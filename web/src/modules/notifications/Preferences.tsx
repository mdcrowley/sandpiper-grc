// Each person's notification choices: for each kind, the bell, email, both or nothing; and
// whether email comes one message at a time or as one summary a day.
import { SegmentedControl } from '@mantine/core';
import { useState } from 'react';
import { api, Card, Checkbox, ColorDot, ErrorState, errorMessage, Loading, useFetch, useToast } from '../../core';

type Channel = 'app' | 'email' | 'both' | 'none';

interface Preferences {
  kinds: { value: string; label: string; color: string; description: string; enabled: boolean; channel: Channel }[];
  dailyDigest: boolean;
  emailAvailable: boolean;
  emailAddress: string | null;
  digestHour: number;
}

const CHOICES: { value: Channel; label: string }[] = [
  { value: 'app', label: 'Bell' },
  { value: 'email', label: 'Email' },
  { value: 'both', label: 'Both' },
  { value: 'none', label: 'Off' },
];

const hourText = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function NotificationPreferences() {
  const toast = useToast();
  const { data, error, reload } = useFetch<Preferences>('/api/notifications/preferences');
  const [saved, setSaved] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const prefs = saved ?? data;

  const save = async (key: string, change: { channels?: Record<string, Channel>; dailyDigest?: boolean }) => {
    setSaving(key);
    try {
      setSaved(await api.patch<Preferences>('/api/notifications/preferences', change));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(null);
    }
  };

  if (error) return <ErrorState title="Your preferences could not be loaded" error={error} onRetry={reload} />;
  if (!prefs) return <Loading lines={6} label="Loading preferences" />;
  const emailKinds = prefs.kinds.filter((k) => k.channel === 'email' || k.channel === 'both').length;

  return (
    <div className="stack ntf-prefs">
      <Card title="How to tell me">
        <p className="muted">
          For each kind, choose <strong>Bell</strong> (inside the application), <strong>Email</strong>, <strong>Both</strong> or <strong>Off</strong>.
          Changes are saved as you make them.
        </p>
        {!prefs.emailAvailable && (
          <p className="notice ntf-notice">
            Email is not switched on in this installation, so anything set to Email or Both comes to the bell instead, until it is.
          </p>
        )}
        <ul className="ntf-kinds">
          {prefs.kinds.map((k) => (
            <li key={k.value} className="ntf-kind">
              <div className="ntf-kind-text">
                <span className="ntf-kind-label" id={`ntf-kind-${k.value}`}><ColorDot color={k.color} /> {k.label}</span>
                {k.description && <span className="muted ntf-kind-hint">{k.description}</span>}
              </div>
              <div role="group" aria-labelledby={`ntf-kind-${k.value}`} className="ntf-channel">
                <SegmentedControl
                  size="sm"
                  data={CHOICES}
                  value={k.channel}
                  disabled={saving !== null}
                  onChange={(v) => void save(k.value, { channels: { [k.value]: v as Channel } })}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Email">
        <div className="stack">
          <p className="muted ntf-email-line">
            {prefs.emailAddress
              ? <>Messages go to <strong>{prefs.emailAddress}</strong>, the address on your account. An administrator can change it.</>
              : <>Your account has no email address, so nothing can be emailed to you. Ask an administrator to add one.</>}
          </p>
          <Checkbox
            label="Send me one summary a day instead of a message for each notification"
            hint={prefs.emailAvailable
              ? `The summary is sent once a day, from ${hourText(prefs.digestHour)}, when there is something new. It applies only to the kinds you get by email${emailKinds ? '' : ' (none at the moment)'}; the bell always shows notifications as they happen.`
              : 'Email is not switched on in this installation. Your choice is kept for when it is; the bell always shows notifications as they happen.'}
            checked={prefs.dailyDigest}
            disabled={saving !== null}
            onChange={(on) => void save('digest', { dailyDigest: on })}
          />
          <p className="muted ntf-small">Messages about security records never contain their details: they only say that there is something new to look at in the application.</p>
        </div>
      </Card>
    </div>
  );
}
