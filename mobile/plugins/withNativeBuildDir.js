// Expo config plugin: lets a Windows build keep the C++ (CMake) build folders outside the project,
// under a short folder given with `-PnativeBuildDir=C:/b` (or the NATIVE_BUILD_DIR environment
// variable), and has CMake shorten long object file paths. Without it, object file paths such as
// node_modules/<library>/android/.cxx/.../CMakeFiles/<target>.dir/C_/Users/.../<source>.o pass Windows'
// 260-character limit and ninja fails with "mkdir ... No such file or directory" or "Filename longer
// than 260 characters". Linux and macOS builds (and CI) do not set it and are unchanged. Each library
// gets a short folder name (a hash of its project path), and CMAKE_OBJECT_PATH_MAX makes CMake replace an
// object's folder with a hash when the path would be long. See docs/mobile.md.
const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const MARK = '// sandpiper: nativeBuildDir';
const BLOCK = `
${MARK}
def sandpiperNativeBuildDir = findProperty('nativeBuildDir') ?: System.getenv('NATIVE_BUILD_DIR')
if (sandpiperNativeBuildDir) {
  subprojects { sub ->
    ['com.android.library', 'com.android.application'].each { id ->
      sub.plugins.withId(id) {
        // A library configured before this file runs keeps its own folder.
        try { sub.android.externalNativeBuild.cmake.buildStagingDirectory = new File(sandpiperNativeBuildDir.toString(), Integer.toString(sub.path.hashCode() & 0xffff, 36)) } catch (ignored) { }
        // CMake replaces an object file's folder with a short hash when its path is longer than this.
        try { sub.android.defaultConfig.externalNativeBuild.cmake.arguments('-DCMAKE_OBJECT_PATH_MAX=240') } catch (ignored) { }
      }
    }
  }
}
`;

// The app module (which compiles the autolinked libraries' generated code) is set in its own android { }.
const APP_MARK = '// sandpiper: nativeBuildDir (app)';
const APP_BLOCK = `    ${APP_MARK}
    def sandpiperNativeBuildDir = findProperty('nativeBuildDir') ?: System.getenv('NATIVE_BUILD_DIR')
    if (sandpiperNativeBuildDir) {
        externalNativeBuild { cmake { buildStagingDirectory = new File(sandpiperNativeBuildDir.toString(), 'app') } }
        defaultConfig { externalNativeBuild { cmake { arguments '-DCMAKE_OBJECT_PATH_MAX=240' } } }
    }
`;

function addNativeBuildDir(gradle) {
  return gradle.includes(MARK) ? gradle : `${gradle.trimEnd()}\n${BLOCK}`;
}

function addAppNativeBuildDir(gradle) {
  if (gradle.includes(APP_MARK)) return gradle;
  return gradle.replace(/^android \{\r?\n/m, (m) => `${m}${APP_BLOCK}`);
}

module.exports = (config) => withAppBuildGradle(
  withProjectBuildGradle(config, (c) => {
    c.modResults.contents = addNativeBuildDir(c.modResults.contents);
    return c;
  }),
  (c) => {
    c.modResults.contents = addAppNativeBuildDir(c.modResults.contents);
    return c;
  },
);
module.exports.addNativeBuildDir = addNativeBuildDir;
module.exports.addAppNativeBuildDir = addAppNativeBuildDir;
