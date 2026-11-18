import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Chart, EmptyState, ErrorState, Loading, useFetch } from '../../core';
import type { ColorName } from '../../core';

interface Summary {
  scales: { key: string; name: string }[];
  levels: { value: string; label: string; color: string; count: number; by_scale: Record<string, number> }[];
  unscored: number;
  total: number;
  top: { id: string; ref: string; title: string; rating_label: string; color: string; owner_name: string | null }[];
}

/** Open risks from every scale on one chart, using the mapping of each rating to a common level. */
export function RiskSummary() {
  const { data, error, reload } = useFetch<Summary>('/api/risks/summary');
  const option = useMemo(() => ({
    tooltip: { trigger: 'axis' as const },
    legend: {},
    xAxis: { type: 'category' as const, data: data?.levels.map((l) => l.label) ?? [] },
    yAxis: { type: 'value' as const, minInterval: 1 },
    series: (data?.scales ?? []).map((s) => ({
      type: 'bar' as const, name: s.name, stack: 'risks',
      data: data?.levels.map((l) => l.by_scale[s.key] ?? 0) ?? [],
    })),
  }), [data]);

  return (
    <Card title="All scales, common levels">
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={5} />
        : data.total === 0 ? <EmptyState title="No open risks" message="Add a risk to start the register." icon="shield" />
        : (
          <div className="stack">
            <Chart label="Open risks by common summary level, stacked by scale" option={option} height={200} />
            <div className="row">
              {data.levels.map((l) => <Badge key={l.value} color={l.color as ColorName}>{l.label}: {l.count}</Badge>)}
              {data.unscored > 0 && <span className="muted">{data.unscored} not yet scored</span>}
            </div>
            {data.top.length > 0 && (
              <div>
                <h3 className="muted" style={{ fontSize: 'var(--fs-sm)', margin: '0 0 var(--s-2)' }}>Highest risks</h3>
                <ol className="stack" style={{ margin: 0, paddingLeft: 'var(--s-5)', gap: 'var(--s-1)' }}>
                  {data.top.slice(0, 5).map((r) => (
                    <li key={r.id}>
                      <Link to={`/risks/${r.id}`}><span className="ref">{r.ref}</span> {r.title}</Link>{' '}
                      <Badge color={r.color as ColorName}>{r.rating_label}</Badge>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        )}
    </Card>
  );
}
