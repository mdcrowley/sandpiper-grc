// Expo config plugin: Android builds do not include Google's data transport ("Firelog"), through which
// the ML Kit libraries (barcode and text recognition, used by the Tag camera) would send usage
// statistics to Google. Never images, but still data leaving the phone, which the app promises not to
// do (spec §5.8). The transport's components are removed from the merged manifest
// (tools:node="remove"): without the backend discovery service no transport backend is registered,
// so events are dropped on the phone, and without the scheduler service and receiver nothing is
// scheduled for upload. Reading tags is unaffected (ML Kit runs on the phone). iOS: see docs/mobile.md.
const { withAndroidManifest } = require('expo/config-plugins');

const REMOVED = [
  ['service', 'com.google.android.datatransport.runtime.backends.TransportBackendDiscovery'],
  ['service', 'com.google.android.datatransport.runtime.scheduling.jobscheduling.JobInfoSchedulerService'],
  ['receiver', 'com.google.android.datatransport.runtime.scheduling.jobscheduling.AlarmManagerSchedulerBroadcastReceiver'],
];

function removeDataTransport(manifest) {
  const root = manifest.manifest;
  root.$ = { ...root.$, 'xmlns:tools': root.$?.['xmlns:tools'] ?? 'http://schemas.android.com/tools' };
  const app = root.application?.[0];
  if (!app) return manifest;
  for (const [tag, name] of REMOVED) {
    const list = (app[tag] = app[tag] ?? []);
    const found = list.find((el) => el.$?.['android:name'] === name);
    if (found) found.$['tools:node'] = 'remove';
    else list.push({ $: { 'android:name': name, 'tools:node': 'remove' } });
  }
  return manifest;
}

module.exports = (config) => withAndroidManifest(config, (c) => {
  c.modResults = removeDataTransport(c.modResults);
  return c;
});
module.exports.removeDataTransport = removeDataTransport;
module.exports.REMOVED = REMOVED;
