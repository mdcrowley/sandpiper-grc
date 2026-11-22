// Writes src/about/licenses.json: every package the app ships with (not the development tools), its
// version and license, from package-lock.json. Run `npm run licenses` after changing dependencies; a
// Jest test (src/about/licenses.test.ts) fails when the file is out of date.
const fs = require('node:fs');
const path = require('node:path');

function shippedPackages(lock) {
  const out = new Map();
  for (const [where, p] of Object.entries(lock.packages ?? {})) {
    if (!where || p.dev || p.link) continue;
    const name = p.name ?? where.slice(where.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const key = `${name}@${p.version}`;
    if (!out.has(key)) out.set(key, { name, version: p.version, license: p.license ?? 'see package' });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function render(lock) {
  return `${JSON.stringify(shippedPackages(lock), null, 1)}\n`;
}

module.exports = { render, shippedPackages };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  fs.writeFileSync(path.join(root, 'src/about/licenses.json'), render(lock));
  console.log(`src/about/licenses.json: ${shippedPackages(lock).length} packages`);
}
