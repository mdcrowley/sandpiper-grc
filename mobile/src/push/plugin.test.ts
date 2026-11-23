// The build's push set-up (plugins/withPushNotifications.js): Firebase only with the organization's own
// google-services.json, and Firebase's automatic token creation and analytics switched off.
/* eslint-disable @typescript-eslint/no-require-imports */
// Node's modules (the app's types do not include Node; Jest runs on Node).
declare const require: (id: string) => any;
const fs = require('fs');
const os = require('os');
const path = require('path');

const plugin = require('../../plugins/withPushNotifications');

describe('withPushNotifications', () => {
  it('builds without Firebase unless a google-services.json is supplied', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grc-push-'));
    try {
      expect(plugin.googleServicesFile(dir, {})).toBeNull();
      fs.writeFileSync(path.join(dir, 'google-services.json'), '{}');
      expect(plugin.googleServicesFile(dir, {})).toBe('./google-services.json');
      expect(() => plugin.googleServicesFile(dir, { GRC_GOOGLE_SERVICES_FILE: 'missing.json' })).toThrow(/does not exist/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('switches off Firebase automatic start-up and analytics in the manifest', () => {
    const manifest = { manifest: { $: {}, application: [{ $: { 'android:name': '.MainApplication' }, 'meta-data': [] }] } };
    const out = plugin.addMeta(manifest);
    const meta = Object.fromEntries(out.manifest.application[0]['meta-data'].map((m: { $: Record<string, string> }) => [m.$['android:name'], m.$['android:value']]));
    expect(meta).toMatchObject({ firebase_messaging_auto_init_enabled: 'false', firebase_analytics_collection_deactivated: 'true' });
  });
});
