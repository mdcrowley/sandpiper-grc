// Expo config plugin: Android release builds come out UNSIGNED (app-release-unsigned.apk) instead of
// signed with the shared debug key that Expo's template uses. The release key is kept outside the
// repository and applied afterwards with apksigner (docs/mobile.md, "Signing the Android app").
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_SIGNING = /(release\s*\{[^}]*?)signingConfig\s+signingConfigs\.debug/;

function unsignRelease(gradle) {
  if (!RELEASE_SIGNING.test(gradle)) return gradle;
  return gradle.replace(RELEASE_SIGNING, '$1signingConfig null // unsigned: sign with apksigner (docs/mobile.md)');
}

module.exports = (config) => withAppBuildGradle(config, (c) => {
  c.modResults.contents = unsignRelease(c.modResults.contents);
  return c;
});
module.exports.unsignRelease = unsignRelease;
