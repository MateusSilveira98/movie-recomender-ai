import { extname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import multer from 'multer';

const uploadDirectory = process.env.UPLOAD_STORAGE_DIR ?? '.uploads';
const maxUploadBytes = Number(process.env.UPLOAD_MAX_BYTES ?? 1073741824);

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    mkdirSync(uploadDirectory, { recursive: true });
    callback(null, uploadDirectory);
  },
  filename: (_request, file, callback) => callback(null, `${randomUUID()}${resolveCsvExtension(file.originalname)}`),
});

export const uploadDatasetFile = multer({
  fileFilter: (_request, file, callback) => callback(null, isCsvFile(file.originalname, file.mimetype)),
  limits: { fileSize: maxUploadBytes, files: 1 },
  storage,
}).single('file');

function isCsvFile(fileName: string, mimeType: string): boolean {
  return extname(fileName).toLowerCase() === '.csv' && ['application/octet-stream', 'application/vnd.ms-excel', 'text/csv'].includes(mimeType);
}

function resolveCsvExtension(fileName: string): string {
  return extname(fileName).toLowerCase() === '.csv' ? '.csv' : '';
}
