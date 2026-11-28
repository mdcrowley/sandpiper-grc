import { mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkRoots, isJunkName, listFolder, LocalPathError, makeGuard, nameMatcher, openChecked, pathTextProblem, resolveLocal, serverPaths, within,
} from './local.ts';

// The path guards of local file import (E18-96), on a temporary folder of invented files: what may be
// read, and everything that must be refused (outside the folders, "..", links and junctions that lead
// out, UNC and device paths, alternate data streams, the server's own files, folders and devices).

const isWin = process.platform === 'win32';
let base = '';
let root = '';
let outside = '';
let fileLink = false;

const refusal = async (p: Promise<unknown>) => {
  try { await p; } catch (err) { if (err instanceof LocalPathError) return err.code; throw err; }
  return 'accepted';
};

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), 'grc-local-'));
  root = join(base, 'Imports');
  outside = join(base, 'Elsewhere');
  for (const d of [root, join(root, 'Contracts', '2021'), join(root, 'server-data'), outside]) mkdirSync(d, { recursive: true });
  writeFileSync(join(root, 'Invented agreement.pdf'), '%PDF-1.4 invented');
  writeFileSync(join(root, 'Contracts', 'Renewal letter.txt'), 'An invented renewal letter.');
  writeFileSync(join(root, 'Contracts', '2021', 'Schedule A.txt'), 'An invented schedule.');
  writeFileSync(join(root, '~$Invented agreement.docx'), 'lock');
  writeFileSync(join(root, 'Thumbs.db'), 'cache');
  writeFileSync(join(root, 'desktop.ini'), 'ini');
  writeFileSync(join(root, 'copy.secret.key'), '00');
  writeFileSync(join(root, 'server-data', 'grc.db'), 'invented database');
  writeFileSync(join(outside, 'Payroll.txt'), 'never read');
  // A junction (Windows) or link (elsewhere) inside the folder that leads out of it.
  symlinkSync(outside, join(root, 'escape'), isWin ? 'junction' : 'dir');
  // And one that leads into the server's own folder, inside the allowed one.
  symlinkSync(join(root, 'server-data'), join(root, 'data-shortcut'), isWin ? 'junction' : 'dir');
  try { symlinkSync(join(outside, 'Payroll.txt'), join(root, 'payroll-link.txt'), 'file'); fileLink = true; } catch { fileLink = false; }
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

const guard = () => makeGuard([root], [join(root, 'server-data'), join(base, 'data.secret.key')]);

describe('the text of a path', () => {
  it('refuses UNC and device paths, "..", alternate data streams, control characters and device names', () => {
    for (const p of ['\\\\fileserver\\share\\x.pdf', '\\\\?\\C:\\Imports\\x.pdf', '\\\\.\\PhysicalDrive0', '//fileserver/share/x.pdf',
      'C:\\Imports\\..\\Windows\\win.ini', '/srv/imports/../../etc/passwd', 'C:\\Imports\\x.pdf:hidden', 'C:\\Imports\\x.pdf::$DATA',
      'x\u0000.pdf', 'C:\\Imports\\CON', 'C:\\Imports\\nul.txt', 'COM1.pdf', '']) {
      expect(pathTextProblem(p), p).not.toBeNull();
    }
    for (const p of ['C:\\Imports\\Invented agreement.pdf', '/srv/imports/a b.pdf', 'Contracts/2021/Schedule A.txt', 'D:/Imports/x..y.pdf']) {
      expect(pathTextProblem(p), p).toBeNull();
    }
  });

  it('compares folders by whole segments, and without case on Windows', () => {
    expect(within(join(base, 'a'), join(base, 'a', 'b.txt'))).toBe(true);
    expect(within(join(base, 'a'), join(base, 'ab', 'b.txt'))).toBe(false);
    expect(within(join(base, 'a'), join(base, 'a', '..x', 'b.txt'))).toBe(true);
    expect(within(join(base, 'a'), base)).toBe(false);
    if (isWin) expect(within(join(base, 'Imports'), join(base, 'IMPORTS', 'x.pdf'))).toBe(true);
  });

  it('matches name patterns with * and ?, in any case, and knows the junk names', () => {
    expect(nameMatcher('*.DOCX')('Plan.docx')).toBe(true);
    expect(nameMatcher('SOP-??-*')('SOP-IT-014 Rev B.docx')).toBe(true);
    expect(nameMatcher('*.pdf')('Plan.docx')).toBe(false);
    expect(nameMatcher('a+b(1).txt')('a+b(1).txt')).toBe(true);
    for (const n of ['~$Plan.docx', 'Thumbs.db', 'desktop.ini', '.DS_Store', '$RECYCLE.BIN', 'System Volume Information']) expect(isJunkName(n), n).toBe(true);
    expect(isJunkName('Plan.docx')).toBe(false);
  });
});

describe("the server's own paths", () => {
  it('names the data folder, the secret key files, the backup folder, every GRC_*_FILE and the application folder', () => {
    const data = join(base, 'grc', 'data');
    const out = serverPaths(data, { GRC_BACKUP_DIR: join(base, 'grc', 'backups'), GRC_DATABASE_PASSWORD_FILE: join(base, 'grc', 'db.pass'), GRC_TLS_KEY: join(base, 'grc', 'tls.key') }, join(base, 'app'));
    expect(out).toEqual(expect.arrayContaining([
      data, join(base, 'grc', 'data.secret.key'), join(base, 'grc', 'data.secret.key.previous'), join(base, 'grc', 'backups'),
      join(base, 'grc', 'db.pass'), join(base, 'grc', 'tls.key'), join(base, 'app'),
    ]));
    const withKey = serverPaths(data, { GRC_SECRET_KEY_FILE: join(base, 'keys', 'grc.key') }, join(base, 'app'));
    expect(withKey).toEqual(expect.arrayContaining([join(base, 'keys', 'grc.key'), join(base, 'keys', 'grc.key.previous')]));
    expect(withKey).not.toContain(join(base, 'grc', 'data.secret.key'));
    expect(serverPaths('memory', {}, join(base, 'app'))).toEqual([join(base, 'app')]);
  });
});

describe('resolving a path', () => {
  it('accepts a file inside the folder, by full path or relative to the only folder, in any case on Windows', async () => {
    const g = await guard();
    const a = await resolveLocal(g, join(root, 'Invented agreement.pdf'), 'file');
    expect(a.stats.isFile()).toBe(true);
    expect((await resolveLocal(g, 'Contracts/2021/Schedule A.txt', 'file')).real).toMatch(/Schedule A\.txt$/);
    expect((await resolveLocal(g, root, 'folder')).stats.isDirectory()).toBe(true);
    if (isWin) expect((await resolveLocal(g, join(root, 'INVENTED AGREEMENT.PDF'), 'file')).stats.isFile()).toBe(true);
  });

  it('refuses paths outside the folders before looking at the disk, and links and junctions that lead out', async () => {
    const g = await guard();
    expect(await refusal(resolveLocal(g, join(outside, 'Payroll.txt'), 'file'))).toBe('outside_allowed_folders');
    expect(await refusal(resolveLocal(g, join(outside, 'missing.txt'), 'file'))).toBe('outside_allowed_folders');
    expect(await refusal(resolveLocal(g, join(root, 'escape', 'Payroll.txt'), 'file'))).toBe('outside_allowed_folders');
    expect(await refusal(resolveLocal(g, join(root, 'escape'), 'folder'))).toBe('outside_allowed_folders');
    if (fileLink) expect(await refusal(resolveLocal(g, join(root, 'payroll-link.txt'), 'file'))).toBe('outside_allowed_folders');
    expect(await refusal(resolveLocal(g, `${root}${isWin ? '\\' : '/'}..${isWin ? '\\' : '/'}Elsewhere${isWin ? '\\' : '/'}Payroll.txt`, 'file'))).toBe('path_refused');
    expect(await refusal(resolveLocal(g, `${join(root, 'Invented agreement.pdf')}:hidden`, 'file'))).toBe('path_refused');
    expect(await refusal(resolveLocal(g, '\\\\fileserver\\share\\Invented agreement.pdf', 'file'))).toBe('path_refused');
    expect(await refusal(resolveLocal(g, 42, 'file'))).toBe('path_refused');
  });

  it("refuses the server's own files inside an allowed folder, key files anywhere, folders, and what is not there", async () => {
    const g = await guard();
    expect(await refusal(resolveLocal(g, join(root, 'server-data', 'grc.db'), 'file'))).toBe('server_files');
    expect(await refusal(resolveLocal(g, join(root, 'server-data'), 'folder'))).toBe('server_files');
    expect(await refusal(resolveLocal(g, join(root, 'copy.secret.key'), 'file'))).toBe('server_files');
    expect(await refusal(resolveLocal(g, join(root, 'Contracts'), 'file'))).toBe('not_a_file');
    expect(await refusal(resolveLocal(g, join(root, 'Invented agreement.pdf'), 'folder'))).toBe('not_a_folder');
    expect(await refusal(resolveLocal(g, join(root, 'Not here.pdf'), 'file'))).toBe('not_found');
    // A protected path given through a link inside the folder is refused as it is on disk.
    expect(await refusal(resolveLocal(g, join(root, 'data-shortcut', 'grc.db'), 'file'))).toBe('server_files');
  });

  it('with several folders, wants the full path', async () => {
    const g = await makeGuard([root, outside], []);
    expect(await refusal(resolveLocal(g, 'Contracts/Renewal letter.txt', 'file'))).toBe('path_refused');
    expect((await resolveLocal(g, join(outside, 'Payroll.txt'), 'file')).root).toMatch(/Elsewhere$/);
  });

  it('opens only the file that was checked', async () => {
    const g = await guard();
    const a = await resolveLocal(g, join(root, 'Invented agreement.pdf'), 'file');
    const { fh, size } = await openChecked(a.real, a.stats);
    expect(size).toBe(statSync(a.real).size);
    await fh.close();
    const other = statSync(join(root, 'Contracts', 'Renewal letter.txt'));
    expect(await refusal(openChecked(a.real, other))).toBe('changed');
  });
});

describe('listing a folder', () => {
  it('leaves out lock and system files, links, junctions and server files; lists subfolders or walks them', async () => {
    const g = await guard();
    const top = await listFolder(g, root, { allowedExtensions: ['pdf'] });
    expect(top.files.map((f) => f.name)).toEqual(['Invented agreement.pdf']);
    expect(top.files[0]).toMatchObject({ relative_path: 'Invented agreement.pdf', extension: 'pdf', allowed_type: true, size_bytes: 17 });
    expect(top.folders.map((f) => f.name)).toEqual(['Contracts']);
    expect(top.skipped.junk).toBe(3);
    expect(top.skipped.links).toBeGreaterThanOrEqual(2);
    expect(top.skipped.protected).toBe(2); // server-data and the key file

    const all = await listFolder(g, root, { recursive: true, allowedExtensions: ['pdf'] });
    expect(all.files.map((f) => f.relative_path)).toEqual(['Contracts/2021/Schedule A.txt', 'Contracts/Renewal letter.txt', 'Invented agreement.pdf']);
    expect(all.files.find((f) => f.extension === 'txt')!.allowed_type).toBe(false);
    const txt = await listFolder(g, root, { recursive: true, pattern: '*.TXT', allowedExtensions: [] });
    expect(txt.files).toHaveLength(2);
  });
});

describe('the setting', () => {
  it('keeps full paths of existing folders and refuses the rest', async () => {
    expect(await checkRoots([root, ` ${root} `], [])).toEqual({ roots: [root] });
    expect(await checkRoots([], [])).toEqual({ roots: [] });
    expect('error' in await checkRoots('C:\\Imports', [])).toBe(true);
    expect((await checkRoots(['Imports'], []) as { error: string }).error).toMatch(/not a full path/);
    expect((await checkRoots([join(base, 'Missing')], []) as { error: string }).error).toMatch(/not a folder/);
    expect((await checkRoots([join(root, 'Invented agreement.pdf')], []) as { error: string }).error).toMatch(/not a folder/);
    expect((await checkRoots(['\\\\fileserver\\share'], []) as { error: string }).error).toMatch(/UNC/);
    expect((await checkRoots([join(root, 'server-data')], [join(root, 'server-data')]) as { error: string }).error).toMatch(/server's own files/);
    // A folder that only contains the server's files may be set: those files are refused when read.
    expect(await checkRoots([root], [join(root, 'server-data')])).toEqual({ roots: [root] });
    expect((await checkRoots(Array.from({ length: 21 }, (_, i) => `${root}${i}`), []) as { error: string }).error).toMatch(/up to 20/);
  });
});
