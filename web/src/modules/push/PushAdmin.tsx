// Administration > Push notifications (E38-14). GET/PUT /api/push/admin/config; saving and replacing
// the UnifiedPush key ask for the password again (withReauth). Keys are write-only: the page shows
// whether one is stored and its fingerprint, never the key.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  api, ApiError, Badge, Button, Card, ErrorState, errorMessage, formatDateTime, Loading, PageHeader, Switch, TextArea, TextField,
  useFetch, useToast, useUnsavedChanges, withReauth,
} from '../../core';
import type { PushConfigInput, PushConfigView, PushProvider, PushStats } from '../../../../shared/push-api.ts';

interface View { config: PushConfigView; stats: PushStats }

interface Form {
  apnsEnabled: boolean; keyId: string; teamId: string; bundleId: string; apnsKey: string;
  fcmEnabled: boolean; serviceAccount: string;
  upEnabled: boolean; hosts: string; contact: string;
}

const formOf = (c: PushConfigView): Form => ({
  apnsEnabled: c.apns.enabled, keyId: c.apns.keyId, teamId: c.apns.teamId, bundleId: c.apns.bundleId, apnsKey: '',
  fcmEnabled: c.fcm.enabled, serviceAccount: '',
  upEnabled: c.unifiedpush.enabled, hosts: c.unifiedpush.allowedHosts.join('\n'), contact: c.unifiedpush.contact,
});

const hostList = (text: string) => text.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean);

/** A button that reads a small text file (the .p8 key or the service account file) into the form. */
function LoadFile({ label, accept, onText }: { label: string; accept: string; onText: (text: string, name: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    if (file.size > 64 * 1024) { toast.error('That file is too large to be a key.'); return; }
    onText(await file.text(), file.name);
  };
  return (
    <>
      <Button variant="secondary" size="sm" icon="upload" onClick={() => input.current?.click()}>{label}</Button>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => void pick(e)} aria-label={label} />
    </>
  );
}

function Delivery({ stats, provider }: { stats: PushStats; provider: PushProvider }) {
  const n = stats.registrations[provider];
  const err = stats.lastError[provider];
  const retrying = stats.retrying?.[provider] ?? 0;
  return (
    <p className="muted">
      {n === 0 ? 'No phone uses it yet.' : `${n} ${n === 1 ? 'phone is' : 'phones are'} registered.`}
      {retrying > 0 ? ` ${retrying} ${retrying === 1 ? 'push waits' : 'pushes wait'} to be tried again (the service was unreachable or busy).` : null}
      {stats.failing[provider] > 0 && err ? <> Last problem ({formatDateTime(err.at)}): {err.message}</> : null}
    </p>
  );
}

const KeyState = ({ set, fingerprint }: { set: boolean; fingerprint: string | null }) => (
  set ? <Badge color="green">{`Key stored (${fingerprint ?? 'fingerprint unknown'})`}</Badge> : <Badge color="gray">No key stored</Badge>
);

export function PushAdminPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<View>('/api/push/admin/config');
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'save' | 'test' | 'vapid' | null>(null);
  useEffect(() => {
    if (data) { setView(data); setForm(formOf(data.config)); }
  }, [data]);

  const base = view ? formOf(view.config) : null;
  const dirty = Boolean(form && base && (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== base[k]));
  const unsaved = useUnsavedChanges(dirty);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));

  const apply = (next: View) => {
    setView(next);
    setForm(formOf(next.config));
  };

  const save = async (extra: PushConfigInput = {}) => {
    if (!form) return;
    setBusy('save');
    setFields({});
    const body: PushConfigInput = {
      apns: { enabled: form.apnsEnabled, keyId: form.keyId, teamId: form.teamId, bundleId: form.bundleId, ...(form.apnsKey.trim() ? { key: form.apnsKey } : {}), ...extra.apns },
      fcm: { enabled: form.fcmEnabled, ...(form.serviceAccount.trim() ? { serviceAccount: form.serviceAccount } : {}), ...extra.fcm },
      unifiedpush: { enabled: form.upEnabled, allowedHosts: hostList(form.hosts), contact: form.contact, ...extra.unifiedpush },
    };
    try {
      const next = await withReauth(() => api.put<View>('/api/push/admin/config', body));
      unsaved.release();
      apply(next);
      toast.success('Push notification settings saved.');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setFields(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const r = await api.post<{ sent: number; failed: number; removed: number; errors: { provider: string; message: string }[] }>('/api/push/admin/test', {});
      if (r.sent) toast.success(`Test sent to ${r.sent} ${r.sent === 1 ? 'phone' : 'phones'}.`);
      else if (r.errors.length) toast.error(r.errors[0].message);
      else toast.error('None of your phones is registered: switch on push notifications under Account in the app first.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const newVapid = async () => {
    if (!window.confirm('Make a new UnifiedPush key? Phones using UnifiedPush stop receiving pushes until the app is opened again.')) return;
    setBusy('vapid');
    try {
      const next = await withReauth(() => api.post<View & { removed: number }>('/api/push/admin/vapid', {}));
      apply(next);
      toast.success(`New UnifiedPush key made; ${next.removed} ${next.removed === 1 ? 'phone registers' : 'phones register'} again when the app opens.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <PageHeader
        title="Push notifications"
        subtitle="Tell people on their phones when they have new notifications, through your organization's own push credentials. A push says only how many notifications are new, never what they are about."
      />
      {error ? <ErrorState error={error} onRetry={reload} /> : !view || !form ? <Loading lines={8} label="Loading the push notification settings" /> : (
        <>
          <Card title="iPhone: Apple Push Notification service">
            <div className="stack">
              <Switch label="Send pushes to iPhones" checked={form.apnsEnabled} onChange={(on) => set('apnsEnabled', on)} error={fields['apns.enabled']}
                hint="Needs a key from your Apple Developer account (Certificates, Identifiers & Profiles > Keys, with Apple Push Notifications service)." />
              <div className="form-grid">
                <TextField label="Key id" value={form.keyId} onChange={(v) => set('keyId', v)} maxLength={10} error={fields['apns.keyId']} hint="10 letters and digits, shown beside the key." />
                <TextField label="Team id" value={form.teamId} onChange={(v) => set('teamId', v)} maxLength={10} error={fields['apns.teamId']} hint="10 letters and digits, shown under Membership." />
                <TextField label="Bundle id" value={form.bundleId} onChange={(v) => set('bundleId', v)} error={fields['apns.bundleId']} hint="The app's bundle id: com.sandpipergrc unless you build your own copy." />
              </div>
              <div className="row">
                <KeyState set={view.config.apns.keySet} fingerprint={view.config.apns.keyFingerprint} />
                <LoadFile label="Load the .p8 key file" accept=".p8,.pem,text/plain" onText={(text) => set('apnsKey', text)} />
                {view.config.apns.keySet ? (
                  <Button variant="ghost" size="sm" onClick={() => void save({ apns: { removeKey: true, enabled: false } })} disabled={busy !== null}>Remove the key</Button>
                ) : null}
              </div>
              <TextArea label={view.config.apns.keySet ? 'Replace the key' : 'Signing key (.p8)'} value={form.apnsKey} onChange={(v) => set('apnsKey', v)} rows={3}
                error={fields['apns.key']} placeholder="-----BEGIN PRIVATE KEY-----" hint="Paste the file's text or load the file. It is stored encrypted and never shown again." />
              <Delivery stats={view.stats} provider="apns" />
            </div>
          </Card>

          <Card title="Android: Firebase Cloud Messaging">
            <div className="stack">
              <Switch label="Send pushes to Android phones through Firebase" checked={form.fcmEnabled} onChange={(on) => set('fcmEnabled', on)} error={fields['fcm.enabled']}
                hint="Needs a Firebase project of your own: the app must be built with that project's google-services.json, and this server needs a service account key of the same project." />
              <div className="row">
                <KeyState set={view.config.fcm.keySet} fingerprint={view.config.fcm.keyFingerprint} />
                {view.config.fcm.keySet ? <span className="muted">{view.config.fcm.projectId} · {view.config.fcm.clientEmail}</span> : null}
                <LoadFile label="Load the service account file" accept=".json,application/json" onText={(text) => set('serviceAccount', text)} />
                {view.config.fcm.keySet ? (
                  <Button variant="ghost" size="sm" onClick={() => void save({ fcm: { removeKey: true, enabled: false } })} disabled={busy !== null}>Remove the key</Button>
                ) : null}
              </div>
              <TextArea label={view.config.fcm.keySet ? 'Replace the service account' : 'Service account (JSON)'} value={form.serviceAccount} onChange={(v) => set('serviceAccount', v)} rows={3}
                error={fields['fcm.serviceAccount']} hint="Only its project, account name and private key are kept; the key is stored encrypted and never shown again." />
              <Delivery stats={view.stats} provider="fcm" />
            </div>
          </Card>

          <Card title="Android: UnifiedPush">
            <div className="stack">
              <Switch label="Send pushes to Android phones through UnifiedPush" checked={form.upEnabled} onChange={(on) => set('upEnabled', on)} error={fields['unifiedpush.enabled']}
                hint="For phones without Google services: each phone uses a UnifiedPush distributor app connected to a push server, such as one your organization runs." />
              <TextArea label="Push servers phones may use" value={form.hosts} onChange={(v) => set('hosts', v)} rows={2} error={fields['unifiedpush.allowedHosts']}
                hint="One per line: host, host:port or *.domain. A push server on a private address must also be listed by its exact address." />
              <TextField label="Contact (optional)" value={form.contact} onChange={(v) => set('contact', v)} error={fields['unifiedpush.contact']}
                hint="A mailto: address or https:// page the push server's operator may use to reach you; sent to the push server with each push." />
              <div className="row">
                {view.config.unifiedpush.vapidPublicKey
                  ? <Badge color="green">Server key made</Badge>
                  : <Badge color="gray">The server's key is made when UnifiedPush is first switched on</Badge>}
                {view.config.unifiedpush.vapidPublicKey ? (
                  <Button variant="ghost" size="sm" onClick={() => void newVapid()} loading={busy === 'vapid'} disabled={busy !== null && busy !== 'vapid'}>Make a new key</Button>
                ) : null}
              </div>
              <Delivery stats={view.stats} provider="unifiedpush" />
            </div>
          </Card>

          <div className="form-actions">
            <Button variant="primary" disabled={!dirty} loading={busy === 'save'} onClick={() => void save()}>Save</Button>
            <Button variant="secondary" onClick={() => void test()} loading={busy === 'test'} disabled={dirty || (busy !== null && busy !== 'test')}>Send a test to my phones</Button>
          </div>
          <p className="muted">
            Each person switches push on for their phone under Account in the app. What is pushed follows their notification
            choices: kinds they switched off or chose to receive by email only are not pushed. Signing a phone out under{' '}
            <Link to="/account/devices">Devices</Link> stops its pushes. Saving asks for your password again.
            {view.stats.lastSentAt ? ` Last push sent ${formatDateTime(view.stats.lastSentAt)}.` : ''}
          </p>
        </>
      )}
    </div>
  );
}
