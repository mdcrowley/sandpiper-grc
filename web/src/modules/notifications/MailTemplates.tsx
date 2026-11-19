// Administration > Email > Templates: the subject and bodies of each kind of message.
import { useEffect, useState } from 'react';
import { api, ApiError, Button, Card, ConfirmDialog, EmptyState, ErrorState, errorMessage, Loading, StatusChip, TextArea, TextField, useFetch, useToast } from '../../core';

interface Template {
  key: string;
  name: string;
  description: string;
  subject: string;
  text: string;
  html: string;
  customised: boolean;
  updatedAt: string;
  placeholders: string[];
}
interface Preview { subject: string; text: string; html: string }

function Editor({ template, onSaved }: { template: Template; onSaved: (t: Template) => void }) {
  const toast = useToast();
  const [draft, setDraft] = useState({ subject: template.subject, text: template.text, html: template.html });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => {
    setDraft({ subject: template.subject, text: template.text, html: template.html });
    setErrors({});
    setPreview(null);
  }, [template]);
  const dirty = draft.subject !== template.subject || draft.text !== template.text || draft.html !== template.html;

  const call = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setErrors({});
    try { await work(); } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally { setBusy(''); }
  };
  const save = () => call('save', async () => {
    onSaved(await api.put<Template>(`/api/admin/mail/templates/${template.key}`, draft));
    toast.success(`Template "${template.name}" saved.`);
  });
  const showPreview = () => call('preview', async () => {
    setPreview(await api.post<Preview>(`/api/admin/mail/templates/${template.key}/preview`, draft));
  });
  const reset = () => call('reset', async () => {
    onSaved(await api.post<Template>(`/api/admin/mail/templates/${template.key}/reset`));
    setConfirmReset(false);
    toast.success(`Template "${template.name}" put back to the default.`);
  });

  return (
    <Card
      title={template.name}
      actions={template.customised ? <StatusChip color="blue" label="Changed here" /> : <StatusChip color="gray" label="Default" />}
    >
      <div className="stack">
        <p className="muted">{template.description}</p>
        <div className="stack" style={{ gap: 'var(--s-1)' }}>
          <span className="ml-small">Placeholders you can use:</span>
          <span className="ml-placeholders">{template.placeholders.map((p) => <code key={p}>{`{{${p}}}`}</code>)}</span>
        </div>
        <TextField label="Subject" required value={draft.subject} onChange={(v) => setDraft((d) => ({ ...d, subject: v }))} error={errors.subject} />
        <TextArea label="Plain-text body" required rows={8} value={draft.text} onChange={(v) => setDraft((d) => ({ ...d, text: v }))} error={errors.text} />
        <TextArea
          label="HTML body" rows={8} className="ml-code" value={draft.html} onChange={(v) => setDraft((d) => ({ ...d, html: v }))} error={errors.html}
          hint="Simple tags only: p, br, strong, em, ul, ol, li, h1 to h3, hr, blockquote and a. Links may point at {{link}}, {{preferencesLink}}, https: or mailto:. Leave empty to build it from the plain text. Values are escaped."
        />
        <div className="form-actions">
          <Button variant="primary" loading={busy === 'save'} disabled={!dirty || busy !== ''} onClick={() => void save()}>Save template</Button>
          <Button icon="eye" loading={busy === 'preview'} disabled={busy !== ''} onClick={() => void showPreview()}>Preview</Button>
          {dirty && <Button onClick={() => setDraft({ subject: template.subject, text: template.text, html: template.html })}>Discard changes</Button>}
          {template.customised && <Button variant="ghost" disabled={busy !== ''} onClick={() => setConfirmReset(true)}>Put back the default</Button>}
        </div>
        {preview && (
          <div className="stack">
            <h3 className="card-title">Preview with sample values</h3>
            <p><strong>Subject:</strong> {preview.subject}</p>
            <iframe className="ml-preview" title="HTML preview" sandbox="" srcDoc={preview.html} />
            <pre className="ml-preview-text">{preview.text}</pre>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmReset} title="Put back the default?" danger busy={busy === 'reset'}
        message={`Your changes to "${template.name}" are replaced by the text the application came with.`}
        confirmLabel="Put back the default" onConfirm={() => void reset()} onCancel={() => setConfirmReset(false)}
      />
    </Card>
  );
}

export function MailTemplates() {
  const { data, error, reload } = useFetch<Template[]>('/api/admin/mail/templates');
  const [rows, setRows] = useState<Template[] | null>(null);
  const [current, setCurrent] = useState('');
  const list = rows ?? data;
  if (error) return <ErrorState title="Templates could not be loaded" error={error} onRetry={reload} />;
  if (!list) return <Loading lines={6} label="Loading templates" />;
  if (!list.length) return <EmptyState icon="message" title="No templates" message="Templates are written when the application starts." />;
  const selected = list.find((t) => t.key === current) ?? list[0];

  return (
    <div className="ml-templates">
      <nav aria-label="Templates">
        <ul className="ml-template-list">
          {list.map((t) => (
            <li key={t.key}>
              <button type="button" className="ml-template-button" aria-current={t.key === selected.key} onClick={() => setCurrent(t.key)}>
                <strong>{t.name}</strong>
                <span className="muted ml-small">{t.customised ? 'Changed here' : 'Default'}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <Editor
        template={selected}
        onSaved={(saved) => setRows(list.map((t) => (t.key === saved.key ? saved : t)))}
      />
    </div>
  );
}
