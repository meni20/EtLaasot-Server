export enum DocumentType {
  MAGNETIC_CARD = 'MAGNETIC_CARD',
  ID_APPENDIX = 'ID_APPENDIX',
  QUEUE_EXEMPTION = 'QUEUE_EXEMPTION',
}

export const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024;
export const DOCUMENT_URL_TTL_SECONDS = 60;
export const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};
