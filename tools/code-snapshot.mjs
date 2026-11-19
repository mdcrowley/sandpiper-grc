#!/usr/bin/env node
// Saves and puts back the application's code, so that `grc.ps1 upgrade` can return to the
// previous version by itself when an upgrade fails (E16-18). It needs nothing but Node.js:
// no version-control tool, and none of the application's own code (which may be the part
// that is broken). grc.ps1 copies this file aside before an upgrade and runs that copy.
//
//   node code-snapshot.mjs save    <app folder> <snapshot.tar>   save the code as a tar file
//   node code-snapshot.mjs restore <app folder> <snapshot.tar>   put saved code back
//   node code-snapshot.mjs apply   <app folder> <new code folder> put a new release in place
//   node code-snapshot.mjs version <app folder | snapshot.tar>   the version recorded in package.json
//
// "Code" is everything in the application folder except data, backups, installed packages,
// the portable Node.js, build output, private seed files and version-control metadata. On
// restore and apply, files that are not in the incoming code are deleted from server/src and
// web/src only (so a migration or module added by the new version is gone again); nothing
// else is deleted. Each command prints one line of JSON describing what it did.
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

// Top-level folders whose names start with a dot (version control, the portable Node.js, editor and
// tool settings) are left out too.
const EXCLUDE = new Set(['node_modules', 'data', 'backups', 'dist', 'seed', 'coverage']);
const PRUNE_UNDER = ['server/src/', 'web/src/'];
const BLOCK = 512;

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Every code file under root, relative with forward slashes. */
function codeFiles(root, extraExclude = []) {
  const skip = new Set(extraExclude.map((p) => resolve(p)));
  const out = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!rel && (EXCLUDE.has(e.name) || (e.isDirectory() && e.name.startsWith('.')))) continue;
      const abs = join(dir, e.name);
      if (skip.has(resolve(abs))) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (e.isFile() && !e.name.endsWith('.log')) out.push(r);
    }
  };
  walk(root, '');
  return out.sort();
}

function header(name, size) {
  const h = Buffer.alloc(BLOCK, 0);
  let path = name;
  let prefix = '';
  if (Buffer.byteLength(path) > 100) {
    const at = [...path].findIndex((c, i) => c === '/' && Buffer.byteLength(path.slice(i + 1)) <= 100);
    if (at <= 0 || at > 155) fail(`Path too long to save: ${name}`);
    prefix = path.slice(0, at);
    path = path.slice(at + 1);
  }
  const oct = (v, w) => `${v.toString(8).padStart(w - 1, '0')}\0`;
  h.write(path, 0, 100, 'utf8');
  h.write(oct(0o644, 8), 100, 'latin1');
  h.write(oct(0, 8), 108, 'latin1');
  h.write(oct(0, 8), 116, 'latin1');
  h.write(oct(size, 12), 124, 'latin1');
  h.write(oct(Math.floor(Date.now() / 1000), 12), 136, 'latin1');
  h.write('        ', 148, 'latin1');
  h.write('0', 156, 'latin1');
  h.write('ustar\0', 257, 'latin1');
  h.write('00', 263, 'latin1');
  h.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1');
  return h;
}

function save(root, file) {
  const files = codeFiles(root, [file]);
  mkdirSync(dirname(resolve(file)), { recursive: true });
  const partial = `${file}.partial`;
  const fd = openSync(partial, 'w');
  try {
    for (const rel of files) {
      const data = readFileSync(join(root, ...rel.split('/')));
      writeSync(fd, header(rel, data.length));
      writeSync(fd, data);
      const pad = (BLOCK - (data.length % BLOCK)) % BLOCK;
      if (pad) writeSync(fd, Buffer.alloc(pad));
    }
    writeSync(fd, Buffer.alloc(BLOCK * 2));
  } finally {
    closeSync(fd);
  }
  renameSync(partial, file);
  return { saved: file, files: files.length, version: versionOf(root) };
}

/** path -> Buffer for every file in a snapshot. */
function readSnapshot(file) {
  const raw = readFileSync(file);
  const out = new Map();
  let at = 0;
  while (at + BLOCK <= raw.length) {
    const h = raw.subarray(at, at + BLOCK);
    if (h.every((b) => b === 0)) break;
    const str = (s, l) => { const b = h.subarray(s, s + l); const z = b.indexOf(0); return b.subarray(0, z < 0 ? l : z).toString('utf8'); };
    let sum = 0;
    for (let i = 0; i < BLOCK; i += 1) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (parseInt(str(148, 8).trim(), 8) !== sum) fail(`${file} is damaged (header checksum).`);
    const name = str(345, 155) ? `${str(345, 155)}/${str(0, 100)}` : str(0, 100);
    const size = parseInt(str(124, 12).trim() || '0', 8);
    if (name.split('/').some((p) => p === '..' || p === '') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) fail(`${file} holds an unsafe path: ${name}`);
    at += BLOCK;
    if (at + size > raw.length) fail(`${file} is incomplete.`);
    out.set(name, raw.subarray(at, at + size));
    at += size + ((BLOCK - (size % BLOCK)) % BLOCK);
  }
  if (!out.has('package.json')) fail(`${file} is not a saved copy of the application (no package.json).`);
  return out;
}

const digest = (b) => createHash('sha256').update(b).digest('hex');

/** Makes the code under root match `incoming` (path -> Buffer). */
function putInPlace(root, incoming) {
  let written = 0;
  let removed = 0;
  const changed = [];
  for (const [rel, data] of incoming) {
    const abs = join(root, ...rel.split('/'));
    if (!resolve(abs).startsWith(resolve(root) + sep)) fail(`Refusing to write outside the application folder: ${rel}`);
    if (existsSync(abs) && statSync(abs).isFile() && digest(readFileSync(abs)) === digest(data)) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, data);
    written += 1;
    changed.push(rel);
  }
  for (const rel of codeFiles(root)) {
    if (incoming.has(rel) || !PRUNE_UNDER.some((p) => rel.startsWith(p))) continue;
    rmSync(join(root, ...rel.split('/')), { force: true });
    removed += 1;
    changed.push(rel);
  }
  return {
    written, removed,
    packagesChanged: changed.includes('package.json') || changed.includes('package-lock.json'),
    version: incoming.has('package.json') ? JSON.parse(incoming.get('package.json').toString('utf8').replace(/^\uFEFF/, '')).version ?? 'unknown' : 'unknown',
  };
}

function versionOf(path) {
  try {
    if (statSync(path).isFile()) return JSON.parse(readSnapshot(path).get('package.json').toString('utf8').replace(/^\uFEFF/, '')).version ?? 'unknown';
    return JSON.parse(readFileSync(join(path, 'package.json'), 'utf8').replace(/^\uFEFF/, '')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const [command, rootArg, other] = process.argv.slice(2);
if (!command || !rootArg) fail('Usage: node code-snapshot.mjs save|restore|apply|version <app folder> [<file or folder>]');
const root = resolve(rootArg);
if (command === 'version') {
  console.log(JSON.stringify({ version: versionOf(root) }));
} else if (!other) {
  fail('Say which snapshot file or folder.');
} else if (command === 'save') {
  console.log(JSON.stringify(save(root, resolve(other))));
} else if (command === 'restore') {
  if (!existsSync(other)) fail(`${other} does not exist.`);
  console.log(JSON.stringify(putInPlace(root, readSnapshot(resolve(other)))));
} else if (command === 'apply') {
  const from = resolve(other);
  if (!existsSync(join(from, 'package.json'))) fail(`${from} does not look like a copy of the application (no package.json).`);
  if (relative(from, root) === '') fail('The new code folder is the application folder itself.');
  const incoming = new Map(codeFiles(from).map((rel) => [rel, readFileSync(join(from, ...rel.split('/')))]));
  console.log(JSON.stringify(putInPlace(root, incoming)));
} else {
  fail(`Unknown command ${command}.`);
}
