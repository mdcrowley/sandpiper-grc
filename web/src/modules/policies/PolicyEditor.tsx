// Write a new version of a policy, or carry on with the draft, with a preview beside the text.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api, ApiError, Button, Card, EmptyState, ErrorState, errorMessage, Loading, PageHeader, TextArea, TextField, useDebounced, useFetch,
  useRecord, useToast,
} from '../../core';
import { PolicyBody, VERSION_STATUS, type PolicyVersion } from './shared';

export function PolicyEditor() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const policy = useRecord('policy', id);
  const versions = useFetch<PolicyVersion[]>(`/api/policies/${id}/versions`);
  const [body, setBody] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<{ html: string; failed: boolean }>({ html: '', failed: false });

  const latest = versions.data?.[0];
  const draft = latest?.status === 'draft' ? latest : undefined;

  // Start from the draft, or from the newest version when writing the next one.
  useEffect(() => {
    if (!versions.data || body !== null) return;
    setBody(latest?.body ?? '');
    setSummary(draft?.change_summary ?? '');
  }, [versions.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const text = useDebounced(body ?? '', 400);
  useEffect(() => {
    let live = true;
    if (!text.trim()) { setPreview({ html: '', failed: false }); return; }
    api.post<{ html: string }>('/api/policies/preview', { body: text })
      .then((r) => { if (live) setPreview({ html: r.html, failed: false }); })
      .catch(() => { if (live) setPreview((p) => ({ ...p, failed: true })); });
    return () => { live = false; };
  }, [text]);

  const back = `/policies/${id}`;
  const crumbs = [{ label: 'Document register', to: '/documents/register' }, { label: policy.row?.doc_number || policy.row?.ref || 'Document', to: back }, { label: 'Write' }];

  if (policy.error || versions.error) {
    return <><PageHeader title="Write the text" breadcrumbs={crumbs} /><ErrorState error={policy.error ?? versions.error} onRetry={() => { policy.reload(); versions.reload(); }} /></>;
  }
  if (!policy.row || !versions.data || body === null) return <><PageHeader title="Write the text" breadcrumbs={crumbs} /><Loading lines={10} /></>;

  const blocked = policy.row.status === 'retired'
    ? 'This document is obsolete, so it cannot have a new version.'
    : latest && ['in_review', 'approved'].includes(latest.status)
      ? `Version ${latest.version} is ${VERSION_STATUS[latest.status].label.toLowerCase()} and its text is fixed. Publish it before starting another version.`
      : '';
  const number = draft ? draft.version : (latest?.version ?? 0) + 1;
  const title = draft ? `Edit draft version ${number}` : `Write version ${number}`;

  if (blocked) {
    return (
      <>
        <PageHeader title="Write the text" subtitle={policy.row.title} breadcrumbs={crumbs} />
        <Card><EmptyState icon="lock" title="Nothing to edit right now" message={blocked} action={<Link className="btn btn-primary" to={back}>Back to the document</Link>} /></Card>
      </>
    );
  }

  const save = async () => {
    setErrors({});
    if (!body.trim()) { setErrors({ body: 'Write the text.' }); return; }
    setSaving(true);
    try {
      const payload = { body, change_summary: summary };
      if (draft) await api.patch(`/api/policies/${id}/versions/${draft.id}`, payload);
      else await api.post(`/api/policies/${id}/versions`, payload);
      toast.success(`Draft version ${number} saved.`);
      navigate(`${back}?tab=versions`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title={title} subtitle={policy.row.title} breadcrumbs={crumbs}
        actions={<><Link className="btn btn-secondary" to={back}>Cancel</Link><Button variant="primary" loading={saving} onClick={save}>Save draft</Button></>}
      />
      <div className="pol-compare">
        <Card title="Text">
          <div className="stack pol-editor">
            <TextField
              label="What changed in this version" value={summary} error={errors.change_summary} maxLength={300}
              placeholder={latest && !draft ? 'For example: adds a section on personal devices' : 'For example: first issue'}
              onChange={setSummary}
            />
            <TextArea label="Text" required rows={22} value={body} error={errors.body} onChange={setBody} />
            <p className="pol-help">
              Plain text with simple marks: <code>## Heading</code>, <code>**bold**</code>, <code>- list item</code>, <code>1. numbered item</code>,{' '}
              <code>[link text](https://address)</code>, and tables with <code>|</code>. Web page code is shown as text, never run, and pictures are not loaded.
            </p>
            {latest && !draft && <p className="pol-help">You are starting from version {latest.version}. That version is kept unchanged.</p>}
          </div>
        </Card>
        <Card title="Preview">
          <div className="pol-preview" aria-live="polite">
            {preview.failed && <p className="muted">The preview could not be refreshed. Your text is not affected.</p>}
            <PolicyBody html={preview.html} empty="The preview appears here as you write." />
          </div>
        </Card>
      </div>
    </div>
  );
}
