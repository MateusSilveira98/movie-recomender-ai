import type {
  DatasetDependency,
  DatasetDiagnosticsPage,
  DatasetDiagnosticsPagination,
  DatasetImportJob,
  DatasetUpload,
  DatasetUploadInput,
} from '../domain/dataset-import-queue.types.js';
import { resolveMissingDatasetDependencies } from '../domain/dataset-import-dependencies.service.js';
import type { DatasetImportGateway, StoredDatasetImportJob } from './ports/dataset-import-gateway.port.js';
import type { DatasetImportChunkDispatcher } from './ports/dataset-import-chunk-dispatcher.port.js';
import { immediateDatasetImportWriteExecutor, type DatasetImportWriteExecutor } from './dataset-import-write-executor.service.js';

export interface DatasetImportQueue {
  enqueue(upload: DatasetUploadInput): Promise<DatasetUpload>;
  findUpload(uploadId: string): Promise<DatasetUpload | null>;
  listDiagnostics(uploadId: string, pagination: DatasetDiagnosticsPagination): Promise<DatasetDiagnosticsPage | null>;
  listJobs(): Promise<DatasetImportJob[]>;
  listUploads(): Promise<DatasetUpload[]>;
  processPending(): Promise<void>;
}

export interface DatasetImportQueueOptions {
  autoProcess?: boolean;
  writeExecutor?: DatasetImportWriteExecutor;
}

export function createDatasetImportQueue(
  gateway: DatasetImportGateway,
  chunkDispatcher?: DatasetImportChunkDispatcher,
  { autoProcess = true, writeExecutor = immediateDatasetImportWriteExecutor }: DatasetImportQueueOptions = {},
): DatasetImportQueue {
  let isProcessing = false;
  let recoveredJobs = false;

  return {
    async enqueue(upload) {
      const queuedUpload = await gateway.createUpload(upload);
      if (autoProcess) {
        void processPendingSafely();
      }
      return queuedUpload;
    },
    findUpload: (uploadId) => gateway.findUpload(uploadId),
    listDiagnostics: (uploadId, pagination) => gateway.listDiagnostics(uploadId, pagination),
    listJobs: () => gateway.listJobs(),
    listUploads: () => gateway.listUploads(),
    processPending: processPendingSafely,
  };

  async function processPendingSafely(): Promise<void> {
    if (isProcessing) return;
    isProcessing = true;
    try {
      await writeExecutor.execute(processPending);
    } catch (error) {
      gateway.reportProcessorFailure(error);
    } finally {
      isProcessing = false;
    }
  }

  async function processPending(): Promise<void> {
    if (!recoveredJobs) {
      await gateway.requeueInterruptedJobs();
      recoveredJobs = true;
    }
    await gateway.reconcileStagedImports();
    let job = await gateway.claimNextJob();
    while (job) {
      await processJob(job);
      job = await gateway.claimNextJob();
    }
  }

  async function processJob(job: StoredDatasetImportJob): Promise<void> {
    const diagnostics = gateway.createDiagnostics(job.uploadId);
    try {
      if (job.attemptCount === 1) {
        await gateway.clearDiagnostics(job.uploadId);
        await gateway.clearRatingKeys(job.uploadId);
      }
      const existingChunks = await gateway.listChunks(job.id);
      if (chunkDispatcher && existingChunks.length > 0) {
        if (!existingChunks.every((chunk) => chunk.status === 'completed')) {
          await Promise.all(existingChunks.map((chunk) => chunkDispatcher.publish({ chunkId: chunk.id, jobId: job.id, type: job.type })));
        }
        return;
      }
      if (!job.storagePath) {
        await diagnostics.record(missingFileDiagnostic());
        await failWithDiagnostics(job, diagnostics, 'Arquivo temporario indisponivel.');
        return;
      }
      if (!await gateway.validateFileStructure(job.type, job.storagePath, diagnostics)) {
        await failWithDiagnostics(job, diagnostics, 'Estrutura do CSV invalida.');
        await gateway.deleteTemporaryFile(job.storagePath);
        return;
      }
      if (job.type === 'links' || job.type === 'ratings' || chunkDispatcher) {
        await gateway.createCheckpoints(job);
        const chunks = await gateway.listChunks(job.id);

        if (chunks.length > 0 && chunks.every((chunk) => chunk.status === 'completed')) return;

        if (chunkDispatcher && chunks.length > 0) {
          await Promise.all(chunks.map((chunk) => chunkDispatcher.publish({ chunkId: chunk.id, jobId: job.id, type: job.type })));
          return;
        }
      }
      if (!chunkDispatcher) {
        const dependencies = await getMissingDependencies(job.type);
        if (dependencies.length > 0) {
          await gateway.waitForDependencies(job, dependencies);
          return;
        }
      }
      const result = await gateway.importFile(job, diagnostics);
      await diagnostics.flush();
      await gateway.completeJob(job, result);
      await gateway.deleteTemporaryFile(job.storagePath);
    } catch (error) {
      await diagnostics.record(processingFailedDiagnostic());
      await failWithDiagnostics(job, diagnostics, 'Falha ao processar o arquivo enviado.');
      if (job.storagePath) await gateway.deleteTemporaryFile(job.storagePath);
      gateway.reportJobFailure(job, error);
    }
  }

  async function failWithDiagnostics(job: StoredDatasetImportJob, diagnostics: ReturnType<DatasetImportGateway['createDiagnostics']>, message: string): Promise<void> {
    await diagnostics.flush();
    await gateway.failJob(job, message, diagnostics.failures());
  }

  async function getMissingDependencies(type: import('../domain/dataset-import-queue.types.js').DatasetFileType): Promise<DatasetDependency[]> {
    return resolveMissingDatasetDependencies(type, await gateway.getDependencyCounts(type));
  }

}

function missingFileDiagnostic() {
  return { category: 'structure' as const, field: null, lineEnd: null, lineStart: null, message: 'O arquivo temporario nao esta mais disponivel.', reason: 'invalid_row' as const, ruleCode: 'temporary_file_missing', value: null };
}

function processingFailedDiagnostic() {
  return { category: 'structure' as const, field: null, lineEnd: null, lineStart: null, message: 'Nao foi possivel processar o CSV.', reason: 'invalid_row' as const, ruleCode: 'processing_failed', value: null };
}
