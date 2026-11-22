// Frameworks and their structure: add a framework from a reference file, download one as a
// file, and add, rename, recolor, reorder and remove functions and categories.
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiError, Button, Card, ConfirmDialog, EmptyState, ErrorState, HistoryPanel, IconButton, Loading, Modal, PageHeader, Select,
  TextArea, TextField, api, errorMessage, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { ColorName } from '../../core';
import { useFrameworkChoice } from './Board';
import { rememberFramework } from './boardState';
import { RefreshTextDialog, SHIPPED_KEY } from './RefreshText';
import type { ImportResult, Structure, StructureCategory, StructureFunction } from './types';
import { frameworkTitle } from './types';

// The OT starter structure link (E33-03) belongs to the OT module, found by file name so frameworks builds without it.
const StarterLinks = Object.values(import.meta.glob<{ StarterLink: () => ReactNode }>('../ot/StarterLink.tsx', { eager: true })).map((m) => m.StarterLink);

const COLORS: ColorName[] = ['purple', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'gray'];
const COLOR_OPTIONS = COLORS.map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1), color: c }));

interface DraftCategory extends StructureCategory { isNew?: boolean }
interface DraftFunction extends Omit<StructureFunction, 'categories'> { isNew?: boolean; categories: DraftCategory[] }

const move = <T,>(list: T[], from: number, by: number): T[] => {
  const to = from + by;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
};

/** Choose a reference file, see what loading it would do, then load it. */
function ImportDialog({ onDone, onCancel }: { onDone: (result: ImportResult) => void; onCancel: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [file, setFile] = useState<unknown>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  // A chosen file tells the enclosing dialog, so closing it asks first.
  useUnsavedChanges(Boolean(fileName));

  async function choose(picked: File | undefined) {
    if (!picked) return;
    setFileName(picked.name);
    setPreview(null);
    setFile(null);
    setProblems([]);
    let parsed: unknown;
    try {
      parsed = JSON.parse((await picked.text()).replace(/^﻿/, ''));
    } catch {
      setProblems(['This is not a JSON file the application can read. Check for a missing comma or bracket.']);
      return;
    }
    setBusy(true);
    try {
      setPreview(await api.post<ImportResult>('/api/frameworks/import', { file: parsed, dryRun: true }));
      setFile(parsed);
    } catch (err) {
      setProblems(err instanceof ApiError && err.fields?.file ? err.fields.file.split('\n').filter(Boolean) : [errorMessage(err)]);
    } finally {
      setBusy(false);
    }
  }

  async function load() {
    if (!file) return;
    setBusy(true);
    try {
      const result = await api.post<ImportResult>('/api/frameworks/import', file);
      toast.success(`${result.name} ${result.created ? 'loaded' : 'reloaded'}: ${result.outcomes.added} outcomes added, ${result.outcomes.updated} updated.`);
      onDone(result);
    } catch (err) {
      toast.error(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="form">
      <p className="muted" style={{ margin: 0 }}>
        A reference file is a JSON file that lists a framework’s functions, categories and outcomes. The format is described in Help,
        under “Cybersecurity frameworks and assessments”. To start from an example, use “Download as a file” on a framework that is already loaded.
      </p>
      {StarterLinks.map((Starter, i) => <Starter key={i} />)}
      <div className="row">
        <Button icon="upload" onClick={() => input.current?.click()} loading={busy && !file}>Choose a file</Button>
        <span className="muted">{fileName || 'No file chosen'}</span>
        <input ref={input} type="file" hidden accept=".json,application/json"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void choose(f); }} />
      </div>
      {problems.length > 0 && (
        <div className="notice notice-warn" role="alert">
          <strong>The file cannot be loaded as it stands.</strong>
          <ul className="fw-problems">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      {preview && (
        <div className="notice notice-success">
          <strong>{preview.created ? `This will add “${preview.name}” as a new framework.` : `This will update “${preview.name}”, which is already loaded.`}</strong>
          <ul className="fw-problems">
            <li>{preview.functions} functions and {preview.categories} categories</li>
            <li>{preview.outcomes.added} outcomes added, {preview.outcomes.updated} with changed wording or place, {preview.outcomes.unchanged} unchanged</li>
            {!preview.created && <li>Statuses, owners, targets, evidence and mappings are not touched.</li>}
            {preview.not_in_file.length > 0 && (
              <li>{preview.not_in_file.length} outcome{preview.not_in_file.length === 1 ? ' is' : 's are'} in the application but not in the file and will be left as {preview.not_in_file.length === 1 ? 'it is' : 'they are'}: {preview.not_in_file.slice(0, 12).join(', ')}{preview.not_in_file.length > 12 ? '…' : ''}</li>
            )}
          </ul>
        </div>
      )}
      <div className="form-actions">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!file} loading={busy && Boolean(file)} onClick={load}>{preview && !preview.created ? 'Update framework' : 'Load framework'}</Button>
      </div>
    </div>
  );
}

function StructureEditor({ frameworkId, canEdit }: { frameworkId: string; canEdit: boolean }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Structure>(`/api/frameworks/${frameworkId}/structure`);
  const [draft, setDraft] = useState<DraftFunction[]>([]);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const [removing, setRemoving] = useState<{ kind: 'function' | 'category'; fn: number; cat?: number } | null>(null);

  useEffect(() => {
    if (data) { setDraft(data.functions.map((f) => ({ ...f, categories: f.categories.map((c) => ({ ...c })) }))); setDirty(false); setProblem(''); }
  }, [data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading lines={8} label="Loading the structure" />;

  const change = (next: DraftFunction[]) => { setDraft(next); setDirty(true); };
  const setFn = (i: number, p: Partial<DraftFunction>) => change(draft.map((f, n) => (n === i ? { ...f, ...p } : f)));
  const setCat = (i: number, j: number, p: Partial<DraftCategory>) =>
    setFn(i, { categories: draft[i].categories.map((c, n) => (n === j ? { ...c, ...p } : c)) });

  async function save() {
    const codes = draft.flatMap((f) => [f.code.trim(), ...f.categories.map((c) => c.code.trim())]);
    if (draft.some((f) => !f.code.trim() || !f.name.trim() || f.categories.some((c) => !c.code.trim() || !c.name.trim()))) {
      setProblem('Every function and category needs a code and a name.');
      return;
    }
    if (new Set(codes.map((c) => c.toLowerCase())).size !== codes.length) { setProblem('Each code can be used only once.'); return; }
    setBusy(true);
    setProblem('');
    try {
      await api.post(`/api/frameworks/${frameworkId}/structure`, {
        functions: draft.map((f) => ({
          code: f.code.trim(), name: f.name.trim(), description: f.description || null, color: f.color,
          categories: f.categories.map((c) => ({ code: c.code.trim(), name: c.name.trim(), description: c.description || null })),
        })),
      });
      toast.success('Structure saved.');
      reload();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    const fn = draft[removing.fn];
    const cat = removing.cat !== undefined ? fn.categories[removing.cat] : undefined;
    const drop = () => {
      change(cat
        ? draft.map((f, n) => (n === removing.fn ? { ...f, categories: f.categories.filter((c) => c !== cat) } : f))
        : draft.filter((f) => f !== fn));
      setRemoving(null);
    };
    // Something added on this screen and not saved yet is simply dropped.
    if ((cat ?? fn).isNew) { drop(); return; }
    setBusy(true);
    try {
      await api.del(`/api/frameworks/${frameworkId}/${cat ? 'categories' : 'functions'}/${encodeURIComponent((cat ?? fn).code)}`);
      toast.success(`${(cat ?? fn).name} removed.`);
      // With nothing else pending, read the saved structure again; otherwise keep the unsaved edits.
      if (dirty) drop(); else { setRemoving(null); reload(); }
    } catch (err) {
      toast.error(errorMessage(err));
      setRemoving(null);
    } finally {
      setBusy(false);
    }
  }

  const target = removing ? (removing.cat !== undefined ? draft[removing.fn]?.categories[removing.cat] : draft[removing.fn]) : null;

  return (
    <div className="stack">
      {!canEdit && <div className="notice">You can read the structure. Changing it needs the Edit permission.</div>}
      {draft.length === 0 && <EmptyState icon="folder" title="This framework has no functions yet" message="Add the first function, then its categories." />}
      {draft.map((f, i) => (
        <section key={i} className="fw-edit-fn" style={{ '--fw-band': `var(--c-${f.color}-solid)` } as CSSProperties} aria-label={`Function ${f.name || i + 1}`}>
          <div className="fw-edit-row fw-edit-row-fn">
            <TextField label="Code" size="xs" className="fw-edit-code" value={f.code} disabled={!canEdit || !f.isNew} onChange={(v) => setFn(i, { code: v })} />
            <TextField label="Function name" size="xs" className="fw-edit-name" value={f.name} disabled={!canEdit} onChange={(v) => setFn(i, { name: v })} />
            <Select label="Color" size="xs" className="fw-edit-color" required value={f.color} disabled={!canEdit} options={COLOR_OPTIONS}
              onChange={(v) => v && setFn(i, { color: v as ColorName })} />
            {canEdit && (
              <div className="fw-edit-tools">
                <IconButton icon="arrow-up" size="sm" variant="ghost" label={`Move ${f.name || 'function'} up`} disabled={i === 0} onClick={() => change(move(draft, i, -1))} />
                <IconButton icon="arrow-down" size="sm" variant="ghost" label={`Move ${f.name || 'function'} down`} disabled={i === draft.length - 1} onClick={() => change(move(draft, i, 1))} />
                <IconButton icon="trash" size="sm" variant="ghost" label={`Remove ${f.name || 'function'}`} onClick={() => setRemoving({ kind: 'function', fn: i })} />
              </div>
            )}
          </div>
          <TextArea label="Description" hideLabel rows={1} size="xs" value={f.description ?? ''} disabled={!canEdit} placeholder="Description of the function (optional)"
            onChange={(v) => setFn(i, { description: v })} />
          <div className="fw-edit-cats">
            {f.categories.map((c, j) => (
              <div key={j} className="fw-edit-row">
                <TextField label={`Code of category ${j + 1}`} hideLabel size="xs" className="fw-edit-code" placeholder="Code" value={c.code} disabled={!canEdit || !c.isNew}
                  onChange={(v) => setCat(i, j, { code: v })} />
                <TextField label={`Name of category ${c.code || j + 1}`} hideLabel size="xs" className="fw-edit-name" placeholder="Category name" value={c.name} disabled={!canEdit}
                  onChange={(v) => setCat(i, j, { name: v })} />
                {canEdit && (
                  <div className="fw-edit-tools">
                    <IconButton icon="arrow-up" size="sm" variant="ghost" label={`Move ${c.name || 'category'} up`} disabled={j === 0} onClick={() => setFn(i, { categories: move(f.categories, j, -1) })} />
                    <IconButton icon="arrow-down" size="sm" variant="ghost" label={`Move ${c.name || 'category'} down`} disabled={j === f.categories.length - 1} onClick={() => setFn(i, { categories: move(f.categories, j, 1) })} />
                    <IconButton icon="trash" size="sm" variant="ghost" label={`Remove ${c.name || 'category'}`} onClick={() => setRemoving({ kind: 'category', fn: i, cat: j })} />
                  </div>
                )}
              </div>
            ))}
            {canEdit && (
              <Button size="sm" variant="ghost" icon="plus"
                onClick={() => setFn(i, { categories: [...f.categories, { code: f.code ? `${f.code}.` : '', name: '', description: null, isNew: true }] })}>
                Add category
              </Button>
            )}
          </div>
        </section>
      ))}
      {canEdit && (
        <div className="fw-edit-foot">
          <Button icon="plus" onClick={() => change([...draft, { code: '', name: '', description: null, color: 'gray', categories: [], isNew: true }])}>Add function</Button>
          <span className="fw-edit-state" role="status">{problem ? <span className="field-error">{problem}</span> : dirty ? 'You have unsaved changes.' : 'No unsaved changes.'}</span>
          <Button disabled={!dirty || busy} onClick={reload}>Discard changes</Button>
          <Button variant="primary" disabled={!dirty} loading={busy} onClick={save}>Save structure</Button>
        </div>
      )}
      <ConfirmDialog
        open={removing !== null} danger busy={busy}
        title={removing?.kind === 'function' ? 'Remove this function?' : 'Remove this category?'}
        message={`“${target?.name || target?.code || ''}” will be removed from the framework. A ${removing?.kind === 'function' ? 'function that still has categories or outcomes' : 'category that still has outcomes'} cannot be removed.`}
        confirmLabel="Remove" onConfirm={remove} onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

export function ManagePage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const choice = useFrameworkChoice(params.get('framework') ?? undefined);
  const [importing, setImporting] = useState(params.get('new') === '1');
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  const canAdd = can('frameworks.create') || can('frameworks.edit');
  const current = choice.frameworks.find((f) => f.id === choice.id);

  async function download() {
    if (!current) return;
    try {
      const ref = await api.get<unknown>(`/api/frameworks/${current.id}/reference`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(ref, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${current.key}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (choice.error) return <ErrorState error={choice.error} onRetry={choice.reload} />;
  if (!choice.data) return <Loading lines={8} label="Loading frameworks" />;

  return (
    <div className="stack fw-page">
      <PageHeader
        title="Frameworks and structure"
        subtitle="Add a framework from a reference file, and edit the functions and categories that group its outcomes"
        breadcrumbs={[{ label: 'Framework outcomes', to: '/frameworks' }, { label: 'Frameworks and structure' }]}
        actions={canAdd && <Button variant="primary" icon="upload" onClick={() => setImporting(true)}>Add framework from a file</Button>}
      />

      {!current ? (
        <EmptyState icon="shield" title="No framework has been loaded yet"
          message="Load one from a reference file. NIST CSF 2.0 is also loaded by the seed command."
          action={canAdd ? <Button variant="primary" icon="upload" onClick={() => setImporting(true)}>Add framework from a file</Button> : undefined} />
      ) : (
        <>
          <div className="fw-fwlist" role="group" aria-label="Frameworks">
            {choice.frameworks.map((f) => (
              <button key={f.id} type="button" className={f.id === current.id ? 'fw-fwcard is-current' : 'fw-fwcard'} aria-pressed={f.id === current.id}
                onClick={() => { rememberFramework(f.id); setParams({ framework: f.id }); }}>
                <span className="fw-coverage-title">{frameworkTitle(f)}</span>
                <span className="fw-coverage-sub">Key: {f.key}</span>
              </button>
            ))}
          </div>

          <Card
            title={frameworkTitle(current)}
            actions={(
              <div className="row">
                {current.key.toLowerCase() === SHIPPED_KEY && can('frameworks.edit') && (
                  <Button size="sm" icon="refresh" onClick={() => setRefreshing(true)}>Check official wording</Button>
                )}
                <Button size="sm" icon="download" onClick={download}>Download as a file</Button>
                <Button size="sm" icon="target" onClick={() => navigate(`/frameworks/board/${current.id}`)}>Open the board</Button>
              </div>
            )}
          >
            {current.description && <p className="muted fw-fwdesc">{current.description}</p>}
            <StructureEditor key={`${current.id}-${version}`} frameworkId={current.id} canEdit={can('frameworks.edit')} />
          </Card>

          <Card title="History of this framework">
            <HistoryPanel type="framework" id={current.id} />
          </Card>
        </>
      )}

      <Modal open={refreshing && Boolean(current)} title="Check the official wording" size="lg" onClose={() => setRefreshing(false)}>
        {current && <RefreshTextDialog frameworkId={current.id} onCancel={() => setRefreshing(false)} onDone={() => { setRefreshing(false); setVersion((v) => v + 1); choice.reload(); }} />}
      </Modal>

      <Modal open={importing} title="Add framework from a file" size="lg" onClose={() => setImporting(false)}>
        <ImportDialog
          onCancel={() => setImporting(false)}
          onDone={(result) => {
            setImporting(false);
            choice.reload();
            if (result.framework_id) { rememberFramework(result.framework_id); setParams({ framework: result.framework_id }); }
          }}
        />
      </Modal>
    </div>
  );
}
