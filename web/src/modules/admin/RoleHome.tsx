// Where the people of a role land (E44-09): after signing in and when they open the start page, they go
// to the Overview, My work, the self-service portal or one dashboard. Stored by the server's My work
// module (GET/PUT /api/work/role-homes); "_none" is for people who hold no role.
import { useState } from 'react';
import { api, Card, errorMessage, listQuery, Select, useAuth, useFetch, useToast } from '../../core';
import type { ListResult } from '../../core';

interface Homes { homes: Record<string, string>; defaults: Record<string, string> }

const LABELS: Record<string, string> = { overview: 'Overview', mywork: 'My work', portal: 'Self-service portal' };

/** The choice for one role (or `_none`), saved as soon as it is changed. */
export function RoleHomePicker({ roleKey, label = 'Home page', hint }: { roleKey: string; label?: string; hint?: string }) {
  const toast = useToast();
  const { areaOn, can } = useAuth();
  const { data, error, reload } = useFetch<Homes>('/api/work/role-homes');
  const dashboardsOn = areaOn('reports') && can('dashboards.view');
  const dashboards = useFetch<ListResult>(dashboardsOn ? `/api/dashboards${listQuery({ pageSize: 100, sort: 'name', dir: 'asc' })}` : null);
  const [busy, setBusy] = useState(false);
  if (error) return <p className="field-error">The home page could not be read. {errorMessage(error)}</p>;
  if (!data) return null;
  const fallback = data.defaults[roleKey] ?? 'overview';
  const nameOf = (v: string) => (v.startsWith('dashboard:')
    ? `Dashboard: ${dashboards.data?.rows.find((d) => `dashboard:${d.id}` === v)?.name ?? 'a dashboard'}`
    : LABELS[v] ?? v);
  const options = [
    { value: '', label: `Default (${nameOf(fallback)})` },
    { value: 'overview', label: LABELS.overview },
    { value: 'mywork', label: LABELS.mywork },
    ...(areaOn('portal') ? [{ value: 'portal', label: LABELS.portal }] : []),
    ...(dashboards.data?.rows ?? []).map((d) => ({ value: `dashboard:${d.id}`, label: `Dashboard: ${String(d.name)}` })),
  ];
  const current = data.homes[roleKey] ?? '';
  const change = async (value: string) => {
    setBusy(true);
    try {
      await api.put('/api/work/role-homes', { homes: { [roleKey]: value || null } });
      toast.success(`Home page saved: ${value ? nameOf(value) : `the default, ${nameOf(fallback)}`}.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Select label={label} value={current} options={options} disabled={busy} onChange={(v) => void change(v ?? '')}
      hint={hint ?? `Where members land after signing in and when they open the start page. Choosing Overview in the menu always shows the Overview. With several roles, My work comes first, then a dashboard, the Overview${areaOn('portal') ? ' and the portal' : ''}.`} />
  );
}

/** On the Roles page: where people who hold no role land. */
export function NoRoleHomeCard() {
  const { areaOn } = useAuth();
  // Name only the parts that are on (E14-34): reporting needs safety or the service desk.
  const can = [(areaOn('safety') || areaOn('tickets')) && 'report a problem', areaOn('policies') && 'read the documents given to them', areaOn('training') && 'do their training'].filter(Boolean) as string[];
  const hint = `${can.length ? `People with no role can still ${can.length > 1 ? `${can.slice(0, -1).join(', ')} and ${can[can.length - 1]}` : can[0]}. ` : ''}By default they land on My work.`;
  return (
    <Card title="People with no role">
      <RoleHomePicker roleKey="_none" label="Where people with no role land"
        hint={hint} />
    </Card>
  );
}
