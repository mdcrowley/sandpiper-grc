// Checklist templates: the reusable lists of checks used by audits and inspections, edited item by item.
import { useEffect, useState } from 'react';
import {
  api, Button, Card, Checkbox, EmptyState, errorMessage, ErrorState, IconButton, Loading, PageHeader, RecordPage, ResourceList, TextArea, TextField,
  useFetch, useToast, useUnsavedChanges,
} from '../../core';
import type { RecordContext } from '../../core';
import { type ChecklistItem, ItemFlags, bySection } from './Checklist';
import { AuditTabs } from './shared';

export function TemplateList() {
  return (
    <div className="stack">
      <PageHeader title="Checklists" subtitle="Reusable checklists for audits and inspections. Your organization writes its own checks; nothing is built in." />
      <AuditTabs active="templates" />
      <ResourceList
        type="checklist_template"
        urlState
        columns={['name', 'kind', 'target_type', 'version', 'active', 'updated_at']}
        filters={['kind', 'target_type', 'active']}
        createFields={['name', 'kind', 'target_type', 'description']}
      />
    </div>
  );
}

interface Draft { key: string; id?: string; section: string; prompt: string; guidance: string; critical: boolean; photo_required: boolean }
let seq = 0;
const toDraft = (i: ChecklistItem): Draft => ({
  key: i.id, id: i.id, section: i.section ?? '', prompt: i.prompt, guidance: i.guidance ?? '', critical: i.critical, photo_required: i.photo_required,
});

function ItemEditor({ row, canEdit, reload }: RecordContext) {
  const toast = useToast();
  const { data, error, reload: again } = useFetch<{ items: ChecklistItem[] }>(`/api/checklist-templates/${row.id}/items`);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const original = JSON.stringify((data?.items ?? []).map(toDraft));
  const dirty = editing && draft !== null && JSON.stringify(draft) !== original;
  const unsaved = useUnsavedChanges(dirty);
  useEffect(() => { if (data && !editing) setDraft(data.items.map(toDraft)); }, [data, editing]);
  if (error) return <ErrorState error={error} onRetry={again} />;
  if (!data || !draft) return <Loading lines={6} />;

  if (!editing) {
    return (
      <Card title={`Items (${data.items.length})`} actions={canEdit && <Button size="sm" icon="edit" onClick={() => setEditing(true)}>Edit items</Button>} flush>
        {data.items.length === 0 ? (
          <EmptyState icon="check-square" title="No items yet" message="Add the checks this checklist asks for, grouped under sections such as Platforms or Fire and emergency." />
        ) : bySection(data.items).map((g) => (
          <section key={`${g.section}-${g.items[0].id}`} className="au-template-section" aria-label={g.section ?? 'Checks'}>
            {g.section && <h3 className="au-section-title">{g.section}</h3>}
            <ol className="au-list">
              {g.items.map((i) => (
                <li key={i.id} className="au-list-item">
                  <div className="au-list-main">
                    <p className="au-prompt">{i.prompt} <ItemFlags item={i} /></p>
                    {i.guidance && <p className="muted au-guidance">{i.guidance}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </Card>
    );
  }

  const set = (n: number, patch: Partial<Draft>) => setDraft(draft.map((d, i) => (i === n ? { ...d, ...patch } : d)));
  const move = (n: number, by: number) => {
    const next = [...draft];
    const [it] = next.splice(n, 1);
    next.splice(n + by, 0, it);
    setDraft(next);
  };
  const saveAll = async () => {
    setBusy(true);
    try {
      const res = await api.put<{ changed: boolean; template: { version: number } }>(`/api/checklist-templates/${row.id}/items`, {
        items: draft.map((d) => ({ id: d.id, section: d.section, prompt: d.prompt, guidance: d.guidance, critical: d.critical, photo_required: d.photo_required })),
      });
      unsaved.release();
      toast.success(res.changed ? `Checklist saved${res.template.version > Number(row.version ?? 1) ? ` as version ${res.template.version}` : ''}.` : 'Nothing changed.');
      setEditing(false);
      again();
      reload();
    } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); }
  };
  return (
    <Card title="Edit items" actions={<span className="muted">A checklist already used gets a new version when saved; earlier answers keep their questions.</span>}>
      <ol className="au-edit-list">
        {draft.map((d, n) => (
          <li key={d.key} className="au-edit-item">
            <div className="form-grid">
              <TextField label="Section" value={d.section} onChange={(v) => set(n, { section: v })} maxLength={200} />
              <TextField label={`Check ${n + 1}`} required value={d.prompt} onChange={(v) => set(n, { prompt: v })} maxLength={1000} />
              <div className="form-cell-wide"><TextArea label="Guidance for the person checking" value={d.guidance} onChange={(v) => set(n, { guidance: v })} rows={1} /></div>
              <Checkbox label="Critical: not met fails the inspection" checked={d.critical} onChange={(v) => set(n, { critical: v })} />
              <Checkbox label="Needs a photo" checked={d.photo_required} onChange={(v) => set(n, { photo_required: v })} />
            </div>
            <div className="au-edit-tools">
              <IconButton icon="arrow-up" size="sm" variant="ghost" label={`Move check ${n + 1} up`} disabled={n === 0} onClick={() => move(n, -1)} />
              <IconButton icon="arrow-down" size="sm" variant="ghost" label={`Move check ${n + 1} down`} disabled={n === draft.length - 1} onClick={() => move(n, 1)} />
              <IconButton icon="trash" size="sm" variant="ghost" label={`Remove check ${n + 1}`} onClick={() => setDraft(draft.filter((_, i) => i !== n))} />
            </div>
          </li>
        ))}
      </ol>
      <div className="form-actions">
        <Button icon="plus" onClick={() => setDraft([...draft, { key: `new-${++seq}`, section: draft.at(-1)?.section ?? '', prompt: '', guidance: '', critical: false, photo_required: false }])}>Add a check</Button>
        <span className="au-spacer" />
        <Button onClick={() => { setDraft(data.items.map(toDraft)); setEditing(false); }}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={saveAll}>Save checklist</Button>
      </div>
    </Card>
  );
}

export function TemplateDetail() {
  return (
    <RecordPage
      type="checklist_template"
      summaryFields={['name', 'kind', 'target_type', 'description', 'version', 'active']}
      tabs={[{ key: 'items', label: 'Items', content: (rec) => <ItemEditor {...rec} /> }]}
    />
  );
}
