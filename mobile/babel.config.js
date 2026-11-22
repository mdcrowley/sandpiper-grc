// The app's Babel set-up (Expo's preset). Also applies to ../shared, which the app imports.
module.exports = function config(api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] };
};
