// Extension file (admin/UserExtensions.tsx): the Devices card on an administrator's user page (E38-02):
// GET /api/admin/users/:id/devices, sign one or all out. Left out while the Mobile app area is off.
import { useState } from 'react';
import { api, Button, Card, EmptyState, ErrorState, errorMessage, Loading, useFetch, useToast } from '../../core';
import type { UserCardDef } from '../admin/UserExtensions';
import { DeviceList, type Device } from './Devices';

function DevicesCard({ userId }: { userId: string }) {
  const toast = useToast();
  const { data, error, reload } = useFetch<Device[]>(`/api/admin/users/${userId}/devices`);
  const [busy, setBusy] = useState('');
  const active = data?.filter((d) => !d.revokedAt).length ?? 0;

  const run = async (key: string, work: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await work();
      toast.success(done);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <Card
      title="Mobile app devices" flush
      actions={active > 1 && (
        <Button size="sm" loading={busy === 'all'} onClick={() => void run('all', () => api.del(`/api/admin/users/${userId}/devices`), 'Every device signed out.')}>
          Sign out all
        </Button>
      )}
    >
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <div className="card-body"><Loading lines={2} label="Loading devices" /></div>
        : data.length === 0 ? <EmptyState icon="key" title="No phones signed in" message="This person has not signed in to the mobile app." />
        : (
          <DeviceList devices={data} busy={busy} owner="admin"
            onSignOut={(d) => void run(d.id, () => api.del(`/api/admin/users/${userId}/devices/${d.id}`), `${d.name} signed out.`)} />
        )}
      <p className="card-body adm-card-foot muted">Disabling the account signs out every phone; they stay signed out if it is enabled again.</p>
    </Card>
  );
}

export const userCards: UserCardDef[] = [
  { key: 'devices', area: 'mobile', Card: DevicesCard },
];
