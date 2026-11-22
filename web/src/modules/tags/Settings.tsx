// Administration > Asset tags > Settings: several tags per record, the lookup log and its retention,
// the print limit. Owner: TAGS-CORE.
import { useEffect, useState, type FormEvent } from 'react';
import {
  api, ApiError, Button, Card, ErrorState, errorMessage, Loading, NumberField, PageHeader, Switch, useAuth, useFetch, useToast, useUnsavedChanges,
} from '../../core';
import { AssetTagsTabs } from './AdminTabs';
import type { TagSettingsView } from './api';

export function TagSettingsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const manage = can('tags.manage');
  const { data, error, reload } = useFetch<TagSettingsView>('/api/asset-tags/settings');
  const [draft, setDraft] = useState<TagSettingsView | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setDraft(data); }, [data]);
  const dirty = Boolean(draft && data && JSON.stringify(draft) !== JSON.stringify(data));
  const { release } = useUnsavedChanges(dirty);
  const set = <K extends keyof TagSettingsView>(k: K, v: TagSettingsView[K]) => setDraft((d) => (d ? { ...d, [k]: v } : d));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    setBusy(true);
    setErrors({});
    try {
      const saved = await api.put<TagSettingsView>('/api/asset-tags/settings', draft);
      release();
      setDraft(saved);
      reload();
      toast.success('Asset tag settings saved.');
    } catch (err) {
      if (err instanceof ApiError && err.fields && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <PageHeader title="Asset tag settings" subtitle="Several tags per record, the lookup log and printing." />
      <AssetTagsTabs />
      <Card>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !draft ? <Loading lines={4} label="Loading settings" />
          : (
            <form className="form" onSubmit={submit} noValidate>
              <Switch
                label="Allow several tags on one record" checked={draft.severalPerRecord} onChange={(v) => set('severalPerRecord', v)} disabled={!manage}
                error={errors.severalPerRecord}
                hint="For example a large item with a tag at each end. Off: a record carries one tag, and a new one replaces it."
              />
              <Switch
                label="Keep a log of tag lookups" checked={draft.logLookups} onChange={(v) => set('logLookups', v)} disabled={!manage}
                error={errors.logLookups}
                hint="Shows when a record was last seen, and by whom, to people who may edit it. The phone's location is never recorded."
              />
              <div className="form-grid">
                <NumberField label="Days the lookup log is kept" min={1} max={3650} step={1} value={draft.lookupDays} onChange={(v) => set('lookupDays', v ?? 0)} disabled={!manage} error={errors.lookupDays} />
                <NumberField label="Most labels one print run makes" min={1} max={10000} step={1} thousands value={draft.printLimit} onChange={(v) => set('printLimit', v ?? 0)} disabled={!manage} error={errors.printLimit} />
              </div>
              {manage && (
                <div className="form-actions">
                  <Button onClick={() => { if (data) setDraft(data); setErrors({}); }} disabled={!dirty}>Undo changes</Button>
                  <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>Save</Button>
                </div>
              )}
            </form>
          )}
      </Card>
    </div>
  );
}
