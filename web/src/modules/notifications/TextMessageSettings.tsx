// Administration > Email > Text messages (E09-25): how urgent alerts reach people's phones, with
// no paid service built in: email-to-text addresses, and/or a signed webhook to the organization's
// own text-message system.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError, Button, Card, Checkbox, ErrorState, errorMessage, Loading, StatusChip, Switch, TextField, useFetch, useToast, withReauth, api,
} from '../../core';

interface TextSettings {
  gateway: boolean;
  webhook: boolean;
  url: string;
  secretSet: boolean;
  emailOn: boolean;
  outboundOn: boolean;
  hostAllowed: boolean | null;
}

export function TextMessageSettings() {
  const toast = useToast();
  const { data, error, reload } = useFetch<TextSettings>('/api/admin/text/settings');
  const [saved, setSaved] = useState<TextSettings | null>(null);
  const shown = saved ?? data;
  const [gateway, setGateway] = useState(false);
  const [webhook, setWebhook] = useState(false);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const [clearSecret, setClearSecret] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!shown) return;
    setGateway(shown.gateway); setWebhook(shown.webhook); setUrl(shown.url);
  }, [shown]);

  if (error) return <ErrorState title="The text-message settings could not be loaded" error={error} onRetry={reload} />;
  if (!shown) return <Loading lines={6} label="Loading text-message settings" />;
  const dirty = gateway !== shown.gateway || webhook !== shown.webhook || url !== shown.url || secret !== '' || clearSecret;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const next = await withReauth(() => api.put<TextSettings>('/api/admin/text/settings', {
        gateway, webhook, url, ...(secret ? { secret } : {}), ...(clearSecret ? { clearSecret: true } : {}),
      }));
      setSaved(next);
      setSecret('');
      setClearSecret(false);
      toast.success('Text-message settings saved.');
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="stack" onSubmit={save} noValidate>
      <Card title="Text messages">
        <div className="form">
          <p className="muted">
            Urgent alerts, such as a security incident that needs attention, can also reach people as text messages. No paid
            service is built in: choose one or both ways below. A text names only what needs attention, never the details.
            Each person adds their mobile number or email-to-text address under Account security (administrators can on the user's page).
          </p>
          <Switch
            label="Send to email-to-text addresses"
            hint="The text is emailed to the person's email-to-text address, which many mobile carriers and messaging services offer. Uses the email settings."
            checked={gateway} onChange={setGateway}
          />
          {gateway && !shown.emailOn && <p className="muted">Email is switched off: nothing goes this way until it is switched on under Settings.</p>}
        </div>
      </Card>
      <Card
        title="Your own text-message system"
        actions={<StatusChip color={shown.webhook ? 'green' : 'gray'} label={shown.webhook ? 'On' : 'Off'} />}
      >
        <div className="form">
          <p className="muted">
            Each text is posted, signed with the secret, to your text-message system's webhook (the format is in the installation guide), and it sends it on.
            This is an outbound connection: it needs outbound connections switched on and the host on the allow-list under{' '}
            <Link to="/admin/settings">Settings</Link>.
          </p>
          <Switch label="Send through the webhook" checked={webhook} onChange={setWebhook} />
          <div className="form-grid">
            <TextField label="Webhook address" type="url" placeholder="https://sms.example.org/grc" value={url} onChange={setUrl} error={errors.url} />
            <TextField
              label="Signing secret" type="password" autoComplete="new-password" value={secret} onChange={setSecret} error={errors.secret}
              hint={shown.secretSet ? 'A secret is saved. Leave empty to keep it.' : 'At least 16 characters; your system checks each message with it.'}
            />
          </div>
          {shown.secretSet && <Checkbox label="Remove the saved secret" checked={clearSecret} onChange={setClearSecret} />}
          {shown.webhook && !shown.outboundOn && <p className="muted">Outbound connections are switched off: nothing is sent through the webhook.</p>}
          {shown.webhook && shown.hostAllowed === false && <p className="muted">The webhook's host is not on the allow-list: nothing is sent until it is added.</p>}
        </div>
      </Card>
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>Save text-message settings</Button>
      </div>
    </form>
  );
}
