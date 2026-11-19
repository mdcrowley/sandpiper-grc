/**
 * Structural checks of the OpenAPI document (used by core/openapi-cli.ts and the tests). Not a
 * full OpenAPI validator: it checks what this application's document must always get right.
 * Returns the problems found; an empty list means the document passed.
 */
type Json = Record<string, any>;
const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export function validateOpenApi(doc: Json, opts: { allowUndocumented?: string[] } = {}): string[] {
  const problems: string[] = [];
  const add = (where: string, what: string) => problems.push(`${where}: ${what}`);
  if (doc.openapi !== '3.1.0') add('openapi', `expected "3.1.0", got ${JSON.stringify(doc.openapi)}`);
  if (typeof doc.info?.title !== 'string' || !doc.info.title) add('info.title', 'missing');
  if (typeof doc.info?.version !== 'string' || !doc.info.version) add('info.version', 'missing');
  if (!doc.paths || typeof doc.paths !== 'object') { add('paths', 'missing'); return problems; }
  const tagNames = new Set<string>((doc.tags ?? []).map((t: Json) => t.name));
  const operationIds = new Map<string, string>();
  const allowed = new Set(opts.allowUndocumented ?? []);

  // Every $ref must point at something in the document.
  const resolve = (pointer: string): unknown => {
    if (!pointer.startsWith('#/')) return undefined;
    return pointer.slice(2).split('/').reduce<any>((node, part) => node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], doc);
  };
  const walk = (node: unknown, where: string) => {
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${where}[${i}]`)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref') {
        if (typeof v !== 'string' || resolve(v) === undefined) add(where, `unresolved $ref ${String(v)}`);
      } else if (k === 'x-resource') add(where, 'unresolved x-resource (a record type left in a schema)');
      else walk(v, `${where}.${k}`);
    }
  };
  walk(doc, '#');

  for (const [path, ops] of Object.entries<Json>(doc.paths)) {
    if (!path.startsWith('/')) add(path, 'path does not start with "/"');
    const templated = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
    for (const [method, op] of Object.entries<Json>(ops)) {
      const where = `${method.toUpperCase()} ${path}`;
      if (!METHODS.includes(method)) { add(where, 'unknown method'); continue; }
      if (typeof op.summary !== 'string' || !op.summary.trim()) add(where, 'no summary');
      if (!Array.isArray(op.tags) || !op.tags.length) add(where, 'no tag');
      else for (const t of op.tags) if (!tagNames.has(t)) add(where, `tag "${t}" is not in the document's tags`);
      if (typeof op.operationId !== 'string' || !op.operationId) add(where, 'no operationId');
      else if (operationIds.has(op.operationId)) add(where, `operationId ${op.operationId} also used by ${operationIds.get(op.operationId)}`);
      else operationIds.set(op.operationId, where);
      if (op['x-undocumented'] && !allowed.has(where)) add(where, 'undocumented (describe it with ctx.describeRoute or in core/api/docs)');
      if (!op.responses || !Object.keys(op.responses).length) add(where, 'no responses');
      for (const [code, r] of Object.entries<Json>(op.responses ?? {})) {
        if (!/^([1-5]\d\d|[1-5]XX|default)$/.test(code)) add(where, `bad response code ${code}`);
        if (typeof r?.description !== 'string') add(where, `response ${code} has no description`);
      }
      const params: Json[] = (op.parameters ?? []).map((p: Json) => (p.$ref ? resolve(p.$ref) as Json : p));
      const seen = new Set<string>();
      for (const p of params) {
        if (!p || typeof p.name !== 'string' || !['query', 'header', 'path', 'cookie'].includes(p.in)) { add(where, `bad parameter ${JSON.stringify(p)}`); continue; }
        const id = `${p.in}:${p.name}`;
        if (seen.has(id)) add(where, `parameter ${id} given twice`);
        seen.add(id);
        if (p.in === 'path' && (p.required !== true || !templated.includes(p.name))) add(where, `path parameter ${p.name} is not in the path or not required`);
      }
      for (const name of templated) if (!seen.has(`path:${name}`)) add(where, `path parameter ${name} is not declared`);
    }
  }
  return problems;
}
