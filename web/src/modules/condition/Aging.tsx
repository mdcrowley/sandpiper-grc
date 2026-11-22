// The aging list (E32-04): the vehicles, assets and sites with an asset class, soonest end of useful
// life first, with their condition, next assessment and replacement project. A list, not a figure:
// it shows only the records the person may see.
import { Link, useSearchParams } from 'react-router-dom';
import { Card, EmptyState, ErrorState, formatDate, Loading, LookupChip, PageHeader, Select, StatusChip, useAuth, useFetch } from '../../core';
import { capitalized, ConditionTabs, LifeChip, useTargetWords } from './shared';

interface Row {
  type: 'vehicle' | 'asset' | 'site'; id: string; label: string; route: string; class_id: string; class_name: string;
  useful_life_end: string | null; past: boolean; condition_rating: string | null; next_assessment_due: string | null;
  excluded: boolean; age_years: number | null; replacement_project_id: string | null; replacement_project: string | null;
}

const KIND: Record<string, string> = { vehicle: 'Vehicle', asset: 'Asset', site: 'Site' };

export function AgingPage() {
  const { can } = useAuth();
  const words = useTargetWords();
  const [params, setParams] = useSearchParams();
  const within = params.get('within_years') ?? '5';
  const cls = params.get('class') ?? '';
  const type = params.get('type') ?? '';
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };
  const classes = useFetch<{ rows: { id: string; name: string }[] }>('/api/asset-classes?pageSize=500&sort=name&dir=asc');
  const query = new URLSearchParams({ ...(within !== 'all' ? { within_years: within } : {}), ...(cls ? { class: cls } : {}), ...(type ? { type } : {}) });
  const { data, error, reload } = useFetch<{ today: string; total: number; rows: Row[] }>(`/api/condition/aging?${query}`, { keepPrevious: true });
  const kinds = [
    ...(can('fleet.view') ? [{ value: 'vehicle', label: 'Vehicles' }] : []),
    { value: 'asset', label: 'Assets' },
    ...(can('sites.view') ? [{ value: 'site', label: 'Sites' }] : []),
  ];

  return (
    <div className="stack">
      <PageHeader title="Aging" subtitle={`${capitalized(words.plural)} with an asset class, soonest end of useful life first.`} />
      <ConditionTabs active="aging" />
      <Card>
        <div className="cnd-bar">
          <Select label="Useful life ends" value={within} onChange={(v) => set('within_years', v)} options={[
            { value: '0', label: 'Already ended' }, { value: '1', label: 'Within a year' }, { value: '2', label: 'Within 2 years' },
            { value: '5', label: 'Within 5 years' }, { value: '10', label: 'Within 10 years' }, { value: 'all', label: 'Any time' },
          ]} />
          <Select label="Asset class" value={cls} onChange={(v) => set('class', v)} placeholder="Every class"
            options={[{ value: '', label: 'Every class' }, ...(classes.data?.rows ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <Select label="Kind" value={type} onChange={(v) => set('type', v)} placeholder="Every kind" options={[{ value: '', label: 'Every kind' }, ...kinds]} />
        </div>
      </Card>
      <Card title={data ? `${data.total} record${data.total === 1 ? '' : 's'}` : 'Records'} flush>
        {error && !data ? <ErrorState error={error} onRetry={reload} />
          : !data ? <Loading lines={8} label="Loading the aging list" />
            : data.rows.length === 0 ? <EmptyState icon="clock" title="Nothing to show" message="No record you may see matches these choices." />
              : (
                <div className="table-wrap">
                  <table className="table">
                    <caption className="sr-only">Records by end of useful life</caption>
                    <thead><tr><th scope="col">Record</th><th scope="col">Kind</th><th scope="col">Class</th><th scope="col">End of useful life</th><th scope="col" className="num">Age</th><th scope="col">Condition</th><th scope="col">Next assessment</th><th scope="col">Replacement</th></tr></thead>
                    <tbody>
                      {data.rows.map((m) => (
                        <tr key={`${m.type}:${m.id}`}>
                          <td><Link to={m.route}>{m.label}</Link>{m.excluded && <> <StatusChip color="gray" size="sm" label="Not counted" title="Retired, disposed or no longer in use" /></>}</td>
                          <td>{KIND[m.type]}</td>
                          <td><Link to={`/condition/classes/${m.class_id}`}>{m.class_name}</Link></td>
                          <td><span className="cnd-life">{m.useful_life_end ? formatDate(m.useful_life_end) : '—'} <LifeChip end={m.useful_life_end} today={data.today} /></span></td>
                          <td className="num">{m.age_years === null ? '—' : `${m.age_years} y`}</td>
                          <td>{m.condition_rating ? <LookupChip list="condition_rating" value={m.condition_rating} /> : <span className="muted">Not assessed</span>}</td>
                          <td>{m.next_assessment_due ? <span className={m.next_assessment_due < data.today ? 'cnd-over' : undefined}>{formatDate(m.next_assessment_due)}</span> : '—'}</td>
                          <td>{m.replacement_project_id ? <Link to={`/projects/${m.replacement_project_id}`}>{m.replacement_project}</Link> : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
      </Card>
    </div>
  );
}
