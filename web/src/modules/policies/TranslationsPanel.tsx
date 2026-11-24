// Translations of a policy version (E41-07): the version's text in another language, which staff who
// chose that language read in the portal, on the kiosk and in the app. The version's own text stays
// the approved original; a translation may be added or corrected after publication, and every change
// is audited with the text it replaced.
import { useEffect, useState } from 'react';
import {
  api, ApiError, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, Modal, Select, TableWrap,
  TextArea, TextField, useAuth, useFetch, useToast,
} from '../../core';
import type { Row } from '../../core';
import { PolicyBody, VersionChip, type PolicyVersion } from './shared';

interface Translation {
  id: string; language: string; language_name: string; title: string; summary: string | null; change_summary: string | null;
  body: string; body_html: string; updated_at: string; updated_by_name: string | null;
}
interface Translations { version: number; status: PolicyVersion['status']; original_language: string; rows: Translation[] }
interface Languages { original: { code: string; name: string }; languages: { code: string; name: string; english: string }[] }

function Editor({ row, version, language, existing, previous, onClose, onSaved }: {
  row: Row; version: PolicyVersion; language: Languages['languages'][number]; existing: Translation | undefined;
  previous: Translation | undefined; onClose: () => void; onSaved: () => void;
}) {
  const toast = useToast();
  const start = existing ?? previous;
  const [title, setTitle] = useState(start?.title ?? '');
  const [summary, setSummary] = useState(start?.summary ?? '');
  const [change, setChange] = useState(existing?.change_summary ?? '');
  const [body, setBody] = useState(start?.body ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const dirty = title !== (start?.title ?? '') || body !== (start?.body ?? '') || summary !== (start?.summary ?? '') || change !== (existing?.change_summary ?? '');

  async function save() {
    setBusy(true); setErrors({});
    try {
      await api.put(`/api/policies/${row.id}/versions/${version.id}/translations/${language.code}`, { title, summary, change_summary: change, body });
      toast.success(`${language.english} translation of version ${version.version} saved.`);
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="lg" title={`${existing ? 'Edit' : 'Add'} the ${language.english} translation of version ${version.version}`} onClose={onClose} dirty={dirty}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Save translation</Button></>}>
      <div className="stack" lang={language.code}>
        {!existing && previous && <p className="muted" lang="en">Started from the {language.english} translation of the version before. Change it to match this version.</p>}
        {version.status === 'published' && <p className="muted" lang="en">This version is published: people who chose {language.english} read this translation from the moment you save it.</p>}
        <TextField label={`Title in ${language.english}`} value={title} onChange={setTitle} error={errors.title} required />
        <TextArea label={`Summary in ${language.english}`} rows={2} value={summary} onChange={setSummary} error={errors.summary} />
        <TextField label={`What changed, in ${language.english}`} value={change} onChange={setChange} error={errors.change_summary} />
        <TextArea label={`Text in ${language.english} (Markdown, as the original)`} rows={12} value={body} onChange={setBody} error={errors.body} required />
        <details lang="en">
          <summary>Read the original text of version {version.version}</summary>
          <PolicyBody html={version.body_html} />
        </details>
      </div>
    </Modal>
  );
}

export function TranslationsPanel({ row, versions }: { row: Row; versions: PolicyVersion[] }) {
  const { can } = useAuth();
  const toast = useToast();
  const langs = useFetch<Languages>('/api/policies/translation-languages');
  const initial = versions.find((v) => v.status === 'published') ?? versions[0];
  const [chosen, setChosen] = useState(initial?.id ?? '');
  const version = versions.find((v) => v.id === chosen) ?? initial;
  const previousVersion = version ? versions.find((v) => v.version < version.version) : undefined;
  const data = useFetch<Translations>(version ? `/api/policies/${row.id}/versions/${version.id}/translations` : null);
  const before = useFetch<Translations>(previousVersion ? `/api/policies/${row.id}/versions/${previousVersion.id}/translations` : null);
  const [editing, setEditing] = useState<string | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReading(null); }, [chosen]);

  if (!version) return <Card><EmptyState icon="file-text" title="No versions yet" message="Write a version first; then it can be translated." /></Card>;
  if (langs.error || data.error) return <Card title="Translations"><ErrorState error={langs.error ?? data.error} onRetry={() => { langs.reload(); data.reload(); }} /></Card>;
  if (!langs.data || !data.data) return <Card title="Translations"><Loading lines={4} /></Card>;
  const editable = can('policies.edit') && row.status !== 'retired' && version.status !== 'superseded';
  const byCode = new Map(data.data.rows.map((r) => [r.language, r]));
  const shown = reading ? byCode.get(reading) : undefined;
  const editingLanguage = langs.data.languages.find((l) => l.code === editing);

  async function remove(code: string) {
    setBusy(true);
    try {
      await api.del(`/api/policies/${row.id}/versions/${version!.id}/translations/${code}`);
      toast.success('Translation removed.');
      setRemoving(null);
      data.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Card
        title="Translations"
        actions={versions.length > 1 ? (
          <span className="row pol-switch">
            <VersionChip status={version.status} />
            <Select label="Version" hideLabel size="xs" value={version.id} onChange={(id) => setChosen(id || version.id)}
              options={versions.map((v) => ({ value: v.id, label: `Version ${v.version}${v.status === 'published' ? ' (published)' : ''}` }))} />
          </span>
        ) : <VersionChip status={version.status} />}
        flush
      >
        <p className="muted pol-pad">
          The text of version {version.version} is the approved original ({langs.data.original.name}). Staff who choose another language in the
          portal, on the kiosk or in the app read its translation when there is one, and their acknowledgment records the language they read.
          {version.status === 'superseded' ? ' This version has been replaced, so its translations are kept as they were.' : ''}
        </p>
        <TableWrap label={`Translations of version ${version.version}`} className="pol-tw">
          <table className="table">
            <caption className="sr-only">Translations of version {version.version}</caption>
            <thead><tr><th scope="col">Language</th><th scope="col">Title</th><th scope="col">Last changed</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {langs.data.languages.map((l) => {
                const tr = byCode.get(l.code);
                return (
                  <tr key={l.code}>
                    <td className="pol-rowhead">{l.english} <span className="muted" lang={l.code}>({l.name})</span></td>
                    <td className="pol-wrap" lang={l.code}>{tr ? tr.title : <span className="muted" lang="en">Not translated</span>}</td>
                    <td>{tr ? `${formatDateTime(tr.updated_at)}${tr.updated_by_name ? ` by ${tr.updated_by_name}` : ''}` : '—'}</td>
                    <td>
                      <span className="row">
                        {tr && <Button size="sm" variant="ghost" icon="eye" onClick={() => setReading(reading === l.code ? null : l.code)}>{reading === l.code ? 'Hide' : 'Read'}</Button>}
                        {editable && <Button size="sm" variant="ghost" icon={tr ? 'edit' : 'plus'} onClick={() => setEditing(l.code)}>{tr ? 'Edit' : 'Translate'}</Button>}
                        {editable && tr && <Button size="sm" variant="ghost" icon="trash" onClick={() => setRemoving(l.code)}>Remove</Button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
      {shown && (
        <Card title={`${shown.title} (${langs.data.languages.find((l) => l.code === shown.language)?.english ?? shown.language})`}>
          <div lang={shown.language} className="stack">
            {shown.summary && <p>{shown.summary}</p>}
            {shown.change_summary && <p className="muted">{shown.change_summary}</p>}
            <PolicyBody html={shown.body_html} />
          </div>
        </Card>
      )}
      {editingLanguage && (
        <Editor row={row} version={version} language={editingLanguage} existing={byCode.get(editingLanguage.code)}
          previous={before.data?.rows.find((r) => r.language === editingLanguage.code)}
          onClose={() => setEditing(null)} onSaved={() => { setEditing(null); data.reload(); }} />
      )}
      <ConfirmDialog
        open={removing !== null} danger busy={busy} title="Remove this translation?"
        message="People who chose this language will read the original text. Acknowledgments already given in it keep their language, and the removed text stays in the history."
        confirmLabel="Remove" onConfirm={() => removing && void remove(removing)} onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
