// The side panel of the relationship map: details of the selected record, its connections,
// and for a system what is affected if it fails.
import { useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Badge, CloseButton, Group, Stack, Text, UnstyledButton } from '@mantine/core';
import { ErrorState, Icon, Loading, LookupChip, useAuth, useFetch } from '../../core';
import { plural } from './shared';
import { NODE_TYPES, typeInfo } from './mapLayout';
import type { GraphData, GraphEdge, GraphNode } from './mapLayout';

interface ImpactItem {
  id: string; label: string; ref?: string | null; route: string; depth?: number; method?: string | null;
  criticality_label?: string | null; sensitivity_label?: string | null; mode_label?: string | null; depot_name?: string | null;
  via: { id: string; label: string; direct?: boolean };
}
export interface Impact {
  system: { id: string; label: string };
  downstream: ImpactItem[]; sites: ImpactItem[]; data_categories: ImpactItem[]; assets: ImpactItem[];
  /** Present when the fleet module is loaded; empty without `fleet.view`. */
  vehicles?: ImpactItem[]; services?: ImpactItem[];
  counts: { systems: number; sites: number; data_categories: number; assets: number; vehicles?: number; services?: number };
}

/** "a, b and c". */
function joinAnd(parts: string[]): string {
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** How an edge reads from one of its ends. */
function relation(e: GraphEdge, self: string): string {
  const out = e.from === self;
  if (e.kind === 'integration') return e.direction === 'two_way' ? 'Exchanges data with' : out ? 'Sends data to' : 'Receives data from';
  if (e.kind === 'vendor') return out ? 'Supplied by' : 'Supplies';
  if (e.kind === 'site') return out ? 'Serves' : 'Served by';
  if (e.kind === 'data') return out ? 'Holds' : 'Held in';
  if (e.kind === 'asset') return out ? 'Runs on' : 'Supports';
  if (e.kind === 'location') return out ? 'Located at' : 'Holds equipment';
  if (e.kind === 'service') return out ? 'Needed by services' : 'Depends on';
  if (e.kind === 'vehicle') return out ? 'Equipment on vehicles' : 'Carries equipment of';
  if (e.kind === 'depot') return out ? 'Based at' : 'Depot of';
  return e.label;
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="inv-panel-section">
      <h3>{title}{count !== undefined && <span className="muted"> {count}</span>}</h3>
      {children}
    </section>
  );
}

function ImpactBlock({ title, items, empty, detail, onPick, onMap }: {
  title: string; items: ImpactItem[]; empty: string; detail: (i: ImpactItem) => string; onPick: (id: string) => void;
  /** Whether a record is drawn on the map: one that is not opens its own page instead. */
  onMap?: (id: string) => boolean;
}) {
  return (
    <div className="inv-impact-block">
      <Text size="sm" fw={600}>{title} <span className="muted">{items.length}</span></Text>
      {items.length === 0 ? <Text size="sm" c="dimmed">{empty}</Text> : (
        <ul className="inv-panel-list">
          {items.map((i) => (
            <li key={`${i.id}-${i.via.id}`}>
              {!onMap || onMap(i.id)
                ? <UnstyledButton className="inv-panel-pick" onClick={() => onPick(i.id)}>{i.ref ? `${i.ref} ` : ''}{i.label}</UnstyledButton>
                : <Link className="inv-panel-pick" to={i.route}>{i.ref ? `${i.ref} ` : ''}{i.label}</Link>}
              <span className="muted">{detail(i)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "What is affected if this fails" for one system. Reports the affected ids so the map can outline them. */
export function ImpactSummary({ systemId, name, onImpact, onPick, onMap }: {
  systemId: string; name: string; onImpact?: (ids: Set<string>) => void; onPick: (id: string) => void;
  /** Whether a record is drawn on the map; records that are not (vehicles, hidden types) link to their page. */
  onMap?: (id: string) => boolean;
}) {
  const { can } = useAuth();
  const { data, error, reload } = useFetch<Impact>(`/api/systems/${systemId}/impact`);
  useEffect(() => {
    if (!onImpact) return;
    onImpact(new Set(data && data.system.id === systemId
      ? [...data.downstream, ...data.sites, ...data.data_categories, ...data.assets, ...(data.services ?? [])].map((i) => i.id) : []));
  }, [data, systemId, onImpact]);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data || data.system.id !== systemId) return <Loading lines={4} label="Working out the impact" />;
  const via = (i: ImpactItem) => (i.via.direct || i.via.id === systemId ? 'directly' : `through ${i.via.label}`);
  // Vehicles and services are shown when the fleet module answers and the reader may see fleet records.
  const fleet = can('fleet.view') && data.counts.vehicles !== undefined;
  const services = data.services ?? [];
  const vehicles = data.vehicles ?? [];
  const parts = [
    plural(data.counts.systems, 'downstream system'), plural(data.counts.sites, 'site'),
    plural(data.counts.data_categories, 'data category', 'data categories'), plural(data.counts.assets, 'asset'),
    ...(fleet ? [plural(services.length, 'service'), plural(vehicles.length, 'vehicle')] : []),
  ];
  const total = data.counts.systems + data.counts.sites + data.counts.data_categories + data.counts.assets + (fleet ? services.length + vehicles.length : 0);
  return (
    <Stack gap="sm">
      <div className={`inv-impact-banner${total ? ' is-hot' : ''}`} role="status">
        <Icon name={total ? 'alert' : 'check-circle'} size={18} />
        <span>{total === 0 ? `Nothing recorded depends on ${name}.` : `If ${name} fails: ${joinAnd(parts)} are affected.`}</span>
      </div>
      <ImpactBlock title="Downstream systems" items={data.downstream} empty="No other system receives data from this one." onPick={onPick} onMap={onMap}
        detail={(i) => `${i.depth === 1 ? 'fed directly' : `fed through ${i.via.label}`}${i.method ? ` by ${i.method.toLowerCase()}` : ''}${i.criticality_label ? ` · ${i.criticality_label}` : ''}`} />
      {fleet && (
        <ImpactBlock title="Services" items={services} empty="No service is recorded as depending on these systems." onPick={onPick} onMap={onMap}
          detail={(i) => [via(i), i.mode_label].filter(Boolean).join(' · ')} />
      )}
      {fleet && (
        <ImpactBlock title="Vehicles" items={vehicles} empty="No vehicle carries equipment of these systems." onPick={onPick} onMap={onMap}
          detail={(i) => [via(i), i.mode_label, i.depot_name].filter(Boolean).join(' · ')} />
      )}
      <ImpactBlock title="Sites" items={data.sites} empty="No sites are recorded as served." detail={via} onPick={onPick} onMap={onMap} />
      <ImpactBlock title="Data categories" items={data.data_categories} empty="No data categories are recorded as held." onPick={onPick} onMap={onMap}
        detail={(i) => `${via(i)}${i.sensitivity_label ? ` · ${i.sensitivity_label}` : ''}`} />
      <ImpactBlock title="Assets" items={data.assets} empty="No assets are linked." detail={via} onPick={onPick} onMap={onMap} />
      <Text size="xs" c="dimmed">
        Downstream systems receive data from this one, directly or through another system. Sites, data and assets are
        those of this system and of every downstream system{fleet ? '; services depend on one of them, and vehicles carry their equipment' : ''}.
        The list is only as good as the relationships recorded.
      </Text>
    </Stack>
  );
}

export function MapPanel({ data, selected, onSelect, onImpact }: {
  data: GraphData; selected: GraphNode | null; onSelect: (id: string | null) => void; onImpact: (ids: Set<string>) => void;
}) {
  const byId = useMemo(() => new Map(data.nodes.map((n) => [n.id, n])), [data.nodes]);
  const groups = useMemo(() => {
    const out = new Map<string, GraphNode[]>();
    if (!selected) return out;
    for (const e of data.edges) {
      if (e.from !== selected.id && e.to !== selected.id) continue;
      const other = byId.get(e.from === selected.id ? e.to : e.from);
      if (!other) continue;
      const key = relation(e, selected.id);
      if (!out.has(key)) out.set(key, []);
      if (!out.get(key)!.some((n) => n.id === other.id)) out.get(key)!.push(other);
    }
    return out;
  }, [data.edges, byId, selected]);
  useEffect(() => { if (!selected || selected.type !== 'system') onImpact(new Set()); }, [selected, onImpact]);

  if (!selected) {
    return (
      <aside className="inv-panel" aria-label="Details">
        <Stack gap="sm">
          <Text fw={650}>Nothing selected</Text>
          <Text size="sm" c="dimmed">Select a record on the map, or find one with the search box, to see its details, its connections and what is affected if it fails.</Text>
          <dl className="inv-panel-counts">
            {NODE_TYPES.map((t) => {
              const n = data.nodes.filter((x) => x.type === t.type).length;
              return n ? <div key={t.type}><dt><span className={`inv-swatch inv-swatch-${t.color}`} /> {t.plural}</dt><dd>{n}</dd></div> : null;
            })}
            <div><dt><span className="inv-swatch-line" /> Integrations</dt><dd>{data.edges.filter((e) => e.kind === 'integration').length}</dd></div>
          </dl>
        </Stack>
      </aside>
    );
  }
  const info = typeInfo(selected.type);
  return (
    <aside className="inv-panel" aria-label={`Details of ${selected.label}`} aria-live="polite">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <div>
          <Badge color={info.color} variant="light">{info.label}</Badge>
          <Text fw={650} size="lg" mt={4} className="inv-panel-title">{selected.label}</Text>
          <Text size="sm" c="dimmed">{[selected.ref, selected.type === 'system' ? selected.group : null].filter(Boolean).join(' · ')}</Text>
        </div>
        <CloseButton aria-label="Clear the selection" onClick={() => onSelect(null)} />
      </Group>
      {selected.type === 'system' && (
        <Group gap={6} mt="xs">
          {selected.attrs?.status && <LookupChip list="system_status" value={selected.attrs.status} />}
          {selected.attrs?.criticality && <LookupChip list="criticality_tier" value={selected.attrs.criticality} />}
          {selected.attrs?.hosting && <LookupChip list="hosting_type" value={selected.attrs.hosting} />}
        </Group>
      )}
      {selected.route
        ? <Link className="btn btn-secondary btn-sm inv-panel-open" to={selected.route}>Open {info.label.toLowerCase()} <Icon name="arrow-right" size={14} /></Link>
        : <Text size="sm" c="dimmed" mt="xs">Named on a system, with no record of its own yet.</Text>}

      {selected.type === 'system' && (
        <Section title="If this fails">
          <ImpactSummary systemId={selected.id} name={selected.label} onImpact={onImpact} onPick={onSelect} onMap={(id) => byId.has(id)} />
        </Section>
      )}
      <Section title="Connections" count={[...groups.values()].reduce((s, g) => s + g.length, 0)}>
        {groups.size === 0 ? <Text size="sm" c="dimmed">No connections in the current view.</Text> : [...groups.entries()].map(([rel, nodes]) => (
          <div key={rel} className="inv-impact-block">
            <Text size="sm" fw={600}>{rel}</Text>
            <ul className="inv-panel-list">
              {nodes.map((n) => (
                <li key={n.id}>
                  <UnstyledButton className="inv-panel-pick" onClick={() => onSelect(n.id)}>
                    <span className={`inv-swatch inv-swatch-${typeInfo(n.type).color}`} /> {n.label}
                  </UnstyledButton>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Section>
    </aside>
  );
}
