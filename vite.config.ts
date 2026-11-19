import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, parseSync, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// ---------------------------------------------------------------------------------------------
// Module manifest (route-level code splitting)
//
// Every web module default-exports a ModuleDef from web/src/modules/<key>/index.tsx. The shell
// needs each module's navigation, Create entries and route paths at start, but not its pages.
// This plugin reads those static parts out of each index.tsx at build time and serves them as
// `virtual:grc-modules`, together with a dynamic import of the module itself, so every module
// becomes its own chunk that loads when one of its routes is first opened.
//
// A module author changes nothing as long as `key`, `nav`, `create`, the `path`/`permission`
// of `routes` and the `path` of `publicRoutes` are written as plain literals (top-level
// `const` values, spreads of them and string concatenation are understood). A module whose
// definition cannot be read this way is simply loaded at start, as before, and the build says so.
// See web/src/core/README.md, "Code splitting".
// ---------------------------------------------------------------------------------------------

const VIRTUAL = 'virtual:grc-modules';
const RESOLVED = `\0${VIRTUAL}`;
const MODULES_DIR = resolve(import.meta.dirname, 'web/src/modules');

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;
const NOT_STATIC = Symbol('not static');

/** Strip TypeScript-only wrappers: `x as T`, `x satisfies T`, `x!`, `(x)`. */
function unwrap(node: Node): Node {
  let n = node;
  while (n && ['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'ParenthesizedExpression', 'TSTypeAssertion'].includes(n.type)) n = n.expression;
  return n;
}

/** The value of an expression made only of literals and top-level constants, or NOT_STATIC. */
function evaluate(node: Node, consts: Map<string, Node>, depth = 0): unknown {
  const n = unwrap(node);
  if (!n || depth > 12) return NOT_STATIC;
  switch (n.type) {
    case 'Literal':
      return n.regex || typeof n.value === 'bigint' ? NOT_STATIC : n.value;
    case 'TemplateLiteral': {
      let out = '';
      for (let i = 0; i < n.quasis.length; i++) {
        out += n.quasis[i].value.cooked;
        if (i < n.expressions.length) {
          const v = evaluate(n.expressions[i], consts, depth + 1);
          if (v === NOT_STATIC || typeof v === 'object') return NOT_STATIC;
          out += String(v);
        }
      }
      return out;
    }
    case 'Identifier':
      if (n.name === 'undefined') return undefined;
      return consts.has(n.name) ? evaluate(consts.get(n.name), consts, depth + 1) : NOT_STATIC;
    case 'UnaryExpression': {
      const v = evaluate(n.argument, consts, depth + 1);
      if (v === NOT_STATIC) return NOT_STATIC;
      if (n.operator === '-') return -(v as number);
      if (n.operator === '!') return !v;
      return NOT_STATIC;
    }
    case 'BinaryExpression': {
      if (n.operator !== '+') return NOT_STATIC;
      const a = evaluate(n.left, consts, depth + 1);
      const b = evaluate(n.right, consts, depth + 1);
      if (a === NOT_STATIC || b === NOT_STATIC) return NOT_STATIC;
      return (a as string) + (b as string);
    }
    case 'ArrayExpression': {
      const out: unknown[] = [];
      for (const el of n.elements) {
        if (!el) return NOT_STATIC;
        if (el.type === 'SpreadElement') {
          const v = evaluate(el.argument, consts, depth + 1);
          if (!Array.isArray(v)) return NOT_STATIC;
          out.push(...v);
        } else {
          const v = evaluate(el, consts, depth + 1);
          if (v === NOT_STATIC) return NOT_STATIC;
          out.push(v);
        }
      }
      return out;
    }
    case 'ObjectExpression': {
      const out: Record<string, unknown> = {};
      for (const p of n.properties) {
        if (p.type === 'SpreadElement') {
          const v = evaluate(p.argument, consts, depth + 1);
          if (v === NOT_STATIC || typeof v !== 'object' || v === null || Array.isArray(v)) return NOT_STATIC;
          Object.assign(out, v);
          continue;
        }
        if (p.type !== 'Property' || p.computed || p.kind !== 'init') return NOT_STATIC;
        const key = p.key.type === 'Identifier' ? p.key.name : p.key.value;
        const v = evaluate(p.value, consts, depth + 1);
        if (v === NOT_STATIC) return NOT_STATIC;
        out[key] = v;
      }
      return out;
    }
    default:
      return NOT_STATIC;
  }
}

/** Array elements of an expression, following constants and spreads; null when not an array literal. */
function elementsOf(node: Node, consts: Map<string, Node>, depth = 0): Node[] | null {
  const n = unwrap(node);
  if (!n || depth > 12) return null;
  if (n.type === 'Identifier') return consts.has(n.name) ? elementsOf(consts.get(n.name), consts, depth + 1) : null;
  if (n.type !== 'ArrayExpression') return null;
  const out: Node[] = [];
  for (const el of n.elements) {
    if (!el) return null;
    if (el.type === 'SpreadElement') {
      const inner = elementsOf(el.argument, consts, depth + 1);
      if (!inner) return null;
      out.push(...inner);
    } else out.push(el);
  }
  return out;
}

function property(obj: Node, name: string): Node | undefined {
  for (const p of obj.properties) {
    if (p.type !== 'Property' || p.computed) continue;
    if ((p.key.type === 'Identifier' ? p.key.name : p.key.value) === name) return p.shorthand ? p.key : p.value;
  }
  return undefined;
}

/** Route entries: only `path` and `permission` are read; the element stays in the module's own chunk. */
function routesOf(node: Node | undefined, consts: Map<string, Node>): { path: string; permission?: string }[] | null {
  if (!node) return [];
  const elements = elementsOf(node, consts);
  if (!elements) return null;
  const out: { path: string; permission?: string }[] = [];
  for (const el of elements) {
    let obj = unwrap(el);
    if (obj.type === 'Identifier' && consts.has(obj.name)) obj = unwrap(consts.get(obj.name));
    if (obj.type !== 'ObjectExpression' || obj.properties.some((p: Node) => p.type !== 'Property' || p.computed)) return null;
    const path = evaluate(property(obj, 'path'), consts);
    const permNode = property(obj, 'permission');
    const permission = permNode ? evaluate(permNode, consts) : undefined;
    if (typeof path !== 'string' || (permission !== undefined && typeof permission !== 'string')) return null;
    out.push(permission ? { path, permission } : { path });
  }
  return out;
}

interface Manifest {
  key: string;
  nav: unknown[];
  create: unknown[];
  routes: { path: string; permission?: string }[];
  publicRoutes: { path: string }[];
}

/** The static part of a module's ModuleDef, or a reason why it could not be read. */
function readManifest(file: string): Manifest | string {
  const parsed = parseSync(file, readFileSync(file, 'utf8'));
  if (parsed.errors.length > 0) return 'it does not parse';
  const body: Node[] = (parsed.program as Node).body;
  const consts = new Map<string, Node>();
  let exported: Node | undefined;
  for (const stmt of body) {
    const decl = stmt.type === 'ExportNamedDeclaration' && stmt.declaration ? stmt.declaration : stmt;
    if (decl.type === 'VariableDeclaration' && decl.kind === 'const') {
      for (const d of decl.declarations) if (d.id.type === 'Identifier' && d.init) consts.set(d.id.name, d.init);
    }
    if (stmt.type === 'ExportDefaultDeclaration') exported = stmt.declaration;
  }
  let def = unwrap(exported);
  if (def?.type === 'Identifier') def = unwrap(consts.get(def.name));
  if (def?.type !== 'ObjectExpression') return 'its default export is not an object literal';
  if (def.properties.some((p: Node) => p.type !== 'Property' || p.computed)) return 'its default export uses spread or computed keys';

  const key = evaluate(property(def, 'key'), consts);
  if (typeof key !== 'string' || !key) return '`key` is not a literal';
  const list = (name: string): unknown[] | null => {
    const node = property(def, name);
    if (!node) return [];
    const v = evaluate(node, consts);
    return Array.isArray(v) ? v : null;
  };
  const nav = list('nav');
  if (!nav) return '`nav` is not made of literals';
  const create = list('create');
  if (!create) return '`create` is not made of literals';
  const routes = routesOf(property(def, 'routes'), consts);
  if (!routes) return 'the `path` or `permission` of a route is not a literal';
  const publicRoutes = routesOf(property(def, 'publicRoutes'), consts);
  if (!publicRoutes) return 'the `path` of a public route is not a literal';
  return { key, nav, create, routes, publicRoutes: publicRoutes.map((r) => ({ path: r.path })) };
}

// GRC_WEB_MODULES=home,admin,help limits the build to those module folders (like GRC_MODULES on
// the server): for working in parallel, when someone else's module is mid-edit and does not build.
const ONLY = (process.env.GRC_WEB_MODULES ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function moduleFolders(): string[] {
  if (!existsSync(MODULES_DIR)) return [];
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_') && existsSync(join(MODULES_DIR, d.name, 'index.tsx')))
    .filter((d) => ONLY.length === 0 || ONLY.includes(d.name))
    .map((d) => d.name)
    .sort();
}

function generate(warn: (message: string) => void): string {
  const imports: string[] = [];
  const entries: string[] = [];
  for (const [i, folder] of moduleFolders().entries()) {
    const spec = `/src/modules/${folder}/index.tsx`;
    let manifest: Manifest | string;
    try {
      manifest = readManifest(join(MODULES_DIR, folder, 'index.tsx'));
    } catch (err) {
      manifest = (err as Error).message;
    }
    if (typeof manifest === 'string') {
      // Not readable statically: load the module at start, exactly as before code splitting.
      warn(`modules/${folder}/index.tsx is loaded at start, not on demand: ${manifest}.`);
      imports.push(`import * as eager${i} from ${JSON.stringify(spec)};`);
      entries.push(`{ file: ${JSON.stringify(`modules/${folder}/index.tsx`)}, eager: eager${i} }`);
    } else {
      entries.push(`{ file: ${JSON.stringify(`modules/${folder}/index.tsx`)}, manifest: ${JSON.stringify(manifest)}, load: () => import(${JSON.stringify(spec)}) }`);
    }
  }
  return `${imports.join('\n')}\nexport const entries = [\n  ${entries.join(',\n  ')},\n];\n`;
}

function grcModules(): Plugin {
  let last = '';
  return {
    name: 'grc-modules',
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : undefined;
    },
    load(id) {
      if (id !== RESOLVED) return undefined;
      for (const folder of moduleFolders()) this.addWatchFile(join(MODULES_DIR, folder, 'index.tsx'));
      last = generate((message) => this.warn(message));
      return last;
    },
    // Dev server: when a module's index.tsx changes its navigation or routes, rebuild the manifest and reload.
    handleHotUpdate({ file, server }) {
      if (!/[\\/]modules[\\/][^\\/]+[\\/]index\.tsx$/.test(file)) return;
      const next = generate(() => undefined);
      if (next === last) return;
      const mod = server.moduleGraph.getModuleById(RESOLVED);
      if (mod) server.moduleGraph.invalidateModule(mod);
      server.ws.send({ type: 'full-reload' });
    },
  };
}

// GRC_ANALYSE=1 puts every npm package and every core file in a chunk of its own, so the build
// output lists what each one weighs. For looking at sizes only: never serve such a build.
const analyse = process.env.GRC_ANALYSE === '1';
const analyseGroup = (id: string): string | null => {
  const pkg = /node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/.exec(id);
  if (pkg) return `pkg-${pkg[1].replace(/[\\/@]/g, '_')}`;
  const core = /web[\\/]src[\\/]core[\\/]([^\\/.]+)/.exec(id);
  return core ? `core-${core[1]}` : null;
};

export default defineConfig({
  root: 'web',
  plugins: [react(), grcModules()],
  // GRC_WEB_DIST lets several builds coexist (the server reads the same variable).
  build: {
    outDir: process.env.GRC_WEB_DIST || '../dist/web',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: analyse
            ? [{ name: analyseGroup }]
            // React and the router change far less often than the application, and every page
            // needs them: one chunk of their own, fetched alongside the entry script and cached.
            : [{ name: 'vendor-react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 10 }],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    fs: { allow: ['..'] }, // the Help pages are bundled from docs/user
    port: 5173,
    proxy: { '/api': `http://127.0.0.1:${process.env.GRC_PORT || 8080}` },
  },
});
