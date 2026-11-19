// Coverage by another framework: pick a framework, law or contract that outcomes are mapped
// to ("also satisfies") and see, requirement by requirement, which outcomes meet it and where
// each of them stands.
import { useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button, Card, EmptyState, ErrorState, Icon, Loading, PageHeader, Select, StatusChip, TextField, cx, useFetch,
} from '../../core';
import { useFrameworkChoice } from './Board';
import { rememberFramework } from './boardState';
import type { Coverage } from './types';
import { frameworkTitle, statusColor, statusLabel, statusVars } from './types';

export function CoveragePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const choice = useFrameworkChoice(params.get('framework') ?? undefined);
  const wanted = params.get('name') ?? '';
  const [q, setQ] = useState('');
  const base = choice.id ? `/api/frameworks/${choice.id}/coverage` : null;
  const overview = useFetch<Coverage>(base);
  const name = wanted || overview.data?.names[0]?.name || '';
  const detail = useFetch<Coverage>(base && name ? `${base}?name=${encodeURIComponent(name)}` : null, { keepPrevious: true });

  const requirements = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = detail.data?.requirements ?? [];
    return needle
      ? all.filter((r) => r.reference.toLowerCase().includes(needle) || r.outcomes.some((o) => `${o.code} ${o.title ?? ''}`.toLowerCase().includes(needle)))
      : all;
  }, [detail.data, q]);

  if (choice.error) return <ErrorState error={choice.error} onRetry={choice.reload} />;
  if (!choice.data) return <Loading lines={8} label="Loading coverage" />;
  if (!choice.id) {
    return (
      <>
        <PageHeader title="Coverage of other frameworks" />
        <EmptyState icon="shield" title="No framework has been loaded yet" action={<Button onClick={() => navigate('/frameworks')}>Go to framework outcomes</Button>} />
      </>
    );
  }
  if (overview.error) return <ErrorState error={overview.error} onRetry={overview.reload} />;
  if (!overview.data) return <Loading lines={8} label="Loading coverage" />;

  const data = overview.data;
  const targetLabel = data.statuses.find((s) => s.value === data.target.status)?.label ?? data.target.status;
  const select = (next: string) => {
    const p = new URLSearchParams(params);
    p.set('name', next);
    setParams(p);
    setQ('');
  };

  return (
    <div className="stack fw-page">
      <PageHeader
        title="Coverage of other frameworks"
        subtitle={`Which outcomes of ${frameworkTitle(data.framework)} also satisfy another framework, law or contract, and where they stand`}
        breadcrumbs={[{ label: 'Framework outcomes', to: '/frameworks' }, { label: 'Coverage' }]}
        actions={choice.frameworks.length > 1 && (
          <Select label="Framework" hideLabel required value={choice.id}
            options={choice.frameworks.map((f) => ({ value: f.id, label: frameworkTitle(f) }))}
            onChange={(v) => { if (v) { rememberFramework(v); setParams({ framework: v }); } }} />
        )}
      />

      {data.names.length === 0 ? (
        <EmptyState
          icon="link"
          title="No outcome is mapped to another framework yet"
          message="Open an outcome and use its “Also satisfies” tab to record the requirements of other frameworks it meets. They are gathered here."
          action={<Button onClick={() => navigate('/frameworks')}>Go to the outcomes board</Button>}
        />
      ) : (
        <div className="fw-coverage">
          <nav className="fw-coverage-names" aria-label="Other frameworks">
            {data.names.map((n) => (
              <button key={n.name} type="button" className={cx('fw-coverage-name', n.name === (detail.data?.name ?? name) && 'is-current')}
                aria-current={n.name === name ? 'true' : undefined} onClick={() => select(n.name)}>
                <span className="fw-coverage-title">{n.name}</span>
                <span className="fw-coverage-sub">{n.requirements ? `${n.requirements} requirement${n.requirements === 1 ? '' : 's'} · ` : ''}{n.outcomes} outcome{n.outcomes === 1 ? '' : 's'}</span>
                <span className="fw-mini" aria-hidden="true"><span style={{ width: `${n.outcomes ? Math.round((n.at_target / n.outcomes) * 100) : 0}%` }} /></span>
                <span className="fw-coverage-sub">{n.at_target} of {n.outcomes} at “{targetLabel}” or better</span>
              </button>
            ))}
          </nav>

          <Card
            title={detail.data?.name ?? name}
            actions={<TextField label="Search requirements" hideLabel size="xs" type="search" value={q} onChange={setQ}
              placeholder="Find a requirement or outcome" leftSection={<Icon name="search" size={14} />} />}
            flush
          >
            {detail.error ? <ErrorState error={detail.error} onRetry={detail.reload} />
              : !detail.data?.requirements ? <Loading lines={6} label="Loading requirements" />
              : requirements.length === 0 ? <EmptyState icon="search" title="No requirement matches that search" />
              : (
                <div className="table-wrap">
                  <table className="table fw-coverage-table">
                    <thead>
                      <tr><th scope="col">Requirement</th><th scope="col">Satisfied by</th><th scope="col">Status</th><th scope="col" className="num">At target</th></tr>
                    </thead>
                    <tbody>
                      {requirements.map((r) => r.outcomes.map((o, i) => (
                        <tr key={`${r.reference}-${o.id}`} className={i === 0 ? 'fw-coverage-first' : undefined}>
                          {i === 0 && (
                            <th scope="rowgroup" rowSpan={r.outcomes.length} className="fw-coverage-ref">
                              {r.reference || <span className="muted">The framework as a whole</span>}
                            </th>
                          )}
                          <td style={{ whiteSpace: 'normal' }}>
                            <Link to={`/frameworks/outcomes/${o.id}`}><span className="ref">{o.code}</span></Link>
                            {o.priority && <span className="fw-star"><Icon name="star" size={13} label="Priority outcome" /></span>}{' '}
                            {o.title}{o.note ? <span className="muted"> ({o.note})</span> : null}
                          </td>
                          <td><StatusChip color={statusColor(data.statuses, o.status)} label={statusLabel(data.statuses, o.status)} /></td>
                          {i === 0 && (
                            <td rowSpan={r.outcomes.length} className="num">
                              <span className="fw-coverage-score" style={statusVars(r.at_target === r.outcomes.length ? 'green' : r.at_target ? 'amber' : 'red') as CSSProperties}>
                                {r.at_target} of {r.outcomes.length}
                              </span>
                            </td>
                          )}
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        </div>
      )}
    </div>
  );
}
