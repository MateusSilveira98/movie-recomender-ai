import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  datasetImportNormalizedChunkObjectKey,
  datasetImportStatusObjectKey,
  datasetImportUploadObjectKey,
  resolveDatasetImportStoragePrefix,
  sanitizeDatasetImportFileName,
} from './dataset-import-storage-path.service.js';

describe('dataset import storage prefix', () => {
  describe('default prefix', () => {
    it('keeps uploads under dataset-imports when the environment is empty', () => {
      assert.equal(resolveDatasetImportStoragePrefix({}), 'dataset-imports');
    });
  });

  describe('configured prefix', () => {
    it('uses the configured prefix without leading or trailing slashes', () => {
      assert.equal(resolveDatasetImportStoragePrefix({
        DATASET_IMPORT_STORAGE_PREFIX: '/dataset-imports/',
      }), 'dataset-imports');
    });
  });

  describe('invalid prefix', () => {
    it('rejects a prefix that cannot be used as an object path', () => {
      assert.throws(
        () => resolveDatasetImportStoragePrefix({ DATASET_IMPORT_STORAGE_PREFIX: '../secret' }),
        { message: 'DATASET_IMPORT_STORAGE_PREFIX é inválido.' },
      );
    });
  });

  describe('object keys', () => {
    it('places the uploaded file, status and normalized chunk under the same prefix', () => {
      const prefix = 'dataset-imports';

      assert.equal(datasetImportUploadObjectKey(prefix, 'upload-1', 'ratings.csv'), 'dataset-imports/upload-1/ratings.csv');
      assert.equal(datasetImportStatusObjectKey(prefix, 'upload-1'), 'dataset-imports/upload-1/status.json');
      assert.equal(
        datasetImportNormalizedChunkObjectKey(prefix, 'upload-1', 3),
        'dataset-imports/normalized/upload-1/chunk-3.jsonl',
      );
    });
  });

  describe('upload object key reconstruction', () => {
    it('rebuilds the same key used at upload for a plain file name', () => {
      const prefix = 'dataset-imports';
      const uploaded = datasetImportUploadObjectKey(prefix, 'upload-1', sanitizeDatasetImportFileName('credits.csv'));
      const rebuilt = datasetImportUploadObjectKey(prefix, 'upload-1', sanitizeDatasetImportFileName('credits.csv'));

      assert.equal(rebuilt, uploaded);
      assert.equal(rebuilt, 'dataset-imports/upload-1/credits.csv');
    });

    it('sanitizes unsafe characters so the rebuilt key matches the stored object', () => {
      assert.equal(
        datasetImportUploadObjectKey('dataset-imports', 'upload-2', sanitizeDatasetImportFileName('dataset imports (ratings).csv')),
        'dataset-imports/upload-2/dataset_imports__ratings_.csv',
      );
    });

    it('does not double-sanitize a name that was already sanitized', () => {
      const once = sanitizeDatasetImportFileName('a b.csv');

      assert.equal(sanitizeDatasetImportFileName(once), once);
    });
  });
});
