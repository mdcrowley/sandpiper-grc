// Request examples for the API reference (ApiExamples.tsx): curl and PowerShell commands with a
// token placeholder, and a small example body from a JSON Schema. No React here, so it is easy to test.

export interface ExampleSchema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  items?: ExampleSchema;
  properties?: Record<string, ExampleSchema>;
  required?: string[];
  readOnly?: boolean;
  anyOf?: ExampleSchema[];
  [k: string]: unknown;
}
export interface ExampleOperation {
  parameters?: { name: string; in: string; required?: boolean; $ref?: string }[];
  requestBody?: { content?: Record<string, { schema?: ExampleSchema }> };
  security?: unknown[];
}
export type Schemas = Record<string, ExampleSchema> | undefined;

const refName = (ref: string) => ref.split('/').pop() ?? ref;

/** A small, plausible example value for a schema: required members first, a few at most. */
export function exampleValue(schema: ExampleSchema | undefined, schemas: Schemas, depth = 0): unknown {
  if (!schema || depth > 4) return null;
  const s = schema.$ref ? schemas?.[refName(schema.$ref)] : schema;
  if (!s) return {};
  if (s.const !== undefined) return s.const;
  if (s.default !== undefined) return s.default;
  if (s.enum?.length) return s.enum.find((v) => v !== null) ?? null;
  if (s.anyOf?.length) return exampleValue(s.anyOf[0], schemas, depth + 1);
  const types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  const type = types.find((t) => t !== 'null') ?? (s.properties ? 'object' : undefined);
  switch (type) {
    case 'object': {
      const props = Object.entries(s.properties ?? {}).filter(([, p]) => !p.readOnly);
      const required = new Set(s.required ?? []);
      const chosen = [...props.filter(([k]) => required.has(k)), ...props.filter(([k]) => !required.has(k))].slice(0, Math.max(required.size, 2));
      return Object.fromEntries(chosen.map(([k, p]) => [k, exampleValue(p, schemas, depth + 1)]));
    }
    case 'array': return [exampleValue(s.items, schemas, depth + 1)];
    case 'integer': case 'number': return 1;
    case 'boolean': return true;
    case 'string':
      if (s.format === 'uuid') return '00000000-0000-0000-0000-000000000000';
      if (s.format === 'date') return '2026-01-31';
      if (s.format === 'date-time') return '2026-01-31T09:00:00Z';
      if (s.format === 'email') return 'someone@example.test';
      return 'text';
    default: return null;
  }
}

/** The curl and PowerShell commands for one operation. */
export function examples(method: string, path: string, op: ExampleOperation, schemas: Schemas, origin: string) {
  const upper = method.toUpperCase();
  const requiredQuery = (op.parameters ?? []).filter((p) => p.in === 'query' && p.required).map((p) => `${p.name}=<${p.name}>`);
  const url = `${origin}${path}${requiredQuery.length ? `?${requiredQuery.join('&')}` : ''}`;
  const jsonSchema = op.requestBody?.content?.['application/json']?.schema;
  const body = jsonSchema ? JSON.stringify(exampleValue(jsonSchema, schemas)) : null;
  const signedIn = !(op.security && op.security.length === 0);

  const curl = [
    `curl -X ${upper} "${url}"`,
    ...(signedIn ? ['  -H "Authorization: Bearer $GRC_TOKEN"'] : []),
    ...(body !== null ? ['  -H "Content-Type: application/json"', `  -d '${body.replace(/'/g, "'\\''")}'`] : []),
  ].join(' \\\n');

  const psMethod = upper.charAt(0) + upper.slice(1).toLowerCase();
  const powershell = [
    ...(signedIn ? ['$headers = @{ Authorization = "Bearer $env:GRC_TOKEN" }'] : []),
    [
      `Invoke-RestMethod -Method ${psMethod} -Uri "${url}"`,
      ...(signedIn ? ['-Headers $headers'] : []),
      ...(body !== null ? ['-ContentType "application/json"', `-Body '${body.replace(/'/g, "''")}'`] : []),
    ].join(' `\n  '),
  ].join('\n');
  return { curl, powershell };
}
