// Changed files and the import graph (wave 27): the low-level parts of change-based CI. The
// files changed since a base commit (committed, staged, unstaged and new), and for every code
// file the repository files it imports (static imports, dynamic imports of a literal path,
// vi.mock, import.meta.glob, `new URL('...', import.meta.url)`). tools/ci/areas.mjs builds the
// area map on top of it, tools/ci/plan.mjs decides what runs. Plain Node, no packages, so it runs
// before `npm ci`.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Unit test files: the include list of vitest.config.ts. */
export const TEST_FILE = /^(server\/src|web\/src|shared|tools)\/(.*\/)?[^/]+\.test\.ts$/;

export const CODE = /\.(ts|tsx|mts|mjs|js|cjs)$/;
const SCANNED = /^(server\/src|web\/src|shared|tools|packages)\//;

export function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }).trim();
}

function lines(s) {
  return s.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Every file in the working copy: tracked and untracked (not ignored), with / separators. */
export function repoFiles(root) {
  return [...new Set(lines(git(root, ['ls-files', '--cached', '--others', '--exclude-standard'])))].filter((f) => existsSync(join(root, f)));
}

/**
 * The files changed since `base` (committed, staged, unstaged and untracked). Without a base: the
 * merge base with main (origin/main when there is no local main); when that is HEAD itself (on
 * main, or nothing committed on the branch yet), the last commit. Returns null when git cannot say
 * (not a repository, unknown base): the caller then runs everything.
 */
export function changedFiles(root, base) {
  try {
    let from = base;
    let why = base ? `since ${base}` : '';
    if (!from) {
      const head = git(root, ['rev-parse', 'HEAD']);
      for (const ref of ['main', 'origin/main']) {
        try { from = git(root, ['merge-base', 'HEAD', ref]); why = `since the merge base with ${ref}`; break; } catch { /* try the next */ }
      }
      if (!from || from === head) {
        try { from = git(root, ['rev-parse', 'HEAD~1']); why = 'in the last commit'; } catch { from = head; why = 'since the last commit'; }
      }
    }
    const committed = lines(git(root, ['diff', '--name-only', '--no-renames', `${from}`, 'HEAD']));
    const working = lines(git(root, ['diff', '--name-only', '--no-renames', 'HEAD']));
    const untracked = lines(git(root, ['ls-files', '--others', '--exclude-standard']));
    const files = [...new Set([...committed, ...working, ...untracked])].sort();
    return { base: from, why: `${why} (${from.slice(0, 10)}), plus uncommitted changes`, files };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// The import graph

const IMPORT_PATTERNS = [
  /(?:^|[\s;])(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g,
  /(?:^|[\s;])import\s*['"]([^'"]+)['"]/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bvi\.(?:mock|doMock|importActual)\(\s*['"]([^'"]+)['"]/g,
  /\bnew URL\(\s*['"](\.[^'"]+)['"]\s*,\s*import\.meta\.url/g,
];
const GLOB = /import\.meta\.glob(?:<[^>]*>)?\(\s*(\[[^\]]*\]|['"][^'"]+['"])/g;

function globRegex(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') { re += '.*'; i++; if (pattern[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '{') { const end = pattern.indexOf('}', i); re += `(${pattern.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|')})`; i = end; }
    else re += c.replace(/[.+?^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function resolveSpec(fromFile, spec, fileSet) {
  if (!spec.startsWith('.')) return null; // a package or node: built-in
  const clean = spec.replace(/[?#].*$/, '');
  const base = posix.normalize(posix.join(posix.dirname(fromFile), clean));
  const tries = [base, base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'), `${base}.ts`, `${base}.tsx`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.tsx`];
  return tries.find((t) => fileSet.has(t)) ?? null;
}

/** For each code file: the repository files it imports. */
export function importGraph(root, files) {
  const fileSet = new Set(files);
  const deps = new Map();
  for (const f of files) {
    if (!CODE.test(f) || !SCANNED.test(f)) continue;
    let text;
    try { text = readFileSync(join(root, f), 'utf8'); } catch { continue; }
    const out = new Set();
    for (const re of IMPORT_PATTERNS) {
      for (const m of text.matchAll(re)) { const r = resolveSpec(f, m[1], fileSet); if (r) out.add(r); }
    }
    for (const m of text.matchAll(GLOB)) {
      const pats = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]).filter((p) => p.startsWith('.'));
      for (const p of pats) {
        const re = globRegex(posix.normalize(posix.join(posix.dirname(f), p)));
        for (const g of files) if (re.test(g)) out.add(g);
      }
    }
    deps.set(f, out);
  }
  return deps;
}

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
