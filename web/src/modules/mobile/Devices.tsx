// Account > Devices (E38-02): the person's signed-in installations of the mobile app, each with
// "Sign out", and those signed out in the last 30 days. GET /api/me/devices, DELETE /api/me/devices/:id
// (shared/mobile-api.ts DeviceView). The administrator's card (UserCard.tsx) reuses DeviceList.
import { useState } from 'react';
import {
  api, Badge, Button, Card, EmptyState, ErrorState, errorMessage, formatDateTime, Loading, PageHeader, relativeTime, useFetch, useToast,
} from '../../core';
import type { DeviceView } from '../../../../shared/mobile-api.ts';
import '../admin/admin.css';

export type Device = DeviceView & { revokedReason?: string | null };

const platformName = (p: string) => (p === 'ios' ? 'iPhone' : p === 'android' ? 'Android' : p);

/** A list (not a table): it has to fit a half-width card and a phone without scrolling sideways. */
export function DeviceList({ devices, busy, onSignOut, owner }: {
  devices: Device[]; busy: string; onSignOut: (d: Device) => void; owner: 'self' | 'admin';
}) {
  return (
    <ul className="adm-sessions" aria-label="Devices">
      {devices.map((d) => (
        <li key={d.id} className="adm-session">
          <div className="adm-session-main">
            <span className="adm-session-name">
              {d.name}
              {d.current && <Badge color="green">This phone</Badge>}
              {d.revokedAt && <Badge color="gray">Signed out</Badge>}
            </span>
            <span className="muted adm-session-facts">
              <span>{platformName(d.platform)}, app {d.appVersion}</span>
              <span>Signed in {formatDateTime(d.createdAt)}</span>
              {d.lastUsedAt && <span title={formatDateTime(d.lastUsedAt)}>Used {relativeTime(d.lastUsedAt)}{d.lastUsedIp ? ` from ${d.lastUsedIp}` : ''}</span>}
              {d.revokedAt && <span>Signed out {formatDateTime(d.revokedAt)}{d.revokedReason ? ` (${d.revokedReason})` : ''}</span>}
            </span>
          </div>
          {!d.revokedAt && (
            <Button size="sm" variant="secondary" loading={busy === d.id}
              aria-label={`Sign out ${d.name}${owner === 'admin' ? '' : ' (your phone)'}`} onClick={() => onSignOut(d)}>
              Sign out
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export function DevicesPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<Device[]>('/api/me/devices');
  const [busy, setBusy] = useState('');

  const signOut = async (d: Device) => {
    setBusy(d.id);
    try {
      await api.del(`/api/me/devices/${d.id}`);
      toast.success(`${d.name} signed out.`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="stack">
      <PageHeader title="Devices" subtitle="Phones signed in to the Sandpiper GRC app with your account." />
      <Card title="Signed-in phones" flush>
        {error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={3} label="Loading your devices" /></div>
          : data.length === 0 ? <EmptyState icon="key" title="No phones signed in" message="When you sign in to the Sandpiper GRC app on a phone, it appears here." />
          : <DeviceList devices={data} busy={busy} onSignOut={(d) => void signOut(d)} owner="self" />}
        <p className="card-body adm-card-foot muted">
          Signing a phone out stops it at once; the app removes what it kept on the phone the next time it connects. If a phone is lost,
          sign it out here and tell your administrator. Phones that sign in again appear again.
        </p>
      </Card>
    </div>
  );
}
