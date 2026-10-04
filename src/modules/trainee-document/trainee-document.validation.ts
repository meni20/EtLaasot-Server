import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import {
  DOCUMENT_MIME_BY_EXTENSION,
  MAX_DOCUMENT_SIZE,
} from './trainee-document.constants';

export async function validateDocumentFile(file?: Express.Multer.File) {
  if (!file?.buffer?.length || file.size !== file.buffer.length) {
    throw new BadRequestException('A non-empty document file is required');
  }
  if (file.buffer.length > MAX_DOCUMENT_SIZE) {
    throw new PayloadTooLargeException('Document exceeds 10 MB');
  }

  // Only retain a display basename. Never use this value in an object key.
  const basename = file.originalname.split(/[\\/]/).pop() ?? '';
  const extension = basename.match(/\.([a-zA-Z]+)$/)?.[1].toLowerCase() ?? '';
  const mimeType = DOCUMENT_MIME_BY_EXTENSION[extension];
  if (!mimeType || file.mimetype !== mimeType) {
    throw new BadRequestException(
      'Document extension and MIME type must match an allowed format',
    );
  }
  // Import by package name: Nest's FileTypeValidator imports a resolved Windows
  // drive path as an ESM URL, which rejects valid files in the native runtime.
  const { fileTypeFromBuffer } = await import('file-type');
  const detected = await fileTypeFromBuffer(file.buffer).catch(() => undefined);
  if (detected?.mime !== mimeType) {
    throw new BadRequestException(
      'Document content does not match its file type',
    );
  }

  const safeName = basename
    .normalize('NFC')
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
      '',
    )
    .trim();
  const stem = safeName
    .slice(0, -(extension.length + 1))
    .replace(/[<>:"|?*]/g, '')
    .trim();
  const originalFilename = `${Array.from(stem || 'document')
    .slice(0, 240)
    .join('')}.${extension}`;
  return {
    originalFilename,
    mimeType,
    fileSize: file.buffer.length,
    extension: extension === 'jpeg' ? 'jpg' : extension,
  };
}
