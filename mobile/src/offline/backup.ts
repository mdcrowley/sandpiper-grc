// Offline work never goes into a backup (wave 16, E38-15). On iPhone, files in the app's Documents
// folder are copied into iCloud and computer backups unless marked; the folders offline work is kept in
// are marked through the local module SandpiperStorage (mobile/modules/sandpiper-storage). On Android,
// the manifest's backup and data extraction rules exclude every folder (plugins/withPlatformSecurity.js),
// so nothing needs doing here.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

interface StorageModule {
  excludeFromBackup(address: string): boolean;
}

let native: StorageModule | null | undefined;
const storageModule = (): StorageModule | null => {
  if (native === undefined) native = requireOptionalNativeModule<StorageModule>('SandpiperStorage');
  return native;
};

/** For tests: the native module to use (null: none in this build). */
export function setStorageModuleForTests(m: StorageModule | null | undefined): void {
  native = m;
}

/**
 * Marks a folder (or file) excluded from backups. True when marked (or when nothing is needed, on
 * Android); false when it does not exist yet or the module is missing (an older iPhone build).
 */
export function excludeFromBackup(address: string): boolean {
  if (Platform.OS !== 'ios') return true;
  const m = storageModule();
  if (!m) return false;
  try {
    return m.excludeFromBackup(address);
  } catch {
    return false;
  }
}
