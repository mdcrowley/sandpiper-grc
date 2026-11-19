// Shapes returned by the file and backup administration routes.

export interface Usage {
  byDriver: { driver: string; files: number; bytes: number }[];
  active: { files: number; bytes: number };
  removed: { files: number; bytes: number };
  purged: { files: number; bytes: number };
  notScanned: number;
}

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  pathStyle: boolean;
  prefix: string;
  sse: 'none' | 'AES256' | 'aws:kms';
  kmsKeyId: string;
  credentials: 'settings' | 'file' | 'environment';
  accessKeyId: string;
  credentialsFile: string;
  secretSet: boolean;
}

export interface ScannerSettings {
  enabled: boolean;
  host: string;
  port: number;
  timeoutSeconds: number;
  maxMb: number;
  whenUnavailable: 'accept' | 'refuse';
}

export interface FilesOverview {
  storage: { driver: 'disk' | 's3'; s3: S3Settings };
  s3Problem: string | null;
  scanner: ScannerSettings;
  activeScanner: string;
  purgeDays: number;
  usage: Usage;
}

export interface RemovedFile {
  id: string;
  file_name: string;
  type_group: string;
  size_bytes: number;
  kind: string;
  removed_at: string;
  removed_reason: 'removed' | 'record_gone' | 'infected';
  storage_driver: string;
  purge_on: string | null;
  record_label: string;
  record_type_label: string;
  record_route: string | null;
  record_deleted: boolean;
  can_restore: boolean;
}

export interface BackupSettings {
  enabled: boolean;
  time: string;
  keep: number;
  destination: 'folder' | 's3';
  folder: string;
  s3Prefix: string;
  encrypt: boolean;
  includeSecretKey: boolean;
}

export interface BackupRun {
  id: string;
  trigger: 'scheduled' | 'manual';
  status: 'running' | 'ok' | 'failed';
  started_at: string;
  finished_at: string | null;
  destination: string | null;
  archive_name: string | null;
  bytes: number | null;
  encrypted: boolean;
  verified: boolean;
  pruned: string[];
  message: string | null;
  created_by_name: string | null;
}

export interface BackupsOverview {
  settings: BackupSettings;
  timeZone: string;
  keySource: string | null;
  /** Where the application's secret key is, and whether backups hold it. */
  secretKeyNote: string;
  secretKeyFile: boolean;
  s3Available: boolean;
  destination: string | null;
  running: boolean;
  lastSuccess: BackupRun | null;
  runs: BackupRun[];
}

export const STORE_LABELS: Record<string, string> = { disk: 'Local disk', memory: 'Local disk', s3: 'Object store' };
