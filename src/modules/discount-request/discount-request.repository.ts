import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  decryptNationalId,
  encryptNationalId,
} from '../user/national-id-encryption.util';
import { discountSections } from './discount-form';

export type DiscountFile = {
  path: string;
  originalFilename: string;
  mimeType: string;
  checksum: string;
};

const identityKeys = discountSections.flatMap(({ fields }) =>
  fields.filter((field) => field.kind === 'id').map((field) => field.key),
);

function protectIdentities(
  data: DiscountRow['data'],
  transform: (value: string) => string,
) {
  const result = { ...data };
  for (const key of identityKeys) {
    if (result[key]) result[key] = transform(result[key]);
  }
  return result;
}
export type DiscountRow = {
  revision: number;
  data: Record<string, string>;
  attachments: Record<string, DiscountFile>;
  submittedAt: Date | null;
  evidence: { pdf: DiscountFile; signature: DiscountFile } | null;
};

@Injectable()
export class DiscountRequestRepository {
  constructor(@InjectConnection() private readonly db: Sequelize) {}

  async find(id: string) {
    const [row] = await this.query<DiscountRow>(
      'SELECT revision, form_data AS data, attachments, submitted_at AS "submittedAt", evidence FROM public.discount_requests WHERE trainee_id = $id',
      { id },
    );
    return row;
  }

  async enable(id: string, actor: string) {
    await this.query(
      'INSERT INTO public.discount_requests (trainee_id, enabled_by) VALUES ($id, $actor) ON CONFLICT (trainee_id) DO NOTHING RETURNING trainee_id',
      { id, actor },
    );
  }

  async prefill(id: string) {
    // Only the trainee's most recent approved record supplies defaults.
    const [row] = await this.query<{
      traineeSchool: string | null;
      fatherName: string | null;
      fatherId: string | null;
      fatherPhone: string | null;
      motherName: string | null;
      motherId: string | null;
      motherPhone: string | null;
    }>(
      `
      SELECT data #>> '{trainee,school}' AS "traineeSchool",
             data #>> '{parent1,name}' AS "fatherName",
             data #>> '{parent1,nationalId}' AS "fatherId",
             data #>> '{parent1,phone}' AS "fatherPhone",
             data #>> '{parent2,name}' AS "motherName",
             data #>> '{parent2,nationalId}' AS "motherId",
             data #>> '{parent2,phone}' AS "motherPhone"
      FROM (
        SELECT draft_data AS data, approved_at AS approved
        FROM public.registration_forms
        WHERE trainee_uuid = $id AND registration_type = 'TRAINEE' AND status = 'APPROVED'
        UNION ALL
        SELECT draft_data AS data, reviewed_at AS approved
        FROM public.trainee_applications
        WHERE provisioned_user_id = $id AND registration_type = 'TRAINEE' AND status = 'APPROVED'
      ) records ORDER BY approved DESC NULLS LAST LIMIT 1
    `,
      { id },
    );
    const data = Object.fromEntries(
      Object.entries(row ?? {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    return protectIdentities(data, (value) => {
      try {
        return decryptNationalId(value);
      } catch {
        return '';
      }
    });
  }

  draftData(row: DiscountRow) {
    return protectIdentities(row.data, decryptNationalId);
  }

  async update(
    id: string,
    revision: number,
    change: Partial<
      Pick<DiscountRow, 'data' | 'attachments' | 'submittedAt' | 'evidence'>
    >,
  ) {
    const [row] = await this.query<{ revision: number }>(
      `UPDATE public.discount_requests
       SET revision = revision + 1, form_data = COALESCE($data::jsonb, form_data),
           attachments = COALESCE($attachments::jsonb, attachments),
           submitted_at = $submittedAt, evidence = $evidence::jsonb
       WHERE trainee_id = $id AND revision = $revision AND submitted_at IS NULL
       RETURNING revision`,
      {
        id,
        revision,
        data: change.data
          ? JSON.stringify(protectIdentities(change.data, encryptNationalId))
          : null,
        attachments: change.attachments
          ? JSON.stringify(change.attachments)
          : null,
        submittedAt: change.submittedAt ?? null,
        evidence: change.evidence ? JSON.stringify(change.evidence) : null,
      },
    );
    if (!row)
      throw new ConflictException('הבקשה השתנתה. יש לטעון מחדש את הטופס.');
    return row;
  }

  private async query<T extends object>(
    sql: string,
    bind: Record<string, unknown>,
  ) {
    try {
      return await this.db.query<T>(sql, {
        bind,
        type: QueryTypes.SELECT,
        logging: false,
      });
    } catch {
      // SQL failures must never log draft values or file metadata.
      throw new ServiceUnavailableException('בקשת ההנחה אינה זמינה כרגע');
    }
  }
}
