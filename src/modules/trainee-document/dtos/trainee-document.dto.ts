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

export interface AdminTraineeDocumentDto extends TraineeDocumentDto {
  traineeUuid: string;
  traineeName: string;
  branchId: string | null;
  branchName: string | null;
}

export interface AdminTraineeDocumentPageDto {
  items: AdminTraineeDocumentDto[];
  total: number;
  page: number;
  pageSize: number;
}
