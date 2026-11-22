// The licenses list shown on Account > Open-source licenses matches the lockfile.
declare const require: (id: string) => any;
declare const __dirname: string;

const fs = require('fs') as { readFileSync(p: string, enc: string): string };
const path = require('path') as { join(...p: string[]): string };
const { render } = require('../../scripts/licenses.js') as { render: (lock: unknown) => string };

describe('open-source licenses', () => {
  it('is up to date with package-lock.json (run npm run licenses)', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package-lock.json'), 'utf8'));
    expect(fs.readFileSync(path.join(__dirname, 'licenses.json'), 'utf8').replace(/\r\n/g, '\n')).toBe(render(lock));
  });
});
