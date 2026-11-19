import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Group, Stack, Text } from '@mantine/core';
import { Button, Card, errorMessage, ErrorState, Icon, IconButton, Loading, RecordPicker, useAuth, useFetch, useToast } from '../../core';
import type { Row } from '../../core';
import type { ProjectSystems } from './types';

/**
 * The systems a project affects, as links into the system inventory. Shown only when the
 * inventory is part of this installation; other related records live on the Related tab.
 */
export function SystemsCard({ row, save }: { row: Row; save: (patch: Record<string, unknown>) => Promise<unknown> }) {
  const { can } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useFetch<ProjectSystems>(`/api/projects/${row.id}/systems`);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const ids: string[] = Array.isArray(row.systems_affected) ? row.systems_affected : [];
  const canEdit = can('projects.edit') && can('systems.view');

  if (data && !data.available) return null;

  async function set(next: string[]) {
    setBusy(true);
    try {
      await save({ systems_affected: next });
      setAdding(false);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="Systems affected"
      actions={canEdit && !adding ? <Button size="sm" icon="plus" onClick={() => setAdding(true)}>Add system</Button> : undefined}
    >
      {error ? <ErrorState error={error} onRetry={reload} /> : !data ? <Loading lines={2} label="Loading systems" /> : (
        <Stack gap="xs">
          {data.systems.length === 0 && !adding && (
            <Text size="sm" c="dimmed">No systems named yet. Add the systems this project changes, replaces or depends on.</Text>
          )}
          {data.systems.length > 0 && (
            <ul className="prj-syslist">
              {data.systems.map((s) => (
                <li key={s.id}>
                  <Icon name="server" size={15} />
                  {s.route ? <Link to={s.route}>{s.ref && <span className="ref">{s.ref}</span>} {s.label}</Link> : <span>{s.label}</span>}
                  {canEdit && (
                    <IconButton icon="x" size="sm" variant="ghost" label={`Remove ${s.label}`} disabled={busy} onClick={() => set(ids.filter((id) => id !== s.id))} />
                  )}
                </li>
              ))}
            </ul>
          )}
          {data.hidden > 0 && <Text size="xs" c="dimmed">{data.hidden} more that you do not have access to.</Text>}
          {adding && (
            <Group align="flex-end" gap="xs">
              <div style={{ flex: '1 1 220px' }}>
                <RecordPicker label="System" type="system" value={null} placeholder="Search the system inventory" onChange={(id) => { if (id && !ids.includes(id)) void set([...ids, id]); }} />
              </div>
              <Button onClick={() => setAdding(false)}>Done</Button>
            </Group>
          )}
        </Stack>
      )}
    </Card>
  );
}
