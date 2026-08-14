export interface DatasetImportWriteExecutor {
  execute<T>(work: () => Promise<T>): Promise<T>;
}

export interface DatasetImportWriteExecutorOptions {
  delay?: (milliseconds: number) => Promise<void>;
  maximumAttempts?: number;
}

export function createDatasetImportWriteExecutor({
  delay = defaultDelay,
  maximumAttempts = 4,
}: DatasetImportWriteExecutorOptions = {}): DatasetImportWriteExecutor {
  let tail = Promise.resolve();

  return {
    execute<T>(work: () => Promise<T>): Promise<T> {
      const task = tail.then(() => executeWithRetry(work));
      tail = task.then(() => undefined, () => undefined);
      return task;
    },
  };

  async function executeWithRetry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        if (!isSqliteBusy(error) || attempt >= maximumAttempts) throw error;
        await delay(50 * 2 ** (attempt - 1));
      }
    }
  }
}

export const immediateDatasetImportWriteExecutor: DatasetImportWriteExecutor = {
  execute: (work) => work(),
};

function isSqliteBusy(error: unknown): boolean {
  return error instanceof Error && error.message.includes('SQLITE_BUSY');
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
