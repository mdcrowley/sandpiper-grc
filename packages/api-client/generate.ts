// Generates packages/api-client/src/schema.ts (TypeScript types of the API the app uses) from the
// server's own OpenAPI description, the document `GET /api/openapi.json` serves (E38-01).
//
//   npx tsx packages/api-client/generate.ts           # write src/schema.ts
//   npx tsx packages/api-client/generate.ts --check   # fail when src/schema.ts is out of date (CI)
//
// Only the operations listed in include.json are generated (exact paths, or `prefix/**` for a path and
// everything under it), so the file stays small and changes only when an API the app uses changes.
// Paths are unversioned (`/api/...`), as the app calls them. It builds an in-memory application, like
// server/src/core/openapi-cli.ts, so it needs no running server and reads no data. No dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

type Json = Record<string, any>;

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'src', 'schema.ts');
const METHODS = ['get', 'put', 'post', 'delete', 'patch'] as const;

/** Whether `path` is listed: exact, or under a `prefix/**` entry. */
export function included(path: string, include: string[]): boolean {
  return include.some((entry) => (entry.endsWith('/**')
    ? path === entry.slice(0, -3) || path.startsWith(entry.slice(0, -2))
    : path === entry));
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const key = (k: string) => (IDENT.test(k) ? k : JSON.stringify(k));
const refName = (ref: string) => ref.replace(/^#\/components\/schemas\//, '');

/** A JSON Schema (OpenAPI 3.1) as a TypeScript type; `refs` collects the component schemas used. */
export function toType(schema: Json | undefined, refs: Set<string>, indent = ''): string {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) return 'unknown';
  if (schema.$ref) {
    const name = refName(schema.$ref);
    refs.add(name);
    return `components['schemas'][${JSON.stringify(name)}]`;
  }
  if ('const' in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map((v: unknown) => JSON.stringify(v)).join(' | ') || 'never';
  for (const [k, sep] of [['oneOf', ' | '], ['anyOf', ' | '], ['allOf', ' & ']] as const) {
    if (Array.isArray(schema[k])) {
      const parts = (schema[k] as Json[]).map((s) => toType(s, refs, indent));
      const base = Object.fromEntries(Object.entries(schema).filter(([n]) => n !== k));
      const joined = parts.length > 1 ? `(${parts.join(sep)})` : parts[0]!;
      return 'type' in base || 'properties' in base ? `${toType(base, refs, indent)} & ${joined}` : joined;
    }
  }
  const types: string[] = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : (schema.properties ? ['object'] : []);
  if (types.length === 0) return 'unknown';
  const out = types.map((t) => {
    switch (t) {
      case 'string': return schema.format === 'binary' ? 'Blob' : 'string';
      case 'integer':
      case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'null': return 'null';
      case 'array': {
        const item = toType(schema.items, refs, indent);
        return /[|&]/.test(item) && !item.startsWith('{') ? `(${item})[]` : `${item}[]`;
      }
      case 'object': {
        const props = (schema.properties ?? {}) as Record<string, Json>;
        const required = new Set<string>(schema.required ?? []);
        const inner = `${indent}  `;
        const lines = Object.keys(props).map((name) => `${inner}${key(name)}${required.has(name) ? '' : '?'}: ${toType(props[name], refs, inner)};`);
        const extra = schema.additionalProperties;
        if (extra && typeof extra === 'object') lines.push(`${inner}[key: string]: ${toType(extra, refs, inner)};`);
        else if (extra === true || (lines.length === 0 && extra !== false)) lines.push(`${inner}[key: string]: unknown;`);
        return `{\n${lines.join('\n')}\n${indent}}`;
      }
      default: return 'unknown';
    }
  });
  return out.length > 1 ? out.join(' | ') : out[0]!;
}

function successResponse(op: Json): Json | undefined {
  const codes = Object.keys(op.responses ?? {}).filter((c) => /^2\d\d$/.test(c)).sort();
  for (const code of codes) {
    const content = op.responses[code]?.content;
    if (!content) return code === '204' ? { type: 'null' } : undefined;
    return content['application/json']?.schema ?? { type: 'string', format: 'binary' };
  }
  return undefined;
}

/** The TypeScript source of schema.ts for an OpenAPI document. */
export function render(doc: Json, include: string[]): string {
  const refs = new Set<string>();
  const paths: string[] = [];
  for (const path of Object.keys(doc.paths ?? {}).sort()) {
    if (!included(path, include)) continue;
    const ops: string[] = [];
    for (const method of METHODS) {
      const op = doc.paths[path][method] as Json | undefined;
      if (!op) continue;
      const query = (op.parameters ?? []).filter((p: Json) => p.in === 'query');
      const pathParams = (op.parameters ?? []).filter((p: Json) => p.in === 'path');
      const queryType = query.length
        ? `{ ${query.map((p: Json) => `${key(p.name)}${p.required ? '' : '?'}: ${toType(p.schema, refs, '        ')}`).join('; ')} }`
        : 'never';
      const pathType = pathParams.length ? `{ ${pathParams.map((p: Json) => `${key(p.name)}: string`).join('; ')} }` : 'never';
      const body = op.requestBody?.content?.['application/json']?.schema
        ?? (op.requestBody?.content ? { type: 'string', format: 'binary' } : undefined);
      const permission = op['x-permission'] ? ` Permission: \`${op['x-permission']}\`.` : '';
      ops.push([
        `    /** ${String(op.summary ?? op.operationId).replace(/\*\//g, '*\\/')}.${permission} */`,
        `    ${method}: {`,
        `      path: ${pathType};`,
        `      query: ${queryType};`,
        `      body: ${body ? toType(body, refs, '      ') : 'never'};`,
        `      response: ${toType(successResponse(op), refs, '      ')};`,
        '    };',
      ].join('\n'));
    }
    if (ops.length) paths.push(`  ${JSON.stringify(path)}: {\n${ops.join('\n')}\n  };`);
  }
  // Component schemas, following references from one to another.
  const schemas = (doc.components?.schemas ?? {}) as Record<string, Json>;
  const done = new Map<string, string>();
  let pending = [...refs];
  while (pending.length) {
    const next = new Set<string>();
    for (const name of pending) {
      if (done.has(name)) continue;
      done.set(name, toType(schemas[name], next, '    '));
    }
    pending = [...next].filter((n) => !done.has(n));
  }
  const components = [...done.keys()].sort().map((name) => `    ${JSON.stringify(name)}: ${done.get(name)};`);
  return [
    '// GENERATED by packages/api-client/generate.ts from the server\'s OpenAPI description. Do not edit.',
    '// Regenerate: npx tsx packages/api-client/generate.ts (CI fails when this file is out of date).',
    '/* eslint-disable */',
    '',
    'export interface paths {',
    ...paths,
    '}',
    '',
    'export interface components {',
    '  schemas: {',
    ...components,
    '  };',
    '}',
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const check = process.argv.includes('--check');
  const include = JSON.parse(readFileSync(join(here, 'include.json'), 'utf8')) as string[];
  const { buildApp } = await import('../../server/src/app.ts');
  const { AREA_KEYS, invalidateFeatures } = await import('../../server/src/core/features.ts');
  const built = await buildApp({ dataDir: 'memory', serveWeb: false });
  let source: string;
  try {
    // The description leaves out switched-off areas; the app's own (Mobile app, off by default) and
    // every other optional area are switched on in this in-memory copy, so all their routes are typed.
    const all = Object.fromEntries(AREA_KEYS.map((k) => [k, true]));
    await built.db.query(
      `insert into settings (key, value) values ('features', $1::jsonb) on conflict (key) do update set value = excluded.value`,
      [JSON.stringify(all)],
    );
    invalidateFeatures(built.db);
    const doc = await built.core.openapi.build(null, { version: null });
    source = render(doc as Json, include);
  } finally {
    await built.close();
  }
  if (check) {
    let current = '';
    try {
      current = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n');
    } catch {
      current = '';
    }
    if (current !== source) {
      console.error('packages/api-client/src/schema.ts is out of date: run `npx tsx packages/api-client/generate.ts` and commit the result.');
      process.exitCode = 1;
      return;
    }
    console.error('packages/api-client/src/schema.ts is up to date.');
    return;
  }
  writeFileSync(OUT, source);
  console.error(`packages/api-client/src/schema.ts written (${source.split('\n').length} lines).`);
}

if (/generate.ts$/.test(process.argv[1] ?? '')) {
  await main();
}
