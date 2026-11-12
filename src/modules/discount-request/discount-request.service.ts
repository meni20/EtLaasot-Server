import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { AuthorizationService } from '../auth/authorization.service';
import type { AuthUser } from '../auth/authorization.service';
import Branch from '../branch/entities/branch.entity';
import { TraineeDocumentStorageService } from '../storage/trainee-document-storage.service';
import { validateDocumentFile } from '../trainee-document/trainee-document.validation';
import UserRole from '../user-role/enitites/user-role.entity';
import User from '../user/entities/user.entity';
import { decryptNationalId } from '../user/national-id-encryption.util';
import {
  discountDeclarations,
  discountDocuments,
  discountInstructions,
  discountPdfSections,
  discountSections,
  requiredDocuments,
  validateDiscountData,
} from './discount-form';
import { DiscountRequestPdfService } from './discount-request-pdf.service';
import { DiscountRequestRepository } from './discount-request.repository';
import type { DiscountFile, DiscountRow } from './discount-request.repository';

const submitted = { status: 'submitted' } as const;
const checksum = (bytes: Buffer) =>
  createHash('sha256').update(bytes).digest('hex');

@Injectable()
export class DiscountRequestService {
  constructor(
    private readonly repository: DiscountRequestRepository,
    private readonly authorization: AuthorizationService,
    private readonly storage: TraineeDocumentStorageService,
    private readonly pdf: DiscountRequestPdfService,
  ) {}

  async selfStatus(actor: AuthUser) {
    const id = this.selfId(actor);
    const row = await this.repository.find(id);
    if (!row) throw new NotFoundException();
    return row.submittedAt ? submitted : { status: 'available' };
  }

  async draft(actor: AuthUser) {
    const id = this.selfId(actor);
    const row = await this.openDraft(id);
    const user = await User.findByPk(id, { include: [Branch] });
    if (!user) throw new NotFoundException();
    const prefill = await this.repository.prefill(id).catch(() => ({}));
    let nationalId = '';
    if (user.nationalIdEncrypted) {
      try {
        nationalId = decryptNationalId(user.nationalIdEncrypted);
      } catch {
        /* Allow manual correction. */
      }
    }
    return {
      revision: row.revision,
      data: {
        traineeName: user.name ?? '',
        traineeId: nationalId,
        traineeBranch: user.branch?.name ?? '',
        address: user.address ?? '',
        signer: user.parentName ?? '',
        trainee2Included: 'no',
        trainee3Included: 'no',
        ...prefill,
        ...this.repository.draftData(row),
      },
      attachments: this.fileList(row.attachments),
      sections: discountSections,
      declarations: discountDeclarations,
      instructions: discountInstructions,
      documents: discountDocuments,
    };
  }

  async save(actor: AuthUser, input: unknown) {
    const id = this.selfId(actor);
    const row = await this.openDraft(id);
    const body = this.body(input, row);
    return this.repository.update(id, row.revision, {
      data: validateDiscountData(body.data),
    });
  }

  async upload(
    actor: AuthUser,
    key: string,
    revision: string,
    file?: Express.Multer.File,
  ) {
    const id = this.selfId(actor);
    const row = await this.openDraft(id);
    this.checkRevision(row, Number(revision));
    const data = row.data;
    if (!requiredDocuments(data).some((doc) => doc.key === key))
      throw new BadRequestException('המסמך אינו נדרש לפי הפרטים שנשמרו');
    if (!file) throw new BadRequestException('יש לבחור קובץ');
    const info = await validateDocumentFile(file);
    const path = this.storage.buildDiscountPath(id, info.extension);
    const metadata = {
      path,
      originalFilename: info.originalFilename,
      mimeType: info.mimeType,
      checksum: checksum(file.buffer),
    };
    try {
      await this.storage.upload(path, file.buffer, info.mimeType);
      const result = await this.repository.update(id, row.revision, {
        attachments: { ...row.attachments, [key]: metadata },
      });
      if (row.attachments[key]) await this.discard(row.attachments[key].path);
      return { ...result, name: metadata.originalFilename };
    } catch (error) {
      await this.discardIfUnreferenced(id, path);
      throw error;
    }
  }

  async remove(actor: AuthUser, key: string, revision: string) {
    const id = this.selfId(actor);
    const row = await this.openDraft(id);
    this.checkRevision(row, Number(revision));
    if (!discountDocuments.some((doc) => doc.key === key))
      throw new NotFoundException();
    const { [key]: previous, ...attachments } = row.attachments;
    const result = await this.repository.update(id, row.revision, {
      attachments,
    });
    if (previous) await this.discard(previous.path);
    return result;
  }

  async submit(actor: AuthUser, input: unknown) {
    const id = this.selfId(actor);
    const row = await this.repository.find(id);
    if (!row) throw new NotFoundException();
    if (row.submittedAt) return submitted;
    const body = this.body(input, row);
    const data = validateDiscountData(body.data, true);
    const documents = requiredDocuments(data);
    const attachments: Record<string, DiscountFile> = {};
    for (const doc of documents) {
      if (!row.attachments[doc.key])
        throw new BadRequestException('חסר מסמך: ' + doc.label);
      attachments[doc.key] = row.attachments[doc.key];
    }
    if (body.declared !== true)
      throw new BadRequestException('יש לאשר את ההצהרה');
    const signature = this.signature(body.signature);
    const submittedAt = new Date();
    const pdfBytes = await this.pdf.render({
      sections: discountPdfSections(data),
      documents: documents.map((doc) => ({
        label: doc.label,
        value: attachments[doc.key].originalFilename,
      })),
      declarations: discountDeclarations,
      instructions: discountInstructions,
      signature: body.signature,
      submittedAt: submittedAt.toISOString(),
    });
    const evidence = {
      pdf: {
        path: this.storage.buildDiscountPath(id, 'pdf'),
        originalFilename: 'בקשת הנחה.pdf',
        mimeType: 'application/pdf',
        checksum: checksum(pdfBytes),
      },
      signature: {
        path: this.storage.buildDiscountPath(id, 'png'),
        originalFilename: 'חתימת ממלא הבקשה.png',
        mimeType: 'image/png',
        checksum: checksum(signature),
      },
    };
    try {
      await this.storage.upload(
        evidence.signature.path,
        signature,
        evidence.signature.mimeType,
      );
      await this.storage.upload(
        evidence.pdf.path,
        pdfBytes,
        evidence.pdf.mimeType,
      );
      await this.repository.update(id, row.revision, {
        data,
        attachments,
        submittedAt,
        evidence,
      });
    } catch (error) {
      await this.discardIfUnreferenced(
        id,
        evidence.pdf.path,
        evidence.signature.path,
      );
      if ((await this.repository.find(id).catch(() => null))?.submittedAt)
        return submitted;
      throw error;
    }
    await Promise.all(
      Object.entries(row.attachments)
        .filter(([key]) => !attachments[key])
        .map(([, item]) => this.discard(item.path)),
    );
    return submitted;
  }

  async adminStatus(actor: AuthUser, id: string) {
    await this.assertManager(actor, id);
    const row = await this.repository.find(id);
    if (!row) return { status: 'disabled' };
    if (row.submittedAt)
      return {
        ...submitted,
        submittedAt: row.submittedAt,
        attachments: this.fileList(row.attachments),
      };
    return { status: row.revision ? 'draft' : 'enabled' };
  }

  async enable(actor: AuthUser, id: string) {
    const actorId = this.authorization.getActorId(actor);
    if (!actorId) throw new ForbiddenException();
    const user = await this.assertManager(actor, id);
    if (
      !user.isActive ||
      user.userRoles.some(
        (role) => Number(role.roleId) === AUTH_ROLES.VOLUNTEER.id,
      )
    )
      throw new ForbiddenException();
    await this.repository.enable(id, actorId);
    return this.adminStatus(actor, id);
  }

  async download(actor: AuthUser, id: string, key: string) {
    await this.assertManager(actor, id);
    const row = await this.repository.find(id);
    if (!row?.submittedAt || !row.evidence) throw new NotFoundException();
    const file =
      key === 'pdf'
        ? row.evidence.pdf
        : key === 'signature'
          ? row.evidence.signature
          : discountDocuments.some((doc) => doc.key === key)
            ? row.attachments[key]
            : undefined;
    if (!file || !file.path.startsWith('discount/' + id + '/'))
      throw new NotFoundException();
    const bytes = await this.storage.downloadDiscount(file.path);
    if (checksum(bytes) !== file.checksum)
      throw new ServiceUnavailableException('לא ניתן לאמת את הקובץ');
    return { file, bytes };
  }

  private selfId(actor: AuthUser) {
    const id = this.authorization.getActorId(actor);
    if (
      !id ||
      !this.authorization.hasRole(actor, AUTH_ROLES.TRAINEE.id) ||
      this.authorization.hasRole(actor, AUTH_ROLES.VOLUNTEER.id)
    )
      throw new NotFoundException();
    return id;
  }

  private async assertManager(actor: AuthUser, id: string) {
    this.authorization.resolveAdminBranchScope(actor);
    const user = await User.findByPk(id, {
      attributes: ['id', 'branchId', 'isActive'],
      include: [{ model: UserRole, attributes: ['roleId', 'resourceId'] }],
    });
    const traineeRoles = user?.userRoles?.filter(
      (role) => Number(role.roleId) === AUTH_ROLES.TRAINEE.id,
    );
    if (!user || !traineeRoles?.length) throw new NotFoundException();
    if (!this.authorization.isSuperAdmin(actor)) {
      const branches = user.branchId
        ? [user.branchId]
        : traineeRoles.map((role) => String(role.resourceId ?? ''));
      if (
        !branches.some(
          (branch) =>
            branch && this.authorization.hasAdminAccess(actor, branch),
        )
      ) {
        throw new ForbiddenException();
      }
    }
    return user;
  }

  private async openDraft(id: string) {
    const row = await this.repository.find(id);
    if (!row || row.submittedAt) throw new NotFoundException();
    return row;
  }

  private checkRevision(row: DiscountRow, revision: unknown) {
    if (revision !== row.revision)
      throw new ConflictException('הבקשה השתנתה. יש לטעון מחדש את הטופס.');
  }

  private body(input: unknown, row: DiscountRow) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new BadRequestException();
    const body = input as Record<string, unknown>;
    this.checkRevision(row, body.revision);
    return body;
  }

  private signature(image: unknown) {
    const invalid = () => new BadRequestException('יש להשלים חתימה תקינה');
    if (
      typeof image !== 'string' ||
      image.length > 75_000 ||
      !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
    )
      throw invalid();
    const bytes = Buffer.from(
      image.slice('data:image/png;base64,'.length),
      'base64',
    );
    if (
      bytes.length < 45 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.subarray(12, 16).toString() !== 'IHDR' ||
      bytes.readUInt32BE(16) < 1 ||
      bytes.readUInt32BE(16) > 2000 ||
      bytes.readUInt32BE(20) < 1 ||
      bytes.readUInt32BE(20) > 1000 ||
      bytes.subarray(-8, -4).toString() !== 'IEND'
    )
      throw invalid();
    return bytes;
  }

  private fileList(attachments: Record<string, DiscountFile>) {
    return Object.fromEntries(
      Object.entries(attachments).map(([key, file]) => [
        key,
        file.originalFilename,
      ]),
    );
  }

  private async discard(path: string) {
    await this.storage.remove(path).catch(() => undefined);
  }

  private async discardIfUnreferenced(id: string, ...paths: string[]) {
    try {
      const row = await this.repository.find(id);
      const retained = new Set(
        [
          ...Object.values(row?.attachments ?? {}),
          ...Object.values(row?.evidence ?? {}),
        ].map((file) => file.path),
      );
      await Promise.all(
        paths
          .filter((path) => !retained.has(path))
          .map((path) => this.discard(path)),
      );
    } catch {
      // Keep private uploads if the database outcome cannot be verified.
    }
  }
}
