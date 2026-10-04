import type { DocumentType } from '../trainee-document.constants';

export interface TraineeDocumentDto {
  id: string;
  documentType: DocumentType;
  originalFilename: string;
  mimeType: string;
  fileSize: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentViewDto {
  signedUrl: string;
  expiresAt: string;
}
