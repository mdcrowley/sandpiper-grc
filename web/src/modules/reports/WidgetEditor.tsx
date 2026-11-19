// The widget library (what can be put on a dashboard) and the editor for one widget.
import { useEffect, useState } from 'react';
import {
  Button, DateTimeField, Drawer, EmptyState, Icon, Modal, NumberField, Select, Switch, TextArea, TextField, useFetch,
} from '../../core';
import type { IconName, ListResult } from '../../core';
import { ChartPicker } from './BuilderParts';
import { completeFilters } from './FilterEditor';
import { ColumnsEditor, FiltersSection, GroupEditor, Section, SortEditor, TotalsEditor } from './SpecEditor';
import type { CatalogType, ReportDefinition, ReportSpec, Widget, WidgetKind } from './types';
import { Markdown } from './visuals';

export const WIDGET_LIBRARY: { kind: WidgetKind; label: string; hint: string; icon: IconName; w: number; h: number }[] = [
  { kind: 'number', label: 'Number', hint: 'One figure, with an arrow showing which way it is moving.', icon: 'target', w: 3, h: 2 },
  { kind: 'chart', label: 'Chart', hint: 'Bars, lines, a doughnut or a heat map of grouped records.', icon: 'chart', w: 6, h: 4 },
  { kind: 'gauge', label: 'Gauge', hint: 'A share or a figure against a target, on a dial.', icon: 'clock', w: 3, h: 4 },
  { kind: 'progress', label: 'Progress toward a target', hint: 'A bar that fills as the figure approaches the target.', icon: 'check-circle', w: 4, h: 2 },
  { kind: 'table', label: 'Table', hint: 'Rows and columns, or a pivot table.', icon: 'clipboard', w: 6, h: 4 },
  { kind: 'list', label: 'List of records', hint: 'A short list, each record a link.', icon: 'file-text', w: 4, h: 4 },
  { kind: 'countdown', label: 'Countdown clock', hint: 'Time left to a date you set, or to the next dates on records.', icon: 'clock', w: 4, h: 3 },
  { kind: 'calendar', label: 'Calendar', hint: 'A month showing how many records fall on each day.', icon: 'calendar', w: 6, h: 5 },
  { kind: 'text', label: 'Text', hint: 'A heading, a note or instructions.', icon: 'edit', w: 4, h: 2 },
];

export function newWidget(kind: WidgetKind, widgets: Widget[], extra: Partial<Widget> = {}): Widget {
  const lib = WIDGET_LIBRARY.find((l) => l.kind === kind);
  return {
    id: `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, kind, title: '', x: 0,
    y: widgets.reduce((n, w) => Math.max(n, w.y + w.h), 0), w: lib?.w ?? 6, h: lib?.h ?? 4, config: {}, ...extra,
  };
}

export function WidgetLibrary({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (kind: WidgetKind, report?: ReportDefinition) => void }) {
  const reports = useFetch<ListResult<ReportDefinition>>(open ? '/api/reports?pageSize=200&sort=name' : null);
  const [q, setQ] = useState('');
  const shown = (reports.data?.rows ?? []).filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Modal open={open} title="Add a widget" onClose={onClose} size="lg">
      <h3 className="rp-lib-title">Build a new widget</h3>
      <ul className="rp-lib-grid">
        {WIDGET_LIBRARY.map((l) => (
          <li key={l.kind}>
            <button type="button" className="rp-lib-item" onClick={() => onAdd(l.kind)}>
              <span className="rp-lib-icon"><Icon name={l.icon} size={20} /></span>
              <span><strong>{l.label}</strong><span className="rp-lib-hint">{l.hint}</span></span>
            </button>
          </li>
        ))}
      </ul>
      <h3 className="rp-lib-title">Or use a saved report</h3>
      <TextField label="Search saved reports" hideLabel type="search" value={q} onChange={setQ} placeholder="Search saved reports" />
      {reports.error ? <p className="muted">Saved reports are not available to your role.</p>
        : shown.length === 0 ? <EmptyState icon="chart" title={reports.data ? 'No saved report matches' : 'Loading saved reports'} message={reports.data ? 'Build one under Reports, then come back to add it here.' : undefined} />
        : (
          <ul className="rp-lib-reports">
            {shown.map((r) => (
              <li key={r.id}><button type="button" className="rp-lib-report" onClick={() => onAdd('report', r)}><Icon name="chart" size={16} /><span><strong>{r.name}</strong>{r.description && <span className="rp-lib-hint">{r.description}</span>}</span></button></li>
            ))}
          </ul>
        )}
    </Modal>
  );
}

const KIND_NEEDS: Record<WidgetKind, { type: boolean; group?: number; totals?: 'one' | 'many'; columns?: boolean; chart?: boolean; filters?: boolean; sort?: boolean }> = {
  report: { type: false }, text: { type: false },
  number: { type: true, totals: 'one', filters: true },
  gauge: { type: true, totals: 'one', filters: true },
  progress: { type: true, totals: 'one', filters: true },
  chart: { type: true, group: 2, totals: 'many', filters: true, chart: true, sort: true },
  table: { type: true, columns: true, filters: true, sort: true },
  list: { type: true, columns: true, filters: true, sort: true },
  countdown: { type: true, filters: true },
  calendar: { type: true, filters: true },
};

export function WidgetEditor({ widget, types, onClose, onSave }: { widget: Widget | null; types: CatalogType[]; onClose: () => void; onSave: (w: Widget) => void }) {
  const [w, setW] = useState<Widget | null>(widget);
  const reports = useFetch<ListResult<ReportDefinition>>(widget?.kind === 'report' ? '/api/reports?pageSize=200&sort=name' : null);
  useEffect(() => setW(widget), [widget]);
  if (!w) return <Drawer open={false} title="Widget" onClose={onClose}><span /></Drawer>;

  const cfg = w.config ?? {};
  const needs = KIND_NEEDS[w.kind];
  const spec = cfg.spec as ReportSpec | undefined;
  const type = types.find((t) => t.type === spec?.type);
  const setCfg = (patch: Record<string, unknown>) => setW({ ...w, config: { ...cfg, ...patch } });
  const setSpec = (next: ReportSpec) => setCfg({ spec: next });
  const dateFields = (type?.fields ?? []).filter((f) => (f.type === 'date' || f.type === 'datetime') && !f.via);
  const lib = WIDGET_LIBRARY.find((l) => l.kind === w.kind);
  const fromRecords = w.kind !== 'countdown' || cfg.mode === 'records' || Boolean(spec);

  function pickType(key: string) {
    const t = types.find((x) => x.type === key);
    if (!t) return;
    const base: ReportSpec = { type: t.type };
    if (w!.kind === 'chart') Object.assign(base, { groupBy: [{ field: (t.fields.find((f) => f.path === 'status') ?? t.fields.find((f) => f.type === 'lookup') ?? t.fields.find((f) => f.group)!).path }] });
    if (w!.kind === 'table' || w!.kind === 'list') Object.assign(base, { columns: [t.refField, t.titleField, 'status'].filter((p): p is string => Boolean(p) && t.fields.some((f) => f.path === p)) });
    setW({ ...w!, title: w!.title || t.plural, config: { ...cfg, spec: base, chart: cfg.chart ?? (w!.kind === 'chart' ? { kind: 'bar' } : undefined), dateField: undefined } });
  }

  function save() {
    const out: Widget = { ...w!, title: w!.title.trim() || lib?.label || 'Widget' };
    if (spec && type) out.config = { ...cfg, spec: { ...spec, filters: completeFilters(spec.filters, type.fields) } };
    onSave(out);
  }

  return (
    <Drawer open title={`${lib?.label ?? 'Saved report'} widget`} onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Done</Button></>}>
      <form className="form rp-widget-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <TextField label="Title" value={w.title} onChange={(title) => setW({ ...w, title })} placeholder={lib?.label} />

        {w.kind === 'report' && (
          <Select label="Saved report" required searchable value={String(cfg.reportId ?? '')} options={(reports.data?.rows ?? []).map((r) => ({ value: r.id, label: r.name }))}
            onChange={(reportId) => setW({ ...w, title: w.title || reports.data?.rows.find((r) => r.id === reportId)?.name || '', config: { ...cfg, reportId } })}
            hint="The widget always shows the report as it is now, drawn the way the report says." />
        )}

        {w.kind === 'text' && (
          <>
            <TextArea label="Text" rows={6} value={String(cfg.markdown ?? '')} onChange={(markdown) => setCfg({ markdown })}
              hint="Start a line with # for a heading or - for a bullet. Use **bold** and *italic*. Links: [words](/tickets)." />
            {cfg.markdown && <div className="rp-md-preview"><p className="field-label">How it will look</p><Markdown source={String(cfg.markdown)} /></div>}
          </>
        )}

        {w.kind === 'countdown' && (
          <Select label="Count down to" required value={fromRecords ? 'records' : 'fixed'} onChange={(mode) => setCfg(mode === 'fixed' ? { mode, spec: undefined, dateField: undefined } : { mode })}
            options={[{ value: 'fixed', label: 'A date I choose' }, { value: 'records', label: 'The next dates on records' }]} />
        )}
        {w.kind === 'countdown' && !fromRecords && (
          <>
            <TextField label="What is being counted down to" value={String(cfg.label ?? '')} onChange={(label) => setCfg({ label })} placeholder="For example: Audit visit" />
            <DateTimeField label="Date and time" value={String(cfg.deadline ?? '')} onChange={(deadline) => setCfg({ deadline })} />
          </>
        )}

        {needs.type && fromRecords && (
          <Select label="Records" required searchable value={spec?.type ?? ''} placeholder="Choose what this widget is about…" onChange={pickType}
            options={types.map((t) => ({ value: t.type, label: t.plural }))} hint={type?.description} />
        )}

        {needs.type && fromRecords && spec && !type && <p className="notice notice-warn">This widget is about records that are not available to you here. It will say so on the dashboard.</p>}

        {type && spec && fromRecords && (
          <>
            {(w.kind === 'calendar' || w.kind === 'countdown') && (
              <Select label="Date to use" required value={String(cfg.dateField ?? '')} placeholder="Choose a date field…" options={dateFields.map((f) => ({ value: f.path, label: f.label }))} onChange={(dateField) => setCfg({ dateField })} />
            )}
            {needs.group && <Section title="Group"><GroupEditor type={type} spec={spec} onChange={setSpec} pivot={false} /></Section>}
            {needs.totals && <Section title={needs.totals === 'one' ? 'Figure' : 'Totals'}><TotalsEditor type={type} spec={spec} onChange={setSpec} single={needs.totals === 'one'} /></Section>}
            {needs.columns && (
              <Section title="Columns" hint={w.kind === 'list' ? 'The first column is the link; the rest appear beside it.' : undefined}>
                <ColumnsEditor type={type} spec={spec} onChange={setSpec} />
                {w.kind === 'table' && <p className="rp-section-hint">For a grouped or pivot table, build a report and add it as a saved report.</p>}
              </Section>
            )}
            {needs.filters && <Section title="Filters"><FiltersSection type={type} spec={spec} onChange={setSpec} /></Section>}
            {needs.sort && <Section title="Order"><SortEditor type={type} spec={spec} onChange={setSpec} /></Section>}
            {(w.kind === 'list' || w.kind === 'table') && <NumberField label="Rows to show" min={1} max={100} value={Number(cfg.limit ?? (w.kind === 'list' ? 6 : 25))} onChange={(limit) => setCfg({ limit: limit ?? undefined })} />}
            {needs.chart && (
              <Section title="Show as">
                <ChartPicker chart={cfg.chart ?? { kind: 'bar' }} onChange={(chart) => setCfg({ chart })}
                  kinds={(spec.groupBy?.length ?? 0) === 2 ? ['stacked', 'bar', 'line', 'area', 'heatmap'] : ['bar', 'hbar', 'line', 'area', 'donut', 'pie']} />
              </Section>
            )}

            {w.kind === 'number' && (
              <Section title="Trend" hint="Compares how many records fall in the latest period with the period before it.">
                <Switch label="Show a trend arrow" checked={Boolean(cfg.trend)} onChange={(on) => setCfg({ trend: on ? { field: 'created_at', days: 30, upIsGood: false } : undefined })} />
                {cfg.trend && (
                  <div className="form-grid">
                    <Select label="Counted by" required value={String(cfg.trend.field ?? 'created_at')} options={dateFields.map((f) => ({ value: f.path, label: f.label }))} onChange={(field) => setCfg({ trend: { ...cfg.trend, field } })} />
                    <NumberField label="Days in each period" min={1} max={366} value={Number(cfg.trend.days ?? 30)} onChange={(days) => setCfg({ trend: { ...cfg.trend, days: days ?? 30 } })} />
                    <Switch label="More is good news" checked={Boolean(cfg.trend.upIsGood)} onChange={(upIsGood) => setCfg({ trend: { ...cfg.trend, upIsGood } })} />
                  </div>
                )}
                <TextField label="Say it in a sentence" value={String(cfg.sentence ?? '')} onChange={(sentence) => setCfg({ sentence: sentence || undefined })}
                  placeholder="{value} {request is|requests are} open with the team." hint="Optional. Write {value} where the figure goes, and {one|many} for words that change when the figure is 1. Good for pages read by people outside the team." />
              </Section>
            )}

            {(w.kind === 'gauge' || w.kind === 'progress') && (
              <Section title="Measure against">
                <Select label="Out of" required value={cfg.of !== undefined ? 'all' : 'target'} onChange={(v) => setCfg(v === 'all' ? { of: null } : { of: undefined })}
                  options={[{ value: 'all', label: `All ${type.plural.toLowerCase()} (shows a percentage)` }, { value: 'target', label: 'A target figure' }]} />
                <NumberField label={cfg.of !== undefined ? 'Target (%)' : 'Target'} value={cfg.target ?? null} onChange={(target) => setCfg({ target: target ?? undefined })} />
              </Section>
            )}
          </>
        )}
      </form>
    </Drawer>
  );
}
