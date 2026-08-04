import { Injectable } from '@nestjs/common';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import type { SuperAdminBranchSummary } from './interfaces/dashboard.interface';

type DashboardAggregateRow = {
  branchId: string;
  branchName: string;
  activeVolunteers: string | number;
  activeTrainees: string | number;
  activeAssignments: string | number;
  unassignedTrainees: string | number;
  upcomingEvents: string | number;
};

@Injectable()
export default class DashboardRepository {
  constructor(private readonly sequelize: Sequelize) {}

  public async getSuperAdminBranchSummaries(): Promise<
    SuperAdminBranchSummary[]
  > {
    const rows = await this.sequelize.query<DashboardAggregateRow>(
      `
        WITH role_counts AS (
          SELECT
            u."branchId" AS branch_id,
            COUNT(DISTINCT u.id) FILTER (
              WHERE ur."roleId"::text = :volunteerRoleId
            ) AS active_volunteers,
            COUNT(DISTINCT u.id) FILTER (
              WHERE ur."roleId"::text = :traineeRoleId
            ) AS active_trainees
          FROM "user" u
          INNER JOIN user_roles ur
            ON ur."userId" = u.id
            AND ur."deletedAt" IS NULL
          WHERE u.is_active = true
            AND u."deletedAt" IS NULL
          GROUP BY u."branchId"
        ),
        assignment_counts AS (
          SELECT
            ma."branchId" AS branch_id,
            COUNT(DISTINCT ma.id) AS active_assignments
          FROM mentor_assignment ma
          INNER JOIN "user" mentor
            ON mentor.id = ma."mentorId"
            AND mentor.is_active = true
            AND mentor."deletedAt" IS NULL
          INNER JOIN "user" trainee
            ON trainee.id = ma."traineeId"
            AND trainee.is_active = true
            AND trainee."deletedAt" IS NULL
          WHERE ma."isActive" = true
            AND ma."deletedAt" IS NULL
          GROUP BY ma."branchId"
        ),
        unassigned_counts AS (
          SELECT
            u."branchId" AS branch_id,
            COUNT(DISTINCT u.id) AS unassigned_trainees
          FROM "user" u
          INNER JOIN user_roles ur
            ON ur."userId" = u.id
            AND ur."deletedAt" IS NULL
            AND ur."roleId"::text = :traineeRoleId
          WHERE u.is_active = true
            AND u."deletedAt" IS NULL
            AND NOT EXISTS (
              SELECT 1
              FROM mentor_assignment ma
              WHERE ma."traineeId" = u.id
                AND ma."branchId" = u."branchId"
                AND ma."isActive" = true
                AND ma."deletedAt" IS NULL
            )
          GROUP BY u."branchId"
        ),
        upcoming_event_counts AS (
          SELECT
            e."branchId" AS branch_id,
            COUNT(e.id) AS upcoming_events
          FROM event e
          WHERE e.start_date >= NOW()
            AND e."deletedAt" IS NULL
          GROUP BY e."branchId"
        )
        SELECT
          b.id AS "branchId",
          b.name AS "branchName",
          COALESCE(rc.active_volunteers, 0) AS "activeVolunteers",
          COALESCE(rc.active_trainees, 0) AS "activeTrainees",
          COALESCE(ac.active_assignments, 0) AS "activeAssignments",
          COALESCE(uc.unassigned_trainees, 0) AS "unassignedTrainees",
          COALESCE(ec.upcoming_events, 0) AS "upcomingEvents"
        FROM branch b
        LEFT JOIN role_counts rc ON rc.branch_id = b.id
        LEFT JOIN assignment_counts ac ON ac.branch_id = b.id
        LEFT JOIN unassigned_counts uc ON uc.branch_id = b.id
        LEFT JOIN upcoming_event_counts ec ON ec.branch_id = b.id
        WHERE b."isActive" = true
          AND b."deletedAt" IS NULL
        ORDER BY b.name ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          volunteerRoleId: String(AUTH_ROLES.VOLUNTEER.id),
          traineeRoleId: String(AUTH_ROLES.TRAINEE.id),
        },
      },
    );

    return rows.map((row) => ({
      branchId: row.branchId,
      branchName: row.branchName,
      activeVolunteers: Number(row.activeVolunteers),
      activeTrainees: Number(row.activeTrainees),
      activeAssignments: Number(row.activeAssignments),
      unassignedTrainees: Number(row.unassignedTrainees),
      upcomingEvents: Number(row.upcomingEvents),
    }));
  }
}
