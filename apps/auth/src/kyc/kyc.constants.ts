// Shared between the document-upload and NIN-verify (selfie) endpoints —
// both accept an image file through Multer's FileInterceptor.
export const KYC_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/heic'];
export const KYC_MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
