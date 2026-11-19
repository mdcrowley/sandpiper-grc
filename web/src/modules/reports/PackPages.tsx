// Report packs: an ordered set of saved reports and text sections behind a cover page, previewed
// on screen, printed from the browser, and frozen as dated documents that can be opened again.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Button, Card, ConfirmDialog, EmptyState, ErrorState, Forbidden, Icon, IconButton, Loading, LookupChip, Menu, NotFound, PageHeader,
  ResourceList, Select, TextArea, TextField, api, errorMessage, formatDate, formatDateTime, useAuth, useFetch, useToast,
} from '../../core';
import type { ApiError, ListResult } from '../../core';
import { downloadFile, fileName, openDocument } from './data';
import { ShareDialog, useCanChange } from './dialogs';
import { ResultView } from './ResultView';
import type { ChartSpec, PackSection, ReportDefinition, ReportPack, ReportResult, Snapshot } from './types';
import { Markdown } from './visuals';

export function PacksPage() {
  return (
    <ResourceList
      type="report_pack"
      title="Report packs"
      columns={['name', 'description', { field: 'sections', label: 'Sections', render: (r) => String((r.sections as unknown[] | null)?.length ?? 0) }, 'sharing', 'updated_at']}
      filters={['sharing', 'owner_id']}
      bulkFields={[]}
      createFields={['name', 'description', 'cover_title', 'cover_subtitle']}
    />
  );
}

interface PreviewSection { kind: 'text' | 'report'; title: string; body?: string; reportId?: string; description?: string | null; note?: string | null; result?: ReportResult | null; chart?: ChartSpec | null }
interface Preview {
  pack: Pick<ReportPack, 'id' | 'name' | 'cover_title' | 'cover_subtitle' | 'description'>;
  sections: PreviewSection[]; generatedAt: string; preparedFor: string;
}

export function PackPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { can, appName } = useAuth();
  const pack = useFetch<ReportPack>(`/api/report-packs/${id}`);
  const canChange = useCanChange(pack.data, 'reports');
  const editing = params.get('edit') === '1' && canChange;
  const preview = useFetch<Preview>(!editing && pack.data ? `/api/report-packs/${id}/preview` : null);
  const snaps = useFetch<Snapshot[]>(pack.data ? `/api/report-packs/${id}/snapshots` : null);
  const [dialog, setDialog] = useState<'share' | 'delete' | null>(null);
  const [producing, setProducing] = useState(false);

  const status = (pack.error as ApiError | undefined)?.status;
  if (status === 404) return <NotFound />;
  if (status === 403) return <Forbidden />;
  if (pack.error) return <ErrorState title="This pack could not be opened" error={pack.error} onRetry={pack.reload} />;
  if (!pack.data) return <><PageHeader title="Report pack" /><Loading lines={8} label="Loading the pack" /></>;
  const p = pack.data;
  const setEdit = (on: boolean) => setParams(on ? { edit: '1' } : {});

  async function produce() {
    setProducing(true);
    try {
      const s = await api.post<Snapshot>(`/api/report-packs/${p.id}/produce`, {});
      toast.success('Pack produced. It is kept under "Produced documents" with today\'s figures.');
      snaps.reload();
      navigate(`/reports/snapshots/${s.id}`);
    } catch (err) { toast.error(errorMessage(err)); } finally { setProducing(false); }
  }
  async function remove() {
    try { await api.del(`/api/report-packs/${p.id}`); toast.success('Pack deleted.'); navigate('/reports/packs'); } catch (err) { toast.error(errorMessage(err)); }
  }

  if (editing) return <PackEditor pack={p} onDone={(saved) => { if (saved) pack.reload(); setEdit(false); }} />;

  return (
    <div className="stack rp-pack-page">
      <PageHeader
        title={p.name}
        breadcrumbs={[{ label: 'Report packs', to: '/reports/packs' }, { label: p.name }]}
        subtitle={p.description || undefined}
        status={<LookupChip list="report_sharing" value={p.sharing} />}
        actions={(
          <>
            <Button icon="file-text" onClick={() => window.print()}>Print</Button>
            {can('reports.export') && (
              <Menu label="Download" icon="download" align="end" items={[
                { label: 'PDF', icon: 'file-text', onSelect: () => downloadFile(fileName(p.cover_title || p.name, 'pdf'), 'GET', `/api/report-packs/${p.id}/export?format=pdf`).catch((err) => toast.error(errorMessage(err))) },
                { label: 'Excel (XLSX)', icon: 'download', onSelect: () => downloadFile(fileName(p.cover_title || p.name, 'xlsx'), 'GET', `/api/report-packs/${p.id}/export?format=xlsx`).catch((err) => toast.error(errorMessage(err))) },
                { label: 'Print-ready page', icon: 'external', separated: true, onSelect: () => openDocument('GET', `/api/report-packs/${p.id}/export`).catch((err) => toast.error(errorMessage(err))) },
              ]} />
            )}
            {can('reports.export') && <Button variant="primary" icon="check" loading={producing} onClick={produce}>Produce dated copy</Button>}
            <Menu label="More" icon="more" iconOnly align="end" items={[
              ...(canChange ? [{ label: 'Edit sections', icon: 'edit' as const, onSelect: () => setEdit(true) }, { label: 'Share…', icon: 'users' as const, onSelect: () => setDialog('share') }] : []),
              { label: 'Refresh the figures', icon: 'refresh' as const, onSelect: preview.reload },
              ...(canChange && can('reports.delete') ? [{ label: 'Delete', icon: 'trash' as const, danger: true, separated: true, onSelect: () => setDialog('delete') }] : []),
            ]} />
          </>
        )}
      />

      <div className="rp-pack-layout">
        <div className="rp-pack-paper-wrap">
          {preview.error ? <ErrorState title="The preview could not be worked out" error={preview.error} onRetry={preview.reload} />
            : !preview.data ? <Loading lines={10} label="Working out the pack" />
            : <PackDocument preview={preview.data} appName={appName} />}
        </div>
        <aside className="rp-pack-side no-print">
          <Card title="Produced documents">
            {snaps.error ? <p className="muted">Not available.</p>
              : !snaps.data ? <Loading lines={3} />
              : snaps.data.length === 0 ? <p className="muted">None yet. "Produce dated copy" keeps today's figures as a document you can open again.</p>
              : (
                <ul className="rp-snap-list">
                  {snaps.data.map((s) => (
                    <li key={s.id}>
                      <Link to={`/reports/snapshots/${s.id}`}>{formatDateTime(s.created_at)}</Link>
                      {s.restricted && <Icon name="lock" size={14} label="Includes restricted records" />}
                    </li>
                  ))}
                </ul>
              )}
          </Card>
          {canChange && <Button icon="edit" onClick={() => setEdit(true)}>Edit sections</Button>}
        </aside>
      </div>

      <ShareDialog open={dialog === 'share'} onClose={() => setDialog(null)} path="/api/report-packs" item={p} what="pack" onSaved={pack.reload} />
      <ConfirmDialog open={dialog === 'delete'} danger title="Delete this pack?" confirmLabel="Delete pack"
        message="Documents already produced from it are kept. The reports in it are not deleted." onConfirm={remove} onCancel={() => setDialog(null)} />
    </div>
  );
}

/** The pack as it prints: a cover page, a contents list, then one section per page. */
function PackDocument({ preview, appName }: { preview: Preview; appName?: string }) {
  const { pack, sections } = preview;
  return (
    <article className="rp-pack-paper" aria-label="Pack preview">
      <section className="rp-pack-cover">
        <p className="rp-pack-org">{appName}</p>
        <h2 className="rp-pack-title">{pack.cover_title || pack.name}</h2>
        {pack.cover_subtitle && <p className="rp-pack-subtitle">{pack.cover_subtitle}</p>}
        <dl className="rp-pack-facts">
          <div><dt>Figures as at</dt><dd>{formatDateTime(preview.generatedAt)}</dd></div>
          <div><dt>Prepared by</dt><dd>{preview.preparedFor}</dd></div>
        </dl>
        {sections.length > 0 && (
          <nav className="rp-pack-contents" aria-label="Contents">
            <h3>Contents</h3>
            <ol>{sections.map((s, i) => <li key={i}>{s.title || 'Untitled section'}</li>)}</ol>
          </nav>
        )}
        <p className="rp-pack-note">Figures are worked out from what the person producing the pack is allowed to see.</p>
      </section>
      {sections.length === 0 && <EmptyState icon="file-text" title="This pack has no sections" message="Edit the pack to add reports and text." />}
      {sections.map((s, i) => (
        <section key={i} className="rp-pack-section">
          <h3 className="rp-pack-h"><span className="rp-pack-n">{i + 1}</span>{s.title || 'Untitled section'}</h3>
          {s.kind === 'text' ? <Markdown source={s.body ?? ''} />
            : s.note ? <p className="notice">{s.note}</p>
            : s.result ? (
              <>
                {s.description && <p className="muted">{s.description}</p>}
                <ResultView result={s.result} chart={s.chart} label={s.title} height={280} withTable maxRows={40} />
              </>
            ) : <p className="muted">No figures.</p>}
        </section>
      ))}
      <p className="rp-pack-end">End of pack · {formatDate(preview.generatedAt)}</p>
    </article>
  );
}

function PackEditor({ pack, onDone }: { pack: ReportPack; onDone: (saved: boolean) => void }) {
  const toast = useToast();
  const reports = useFetch<ListResult<ReportDefinition>>('/api/reports?pageSize=200&sort=name');
  const [f, setF] = useState({ name: pack.name, description: pack.description ?? '', cover_title: pack.cover_title ?? '', cover_subtitle: pack.cover_subtitle ?? '' });
  const [sections, setSections] = useState<PackSection[]>(pack.sections ?? []);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState('');
  useEffect(() => { setSections(pack.sections ?? []); }, [pack]);
  const nameOf = (rid: string) => reports.data?.rows.find((r) => r.id === rid)?.name;
  const move = (i: number, by: number) => { const next = [...sections]; const [s] = next.splice(i, 1); next.splice(i + by, 0, s); setSections(next); };
  const set = (i: number, patch: Partial<PackSection>) => setSections(sections.map((s, j) => (j === i ? { ...s, ...patch } as PackSection : s)));

  async function save() {
    if (!f.name.trim()) return toast.error('Give the pack a name.');
    setBusy(true);
    try {
      await api.patch(`/api/report-packs/${pack.id}`, { ...f, name: f.name.trim(), sections });
      toast.success('Pack saved.');
      onDone(true);
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <PageHeader title={`Editing: ${pack.name}`} breadcrumbs={[{ label: 'Report packs', to: '/reports/packs' }, { label: pack.name }]}
        actions={<><Button onClick={() => onDone(false)}>Cancel</Button><Button variant="primary" icon="check" loading={busy} onClick={save}>Save</Button></>} />
      <div className="rp-pack-edit">
        <Card title="Cover page">
          <div className="form">
            <TextField label="Name" required value={f.name} onChange={(name) => setF({ ...f, name })} />
            <TextField label="Cover title" value={f.cover_title} onChange={(cover_title) => setF({ ...f, cover_title })} placeholder={f.name} />
            <TextField label="Cover subtitle" value={f.cover_subtitle} onChange={(cover_subtitle) => setF({ ...f, cover_subtitle })} placeholder="For example: Prepared for the governing body" />
            <TextArea label="Description" rows={2} value={f.description} onChange={(description) => setF({ ...f, description })} />
          </div>
        </Card>
        <Card title="Sections" actions={<span className="muted">{sections.length} of 40</span>}>
          {sections.length === 0 && <p className="rp-empty-hint">No sections yet. Add a saved report or some text below.</p>}
          <ol className="rp-pack-sections">
            {sections.map((s, i) => (
              <li key={i} className="rp-pack-sec">
                <div className="rp-pack-sec-head">
                  <span className="rp-column-n">{i + 1}</span>
                  <Icon name={s.kind === 'text' ? 'edit' : 'chart'} size={16} />
                  <strong className="truncate">{s.kind === 'text' ? 'Text' : nameOf(s.reportId) ?? 'A report not available to you'}</strong>
                  <span className="rp-pack-sec-tools">
                    <IconButton icon="arrow-up" label="Move up" variant="ghost" size="sm" disabled={i === 0} onClick={() => move(i, -1)} />
                    <IconButton icon="arrow-down" label="Move down" variant="ghost" size="sm" disabled={i === sections.length - 1} onClick={() => move(i, 1)} />
                    <IconButton icon="x" label="Remove this section" variant="ghost" size="sm" onClick={() => setSections(sections.filter((_, j) => j !== i))} />
                  </span>
                </div>
                <TextField label="Heading" value={s.title ?? ''} onChange={(title) => set(i, { title })} placeholder={s.kind === 'report' ? nameOf(s.reportId) : 'Heading'} />
                {s.kind === 'text' && <TextArea label="Text" rows={4} value={s.body} onChange={(body) => set(i, { body })} hint="# for a heading, - for a bullet, **bold**, *italic*." />}
              </li>
            ))}
          </ol>
          <div className="rp-pack-add">
            <Select label="Add a saved report" searchable value={pick} placeholder="Choose a report…" options={(reports.data?.rows ?? []).map((r) => ({ value: r.id, label: r.name }))}
              onChange={(rid) => { if (rid) { setSections([...sections, { kind: 'report', reportId: rid }]); setPick(''); } }} />
            <Button icon="plus" onClick={() => setSections([...sections, { kind: 'text', title: '', body: '' }])}>Add text</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
