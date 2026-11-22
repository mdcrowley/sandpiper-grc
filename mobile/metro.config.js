// Metro (the app's bundler): Expo's defaults, plus the repository's `shared/` folder, which holds code
// the server, the web application and the app have in common (tag values and formats, API shapes).
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, '../shared'), path.resolve(__dirname, '../packages')];
module.exports = config;
