import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes } from 'sequelize';
import { randomUUID } from 'crypto';
import { RegistrationIntegrationService } from '../parent-registration/registration-integration.service';
import {
  AuthorizationService,
  type AuthUser,
} from '../auth/authorization.service';

export type DraftDeletionStatus = {
  applicationId: string;
  status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'COMPLETE';
};
@Injectable()
export class DraftDeletionService implements OnModuleInit, OnModuleDestroy {
  private ready = false;
  private running = false;
  private timer?: ReturnType<typeof setInterval>;
  private readonly logger = new Logger(DraftDeletionService.name);
  constructor(
    @InjectConnection() private readonly db: Sequelize,
    private readonly integration: RegistrationIntegrationService,
    private readonly auth: AuthorizationService,
  ) {}
  private async call<T>(
    expression: string,
    values: Record<string, unknown> = {},
  ): Promise<T> {
    const [row] = await this.db.query<{ result: T }>(
      `SELECT ${expression} AS result`,
      {
        type: QueryTypes.SELECT,
        replacements: values,
        logging: false,
      },
    );
    return row.result;
  }
  async onModuleInit() {
    this.ready = await this.call<boolean>(
      "to_regclass('public.registration_draft_deletions') IS NOT NULL",
    );
    if (!this.ready || !this.integration.enabled()) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, 15000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  private actor(actor: AuthUser) {
    const id = this.auth.getActorId(actor);
    if (!id) throw new ForbiddenException();
    if (!this.ready) throw new NotFoundException();
    return id;
  }
  async eligible(id: string, actor: AuthUser) {
    if (!this.ready) return false;
    return this.call<boolean>(
      'registration_private.draft_delete_eligible(CAST(:id AS uuid),CAST(:actor AS uuid))',
      { id, actor: this.actor(actor) },
    );
  }
  async begin(id: string, actor: AuthUser, revision: number) {
    try {
      const result = await this.call<DraftDeletionStatus>(
        'registration_private.draft_delete_begin(CAST(:id AS uuid),CAST(:actor AS uuid),:revision)',
        { id, actor: this.actor(actor), revision },
      );
      setImmediate(() => {
        void this.tick();
      });
      return result;
    } catch (e) {
      throw this.safeError(e);
    }
  }
  async status(id: string, actor: AuthUser) {
    try {
      return await this.call<DraftDeletionStatus>(
        'registration_private.draft_delete_status(CAST(:id AS uuid),CAST(:actor AS uuid))',
        { id, actor: this.actor(actor) },
      );
    } catch (e) {
      throw this.safeError(e);
    }
  }
  private safeError(e: unknown) {
    if (e instanceof NotFoundException || e instanceof ForbiddenException)
      return e;
    const code = (e as { original?: { code?: string } })?.original?.code;
    if (code === '42501')
      return new ForbiddenException('Draft deletion is not authorized');
    if (code === 'P0002') return new NotFoundException();
    return new ConflictException({
      code: 'DRAFT_DELETION_CONFLICT',
      message: 'Draft cannot be deleted at this revision or state',
    });
  }
  async tick() {
    if (!this.ready || this.running || !this.integration.enabled()) return;
    this.running = true;
    const claim = randomUUID();
    let app: string | null = null;
    try {
      app = await this.call<string | null>(
        'registration_private.draft_delete_claim(CAST(:claim AS uuid))',
        { claim },
      );
      if (!app) return;
      await this.integration.eraseUnsubmittedDraftFiles(app);
      await this.call(
        'registration_private.draft_delete_complete(CAST(:id AS uuid),CAST(:claim AS uuid))',
        { id: app, claim },
      );
    } catch {
      if (app)
        await this.call(
          'registration_private.draft_delete_fail(CAST(:id AS uuid),CAST(:claim AS uuid))',
          { id: app, claim },
        ).catch(() => {});
      this.logger.warn(
        'Draft erasure incomplete; no completion claimed; retry recorded',
      );
    } finally {
      this.running = false;
    }
  }
}
