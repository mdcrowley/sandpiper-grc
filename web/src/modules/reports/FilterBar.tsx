// The dashboard-wide filters: one row above the widgets. The values live in the page address
// (g.from, g.to, g.department, g.site, g.system, g.owner), so a filtered dashboard can be
// bookmarked or sent, and every drill-down carries them on to the list behind a figure.
import { useEffect, useState } from 'react';
import { Button, DateField, RecordPicker, Select, UserPicker, todayInZone, useAuth, useFetch, useResource } from '../../core';
import type { GlobalFilterDef, GlobalKind, Globals } from './types';

const KEYS: (keyof Globals)[] = ['from', 'to', 'department', 'site', 'system', 'owner'];

export function readGlobals(params: URLSearchParams): Globals {
  const out: Globals = {};
  for (const k of KEYS) { const v = params.get(`g.${k}`); if (v) out[k] = v; }
  return out;
}

export function writeGlobals(params: URLSearchParams, g: Globals): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const k of KEYS) { if (g[k]) next.set(`g.${k}`, g[k]!); else next.delete(`g.${k}`); }
  return next;
}

const shift = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function RecordFilter({ type, label, value, onChange }: { type: 'site' | 'system'; label: string; value?: string; onChange: (id?: string) => void }) {
  const resource = useResource(type);
  const [display, setDisplay] = useState<string | undefined>();
  // A value from the address has no label yet: look the record up once.
  const known = useFetch<{ [k: string]: unknown }>(resource && value && !display ? `${resource.path}/${value}` : null);
  useEffect(() => { if (known.data && resource) setDisplay(String(known.data[resource.titleField] ?? '')); }, [known.data, resource]);
  if (!resource) return null;
  return (
    <RecordPicker label={label} type={type} value={value ?? null} display={display} placeholder={`Any ${resource.label.toLowerCase()}`}
      onChange={(id, opt) => { setDisplay(opt?.label); onChange(id ?? undefined); }} />
  );
}

export function FilterBar({ defs, value, onChange }: { defs: GlobalFilterDef[]; value: Globals; onChange: (g: Globals) => void }) {
  const { user } = useAuth();
  const depts = useFetch<{ value: string; label: string }[]>(defs.some((d) => d.kind === 'department') ? '/api/reports/departments' : null);
  const [ownerLabel, setOwnerLabel] = useState<string | undefined>();
  if (!defs.length) return null;
  const set = (patch: Globals) => onChange({ ...value, ...patch });
  const any = KEYS.some((k) => value[k]);
  const today = todayInZone();
  const quick = (days: number) => set({ from: shift(today, -days + 1), to: today });

  const control = (d: GlobalFilterDef) => {
    switch (d.kind as GlobalKind) {
    case 'date': return (
      <div key="date" className="rp-fb-dates">
        <DateField label={`${d.label}: from`} value={value.from ?? ''} max={value.to} onChange={(from) => set({ from: from || undefined })} />
        <DateField label="To" value={value.to ?? ''} min={value.from} onChange={(to) => set({ to: to || undefined })} />
        <div className="rp-fb-quick" role="group" aria-label="Quick date ranges">
          <Button size="sm" variant="ghost" onClick={() => quick(30)}>30 days</Button>
          <Button size="sm" variant="ghost" onClick={() => quick(90)}>90 days</Button>
          <Button size="sm" variant="ghost" onClick={() => set({ from: `${today.slice(0, 4)}-01-01`, to: today })}>This year</Button>
        </div>
      </div>
    );
    case 'department': return (
      <Select key="department" label={d.label} value={value.department ?? ''} placeholder="Any department" searchable
        options={(depts.data ?? []).map((o) => ({ value: o.value, label: o.label }))} onChange={(department) => set({ department: department || undefined })} />
    );
    case 'site': return <RecordFilter key="site" type="site" label={d.label} value={value.site} onChange={(site) => set({ site })} />;
    case 'system': return <RecordFilter key="system" type="system" label={d.label} value={value.system} onChange={(system) => set({ system })} />;
    case 'owner': return (
      <div key="owner" className="rp-fb-owner">
        <UserPicker label={d.label} value={value.owner === 'me' ? user?.id ?? null : value.owner ?? null}
          display={value.owner === 'me' ? 'Me' : ownerLabel ?? (value.owner ? 'Chosen person' : undefined)} placeholder="Anyone"
          onChange={(id, opt) => { setOwnerLabel(opt?.label); set({ owner: id ?? undefined }); }} />
        {value.owner !== 'me' && <Button size="sm" variant="ghost" onClick={() => set({ owner: 'me' })}>Me</Button>}
      </div>
    );
    default: return null;
    }
  };

  return (
    <div className="rp-filterbar no-print" role="search" aria-label="Dashboard filters">
      {defs.map(control)}
      {any && <Button size="sm" variant="ghost" icon="x" onClick={() => onChange({})}>Clear filters</Button>}
    </div>
  );
}
