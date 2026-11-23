// The security review of the app's own storage (wave 16, E38-15): the Android build's network and backup
// rules (plugins/withPlatformSecurity.js), the iPhone backup exclusion of offline work (backup.ts), a new
// iPhone installation starting signed out (auth/install.ts), and the cache emptied with the rest.
/* eslint-disable @typescript-eslint/no-require-imports */
// Node's modules (the app's types do not include Node; Jest runs on Node).
declare const require: (id: string) => any;
declare const __dirname: string;

const mockFiles = new Map<string, string>();
const mockCache: { name: string; deleted: boolean }[] = [];
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(dir: { uri: string } | string, name?: string) {
      this.uri = typeof dir === 'string' ? dir : `${dir.uri}${name}`;
    }
    get exists() { return mockFiles.has(this.uri); }
    create() { mockFiles.set(this.uri, ''); }
    write(text: string) { mockFiles.set(this.uri, text); }
    delete() { mockFiles.delete(this.uri); }
  }
  class Directory {
    uri: string;
    constructor(dir: { uri: string }, ...names: string[]) {
      this.uri = `${dir.uri}${names.join('/')}/`;
    }
    get exists() { return true; }
    create() {}
    delete() {}
  }
  const entry = (name: string) => {
    const e = { name, deleted: false, delete() { e.deleted = true; } };
    mockCache.push(e);
    return e;
  };
  return {
    File, Directory,
    Paths: {
      document: { uri: 'file:///app/Documents/' },
      cache: { uri: 'file:///app/Caches/', list: () => [entry('ImageManipulator'), entry('http-cache')] },
    },
  };
});
const mockKeychain = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (k: string) => mockKeychain.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { mockKeychain.set(k, v); },
  deleteItemAsync: async (k: string) => { mockKeychain.delete(k); },
}));
jest.mock('expo-sqlite', () => ({ openDatabaseAsync: jest.fn(), deleteDatabaseAsync: jest.fn(async () => undefined) }));

const fs = require('fs');
const os = require('os');
const path = require('path');

const plugin = require('../../plugins/withPlatformSecurity');

describe('the Android build (plugins/withPlatformSecurity.js)', () => {
  const manifest = () => ({
    manifest: {
      $: {},
      application: [{ $: {
        'android:name': '.MainApplication', 'android:allowBackup': 'true', 'android:usesCleartextTraffic': 'true',
        'android:fullBackupContent': '@xml/secure_store_backup_rules', 'android:dataExtractionRules': '@xml/secure_store_data_extraction_rules',
      } }],
    },
  });

  it('points the application at its own network and backup rules and allows no backup', () => {
    const app = plugin.applyManifest(manifest()).manifest.application[0].$;
    expect(app).toMatchObject({
      'android:allowBackup': 'false',
      'android:networkSecurityConfig': '@xml/sandpiper_network_security_config',
      'android:fullBackupContent': '@xml/sandpiper_backup_rules',
      'android:dataExtractionRules': '@xml/sandpiper_data_extraction_rules',
    });
    expect(app['android:usesCleartextTraffic']).toBeUndefined();
  });

  it('release builds trust only system authorities over HTTPS; only development variants allow more', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grc-netsec-'));
    try {
      plugin.writeFiles(dir);
      const read = (variant: string, name: string) => fs.readFileSync(path.join(dir, 'app', 'src', variant, 'res', 'xml', `${name}.xml`), 'utf8');
      const release = read('main', 'sandpiper_network_security_config');
      expect(release).toContain('cleartextTrafficPermitted="false"');
      expect(release).toContain('<certificates src="system"/>');
      expect(release).not.toContain('src="user"');
      expect(release).not.toContain('domain-config');
      expect(release).not.toContain('debug-overrides');
      for (const variant of plugin.DEVELOPMENT_VARIANTS) {
        const dev = read(variant, 'sandpiper_network_security_config');
        expect(dev).toContain('cleartextTrafficPermitted="true"');
        expect(dev).toContain('src="user"');
      }
      // Nothing other than the release folder ships in a release build, and it has all three files.
      expect(fs.readdirSync(path.join(dir, 'app', 'src', 'main', 'res', 'xml')).sort()).toEqual([
        'sandpiper_backup_rules.xml', 'sandpiper_data_extraction_rules.xml', 'sandpiper_network_security_config.xml',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('keeps every storage domain out of cloud backups and device-to-device transfers', () => {
    const backup = plugin.FILES.release['sandpiper_backup_rules.xml'] as string;
    const extraction = plugin.FILES.release['sandpiper_data_extraction_rules.xml'] as string;
    expect(backup).not.toContain('<include');
    expect(extraction).not.toContain('<include');
    const [cloud, transfer] = [/<cloud-backup>([\s\S]*?)<\/cloud-backup>/, /<device-transfer>([\s\S]*?)<\/device-transfer>/].map((re) => re.exec(extraction)![1]!);
    for (const d of plugin.DOMAINS as string[]) {
      for (const section of [backup, cloud, transfer]) expect(section).toContain(`<exclude domain="${d}" path="."/>`);
    }
  });

  it('is in app.json, and expo-secure-store\'s own backup rules (which keep other preferences) are off', () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'app.json'), 'utf8')).expo;
    expect(app.android.allowBackup).toBe(false);
    expect(app.plugins).toContain('./plugins/withPlatformSecurity');
    expect(app.plugins).toContainEqual(['expo-secure-store', { configureAndroidBackup: false }]);
  });
});

describe('offline work stays out of iPhone backups (backup.ts)', () => {
  const { Platform } = require('react-native');
  const backup = require('./backup');
  afterEach(() => { Platform.OS = 'ios'; backup.setStorageModuleForTests(undefined); });

  it('marks the folders through the native module on iPhone, and needs nothing on Android', () => {
    const marked: string[] = [];
    backup.setStorageModuleForTests({ excludeFromBackup: (a: string) => { marked.push(a); return true; } });
    Platform.OS = 'ios';
    expect(backup.excludeFromBackup('file:///app/Documents/offline/')).toBe(true);
    expect(marked).toEqual(['file:///app/Documents/offline/']);
    Platform.OS = 'android';
    expect(backup.excludeFromBackup('file:///data/files/offline/')).toBe(true);
    expect(marked).toHaveLength(1);
  });

  it('says so when the module is missing or fails, without throwing', () => {
    Platform.OS = 'ios';
    backup.setStorageModuleForTests(null);
    expect(backup.excludeFromBackup('file:///x/')).toBe(false);
    backup.setStorageModuleForTests({ excludeFromBackup: () => { throw new Error('no'); } });
    expect(backup.excludeFromBackup('file:///x/')).toBe(false);
  });

  it('the database folder and the files folder are both marked when the store marks them', () => {
    const marked: string[] = [];
    backup.setStorageModuleForTests({ excludeFromBackup: (a: string) => { marked.push(a); return true; } });
    Platform.OS = 'ios';
    require('./sqlite').keepOutOfBackups();
    expect(marked).toEqual(['file:///app/Documents/SQLite/', 'file:///app/Documents/offline/']);
  });
});

describe('a wipe empties the cache folder too (sqlite.ts)', () => {
  it('deletes every entry of the cache (camera copies, downloaded images)', async () => {
    mockCache.length = 0;
    await require('./sqlite').wipeOfflineStorage();
    expect(mockCache.map((e) => [e.name, e.deleted])).toEqual([['ImageManipulator', true], ['http-cache', true]]);
  });
});

describe('a new iPhone installation starts signed out (auth/install.ts)', () => {
  const { forgetEarlierInstallation, MARKER } = require('../auth/install');

  it('removes Keychain items an earlier installation left, once', async () => {
    mockFiles.clear();
    for (const k of ['grc.installation', 'grc.server', 'grc.hello', 'grc.tokens', 'grc.prefs', 'grc.profile']) mockKeychain.set(k, 'left over');
    await expect(forgetEarlierInstallation('ios')).resolves.toBe(true);
    expect([...mockKeychain.keys()]).toEqual([]);
    expect(mockFiles.has(`file:///app/Documents/${MARKER}`)).toBe(true);
    // Later launches of the same installation keep what they stored.
    mockKeychain.set('grc.tokens', 'this installation');
    await expect(forgetEarlierInstallation('ios')).resolves.toBe(false);
    expect(mockKeychain.get('grc.tokens')).toBe('this installation');
  });

  it('does nothing on Android, where the Keystore goes with the app', async () => {
    mockFiles.clear();
    mockKeychain.set('grc.tokens', 'kept');
    await expect(forgetEarlierInstallation('android')).resolves.toBe(false);
    expect(mockKeychain.get('grc.tokens')).toBe('kept');
  });
});
