import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { MAX_DOCUMENT_SIZE } from './trainee-document.constants';
import { validateDocumentFile } from './trainee-document.validation';
import { execFileSync } from 'node:child_process';

const pdf = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF',
);
export function documentFile(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    buffer: pdf,
    size: pdf.length,
    originalname: 'document.pdf',
    mimetype: 'application/pdf',
    ...overrides,
  } as Express.Multer.File;
}

describe('document validation (real content detection)', () => {
  it('accepts valid content in native Node outside the Jest ESM loader', () => {
    const script = `
      require('ts-node/register');
      const { validateDocumentFile } = require(${JSON.stringify(require.resolve('./trainee-document.validation'))});
      const buffer = Buffer.from('%PDF-1.4\\n%%EOF');
      validateDocumentFile({buffer, size: buffer.length, originalname: 'test.pdf', mimetype: 'application/pdf'})
        .then(result => { if(result.mimeType !== 'application/pdf') process.exitCode = 1; })
        .catch(() => { process.exitCode = 1; });
    `;
    expect(() =>
      execFileSync(process.execPath, ['-e', script], {
        timeout: 30000,
        stdio: 'pipe',
      }),
    ).not.toThrow();
  }, 35000);
  it.each([
    ['jpg', 'image/jpeg', Buffer.from('ffd8ffdb00040000', 'hex')],
    ['JPEG', 'image/jpeg', Buffer.from('ffd8ffdb00040000', 'hex')],
    [
      'png',
      'image/png',
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY9sAAAAASUVORK5CYII=',
        'base64',
      ),
    ],
    [
      'webp',
      'image/webp',
      Buffer.from('524946462400000057454250565038200000000000000000', 'hex'),
    ],
    ['pdf', 'application/pdf', pdf],
  ])('accepts matching %s content', async (extension, mimetype, buffer) => {
    const result = await validateDocumentFile(
      documentFile({
        originalname: `file.${extension}`,
        mimetype,
        buffer,
        size: buffer.length,
      }),
    );
    expect(result.mimeType).toBe(mimetype);
    expect(result.fileSize).toBe(buffer.length);
  });

  it('rejects missing and empty files', async () => {
    await expect(validateDocumentFile()).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      validateDocumentFile(documentFile({ buffer: Buffer.alloc(0), size: 0 })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unsupported extensions, mismatched MIME and spoofed content', async () => {
    await expect(
      validateDocumentFile(documentFile({ originalname: 'file.exe' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validateDocumentFile(documentFile({ mimetype: 'image/png' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      validateDocumentFile(
        documentFile({ originalname: 'file.png', mimetype: 'image/png' }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    const buffer = Buffer.from('<script>alert(1)</script>');
    await expect(
      validateDocumentFile(documentFile({ buffer, size: buffer.length })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts exactly 10 MiB and rejects one byte over', async () => {
    const buffer = Buffer.alloc(MAX_DOCUMENT_SIZE);
    pdf.copy(buffer);
    await expect(
      validateDocumentFile(documentFile({ buffer, size: buffer.length })),
    ).resolves.toMatchObject({ fileSize: MAX_DOCUMENT_SIZE });
    await expect(
      validateDocumentFile(
        documentFile({
          buffer: Buffer.alloc(MAX_DOCUMENT_SIZE + 1),
          size: MAX_DOCUMENT_SIZE + 1,
        }),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('sanitizes path, control and bidi filename data and bounds metadata', async () => {
    const result = await validateDocumentFile(
      documentFile({
        originalname: `C:\\secret/../${'א'.repeat(300)}\u202e\u0000.pdf`,
      }),
    );
    expect(result.originalFilename.length).toBeLessThanOrEqual(255);
    expect(result.originalFilename).not.toMatch(/[\\/\u202e\u0000]/);
    expect(result.originalFilename).toMatch(/\.pdf$/);
  });
});
