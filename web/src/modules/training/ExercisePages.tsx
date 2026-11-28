// Exercises list and the exercise record.
import { lazy, Suspense } from 'react';
import type { ComponentType } from 'react';
import { EmptyState, Loading, LookupChip, RecordPage, ResourceList, todayInZone, useAuth, useResource } from '../../core';
import { ExerciseFindings } from './ExerciseFindings';
import { ExerciseParticipants } from './ExerciseParticipants';
import { ExerciseSteps } from './ExerciseSteps';
import { daysPhrase } from './shared';

export function ExerciseList() {
  const today = todayInZone();
  return (
    <ResourceList
      type="exercise"
      title="Exercises"
      columns={[
        'ref', 'title', 'type', 'status', 'exercise_date', 'result',
        {
          field: 'next_due_on', label: 'Next due', sortable: true,
          render: (row) => (row.next_due_on
            ? <span className={row.next_due_on < today ? 'trn-late' : undefined}>{daysPhrase(today, row.next_due_on)}</span>
            : <span className="muted">—</span>),
        },
        'owner_id',
      ]}
      filters={['type', 'status', 'result', 'exercise_date', 'next_due_on', 'owner_id']}
      createFields={['title', 'type', 'status', 'exercise_date', 'scenario', 'scope', 'objectives', 'facilitator', 'owner_id']}
      bulkFields={['type', 'status', 'owner_id']}
    />
  );
}

// The shared Actions panel, loaded only when the risks module is part of the build.
const actionLoaders = import.meta.glob<{ ActionsPanel: ComponentType<{ sourceType: string; sourceId: string; source?: string }> }>(
  '../risks/ActionsPanel.tsx',
);
const loadActions = Object.values(actionLoaders)[0];
const LazyActions = loadActions ? lazy(() => loadActions().then((m) => ({ default: m.ActionsPanel }))) : null;

function ActionsTab({ exerciseId }: { exerciseId: string }) {
  const action = useResource('action');
  const { can } = useAuth();
  if (!action || !LazyActions || !can('actions.view')) {
    return (
      <EmptyState icon="check-square" title="Actions are not available"
        message="The action tracker is not switched on, or you do not have access to it. Findings stay on the Findings tab." />
    );
  }
  return (
    <Suspense fallback={<Loading lines={3} label="Loading actions" />}>
      <LazyActions sourceType="exercise" sourceId={exerciseId} source="exercise" />
    </Suspense>
  );
}

export function ExerciseDetail() {
  return (
    <RecordPage
      type="exercise"
      status={(row) => (
        <span className="row">
          <LookupChip list="exercise_type" value={row.type} />
          <LookupChip list="exercise_status" value={row.status} />
          {row.result && <LookupChip list="exercise_result" value={row.result} />}
        </span>
      )}
      summaryFields={[
        'title', 'type', 'status', 'exercise_date', 'facilitator', 'owner_id', 'scenario', 'scope', 'objectives', 'result', 'outcome', 'next_due_on',
      ]}
      tabs={[
        { key: 'steps', label: 'Steps', content: ({ row }) => <ExerciseSteps exerciseId={row.id} /> },
        { key: 'participants', label: 'Participants', content: ({ row }) => <ExerciseParticipants exerciseId={row.id} /> },
        { key: 'findings', label: 'Findings', content: ({ row }) => <ExerciseFindings exerciseId={row.id} /> },
        { key: 'actions', label: 'Actions', content: ({ row }) => <ActionsTab exerciseId={row.id} /> },
      ]}
    />
  );
}
