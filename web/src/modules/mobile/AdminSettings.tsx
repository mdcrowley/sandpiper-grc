// Administration > Mobile app (E38-09): how long the app stays signed in, whether it must be unlocked
// with Face ID, a fingerprint or the device credential, and how long offline work is kept.
// GET/PUT /api/mobile/admin/settings; saving asks for the password again (withReauth).
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, Button, Card, ErrorState, errorMessage, Loading, NumberField, PageHeader, Switch, useFetch, useToast, withReauth } from '../../core';

interface Settings { accessMinutes: number; refreshDays: number; requireUnlock: boolean; unlockAfterMinutes: number; offlineDays: number }
interface View { settings: Settings; limits: Record<'accessMinutes' | 'refreshDays' | 'unlockAfterMinutes' | 'offlineDays', [number, number]> }

export function MobileAdminPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<View>('/api/mobile/admin/settings');
  const [form, setForm] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => { if (data) setForm(data.settings); }, [data]);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => (f ? { ...f, [k]: v } : f));
  const changed = Boolean(form && data && (Object.keys(form) as (keyof Settings)[]).some((k) => form[k] !== data.settings[k]));

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setFields({});
    try {
      await withReauth(() => api.put('/api/mobile/admin/settings', form));
      toast.success('Mobile app settings saved.');
      reload();
    } catch (err) {
      const f = (err as { fields?: Record<string, string> }).fields;
      if (f) setFields(f);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const num = (k: 'accessMinutes' | 'refreshDays' | 'unlockAfterMinutes' | 'offlineDays', label: string, hint: string) => (
    <NumberField label={label} min={data!.limits[k][0]} max={data!.limits[k][1]} step={1} value={form![k]}
      onChange={(v) => set(k, v === null ? data!.settings[k] : Math.round(v))} error={fields[k]}
      hint={`${hint} From ${data!.limits[k][0]} to ${data!.limits[k][1]}.`} />
  );

  return (
    <div className="stack">
      <PageHeader title="Mobile app" subtitle="How the Sandpiper GRC app for iPhone and Android signs in and protects what it keeps on the phone." />
      {error ? <ErrorState error={error} onRetry={reload} /> : !data || !form ? <Loading lines={6} label="Loading the mobile app settings" /> : (
        <Card title="Sign-in and unlock">
          <div className="stack">
            {num('accessMinutes', 'Access token life in minutes', 'The app gets a new short-lived token this often, without asking the person.')}
            {num('refreshDays', 'Days a phone stays signed in without use', 'A phone not used for this long must sign in again.')}
            <Switch label="Require unlock to open the app" checked={form.requireUnlock} onChange={(on) => set('requireUnlock', on)}
              hint="Face ID, a fingerprint or the phone's passcode before the app opens. When off, each person may still choose it in the app." />
            {num('unlockAfterMinutes', 'Minutes before unlocking again', 'After this long in the background the app asks to be unlocked again (0 = every time).')}
            {num('offlineDays', 'Days offline work is kept', 'A phone deletes its offline package (My work, the report forms\' choices, upcoming inspections) after this many days. Work saved on the phone and not yet sent is kept.')}
            <div className="form-actions">
              <Button variant="primary" disabled={!changed} loading={busy} onClick={() => void save()}>Save</Button>
            </div>
            <p className="muted">
              New lifetimes apply to tokens issued from now on. Saving asks for your password again. People see and sign out their own phones under{' '}
              <Link to="/account/devices">Devices</Link>; you see each person&apos;s phones on their page under Users. Switching the Mobile app off under{' '}
              <Link to="/admin/features">Features</Link> signs out every phone.
            </p>
          </div>
        </Card>
      )}
    </div>
  );
}
