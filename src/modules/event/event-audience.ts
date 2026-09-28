import { Op, type WhereOptions } from 'sequelize';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import type { AuthUser } from '../auth/authorization.service';

export const EVENT_AUDIENCES = ['ALL', 'VOLUNTEERS', 'TRAINEES'] as const;
export type EventAudience = (typeof EVENT_AUDIENCES)[number];
export type AudienceEvent = {
  branchId?: string | null;
  audience?: EventAudience;
};

export function allowedEventAudiences(
  actor: AuthUser,
  branchId: string,
): EventAudience[] {
  const roles = actor.roles ?? [];
  if (
    roles.some(
      (r) =>
        r.roleId === AUTH_ROLES.SUPER_ADMIN.id ||
        (r.roleId === AUTH_ROLES.BRANCH_ADMIN.id &&
          (r.branchId ?? r.resourceId) === branchId),
    )
  ) {
    return [...EVENT_AUDIENCES];
  }
  const localRoles = roles.filter(
    (r) => (r.branchId ?? r.resourceId) === branchId,
  );
  return [
    'ALL',
    ...(localRoles.some((r) => r.roleId === AUTH_ROLES.VOLUNTEER.id)
      ? ['VOLUNTEERS' as const]
      : []),
    ...(localRoles.some((r) => r.roleId === AUTH_ROLES.TRAINEE.id)
      ? ['TRAINEES' as const]
      : []),
  ];
}

// Audience only: callers must retain their existing branch authorization.
export function matchesEventAudience(actor: AuthUser, event: AudienceEvent) {
  return allowedEventAudiences(actor, event.branchId ?? '').includes(
    event.audience ?? 'ALL',
  );
}

export function eventAudienceWhere(
  actor: AuthUser,
  branchId?: string,
): WhereOptions {
  if (actor.roles?.some((r) => r.roleId === AUTH_ROLES.SUPER_ADMIN.id))
    return {};
  if (!branchId) return { id: { [Op.in]: [] } }; // No implicit unrestricted caller.
  return { audience: { [Op.in]: allowedEventAudiences(actor, branchId) } };
}

export function userAudienceActor(user: {
  userRoles?: { roleId: number; resourceId?: string }[];
}): AuthUser {
  return { roles: user.userRoles ?? [] };
}
