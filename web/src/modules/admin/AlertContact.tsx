// Contact details for urgent alerts by text message (E09-25): a mobile number and an
// email-to-text address. Personal data: each person edits their own (Account security), and
// administrators anyone's (the user's page).
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, Button, Card, ErrorState, errorMessage, Loading, TextField, useAuth, useFetch, useToast } from '../../core';

interface AlertContact {
  mobile: string;
  smsAddress: string;
  channels: { gateway: boolean; webhook: boolean };
}
interface TestRow { id: string; status: string; error: string | null; provider: string | null }

/** `userId` set: an administrator editing that person; otherwise the signed-in person's own. */
/** Text messages carry security incident alerts and call-tree messages (E41-14): hidden while both parts are switched off (E14-34). */
export function AlertContactCard({ userId }: { userId?: string }) {
  const { areaOn } = useAuth();
  return areaOn('secincidents') || areaOn('continuity') ? <AlertContactForm userId={userId} /> : null;
}

function AlertContactForm({ userId }: { userId?: string }) {
  const base = userId ? `/api/admin/users/${userId}/alert-contact` : '/api/me/alert-contact';
  const toast = useToast();
  const { data, error, reload } = useFetch<AlertContact>(base);
  const [mobile, setMobile] = useState('');
  const [smsAddress, setSmsAddress] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  const [saved, setSaved] = useState<AlertContact | null>(null);
  const shown = saved ?? data;
  useEffect(() => { if (data) { setMobile(data.mobile); setSmsAddress(data.smsAddress); } }, [data]);

  const dirty = Boolean(shown && (mobile !== shown.mobile || smsAddress !== shown.smsAddress));
  const own = !userId;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setErrors({});
    try {
      const next = await api.put<AlertContact>(base, { mobile, smsAddress });
      setSaved(next);
      setMobile(next.mobile);
      setSmsAddress(next.smsAddress);
      toast.success('Alert contact details saved.');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const res = await api.post<{ results: TestRow[] }>(`${base}/test`);
      const sent = res.results.filter((r) => r.status === 'sent');
      if (sent.length === res.results.length) toast.success(`Test text message sent (${sent.length === 1 ? 'one way' : `${sent.length} ways`}).`);
      else toast.error(`Not every test was sent: ${res.results.filter((r) => r.status !== 'sent').map((r) => r.error ?? r.status).join('; ')}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  if (error) return <Card title="Alerts by text message"><ErrorState title="The contact details could not be loaded" error={error} onRetry={reload} /></Card>;
  if (!shown) return <Card title="Alerts by text message"><Loading lines={3} label="Loading contact details" /></Card>;
  const anyOn = shown.channels.gateway || shown.channels.webhook;
  return (
    <Card title="Alerts by text message">
      <form className="form" onSubmit={save} noValidate>
        <p className="muted">
          {own ? 'Urgent alerts, such as a security incident that needs attention, can reach your phone as a text message. ' : 'Urgent alerts, such as a security incident that needs attention, can reach this person\'s phone as a text message. '}
          A text names only what needs attention and never the details. These details are personal: only {own ? 'you' : 'this person'} and administrators can see them.
        </p>
        <TextField
          label="Mobile number" type="tel" inputMode="tel" autoComplete={own ? 'tel' : 'off'} placeholder="+1 555 010 0123"
          hint="With the country code. Used when your organization sends texts through its own text-message system."
          value={mobile} onChange={setMobile} error={errors.mobile} maxLength={30}
        />
        <TextField
          label="Email-to-text address" type="email" autoComplete="off" placeholder="5550100123@text.example.net"
          hint="An address that turns email into a text message on the phone; many mobile carriers and messaging services offer one."
          value={smsAddress} onChange={setSmsAddress} error={errors.smsAddress} maxLength={200}
        />
        {!anyOn && <p className="muted">Text messages are not switched on yet: an administrator sets them up under Administration &gt; Email &gt; Text messages.</p>}
        <div className="form-actions">
          <Button
            icon="message" loading={busy === 'test'} onClick={() => void test()}
            disabled={dirty || busy !== '' || !anyOn || (!shown.mobile && !shown.smsAddress)}
          >
            Send a test text
          </Button>
          <Button type="submit" variant="primary" loading={busy === 'save'} disabled={!dirty || busy !== ''}>Save</Button>
        </div>
      </form>
    </Card>
  );
}
