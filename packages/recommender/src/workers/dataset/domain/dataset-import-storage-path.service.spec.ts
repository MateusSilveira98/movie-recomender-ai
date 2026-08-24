import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  datasetImportNormalizedChunkObjectKey,
  datasetImportStatusObjectKey,
  datasetImportUploadObjectKey,
  resolveDatasetImportStoragePrefix,
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
});
