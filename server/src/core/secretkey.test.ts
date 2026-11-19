import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.ts';
import { readTotpSecret, secretBox, storeTotpSecret } from './auth.ts';
import { makeSecretBox } from './secretbox.ts';
import { defaultKeyFile, describeSecretKey, parseKey, previousKeyFile, resolveSecretKey, rotateSecretKey } from './secretkey.ts';
import { generateTotpSecret } from './totp.ts';

let parent: string;
let dataDir: string;
let keep: NodeJS.ProcessEnv;

beforeEach(() => {
  keep = { ...process.env };
  delete process.env.GRC_SECRET_KEY; delete process.env.GRC_SECRET_KEY_FILE; delete process.env.GRC_SECRET_KEY_PREVIOUS;
  parent = mkdtempSync(join(tmpdir(), 'grc-key-'));
  dataDir = join(parent, 'data');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  process.env = keep;
  vi.restoreAllMocks();
  rmSync(parent, { recursive: true, force: true });
});

const hexKey = () => randomBytes(32).toString('hex');
const legacyFile = () => join(dataDir, 'secret.key');

describe('secret key kept out of the data folder (E02-16)', () => {
  it('generates the key beside the data folder on a new installation, and says so', async () => {
    const app = await buildApp({ dataDir, serveWeb: false });
    await app.close();
    expect(defaultKeyFile(dataDir)).toBe(join(parent, 'data.secret.key'));
    expect(existsSync(defaultKeyFile(dataDir))).toBe(true);
    expect(existsSync(legacyFile())).toBe(false);
    expect(readFileSync(defaultKeyFile(dataDir), 'utf8').trim()).toMatch(/^[0-9a-f]{64}$/);
    expect((console.log as any).mock.calls.flat().join('\n')).toMatch(/Generated a new key in .*data\.secret\.key, beside the data folder/);
    // The next start uses the same file and reports where it came from.
    const again = resolveSecretKey(dataDir);
    expect(again.file).toBe(defaultKeyFile(dataDir));
    expect(again.notes.join(' ')).toMatch(/Using the key in .*data\.secret\.key/);
  });

  it('moves the key of an existing installation out of the data folder, and its values still open', async () => {
    mkdirSync(dataDir, { recursive: true });
    const key = hexKey();
    writeFileSync(legacyFile(), `${key}\n`);
    // A value written by the earlier version with that key.
    const secret = generateTotpSecret();
    const sealedOld = makeSecretBox(parseKey(key)).encrypt(secret, 'totp:x');

    const found = resolveSecretKey(dataDir);
    expect(found.file).toBe(defaultKeyFile(dataDir));
    expect(found.key.toString('hex')).toBe(key);
    expect(existsSync(legacyFile())).toBe(false);
    expect(found.notes.join(' ')).toMatch(/Moved the key out of the data folder/);
    expect(makeSecretBox(found.key, found.previous).decrypt(sealedOld, 'totp:x')).toBe(secret);
  });

  it('removes a second identical copy, and keeps a different one as a retired key', () => {
    mkdirSync(dataDir, { recursive: true });
    const key = hexKey();
    writeFileSync(defaultKeyFile(dataDir), key);
    writeFileSync(legacyFile(), key);
    resolveSecretKey(dataDir);
    expect(existsSync(legacyFile())).toBe(false);

    const older = hexKey();
    writeFileSync(legacyFile(), older); // an old backup restored over the data folder
    const found = resolveSecretKey(dataDir);
    expect(found.key.toString('hex')).toBe(key);
    expect(found.previous.map((k) => k.toString('hex'))).toContain(older);
    expect(found.warnings.join(' ')).toMatch(/Two different secret keys/);
    expect(existsSync(legacyFile())).toBe(true); // left for the operator
  });

  it('warns about a key file inside the data folder, and reads an old in-folder key when the key is in the environment', () => {
    mkdirSync(dataDir, { recursive: true });
    process.env.GRC_SECRET_KEY_FILE = join(dataDir, 'my.key');
    expect(resolveSecretKey(dataDir).warnings.join(' ')).toMatch(/inside the data folder/);
    delete process.env.GRC_SECRET_KEY_FILE;

    const older = hexKey();
    writeFileSync(legacyFile(), older);
    process.env.GRC_SECRET_KEY = hexKey();
    const found = resolveSecretKey(dataDir);
    expect(found.source).toBe('environment');
    expect(found.previous.map((k) => k.toString('hex'))).toContain(older);
    expect(found.warnings.join(' ')).toMatch(/older key file is still in the data folder/);
  });

  it('shows where the key comes from and rotates it; stored values are re-encrypted at the next start', async () => {
    expect(describeSecretKey(dataDir).join(' ')).toMatch(/No key yet/);
    const first = await buildApp({ dataDir, serveWeb: false });
    const user = (await first.db.one<{ id: string }>(
      `insert into users (username, email, display_name, status) values ('rot', 'rot@example.test', 'Rot', 'active') returning id`))!;
    const secret = generateTotpSecret();
    await storeTotpSecret(first.db, user.id, secret);
    await first.close();
    expect(describeSecretKey(dataDir).join(' ')).toMatch(/data\.secret\.key .*fingerprint [0-9a-f]{12}/);

    writeFileSync(join(dataDir, 'grc.pid'), '1');
    expect(() => rotateSecretKey(dataDir)).toThrow(/running/);
    rmSync(join(dataDir, 'grc.pid'));
    const before = readFileSync(defaultKeyFile(dataDir), 'utf8').trim();
    const said = rotateSecretKey(dataDir).join(' ');
    expect(said).toMatch(/New secret key written/);
    expect(said).not.toContain(before);
    expect(readFileSync(defaultKeyFile(dataDir), 'utf8').trim()).not.toBe(before);
    expect(readFileSync(previousKeyFile(defaultKeyFile(dataDir)), 'utf8').trim()).toBe(before);

    const second = await buildApp({ dataDir, serveWeb: false });
    expect(await readTotpSecret(second.db, user.id)).toBe(secret);
    const stored = (await second.db.one<{ totp_secret: string }>('select totp_secret from users where id = $1', [user.id]))!.totp_secret;
    expect(secretBox(second.db).isCurrent(stored, `totp:${user.id}`)).toBe(true);
    await second.close();

    process.env.GRC_SECRET_KEY = hexKey();
    expect(() => rotateSecretKey(dataDir)).toThrow(/GRC_SECRET_KEY/);
  });
});
