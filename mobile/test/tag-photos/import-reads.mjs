// Measuring the real recognizers on the tag photo test set (E38-05).
//
// 1. Copy the pictures into a development build's documents folder (adb on PATH; one device connected;
//    the app installed as a debuggable build):
//      node mobile/test/tag-photos/import-reads.mjs push
// 2. In the app: Tag, then press and hold "Choose a picture". Every picture in the folder is read on the
//    device and its reads are logged as "[tag-photo-reads] <file name> <json>", then
//    "[tag-photo-reads-done]". Save the log: `adb logcat -d -s ReactNativeJS:V > reads.log`.
// 3. Import the reads into real-reads.json:
//      node mobile/test/tag-photos/import-reads.mjs import reads.log "<device and system, e.g. Android emulator, API 36>"
// 4. `npm test -- test/tag-photos` in mobile/ then also runs the value rules on the real reads and
//    prints that rate next to the modeled one.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [command, logFile, device] = process.argv.slice(2);
const APP = 'com.sandpipergrc';
const TMP = '/data/local/tmp/tag-photos';

if (command === 'push') {
  const files = readdirSync(join(here, 'images')).filter((f) => f.endsWith('.png'));
  execFileSync('adb', ['shell', 'rm', '-rf', TMP], { stdio: 'inherit' });
  execFileSync('adb', ['shell', 'mkdir', '-p', TMP], { stdio: 'inherit' });
  for (const f of files) execFileSync('adb', ['push', join(here, 'images', f), `${TMP}/${f}`], { stdio: 'ignore' });
  execFileSync('adb', ['shell', `run-as ${APP} sh -c 'rm -rf files/tag-photos; mkdir -p files/tag-photos; cp ${TMP}/*.png files/tag-photos/'`], { stdio: 'inherit' });
  console.log(`${files.length} pictures copied to the app's documents folder (tag-photos)`);
} else if (command === 'import' && logFile) {
  const set = JSON.parse(readFileSync(join(here, 'set.json'), 'utf8'));
  const ids = new Set(set.photos.map((p) => p.id));
  const reads = {};
  for (const line of readFileSync(logFile, 'utf8').split(/\r?\n/)) {
    // Metro prints `[tag-photo-reads] name {json}`; logcat prints `'[tag-photo-reads]', 'name', '{json}'`.
    const m = /\[tag-photo-reads\]'?,?\s+'?([^\s']+)'?,?\s+'?(\{.*\})'?\s*$/.exec(line);
    if (!m) continue;
    const id = m[1].replace(/^.*\//, '').replace(/\.(png|jpe?g)$/i, '');
    if (!ids.has(id)) continue;
    const r = JSON.parse(m[2]);
    if (!r.error) reads[id] = { ...r, still: true };
  }
  const out = { recordedOn: new Date().toISOString().slice(0, 10), device: device ?? 'unknown device', reads };
  writeFileSync(join(here, 'real-reads.json'), `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${Object.keys(reads).length} of ${ids.size} pictures imported into real-reads.json`);
} else {
  console.log('Usage: import-reads.mjs push | import <log file> "<device>"');
  process.exit(1);
}
