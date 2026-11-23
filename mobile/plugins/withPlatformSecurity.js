// Expo config plugin (wave 16, E38-15 security review): the Android app's network and backup rules,
// written out rather than left to platform defaults or to what a library's manifest might add.
//
// - Network security config: release builds send nothing in plain HTTP and trust only the system's
//   certificate authorities, never one a person or a device-management profile installed (spec §5.8).
//   Development builds (the `debug` and `debugOptimized` variants, which already allow plain HTTP for a
//   server on the developer's computer and Metro) replace the file with one that allows plain HTTP and
//   user-installed authorities (for a test proxy). Release builds never contain that file.
// - Backup: `allowBackup` is false, and the backup and data extraction rules exclude every storage
//   domain, so neither a cloud backup nor an Android 12+ device-to-device transfer (which `allowBackup`
//   alone does not stop) copies the offline database, photos, drafts or preferences to another phone.
//   expo-secure-store's own rules (which keep other shared preferences) are switched off in app.json
//   (`configureAndroidBackup: false`).
//
// iPhone: tokens are in the Keychain with "when unlocked, this device only" (never in an iCloud backup
// or on another device); App Transport Security uses the system's trust store, and the app itself
// refuses a plain HTTP server or sign-in address in release builds (src/auth/server.ts).
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const NETWORK = 'sandpiper_network_security_config';
const BACKUP = 'sandpiper_backup_rules';
const EXTRACTION = 'sandpiper_data_extraction_rules';

/** Every storage domain an Android backup or transfer can name (credential and device-protected storage). */
const DOMAINS = ['root', 'file', 'database', 'sharedpref', 'external', 'device_root', 'device_file', 'device_database', 'device_sharedpref'];

const HEADER = '<?xml version="1.0" encoding="utf-8"?>\n<!-- Written by mobile/plugins/withPlatformSecurity.js. Do not edit. -->\n';
const excludes = (indent) => DOMAINS.map((d) => `${indent}<exclude domain="${d}" path="."/>`).join('\n');

const FILES = {
  release: {
    [`${NETWORK}.xml`]: `${HEADER}<network-security-config>
  <base-config cleartextTrafficPermitted="false">
    <trust-anchors>
      <certificates src="system"/>
    </trust-anchors>
  </base-config>
</network-security-config>
`,
    [`${BACKUP}.xml`]: `${HEADER}<full-backup-content>
${excludes('  ')}
</full-backup-content>
`,
    [`${EXTRACTION}.xml`]: `${HEADER}<data-extraction-rules>
  <cloud-backup>
${excludes('    ')}
  </cloud-backup>
  <device-transfer>
${excludes('    ')}
  </device-transfer>
</data-extraction-rules>
`,
  },
  development: {
    [`${NETWORK}.xml`]: `${HEADER}<!-- Development builds only: plain HTTP to a local server and Metro, and user-installed authorities for a test proxy. -->
<network-security-config>
  <base-config cleartextTrafficPermitted="true">
    <trust-anchors>
      <certificates src="system"/>
      <certificates src="user"/>
    </trust-anchors>
  </base-config>
</network-security-config>
`,
  },
};

/** The build variants whose resources replace the release ones (development builds). */
const DEVELOPMENT_VARIANTS = ['debug', 'debugOptimized'];

/** Sets the application's network and backup attributes in the main manifest. */
function applyManifest(manifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  app.$['android:allowBackup'] = 'false';
  app.$['android:fullBackupContent'] = `@xml/${BACKUP}`;
  app.$['android:dataExtractionRules'] = `@xml/${EXTRACTION}`;
  app.$['android:networkSecurityConfig'] = `@xml/${NETWORK}`;
  delete app.$['android:usesCleartextTraffic'];
  return manifest;
}

/** Writes the rule files into `<android>/app/src/<variant>/res/xml/`. */
function writeFiles(androidRoot) {
  const write = (variant, files) => {
    const dir = path.join(androidRoot, 'app', 'src', variant, 'res', 'xml');
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  };
  write('main', FILES.release);
  for (const v of DEVELOPMENT_VARIANTS) write(v, FILES.development);
}

module.exports = (config) => {
  config = withAndroidManifest(config, (c) => {
    c.modResults = applyManifest(c.modResults);
    return c;
  });
  return withDangerousMod(config, ['android', async (c) => {
    writeFiles(c.modRequest.platformProjectRoot);
    return c;
  }]);
};
module.exports.applyManifest = applyManifest;
module.exports.writeFiles = writeFiles;
module.exports.FILES = FILES;
module.exports.DOMAINS = DOMAINS;
module.exports.DEVELOPMENT_VARIANTS = DEVELOPMENT_VARIANTS;
