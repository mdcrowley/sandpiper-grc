// Expo config plugin for push notifications (E38-14). Owner: W14-PUSH.
//
// Firebase Cloud Messaging is optional on Android. The organization supplies its own Firebase project's
// google-services.json at build time, either as mobile/google-services.json (never committed: it names the
// organization's project) or through GRC_GOOGLE_SERVICES_FILE (a path). With the file, the build applies
// Google's services plugin and the app can get an FCM token; without it, the build has no Firebase project,
// getDevicePushTokenAsync fails on Android, and the app falls back to UnifiedPush (when the server offers it
// and the build carries the connector). iPhones use Apple's push service and need no such file.
//
// Firebase Messaging, which expo-notifications includes, must not talk to Google before the person
// switches push on: automatic token creation at start-up is switched off (the app asks for a token only
// when push is on), and Firebase Analytics collection is switched off in case any library brings it in.
// Google's data transport ("Firelog", used for Firebase delivery metrics and ML Kit usage reports) is
// removed by withoutDataTransport.js.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const META = [
  ['firebase_messaging_auto_init_enabled', 'false'],
  ['firebase_analytics_collection_enabled', 'false'],
  ['firebase_analytics_collection_deactivated', 'true'],
  ['google_analytics_adid_collection_enabled', 'false'],
  ['firebase_performance_collection_deactivated', 'true'],
];

/** The google-services.json to build with, relative to the project, or null for a build without Firebase. */
function googleServicesFile(projectRoot, env = process.env) {
  const given = env.GRC_GOOGLE_SERVICES_FILE;
  if (given) {
    const full = path.resolve(projectRoot, given);
    if (!fs.existsSync(full)) throw new Error(`GRC_GOOGLE_SERVICES_FILE names ${full}, which does not exist.`);
    return full;
  }
  const local = path.join(projectRoot, 'google-services.json');
  return fs.existsSync(local) ? './google-services.json' : null;
}

function addMeta(manifest) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  for (const [name, value] of META) AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, name, value);
  return manifest;
}

module.exports = (config) => {
  const file = googleServicesFile(config._internal?.projectRoot ?? process.cwd());
  if (file) config.android = { ...config.android, googleServicesFile: file };
  else if (config.android) delete config.android.googleServicesFile;
  return withAndroidManifest(config, (c) => {
    c.modResults = addMeta(c.modResults);
    return c;
  });
};
module.exports.googleServicesFile = googleServicesFile;
module.exports.addMeta = addMeta;
module.exports.META = META;
