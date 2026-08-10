export interface ModelArtifactStorage {
  getObject(key: string): Promise<Uint8Array>;
  hasObject(key: string): Promise<boolean>;
  putObject(input: ModelArtifactStoragePutInput): Promise<void>;
}

export interface ModelArtifactStoragePutInput {
  body: Uint8Array;
  contentType: string;
  ifAbsent: boolean;
  key: string;
}
