import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getRequiredEnv } from 'src/config/env.util';
import { isAllowedDocumentsBaseUrl } from '../parent-registration/registration-environment';

@Injectable()
export class DiscountRequestPdfService {
  async render(payload: object) {
    try {
      const url = getRequiredEnv('REGISTRATION_DOCUMENTS_URL');
      const key = getRequiredEnv('REGISTRATION_DOCUMENTS_API_KEY');
      if (!isAllowedDocumentsBaseUrl(url) || !/^[a-f0-9]{64}$/.test(key))
        throw new Error();
      const response = await fetch(new URL('/internal/documents/render', url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Api-Key': key,
        },
        body: JSON.stringify({
          template: 'discount-request',
          version: 'v1',
          ...payload,
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(60_000),
      });
      if (response.status === 422)
        throw new BadRequestException('יש לצייר חתימה לפני השליחה');
      if (
        !response.ok ||
        response.headers.get('content-type') !== 'application/pdf'
      )
        throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Buffer[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 10 * 1024 * 1024) {
          await reader.cancel();
          throw new Error();
        }
        chunks.push(Buffer.from(value));
      }
      const bytes = Buffer.concat(chunks);
      if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error();
      return bytes;
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException(
        'יצירת מסמך הבקשה נכשלה. אפשר לנסות שוב.',
      );
    }
  }
}
