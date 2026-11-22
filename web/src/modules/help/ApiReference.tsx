// The API reference (/help/api): the OpenAPI description from GET /api/v1/openapi.json (paths under
// the stable base path /api/v1), readable on screen. No extra library: paths grouped by tag, each
// operation folded until opened, schemas drawn as nested lists, copyable curl and PowerShell examples.
// Read-only documentation: nothing on this page sends a request to the documented routes.
// The server cuts the description down to what the signed-in person may use.
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Card, cx, EmptyState, ErrorState, Loading, PageHeader, TableWrap, TextField, useFetch } from '../../core';
import ApiExamples from './ApiExamples';
import './help.css';

interface Schema {
  $ref?: string;
  type?: string | string[];
  format?: string;
  title?: string;
  description?: string;
  enum?: unknown[];
  items?: Schema;
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: boolean | Schema;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  readOnly?: boolean;
  [k: string]: unknown;
}
interface Parameter { name: string; in: string; required?: boolean; description?: string; schema?: Schema; $ref?: string }
interface Media { schema?: Schema }
interface Operation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, Media> };
  responses?: Record<string, { description?: string; headers?: Record<string, unknown>; content?: Record<string, Media> }>;
  security?: unknown[];
  deprecated?: boolean;
  'x-permission'?: string;
  'x-also-needs'?: string;
  'x-undocumented'?: boolean;
}
interface OpenApiDoc {
  openapi: string;
  info: { title: string; version?: string; description?: string };
  tags?: { name: string; description?: string }[];
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, Schema>; parameters?: Record<string, Parameter> };
}

/** Parameters given by reference (If-Match, Idempotency-Key, ...) drawn like the others. */
const resolveParams = (params: Parameter[] | undefined, doc: OpenApiDoc): Parameter[] =>
  (params ?? []).map((p) => (p.$ref ? doc.components?.parameters?.[refName(p.$ref)] ?? p : p)).filter((p) => p.name);
interface Entry { key: string; method: string; path: string; op: Operation; tag: string; text: string }

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'];
const anchor = (tag: string) => `api-tag-${tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
const refName = (ref: string) => ref.split('/').pop() ?? ref;

/** Inline `code` and **bold** from the descriptions; everything else is plain text. */
function Rich({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('`') && p.endsWith('`') && p.length > 1 ? <code key={i}>{p.slice(1, -1)}</code>
        : p.startsWith('**') && p.endsWith('**') && p.length > 3 ? <strong key={i}>{p.slice(2, -2)}</strong>
          : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

function Paragraphs({ text }: { text: string }) {
  return <>{text.split(/\n\s*\n|\n/).filter((t) => t.trim()).map((t, i) => <p key={i}><Rich text={t} /></p>)}</>;
}

/** `string`, `string | null`, `array of Ticket`, `string (date)`, `one of: a, b`. */
function typeText(s: Schema | undefined): string {
  if (!s) return 'any';
  if (s.$ref) return refName(s.$ref);
  const types = (Array.isArray(s.type) ? s.type : s.type ? [s.type] : []);
  const main = types.filter((t) => t !== 'null');
  let text = main.length === 0 ? (s.properties ? 'object' : 'any') : main.map((t) => (t === 'array' ? `array of ${typeText(s.items)}` : t)).join(' | ');
  if (s.format) text += ` (${s.format})`;
  if (types.includes('null')) text += ', or null';
  return text;
}

/** A fold whose content is built only once it is opened, so large or self-referring schemas cost nothing. */
function Fold({ summary, children, className }: { summary: ReactNode; children: () => ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details className={className} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && children()}
    </details>
  );
}

function SchemaView({ schema, doc, depth = 0 }: { schema: Schema | undefined; doc: OpenApiDoc; depth?: number }) {
  if (!schema) return <p className="muted">No schema is given.</p>;
  const resolved = schema.$ref ? doc.components?.schemas?.[refName(schema.$ref)] : schema;
  if (!resolved) return <p className="muted">Schema {schema.$ref ? <code>{refName(schema.$ref)}</code> : null} is not in this document.</p>;
  if (depth > 6) return <p className="muted">…</p>;
  const props = resolved.properties ?? (resolved.items && !resolved.items.$ref ? resolved.items.properties : undefined);
  const isArray = (Array.isArray(resolved.type) ? resolved.type : [resolved.type]).includes('array');

  if (!props) {
    return (
      <div className="api-schema-plain">
        <span className="api-type">{schema.$ref ? `${refName(schema.$ref)}: ` : ''}{typeText(resolved)}</span>
        {resolved.description && <span className="api-desc"> <Rich text={resolved.description} /></span>}
        {resolved.enum && <span className="api-enum"> One of {resolved.enum.map((v, i) => <Fragment key={i}>{i > 0 && ', '}<code>{String(v)}</code></Fragment>)}.</span>}
        {isArray && resolved.items?.$ref && (
          <Fold className="api-fold" summary={<>Each item: <code>{refName(resolved.items.$ref)}</code></>}>
            {() => <SchemaView schema={resolved.items} doc={doc} depth={depth + 1} />}
          </Fold>
        )}
      </div>
    );
  }
  const required = new Set(resolved.required ?? (resolved.items?.required ?? []));
  return (
    <div className="api-schema">
      {(schema.$ref || isArray || resolved.description) && (
        <p className="api-schema-head">
          {schema.$ref && <code>{refName(schema.$ref)}</code>}
          {isArray && <span className="muted"> An array; each item:</span>}
          {resolved.description && <span className="muted"> <Rich text={resolved.description} /></span>}
        </p>
      )}
      <ul className="api-props">
        {Object.entries(props).map(([name, p]) => {
          const nested = p.$ref || p.properties || (p.items && (p.items.$ref || p.items.properties));
          const notes = [p.title && p.title !== name ? p.title : '', p.description ?? ''].filter(Boolean).join('. ');
          return (
            <li key={name}>
              <span className="api-prop-name"><code>{name}</code></span>
              <span className="api-type">{typeText(p)}</span>
              {required.has(name) && <span className="api-flag api-flag-req">required</span>}
              {p.readOnly && <span className="api-flag">read only</span>}
              {notes && <span className="api-desc"><Rich text={notes} /></span>}
              {p.enum && <span className="api-enum">One of {p.enum.map((v, i) => <Fragment key={i}>{i > 0 && ', '}<code>{String(v)}</code></Fragment>)}.</span>}
              {p.default !== undefined && <span className="api-enum">Default <code>{JSON.stringify(p.default)}</code>.</span>}
              {nested && depth < 6 && (
                <Fold className="api-fold" summary="Show its fields">{() => <SchemaView schema={p.$ref || p.properties ? p : p.items} doc={doc} depth={depth + 1} />}</Fold>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const PARAMS_SHOWN = 12;

function Parameters({ params, label }: { params: Parameter[]; label: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? params : params.slice(0, PARAMS_SHOWN);
  return (
    <>
      <TableWrap label={label} className="api-table-wrap">
        <table className="api-table">
          <thead><tr><th scope="col">Name</th><th scope="col">In</th><th scope="col">Type</th><th scope="col">About</th></tr></thead>
          <tbody>
            {shown.map((p) => (
              <tr key={`${p.in}:${p.name}`}>
                <td><code>{p.name}</code>{p.required && <span className="api-flag api-flag-req">required</span>}</td>
                <td>{p.in}</td>
                <td className="api-type">{typeText(p.schema)}{p.schema?.enum && <div className="muted">{p.schema.enum.map(String).join(', ')}</div>}</td>
                <td>{p.description ? <Rich text={p.description} /> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      {params.length > PARAMS_SHOWN && (
        <button type="button" className="api-more" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${params.length} parameters`}
        </button>
      )}
    </>
  );
}

function OperationBody({ entry, doc }: { entry: Entry; doc: OpenApiDoc }) {
  const { op } = entry;
  const body = op.requestBody?.content ?? {};
  const params = resolveParams(op.parameters, doc);
  return (
    <div className="api-op-body">
      {op.description && <div className="api-text"><Paragraphs text={op.description} /></div>}
      <ul className="api-facts">
        {op.security && op.security.length === 0 ? <li>No sign-in needed.</li> : (
          op['x-permission'] ? <li>Needs the permission <code>{op['x-permission']}</code>{op['x-also-needs'] && <> and <code>{op['x-also-needs']}</code></>}.</li> : <li>Needs a signed-in session or an API token.</li>
        )}
        {op.deprecated && <li><strong>Deprecated.</strong> Answers carry a <code>Deprecation</code> header; see the description for what to use instead.</li>}
        {op['x-undocumented'] && <li>This route has not been described in detail yet.</li>}
        {op.operationId && <li>Operation id <code>{op.operationId}</code></li>}
      </ul>
      {params.length > 0 && (
        <section><h4>Parameters</h4><Parameters params={params} label={`Parameters of ${entry.method.toUpperCase()} ${entry.path}`} /></section>
      )}
      {Object.keys(body).length > 0 && (
        <section>
          <h4>Request body{op.requestBody?.required ? ' (required)' : ''}</h4>
          {Object.entries(body).map(([type, m]) => (
            <div key={type} className="api-media"><span className="api-media-type">{type}</span><SchemaView schema={m.schema} doc={doc} /></div>
          ))}
        </section>
      )}
      {op.responses && (
        <section>
          <h4>Responses</h4>
          <dl className="api-responses">
            {Object.entries(op.responses).map(([code, r]) => (
              <div key={code} className="api-response">
                <dt><span className={cx('api-code', code.startsWith('2') && 'api-code-ok', /^[45]/.test(code) && 'api-code-err')}>{code === 'default' ? 'Any' : code}</span></dt>
                <dd>
                  {r.description && <Rich text={r.description} />}
                  {code.startsWith('2') && r.headers && (
                    <p className="muted api-headers">Headers: {Object.keys(r.headers).map((h, i) => <Fragment key={h}>{i > 0 && ', '}<code>{h}</code></Fragment>)}</p>
                  )}
                  {r.content && Object.entries(r.content).map(([type, m]) => {
                    const isError = m.schema?.$ref?.endsWith('/Error');
                    if (isError) return null; // the error shape is described once, at the top
                    return <div key={type} className="api-media"><span className="api-media-type">{type}</span><SchemaView schema={m.schema} doc={doc} /></div>;
                  })}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <ApiExamples method={entry.method} path={entry.path} op={{ ...op, parameters: params }} schemas={doc.components?.schemas} />
    </div>
  );
}

export default function ApiReference() {
  const { data: doc, error, reload } = useFetch<OpenApiDoc>('/api/v1/openapi.json');
  const [q, setQ] = useState('');

  const entries = useMemo<Entry[]>(() => {
    if (!doc) return [];
    const out: Entry[] = [];
    for (const [path, ops] of Object.entries(doc.paths ?? {})) {
      for (const [method, op] of Object.entries(ops)) {
        if (!METHOD_ORDER.includes(method)) continue;
        const tag = op.tags?.[0] ?? 'Other';
        out.push({ key: `${method} ${path}`, method, path, op, tag, text: `${method} ${path} ${op.summary ?? ''} ${tag} ${op.operationId ?? ''} ${op['x-permission'] ?? ''} ${op.description ?? ''}`.toLowerCase() });
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path) || METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method));
  }, [doc]);

  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? entries.filter((e) => words.every((w) => e.text.includes(w))) : entries;
  const groups = useMemo(() => {
    const byTag = new Map<string, Entry[]>();
    for (const e of shown) (byTag.get(e.tag) ?? byTag.set(e.tag, []).get(e.tag)!).push(e);
    const order = (doc?.tags ?? []).map((t) => t.name);
    return [...byTag.entries()].sort(([a], [b]) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a.localeCompare(b);
    });
  }, [shown, doc]);
  const tagInfo = (name: string) => doc?.tags?.find((t) => t.name === name)?.description;

  const jump = (tag: string) => {
    const el = document.getElementById(anchor(tag));
    el?.scrollIntoView({ block: 'start' });
    el?.focus({ preventScroll: true });
  };

  return (
    <>
      <PageHeader
        title="API reference"
        subtitle="Every route you may call, with its parameters and what it returns. Generated from the running application."
        breadcrumbs={[{ label: 'User guide', to: '/help' }, { label: 'API reference' }]}
      />
      {error ? <ErrorState title="The API description could not be loaded" error={error} onRetry={reload} />
        : !doc ? <Loading lines={10} label="Loading the API description" />
        : (
          <div className="stack">
            <Card title={doc.info.title}>
              <div className="api-text api-intro">
                {doc.info.description && <Paragraphs text={doc.info.description} />}
                <p>
                  Make a personal API token on your <Link to="/account/security">Account security</Link> page. This page lists only what you may use;
                  the machine-readable version is <a href="/api/v1/openapi.json" download="openapi.json">openapi.json</a> (OpenAPI {doc.openapi}).
                  Each route shows copyable curl and PowerShell examples. This is documentation only: it does not send requests for you.
                </p>
              </div>
            </Card>
            <div className="api-search" role="search">
              <TextField label="Filter routes" type="search" value={q} onChange={setQ} placeholder="For example: systems, POST, webhook, /api/admin" />
              <p className="muted api-count" role="status">
                {words.length ? `${shown.length} of ${entries.length} routes match` : `${entries.length} routes in ${groups.length} groups`}
              </p>
            </div>
            {entries.length === 0 ? <EmptyState icon="file-text" title="No routes are available to you" message="Ask an administrator about your access." />
              : shown.length === 0 ? <EmptyState icon="search" title="No route matches that" message="Try fewer words, a path such as /api/assets, or a method such as GET." />
              : (
                <div className="api-layout">
                  <nav className="api-contents" aria-label="Groups of routes">
                    <ul>
                      {groups.map(([tag, list]) => (
                        <li key={tag}>
                          <a href={`#${anchor(tag)}`} onClick={(e) => { e.preventDefault(); jump(tag); }}>
                            <span>{tag}</span><span className="api-contents-n">{list.length}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </nav>
                  <div className="api-groups">
                    {groups.map(([tag, list]) => (
                      <section key={tag} className="api-group" aria-labelledby={anchor(tag)}>
                        <h2 id={anchor(tag)} tabIndex={-1}>{tag}</h2>
                        {tagInfo(tag) && <p className="muted api-group-about"><Rich text={tagInfo(tag)!} /></p>}
                        <div className="api-ops">
                          {list.map((e) => (
                            <Fold
                              key={e.key} className="api-op"
                              summary={(
                                <span className="api-op-head">
                                  <span className={`api-method api-method-${e.method}`}>{e.method.toUpperCase()}</span>
                                  <code className="api-path">{e.path}</code>
                                  <span className="api-summary">{e.op.summary && e.op.summary !== `${e.method.toUpperCase()} ${e.path}` ? e.op.summary : ''}</span>
                                </span>
                              )}
                            >
                              {() => <OperationBody entry={e} doc={doc} />}
                            </Fold>
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                </div>
              )}
          </div>
        )}
    </>
  );
}
