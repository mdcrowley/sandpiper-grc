// Each person's notification choices: which kinds they receive, and the daily digest flag.
import { useState } from 'react';
import { api, Card, Checkbox, ErrorState, errorMessage, Loading, StatusChip, useFetch, useToast } from '../../core';

interface Preferences {
  kinds: { value: string; label: string; color: string; description: string; enabled: boolean }[];
  dailyDigest: boolean;
  emailAvailable: boolean;
}

export function NotificationPreferences() {
  const toast = useToast();
  const { data, error, reload } = useFetch<Preferences>('/api/notifications/preferences');
  const [saved, setSaved] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const prefs = saved ?? data;

  const save = async (key: string, change: { kinds?: Record<string, boolean>; dailyDigest?: boolean }) => {
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

  return (
    <div className="stack ntf-prefs">
      <Card title="What to tell me about">
        <p className="muted">Changes are saved as you make them. A kind you switch off is not shown in the bell or in your list from then on.</p>
        <ul className="ntf-kinds">
          {prefs.kinds.map((k) => (
            <li key={k.value} className="ntf-kind">
              <Checkbox
                label={k.label}
                hint={k.description || undefined}
                checked={k.enabled}
                disabled={saving !== null}
                onChange={(on) => void save(k.value, { kinds: { [k.value]: on } })}
              />
              <StatusChip color={k.enabled ? 'green' : 'gray'} label={k.enabled ? 'On' : 'Off'} />
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Email">
        <Checkbox
          label="Send me one summary a day instead of a message for each notification"
          hint={prefs.emailAvailable
            ? 'Applies to email only. The bell always shows notifications as they happen.'
            : 'Email delivery is not set up in this installation. Your choice is kept for when it is; the bell always shows notifications as they happen.'}
          checked={prefs.dailyDigest}
          disabled={saving !== null}
          onChange={(on) => void save('digest', { dailyDigest: on })}
        />
      </Card>
    </div>
  );
}
