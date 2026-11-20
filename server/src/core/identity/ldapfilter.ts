// LDAP search filters (RFC 4515) and distinguished-name values (RFC 4514) for directory sign-in
// (E02-26).
//
// A person's typed user name only ever reaches a filter through `fillFilter`, which escapes it
// (RFC 4515 section 3: `\ * ( )` and NUL, plus every other non-printable or non-ASCII byte), and the
// filled filter is then parsed and sent in its binary (BER) form, so what the directory receives is
// exactly the administrator's filter with the name as one literal value. A name typed into a
// distinguished name (the "user DN template" mode) is escaped with `escapeDnValue` (RFC 4514).
import { BerError, boolean, constructed, children, octets, readBoolean, readString, sequence, type Element } from './ber.ts';

export type Filter =
  | { op: 'and' | 'or'; list: Filter[] }
  | { op: 'not'; filter: Filter }
  | { op: 'eq' | 'ge' | 'le' | 'approx'; attr: string; value: Buffer }
  | { op: 'present'; attr: string }
  | { op: 'substr'; attr: string; initial: Buffer | null; any: Buffer[]; final: Buffer | null }
  | { op: 'ext'; attr: string | null; rule: string | null; dn: boolean; value: Buffer };

export class FilterError extends Error {
  constructor(message: string) { super(message); this.name = 'FilterError'; }
}

const MAX_FILTER = 4096;
const MAX_DEPTH = 20;
/** Matching rule "in chain" (Active Directory): membership through nested groups. */
export const IN_CHAIN = '1.2.840.113556.1.4.1941';

/** Escapes a value for the string form of a filter (RFC 4515 section 3). Every byte that is not plain printable ASCII is escaped too. */
export function escapeFilterValue(value: string): string {
  let out = '';
  for (const byte of Buffer.from(value, 'utf8')) {
    const c = String.fromCharCode(byte);
    out += byte < 0x20 || byte > 0x7e || c === '\\' || c === '*' || c === '(' || c === ')' ? `\\${byte.toString(16).padStart(2, '0')}` : c;
  }
  return out;
}

/** Escapes one attribute value for a distinguished name (RFC 4514 section 2.4). */
export function escapeDnValue(value: string): string {
  let out = '';
  const chars = [...value];
  chars.forEach((c, i) => {
    if (c === '\u0000') out += '\\00';
    else if ('"+,;<>\\='.includes(c)) out += `\\${c}`;
    else if ((i === 0 && (c === ' ' || c === '#')) || (i === chars.length - 1 && c === ' ')) out += `\\${c}`;
    else if (c.charCodeAt(0) < 0x20) out += `\\${c.charCodeAt(0).toString(16).padStart(2, '0')}`;
    else out += c;
  });
  return out;
}

/** Puts values into a filter template: each `{name}` becomes the escaped value. Unknown placeholders are refused. */
export function fillFilter(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (_m, name: string) => {
    if (!(name in values)) throw new FilterError(`unknown placeholder {${name}}`);
    return escapeFilterValue(values[name]);
  });
}

/** Puts values into a DN template: each `{name}` becomes the DN-escaped value. */
export function fillDn(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-z]+)\}/g, (_m, name: string) => {
    if (!(name in values)) throw new FilterError(`unknown placeholder {${name}}`);
    return escapeDnValue(values[name]);
  });
}

// ---------- parsing the string form ----------

const ATTR_RE = /^(?:[A-Za-z][A-Za-z0-9-]*|\d+(?:\.\d+)+)(?:;[A-Za-z0-9-]+)*$/;
const RULE_RE = /^(?:[A-Za-z][A-Za-z0-9-]*|\d+(?:\.\d+)+)$/;

/** Decodes an assertion value with `\hh` escapes into bytes. Refuses unescaped `( ) * \` and NUL. */
function unescapeValue(raw: string, allowStar = false): Buffer {
  const out: number[] = [];
  const bytes = Buffer.from(raw, 'utf8');
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0x5c) {
      const hex = bytes.subarray(i + 1, i + 3).toString('latin1');
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new FilterError('bad escape in a filter value');
      out.push(parseInt(hex, 16));
      i += 2;
    } else if (b === 0x00 || b === 0x28 || b === 0x29 || (b === 0x2a && !allowStar)) {
      throw new FilterError('unescaped special character in a filter value');
    } else out.push(b);
  }
  return Buffer.from(out);
}

/** Parses a filter in its string form (RFC 4515). */
export function parseFilter(text: string): Filter {
  if (typeof text !== 'string' || !text.trim()) throw new FilterError('empty filter');
  if (text.length > MAX_FILTER) throw new FilterError('filter too long');
  let pos = 0;
  const s = text.trim();

  const filter = (depth: number): Filter => {
    if (depth > MAX_DEPTH) throw new FilterError('filter nested too deeply');
    if (s[pos] !== '(') throw new FilterError(`expected "(" at ${pos}`);
    pos += 1;
    let f: Filter;
    const c = s[pos];
    if (c === '&' || c === '|') {
      pos += 1;
      const list: Filter[] = [];
      while (s[pos] === '(') list.push(filter(depth + 1));
      if (!list.length) throw new FilterError('an "and" or "or" needs at least one filter');
      f = { op: c === '&' ? 'and' : 'or', list };
    } else if (c === '!') {
      pos += 1;
      f = { op: 'not', filter: filter(depth + 1) };
    } else {
      // An item runs to the next unescaped ")": values cannot hold one unescaped.
      const end = s.indexOf(')', pos);
      if (end < 0) throw new FilterError('missing ")"');
      f = item(s.slice(pos, end));
      pos = end;
    }
    if (s[pos] !== ')') throw new FilterError(`expected ")" at ${pos}`);
    pos += 1;
    return f;
  };

  const item = (body: string): Filter => {
    const ext = /^([^:=]*)((?::dn)?)(?::([^:=]+))?:=(.*)$/s.exec(body);
    if (ext && body.includes(':=') && body.indexOf(':') < body.indexOf('=')) {
      const [, attr, dn, rule, value] = ext;
      if (attr && !ATTR_RE.test(attr)) throw new FilterError('bad attribute in an extensible match');
      if (rule && !RULE_RE.test(rule)) throw new FilterError('bad matching rule');
      if (!attr && !rule) throw new FilterError('an extensible match needs an attribute or a matching rule');
      return { op: 'ext', attr: attr || null, rule: rule || null, dn: Boolean(dn), value: unescapeValue(value) };
    }
    const m = /^([^=~<>]+)(=|~=|>=|<=)(.*)$/s.exec(body);
    if (!m) throw new FilterError('bad filter item');
    const [, attr, type, value] = m;
    if (!ATTR_RE.test(attr)) throw new FilterError(`bad attribute name "${attr.slice(0, 40)}"`);
    if (type === '~=') return { op: 'approx', attr, value: unescapeValue(value) };
    if (type === '>=') return { op: 'ge', attr, value: unescapeValue(value) };
    if (type === '<=') return { op: 'le', attr, value: unescapeValue(value) };
    if (value === '*') return { op: 'present', attr };
    if (value.includes('*')) {
      const parts = value.split('*');
      const initial = parts[0] ? unescapeValue(parts[0]) : null;
      const final = parts[parts.length - 1] ? unescapeValue(parts[parts.length - 1]) : null;
      const any = parts.slice(1, -1).filter(Boolean).map((p) => unescapeValue(p));
      return { op: 'substr', attr, initial, any, final };
    }
    return { op: 'eq', attr, value: unescapeValue(value) };
  };

  const f = filter(0);
  if (pos !== s.length) throw new FilterError('text after the filter');
  return f;
}

// ---------- the binary form (RFC 4511 section 4.5.1) ----------

export function encodeFilter(f: Filter): Buffer {
  switch (f.op) {
    case 'and': return constructed(0xa0, ...f.list.map(encodeFilter));
    case 'or': return constructed(0xa1, ...f.list.map(encodeFilter));
    case 'not': return constructed(0xa2, encodeFilter(f.filter));
    case 'eq': return constructed(0xa3, octets(f.attr), octets(f.value));
    case 'ge': return constructed(0xa5, octets(f.attr), octets(f.value));
    case 'le': return constructed(0xa6, octets(f.attr), octets(f.value));
    case 'approx': return constructed(0xa8, octets(f.attr), octets(f.value));
    case 'present': return octets(f.attr, 0x87);
    case 'substr': return constructed(0xa4, octets(f.attr), sequence(
      ...(f.initial ? [octets(f.initial, 0x80)] : []), ...f.any.map((a) => octets(a, 0x81)), ...(f.final ? [octets(f.final, 0x82)] : []),
    ));
    case 'ext': return constructed(0xa9,
      ...(f.rule ? [octets(f.rule, 0x81)] : []), ...(f.attr ? [octets(f.attr, 0x82)] : []), octets(f.value, 0x83), ...(f.dn ? [boolean(true, 0x84)] : []));
    default: throw new FilterError('unknown filter');
  }
}

/** Reads a filter from its binary form (the stand-in directory uses this). */
export function decodeFilter(el: Element, depth = 0): Filter {
  if (depth > MAX_DEPTH) throw new BerError('filter nested too deeply');
  const kids = () => children(el);
  const ava = () => { const [a, v] = kids(); return { attr: readString(a), value: Buffer.from(v.value) }; };
  switch (el.tag) {
    case 0xa0: return { op: 'and', list: kids().map((k) => decodeFilter(k, depth + 1)) };
    case 0xa1: return { op: 'or', list: kids().map((k) => decodeFilter(k, depth + 1)) };
    case 0xa2: return { op: 'not', filter: decodeFilter(kids()[0], depth + 1) };
    case 0xa3: return { op: 'eq', ...ava() };
    case 0xa5: return { op: 'ge', ...ava() };
    case 0xa6: return { op: 'le', ...ava() };
    case 0xa8: return { op: 'approx', ...ava() };
    case 0x87: return { op: 'present', attr: readString(el) };
    case 0xa4: {
      const [a, subs] = kids();
      const f: Filter = { op: 'substr', attr: readString(a), initial: null, any: [], final: null };
      for (const s of children(subs)) {
        if (s.tag === 0x80) f.initial = Buffer.from(s.value);
        else if (s.tag === 0x81) f.any.push(Buffer.from(s.value));
        else if (s.tag === 0x82) f.final = Buffer.from(s.value);
      }
      return f;
    }
    case 0xa9: {
      const f: Filter = { op: 'ext', attr: null, rule: null, dn: false, value: Buffer.alloc(0) };
      for (const k of kids()) {
        if (k.tag === 0x81) f.rule = readString(k);
        else if (k.tag === 0x82) f.attr = readString(k);
        else if (k.tag === 0x83) f.value = Buffer.from(k.value);
        else if (k.tag === 0x84) f.dn = readBoolean(k);
      }
      return f;
    }
    default: throw new BerError(`unknown filter tag ${el.tag}`);
  }
}

/** The string form of a filter, for showing to an administrator (values escaped). */
export function filterToString(f: Filter): string {
  const v = (b: Buffer) => escapeFilterValue(b.toString('utf8'));
  switch (f.op) {
    case 'and': return `(&${f.list.map(filterToString).join('')})`;
    case 'or': return `(|${f.list.map(filterToString).join('')})`;
    case 'not': return `(!${filterToString(f.filter)})`;
    case 'eq': return `(${f.attr}=${v(f.value)})`;
    case 'ge': return `(${f.attr}>=${v(f.value)})`;
    case 'le': return `(${f.attr}<=${v(f.value)})`;
    case 'approx': return `(${f.attr}~=${v(f.value)})`;
    case 'present': return `(${f.attr}=*)`;
    case 'substr': return `(${f.attr}=${f.initial ? v(f.initial) : ''}*${f.any.map((a) => `${v(a)}*`).join('')}${f.final ? v(f.final) : ''})`;
    case 'ext': return `(${f.attr ?? ''}${f.dn ? ':dn' : ''}${f.rule ? `:${f.rule}` : ''}:=${v(f.value)})`;
    default: return '';
  }
}

