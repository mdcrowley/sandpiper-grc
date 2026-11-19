/**
 * A short notation for JSON Schemas in route descriptions (`ctx.describeRoute`, `core/api/docs/*`).
 *
 *   shape('{ id: uuid, title: string, due_on?: date | null, tags: [string], status: \'open\' | \'done\' }')
 *
 * - Objects `{ a: type, b?: type }`: members without `?` are required. `...` allows other members;
 *   `[key]: type` describes members with any name. A member with no type (`{ ok }`) may hold anything.
 * - Arrays `[type]`. Unions `a | b`. Single-quoted strings are fixed values (an enum).
 * - Scalars: string, integer, number, boolean, uuid, date, datetime, email, url, null, any, object,
 *   binary (a file). `@ticket` is a record of that type (its schema in components, when the caller
 *   may view it).
 * - A double-quoted string after a type is its description: `count: integer "Open items only"`.
 *
 * `shape` throws on anything it does not understand, so a typo fails the build of the description
 * (and its test) rather than producing a wrong document. `looseShape` is for the older free-text
 * descriptions: it returns null instead of throwing, and reads unknown words as fixed values.
 */
export type JsonSchema = Record<string, unknown>;

const SCALARS: Record<string, JsonSchema> = {
  string: { type: 'string' }, text: { type: 'string' },
  integer: { type: 'integer' }, int: { type: 'integer' },
  number: { type: 'number' },
  boolean: { type: 'boolean' }, bool: { type: 'boolean' },
  uuid: { type: 'string', format: 'uuid' },
  date: { type: 'string', format: 'date' },
  datetime: { type: 'string', format: 'date-time' },
  email: { type: 'string', format: 'email' },
  url: { type: 'string', format: 'uri' },
  null: { type: 'null' },
  any: {},
  object: { type: 'object' },
  binary: { type: 'string', format: 'binary' },
};

class ShapeError extends Error {}

function parse(src: string, loose: boolean): JsonSchema {
  let i = 0;
  const ws = () => { while (i < src.length && /\s/.test(src[i])) i += 1; };
  const peek = () => { ws(); return src[i]; };
  const expect = (ch: string) => {
    ws();
    if (src[i] !== ch) throw new ShapeError(`Expected "${ch}" at ${i} in: ${src}`);
    i += 1;
  };
  const word = (): string => {
    ws();
    const m = /^[A-Za-z_$][A-Za-z0-9_$.\-]*/.exec(src.slice(i));
    if (!m) throw new ShapeError(`Expected a name at ${i} in: ${src}`);
    i += m[0].length;
    return m[0];
  };
  const quoted = (q: string): string => {
    expect(q);
    let out = '';
    while (i < src.length && src[i] !== q) { out += src[i]; i += 1; }
    if (src[i] !== q) throw new ShapeError(`Unclosed ${q} in: ${src}`);
    i += 1;
    return out;
  };
  const describe = (s: JsonSchema): JsonSchema => (peek() === '"' ? { ...s, description: quoted('"') } : s);

  function primary(): JsonSchema {
    const ch = peek();
    if (ch === '{') return object();
    if (ch === '[') {
      expect('[');
      const items = union();
      expect(']');
      return { type: 'array', items };
    }
    if (ch === "'") return { const: quoted("'") };
    if (ch === '@') {
      i += 1;
      return { 'x-resource': word() };
    }
    if (ch !== undefined && /[0-9]/.test(ch)) {
      const m = /^-?\d+(\.\d+)?/.exec(src.slice(i))!;
      i += m[0].length;
      return { const: Number(m[0]) };
    }
    const w = word();
    if (w === 'true' || w === 'false') return { const: w === 'true' };
    const s = SCALARS[w];
    if (s) return { ...s };
    if (loose) return { const: w };
    throw new ShapeError(`Unknown type "${w}" in: ${src}`);
  }

  function union(): JsonSchema {
    const parts = [describe(primary())];
    while (peek() === '|') { i += 1; parts.push(describe(primary())); }
    return merge(parts);
  }

  function object(): JsonSchema {
    expect('{');
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    let additional: JsonSchema | boolean = false;
    while (peek() !== '}') {
      if (src.startsWith('...', i)) { i += 3; additional = true; }
      else if (peek() === '[') {
        expect('[');
        word();
        expect(']');
        expect(':');
        additional = union();
      } else {
        const name = peek() === "'" ? quoted("'") : word();
        let optional = false;
        if (peek() === '?') { i += 1; optional = true; }
        let schema: JsonSchema = {};
        if (peek() === ':') { i += 1; schema = union(); }
        else schema = describe(schema);
        properties[name] = schema;
        if (!optional) required.push(name);
      }
      if (peek() === ',') i += 1;
      else if (peek() !== '}') throw new ShapeError(`Expected "," or "}" at ${i} in: ${src}`);
    }
    expect('}');
    return {
      type: 'object', properties,
      ...(required.length ? { required } : {}),
      ...(additional === false ? {} : { additionalProperties: additional }),
    };
  }

  const out = union();
  ws();
  if (i !== src.length) throw new ShapeError(`Unexpected "${src.slice(i, i + 12)}" at ${i} in: ${src}`);
  return out;
}

/** Joins the parts of a union: fixed strings become an enum, `x | null` a nullable x, else anyOf. */
function merge(parts: JsonSchema[]): JsonSchema {
  if (parts.length === 1) return parts[0];
  const description = parts.map((p) => p.description).filter(Boolean).join(' ');
  const plain = parts.map(({ description: _d, ...p }) => p);
  const nonNull = plain.filter((p) => p.type !== 'null');
  const hasNull = nonNull.length < plain.length;
  const withDesc = (s: JsonSchema) => (description ? { ...s, description } : s);
  if (nonNull.length && nonNull.every((p) => 'const' in p && Object.keys(p).length === 1)) {
    const values = nonNull.map((p) => p.const);
    const types = [...new Set(values.map((v) => (typeof v === 'number' ? 'number' : typeof v === 'boolean' ? 'boolean' : 'string')))];
    const type = types.length === 1 ? types[0] : types;
    return withDesc({ type: hasNull ? [...(Array.isArray(type) ? type : [type]), 'null'] : type, enum: hasNull ? [...values, null] : values });
  }
  if (hasNull && nonNull.length === 1 && typeof nonNull[0].type === 'string') {
    return withDesc({ ...nonNull[0], type: [nonNull[0].type, 'null'] });
  }
  return withDesc({ anyOf: plain });
}

/** Parses the notation; throws on anything it does not understand. */
export function shape(src: string): JsonSchema {
  return parse(src.trim(), false);
}

/** Reads an older free-text description as a schema when it is one; otherwise null. */
export function looseShape(src: string): JsonSchema | null {
  const text = src.trim();
  if (!/^[[{]/.test(text)) return null;
  try {
    return parse(text, true);
  } catch {
    return null;
  }
}
