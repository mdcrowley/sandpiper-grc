// Administration > Asset tags > Print tags (E37-08, spec §3.5). Owner: TAGS-PRINT.
// New tags from a series, or reprints (typed values, or the tags of records chosen on a list with the
// "Print tags" bulk action), on sheet or roll label stock, as a PDF or as ZPL for a label printer.
// The preview is drawn from the server's plan of one label (POST /api/asset-tags/print/preview), so
// it shows exactly what will print and why a value would not fit.
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import {
  api, ApiError, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, errorMessage, Loading, Modal, NumberField,
  PageHeader, Select, TextArea, TextField, useDebounced, useFetch, useToast,
} from '../../core';
import type { LabelCode, LabelLayout, PrintRequest, TagSeries } from './api';
import './print.css';

/** What the bulk action hands over (router state). */
export interface PrintRecordsState { recordType: string; recordIds: string[]; typeLabel?: string }

type Source = 'series' | 'values' | 'records';
type Output = 'pdf' | 'zpl';

interface TextPlacement { text: string; x: number; width: number; baseline: number; capHeight: number; fontSize: number }
interface Box { x: number; y: number; width: number; height: number }
type Symbol = { kind: 'linear'; modules: boolean[]; quiet: number } | { kind: 'matrix'; cols: number; rows: number; dark: boolean[]; quiet: number };
interface LabelPlan {
  width: number; height: number; logo: Box | null; topLine: TextPlacement | null; value: TextPlacement;
  code: { symbol: Symbol; x: number; y: number; module: number; height: number } | null;
}
interface Preview { sample: string; plan: LabelPlan | null; error: string | null; layout: LabelLayout; perPage: number; logoAvailable: boolean; printLimit: number }

const CODE_OPTIONS: { value: LabelCode; label: string }[] = [
  { value: 'code128', label: 'Text and Code 128 barcode' },
  { value: 'qr', label: 'Text and QR code' },
  { value: 'datamatrix', label: 'Text and Data Matrix code' },
  { value: 'none', label: 'Text only' },
];
const DPI_OPTIONS = [{ value: '203', label: '203 dpi (8 dots per mm)' }, { value: '300', label: '300 dpi (12 dots per mm)' }, { value: '600', label: '600 dpi (24 dots per mm)' }];
const DEFAULT_LAYOUT = 'letter-30-2.625x1';

/** Values typed one per line (or separated by commas). */
export function parseValues(text: string): string[] {
  return text.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean);
}

/** POSTs a print request and saves the answer as a file; returns the response headers. */
async function download(body: unknown): Promise<Headers> {
  let res: Response;
  try {
    res = await fetch('/api/asset-tags/print', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'X-GRC-CSRF': '1', 'Content-Type': 'application/json', Accept: 'application/pdf, text/plain, application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'The server could not be reached. Check that it is running and try again.');
  }
  if (!res.ok) {
    let error: { code?: string; message?: string; fields?: Record<string, string> } = {};
    try { error = (await res.json()).error ?? {}; } catch { /* not JSON */ }
    throw new ApiError(res.status, error.code ?? `http_${res.status}`, error.message ?? `The request failed (${res.status}).`, error.fields ?? {});
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'tags';
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return res.headers;
}

function runs(row: boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= row.length; i += 1) {
    const d = i < row.length && row[i];
    if (d && start < 0) start = i;
    else if (!d && start >= 0) { out.push([start, i - start]); start = -1; }
  }
  return out;
}

function PlanText({ t }: { t: TextPlacement }) {
  return (
    <text x={t.x + t.width / 2} y={t.baseline} fontSize={t.fontSize} fontFamily="Helvetica, Arial, sans-serif" fontWeight={700} textAnchor="middle" fill="#000">
      {t.text}
    </text>
  );
}

/** One label drawn from the server's plan, at its proportions (millimeters as SVG units). Paper is white whatever the theme. */
export function LabelPreview({ plan, codeLabel }: { plan: LabelPlan; codeLabel: string }) {
  const c = plan.code;
  const rects: ReactElement[] = [];
  if (c) {
    const x0 = c.x + c.symbol.quiet * c.module;
    if (c.symbol.kind === 'linear') {
      for (const [s, n] of runs(c.symbol.modules)) rects.push(<rect key={s} x={x0 + s * c.module} y={c.y} width={n * c.module} height={c.height} />);
    } else {
      const sym = c.symbol;
      const y0 = c.y + sym.quiet * c.module;
      for (let y = 0; y < sym.rows; y += 1) {
        for (const [s, n] of runs(sym.dark.slice(y * sym.cols, (y + 1) * sym.cols))) {
          rects.push(<rect key={`${y}-${s}`} x={x0 + s * c.module} y={y0 + y * c.module} width={n * c.module} height={c.module} />);
        }
      }
    }
  }
  const label = `Preview of tag ${plan.value.text}, ${plan.width} by ${plan.height} millimeters: ${codeLabel.toLowerCase()}${plan.topLine ? `, line above "${plan.topLine.text}"` : ''}${plan.logo ? ', logo' : ''}.`;
  return (
    <svg className="tag-print-label" viewBox={`0 0 ${plan.width} ${plan.height}`} role="img" aria-label={label} style={{ aspectRatio: `${plan.width} / ${plan.height}` }}>
      <rect x={0} y={0} width={plan.width} height={plan.height} fill="#fff" stroke="#8a969b" strokeWidth={0.3} rx={1} />
      {plan.logo && (
        <g>
          <rect x={plan.logo.x} y={plan.logo.y} width={plan.logo.width} height={plan.logo.height} fill="none" stroke="#8a969b" strokeWidth={0.2} strokeDasharray="0.8 0.6" />
          <text x={plan.logo.x + plan.logo.width / 2} y={plan.logo.y + plan.logo.height / 2 + 0.8} fontSize={Math.min(2.4, plan.logo.height * 0.5)} textAnchor="middle" fill="#50626a" fontFamily="Helvetica, Arial, sans-serif">Logo</text>
        </g>
      )}
      {plan.topLine && <PlanText t={plan.topLine} />}
      {rects.length > 0 && <g fill="#000">{rects}</g>}
      <PlanText t={plan.value} />
    </svg>
  );
}

const num = (v: number) => String(Math.round(v * 10) / 10);

function LayoutDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: (l: LabelLayout) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'sheet' | 'roll'>('sheet');
  const [page, setPage] = useState<'letter' | 'a4' | 'other'>('letter');
  const [pageW, setPageW] = useState<number | null>(215.9);
  const [pageH, setPageH] = useState<number | null>(279.4);
  const [labelW, setLabelW] = useState<number | null>(null);
  const [labelH, setLabelH] = useState<number | null>(null);
  const [columns, setColumns] = useState<number | null>(3);
  const [rows, setRows] = useState<number | null>(10);
  const [top, setTop] = useState<number | null>(0);
  const [left, setLeft] = useState<number | null>(0);
  const [gapX, setGapX] = useState<number | null>(0);
  const [gapY, setGapY] = useState<number | null>(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = Boolean(name || labelW || labelH);

  const choosePage = (p: string) => {
    setPage(p as 'letter' | 'a4' | 'other');
    if (p === 'letter') { setPageW(215.9); setPageH(279.4); }
    if (p === 'a4') { setPageW(210); setPageH(297); }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError('');
    try {
      const saved = await api.post<LabelLayout>('/api/asset-tags/print/layouts', {
        name, kind, pageWidthMm: pageW, pageHeightMm: pageH, labelWidthMm: labelW, labelHeightMm: labelH,
        columns, rows, marginTopMm: top, marginLeftMm: left, gapXMm: gapX, gapYMm: gapY,
      });
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields ?? {}).length) setErrors(err.fields);
      else setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="New label layout" onClose={onClose} dirty={dirty} size="lg">
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <TextField label="Name" required value={name} onChange={setName} error={errors.name} hint="For example the label stock's size and where it is kept." />
        <SegmentedControl aria-label="Label stock" fullWidth value={kind} onChange={(v) => setKind(v as 'sheet' | 'roll')}
          data={[{ value: 'sheet', label: 'Sheets for an office printer' }, { value: 'roll', label: 'Roll for a label printer' }]} />
        <div className="form-grid">
          <NumberField label="Label width (mm)" required min={8} max={600} value={labelW} onChange={setLabelW} error={errors.labelWidthMm} />
          <NumberField label="Label height (mm)" required min={8} max={600} value={labelH} onChange={setLabelH} error={errors.labelHeightMm} />
          {kind === 'sheet' && (
            <>
              <Select label="Page" value={page} onChange={choosePage} required
                options={[{ value: 'letter', label: 'Letter (215.9 × 279.4 mm)' }, { value: 'a4', label: 'A4 (210 × 297 mm)' }, { value: 'other', label: 'Another size' }]} />
              <div />
              {page === 'other' && (
                <>
                  <NumberField label="Page width (mm)" required min={50} max={600} value={pageW} onChange={setPageW} error={errors.pageWidthMm} />
                  <NumberField label="Page height (mm)" required min={50} max={600} value={pageH} onChange={setPageH} error={errors.pageHeightMm} />
                </>
              )}
              <NumberField label="Columns" required min={1} max={40} step={1} value={columns} onChange={setColumns} error={errors.columns} />
              <NumberField label="Rows" required min={1} max={40} step={1} value={rows} onChange={setRows} error={errors.rows} />
              <NumberField label="Top margin (mm)" min={0} value={top} onChange={setTop} error={errors.marginTopMm} hint="From the top of the page to the first row." />
              <NumberField label="Left margin (mm)" min={0} value={left} onChange={setLeft} error={errors.marginLeftMm} hint="From the left of the page to the first column." />
              <NumberField label="Gap between columns (mm)" min={0} value={gapX} onChange={setGapX} error={errors.gapXMm} />
              <NumberField label="Gap between rows (mm)" min={0} value={gapY} onChange={setGapY} error={errors.gapYMm} />
            </>
          )}
        </div>
        <p className="field-hint">Measure a sheet with a ruler, then print the alignment test page to check it before printing tags.</p>
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>Save layout</Button>
        </div>
      </form>
    </Modal>
  );
}

export function PrintPage() {
  const toast = useToast();
  const location = useLocation();
  const handed = (location.state as { print?: PrintRecordsState } | null)?.print ?? null;
  const series = useFetch<TagSeries[]>('/api/asset-tags/series');
  const layouts = useFetch<LabelLayout[]>('/api/asset-tags/print/layouts');

  const [source, setSource] = useState<Source>(handed ? 'records' : 'series');
  const [seriesId, setSeriesId] = useState('');
  const [count, setCount] = useState<number | null>(30);
  const [valuesText, setValuesText] = useState('');
  const [layoutId, setLayoutId] = useState(DEFAULT_LAYOUT);
  const [startAt, setStartAt] = useState<number | null>(1);
  const [code, setCode] = useState<LabelCode>('code128');
  const [topLine, setTopLine] = useState('');
  const [logo, setLogo] = useState(false);
  const [textHeight, setTextHeight] = useState<number | null>(5);
  const [output, setOutput] = useState<Output>('pdf');
  const [dpi, setDpi] = useState('203');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'print' | 'test'>('');
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');

  const activeSeries = useMemo(() => (series.data ?? []).filter((s) => s.active), [series.data]);
  useEffect(() => { if (!seriesId && activeSeries.length) setSeriesId(activeSeries[0].id); }, [activeSeries, seriesId]);
  const layout = (layouts.data ?? []).find((l) => l.id === layoutId) ?? null;
  const isRoll = layout?.kind === 'roll';
  useEffect(() => { if (!isRoll && output === 'zpl') setOutput('pdf'); }, [isRoll, output]);

  const from = useMemo<PrintRequest['from']>(() => {
    if (source === 'series') return { kind: 'series', seriesId, count: count ?? 0 };
    if (source === 'records' && handed) return { kind: 'records', recordType: handed.recordType, recordIds: handed.recordIds };
    return { kind: 'values', values: parseValues(valuesText) };
  }, [source, seriesId, count, valuesText, handed]);

  const request = useMemo(() => ({
    from, layoutId, startAt: isRoll ? 1 : startAt ?? 1, code, topLine: topLine.trim() || null, logo,
    textHeightMm: textHeight ?? 5, output, ...(output === 'zpl' ? { dpi: Number(dpi) } : {}),
  }), [from, layoutId, isRoll, startAt, code, topLine, logo, textHeight, output, dpi]);
  const debounced = useDebounced(request, 300);

  useEffect(() => {
    if (!layouts.data || (debounced.from.kind === 'series' && !debounced.from.seriesId)) return undefined;
    let live = true;
    api.post<Preview>('/api/asset-tags/print/preview', debounced)
      .then((p) => { if (live) { setPreview(p); setPreviewError(''); } })
      .catch((err) => { if (live) { setPreview(null); setPreviewError(errorMessage(err)); } });
    return () => { live = false; };
  }, [debounced, layouts.data]);

  const count_ = from.kind === 'series' ? from.count : from.kind === 'values' ? from.values.length : from.recordIds.length;

  const run = async (test: boolean) => {
    setBusy(test ? 'test' : 'print');
    setErrors({});
    try {
      const headers = await download({ ...request, test });
      if (test) toast.info('Alignment test page ready. Print it at actual size (100 %) on plain paper and hold it over a sheet of labels.');
      else {
        const n = Number(headers.get('x-tags-count') ?? count_);
        const skipped = Number(headers.get('x-tags-skipped') ?? 0);
        toast.success(`${n} tag${n === 1 ? '' : 's'} ready to print${skipped ? ` (${skipped} chosen record${skipped === 1 ? ' has' : 's have'} no tag value)` : ''}.`);
        if (from.kind === 'series') series.reload();
      }
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields ?? {}).length) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const removeLayout = async () => {
    try {
      await api.del(`/api/asset-tags/print/layouts/${layoutId}`);
      toast.success('Layout deleted.');
      setLayoutId(DEFAULT_LAYOUT);
      layouts.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const crumbs = [{ label: 'Asset tags', to: '/admin/asset-tags' }, { label: 'Print tags' }];
  if (layouts.error) return <div className="stack"><PageHeader title="Print tags" breadcrumbs={crumbs} /><ErrorState error={layouts.error} onRetry={layouts.reload} /></div>;
  if (!layouts.data) return <div className="stack"><PageHeader title="Print tags" breadcrumbs={crumbs} /><Loading /></div>;

  const group = (pred: (l: LabelLayout) => boolean) => layouts.data!.filter(pred).map((l) => ({ value: l.id, label: l.name }));
  const layoutOptions = [
    ...group((l) => l.preset && l.kind === 'sheet' && l.pageWidthMm === 215.9),
    ...group((l) => l.preset && l.kind === 'sheet' && l.pageWidthMm !== 215.9),
    ...group((l) => l.preset && l.kind === 'roll'),
    ...group((l) => !l.preset).map((o) => ({ ...o, label: `${o.label} (saved)` })),
  ];
  const codeLabel = CODE_OPTIONS.find((o) => o.value === code)?.label ?? '';
  const noSeries = source === 'series' && series.data && !activeSeries.length;

  return (
    <div className="stack">
      <PageHeader
        title="Print tags"
        breadcrumbs={crumbs}
        subtitle="New tags from a series, or reprints, sized exactly for your label stock. A tag's code holds only its value, never a web address."
      />
      <div className="tag-print">
        <form className="form tag-print-form" onSubmit={(e) => { e.preventDefault(); void run(false); }} noValidate>
          <Card title="What to print">
            <div className="stack">
              <SegmentedControl aria-label="What to print" fullWidth value={source} onChange={(v) => { setSource(v as Source); setErrors({}); }}
                data={[
                  { value: 'series', label: 'New tags' },
                  { value: 'values', label: 'Reprint values' },
                  ...(handed ? [{ value: 'records', label: 'Chosen records' }] : []),
                ]} />
              {source === 'series' && (series.error ? <ErrorState error={series.error} onRetry={series.reload} />
                : noSeries ? (
                  <EmptyState icon="tag" title="No series yet" message="A series gives printed tags their numbers (prefix, digits, next number)."
                    action={<Link to="/admin/asset-tags/series">Add a series</Link>} />
                ) : (
                  <div className="form-grid">
                    <Select label="Series" required value={seriesId} onChange={setSeriesId} error={errors.seriesId}
                      options={activeSeries.map((s) => ({ value: s.id, label: `${s.name} (next ${s.nextValue || 'none left'})` }))} />
                    <NumberField label="How many" required min={1} max={preview?.printLimit ?? 1000} step={1} value={count} onChange={setCount} error={errors.count}
                      hint={`New numbers are taken when you print and added to tag stock. At most ${(preview?.printLimit ?? 1000).toLocaleString('en-US')} at a time.`} />
                  </div>
                ))}
              {source === 'values' && (
                <TextArea label="Values to reprint" required rows={4} value={valuesText} onChange={setValuesText} error={errors.values}
                  hint={`One per line, or separated by commas. ${parseValues(valuesText).length} entered.`} />
              )}
              {source === 'records' && handed && (
                <p>The current tags of <strong>{handed.recordIds.length}</strong> chosen {handed.recordIds.length === 1 ? (handed.typeLabel ?? 'records').replace(/s$/, '') : handed.typeLabel ?? 'records'}. Records without a tag value are left out.</p>
              )}
            </div>
          </Card>

          <Card title="Label stock">
            <div className="form-grid">
              <Select className="form-cell-wide" label="Layout" required value={layoutId} onChange={(v) => setLayoutId(v || DEFAULT_LAYOUT)} options={layoutOptions} error={errors.layoutId} searchable />
              {!isRoll && (
                <NumberField label="Start at label" min={1} max={preview?.perPage ?? 1} step={1} value={startAt} onChange={setStartAt} error={errors.startAt}
                  hint="On a partly used sheet: the first free label, counting across, then down." />
              )}
              <Select label="Output" required value={output} onChange={(v) => setOutput((v || 'pdf') as Output)} error={errors.output}
                options={[{ value: 'pdf', label: 'PDF' }, ...(isRoll ? [{ value: 'zpl', label: 'ZPL for a thermal label printer' }] : [])]}
                hint={isRoll ? 'A PDF prints one label per page at the exact label size.' : 'ZPL is for roll layouts.'} />
              {output === 'zpl' && <Select label="Printer resolution" required value={dpi} onChange={(v) => setDpi(v || '203')} options={DPI_OPTIONS} error={errors.dpi} />}
            </div>
            <div className="tag-print-row">
              <Button icon="plus" onClick={() => setLayoutOpen(true)}>New layout</Button>
              {layout && !layout.preset && <Button icon="trash" variant="ghost" onClick={() => setDeleting(true)}>Delete this layout</Button>}
            </div>
          </Card>

          <Card title="On each tag">
            <div className="form-grid">
              <Select label="Code" required value={code} onChange={(v) => setCode((v || 'code128') as LabelCode)} options={CODE_OPTIONS} error={errors.code}
                hint="Code 128 suits handheld scanners and phones; QR and Data Matrix fit small labels." />
              <NumberField label="Minimum text height (mm)" min={3} max={25} step={0.5} value={textHeight} onChange={setTextHeight} error={errors.textHeightMm}
                hint="The value's capital letters; 5 mm or more reads reliably by eye and by camera." />
              <TextField className="form-cell-wide" label="Line above (optional)" value={topLine} onChange={setTopLine} maxLength={80} error={errors.topLine}
                hint="For example the organization's name, or Property of …" />
              <Checkbox label="The organization's logo" checked={logo} onChange={setLogo}
                disabled={preview ? !preview.logoAvailable : false}
                hint={preview && !preview.logoAvailable ? 'No logo is set (Administration > Organization).' : output === 'zpl' ? 'Printed in black and white; a PNG logo only.' : undefined} />
            </div>
          </Card>

          <div className="form-actions">
            <Button onClick={() => void run(true)} loading={busy === 'test'} disabled={Boolean(busy)}>Alignment test page</Button>
            <Button type="submit" variant="primary" icon="download" loading={busy === 'print'} disabled={Boolean(busy) || Boolean(noSeries) || !count_ || Boolean(preview?.error)}>
              {count_ > 0 ? `Print ${count_} tag${count_ === 1 ? '' : 's'}` : 'Print tags'}
            </Button>
          </div>
        </form>

        <aside className="tag-print-side" aria-label="Preview">
          <Card title="Preview">
            {previewError ? <p className="form-error" role="alert">{previewError}</p>
              : noSeries ? <p className="muted">The preview appears once there is a series to print from, or when you choose Reprint values.</p>
              : !preview ? <Loading lines={2} label="Loading the preview" />
              : (
                <div className="stack">
                  {preview.plan ? <LabelPreview plan={preview.plan} codeLabel={codeLabel} /> : <p className="form-error" role="alert">{preview.error}</p>}
                  <p className="muted tag-print-facts">
                    {num(preview.layout.labelWidthMm)} × {num(preview.layout.labelHeightMm)} mm
                    {preview.layout.kind === 'sheet' ? `, ${preview.perPage} per sheet` : ', one per page'}
                    {preview.plan ? `. Value ${num(preview.plan.value.capHeight)} mm tall` : ''}
                    {preview.plan?.code ? `, code modules ${preview.plan.code.module.toFixed(2)} mm` : ''}.
                  </p>
                  <p className="field-hint">Sample: {preview.sample}. Print the alignment test page first on new label stock, at actual size (not "fit to page").</p>
                </div>
              )}
          </Card>
        </aside>
      </div>

      <LayoutDialog open={layoutOpen} onClose={() => setLayoutOpen(false)}
        onSaved={(l) => { setLayoutOpen(false); layouts.reload(); setLayoutId(l.id); toast.success('Layout saved.'); }} />
      <ConfirmDialog open={deleting} title="Delete this layout?" message={`"${layout?.name ?? ''}" will no longer be offered. Tags already printed are not affected.`}
        confirmLabel="Delete" danger onConfirm={() => void removeLayout()} onCancel={() => setDeleting(false)} />
    </div>
  );
}
