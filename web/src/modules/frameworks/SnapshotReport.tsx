// An assessment snapshot as a report to print or save as a PDF: the position on that date,
// what moved since the snapshot before it, each function, and every outcome with its status.
import { Fragment } from 'react';
import type { CSSProperties } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ApiError, Button, ErrorState, Icon, Loading, NotFound, PageHeader, formatDate, formatDateTime, useAuth, useFetch,
} from '../../core';
import { StatusBar, StatusLegend, TargetRing } from './StatusBar';
import type { Comparison, SnapshotDetail, SnapshotExtra, SnapshotOutcome } from './types';
import { statusColor, statusLabel } from './types';

const signed = (n: number) => (n === 0 ? 'no change' : `${n > 0 ? '+' : '−'}${Math.abs(n)}`);

export function SnapshotReport() {
  const { id } = useParams();
  const { appName, user } = useAuth();
  const { data, error, reload } = useFetch<SnapshotDetail & SnapshotExtra>(id ? `/api/assessments/${id}` : null);
  const compare = useFetch<Comparison>(data?.previous ? `/api/assessments/compare?from=${data.previous.id}&to=${data.id}` : null);

  if (error instanceof ApiError && error.status === 404) return <NotFound />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || (data.previous && !compare.data && !compare.error)) return <Loading lines={12} label="Preparing the report" />;

  const cmp = compare.data;
  const headline = data.priority.total ? data.priority : data.all;
  const what = data.priority.total ? 'priority outcomes' : 'outcomes';
  const targetLabel = data.statuses.find((s) => s.value === data.target.status)?.label ?? data.target.status;
  const improved = cmp?.changed.filter((c) => c.direction === 'improved') ?? [];
  const declined = cmp?.changed.filter((c) => c.direction === 'declined') ?? [];
  const categoryName = new Map(data.categories.map((c) => [c.code, c.name]));
  const byCategory = (fn: string) => {
    const groups = new Map<string, SnapshotOutcome[]>();
    for (const o of data.outcomes.filter((x) => (x.function_code ?? '') === fn)) {
      const key = o.category_code ?? '';
      groups.set(key, [...(groups.get(key) ?? []), o]);
    }
    return [...groups];
  };

  return (
    <div className="fw-report">
      <div className="fw-report-bar">
        <PageHeader
          title="Assessment report"
          subtitle="Laid out for paper. Use Print, then choose a printer or “Save as PDF”."
          breadcrumbs={[{ label: 'Assessments', to: '/assessments' }, { label: data.name, to: `/assessments/${data.id}` }, { label: 'Report' }]}
          actions={<Button variant="primary" icon="file-text" onClick={() => window.print()}>Print</Button>}
        />
      </div>

      <article className="fw-sheet">
        <header className="fw-sheet-head">
          <div className="fw-eyebrow">{appName} · Assessment report</div>
          <h2>{data.framework_name ?? 'Framework'}: {data.name}</h2>
          <p>Position on <strong>{formatDate(data.taken_on)}</strong>{data.previous ? <>, compared with “{data.previous.name}” ({formatDate(data.previous.taken_on)})</> : null}.</p>
        </header>

        <section className="fw-sheet-summary">
          <TargetRing tally={headline} size={120} label={`All functions, ${what}`} />
          <div className="fw-sheet-key">
            <div className="fw-hero-figure"><strong>{headline.atTarget}</strong> of {headline.total}</div>
            <div className="fw-hero-label">{what} at “{targetLabel}” or better</div>
          </div>
          <dl className="fw-sheet-figures">
            <div><dt>Score, priority outcomes</dt><dd>{data.priority.score}{cmp && <small>{signed(data.priority.score - cmp.overall.from.priority.score)}</small>}</dd></div>
            <div><dt>Score, all outcomes</dt><dd>{data.all.score}{cmp && <small>{signed(data.all.score - cmp.overall.from.all.score)}</small>}</dd></div>
            <div><dt>Target score</dt><dd>{data.target.score}</dd></div>
            {cmp && <div><dt>Outcomes that moved</dt><dd>{improved.length} up<small>{declined.length} down</small></dd></div>}
          </dl>
        </section>

        <StatusBar tally={data.all} scale={data.statuses} thick showCounts label="All outcomes by status" />
        {data.notes && <p className="fw-sheet-notes"><strong>Notes.</strong> {data.notes}</p>}

        <section>
          <h3>By function</h3>
          <table className="fw-sheet-table">
            <thead>
              <tr>
                <th scope="col">Function</th><th scope="col" className="num">Outcomes</th><th scope="col" className="num">At target</th>
                <th scope="col" className="num">Score</th>{cmp && <th scope="col" className="num">Change</th>}<th scope="col">By status</th>
              </tr>
            </thead>
            <tbody>
              {data.functions.map((f) => {
                const was = cmp?.functions.find((x) => x.code === f.code)?.from;
                return (
                  <tr key={f.code}>
                    <th scope="row"><span className="fw-cat-code">{f.code}</span>{f.name}</th>
                    <td className="num">{f.total}</td>
                    <td className="num">{f.atTarget}</td>
                    <td className="num"><strong>{f.score}</strong></td>
                    {cmp && <td className="num">{was ? signed(f.score - was.score) : '—'}</td>}
                    <td style={{ minWidth: 160 }}><StatusBar tally={f} scale={data.statuses} label={`${f.name}: outcomes by status`} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <StatusLegend scale={data.statuses} />
        </section>

        {cmp && (
          <section>
            <h3>What moved since “{cmp.from.name}”</h3>
            {cmp.changed.length === 0 ? <p>No outcome changed status.</p> : (
              <table className="fw-sheet-table">
                <thead><tr><th scope="col">Outcome</th><th scope="col">Was</th><th scope="col">Is</th></tr></thead>
                <tbody>
                  {cmp.changed.map((c) => (
                    <tr key={c.outcome_id}>
                      <td><span className="fw-cat-code">{c.code}</span>{c.priority && <span className="fw-star"><Icon name="star" size={11} label="Priority outcome" /></span>} {c.title}</td>
                      <td className="fw-nowrap">{statusLabel(cmp.statuses, c.from)}</td>
                      <td className="fw-nowrap">
                        <span className="fw-tl-status"><span className="fw-swatch" style={{ background: `var(--c-${statusColor(cmp.statuses, c.to)}-solid)` }} />{statusLabel(cmp.statuses, c.to)}</span>
                        {(c.direction === 'improved' || c.direction === 'declined') && <Icon name={c.direction === 'improved' ? 'arrow-up' : 'arrow-down'} size={12} label={c.direction} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        <section>
          <h3>Every outcome</h3>
          {data.functions.map((f) => (
            <div key={f.code} className="fw-sheet-fn" style={{ '--fw-band': `var(--c-${f.color}-solid)` } as CSSProperties}>
              <h4>{f.code} · {f.name}</h4>
              <table className="fw-sheet-table fw-sheet-outcomes">
                <tbody>
                  {byCategory(f.code).map(([cat, list]) => (
                    <Fragment key={cat}>
                      <tr className="fw-sheet-cat"><th scope="colgroup" colSpan={2}>{cat || 'No category'}{categoryName.get(cat) ? ` · ${categoryName.get(cat)}` : ''}</th></tr>
                      {list.map((o) => (
                        <tr key={o.outcome_id}>
                          <td><span className="fw-cat-code">{o.code}</span>{o.priority && <span className="fw-star"><Icon name="star" size={11} label="Priority outcome" /></span>} {o.title}</td>
                          <td className="fw-sheet-status">
                            <span className="fw-tl-status"><span className="fw-swatch" style={{ background: `var(--c-${statusColor(data.statuses, o.status)}-solid)` }} />{statusLabel(data.statuses, o.status)}</span>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        <footer className="fw-sheet-foot">
          A star marks a priority outcome. The score weights each outcome by its status
          ({data.statuses.map((s) => `${s.label} ${Math.round(s.weight * 100)}`).join(', ')}) and averages them.
          Printed {formatDateTime(new Date().toISOString())}{user ? ` by ${user.displayName}` : ''}. <Link to={`/assessments/${data.id}`} className="fw-noprint">Back to the snapshot</Link>
        </footer>
      </article>
    </div>
  );
}
