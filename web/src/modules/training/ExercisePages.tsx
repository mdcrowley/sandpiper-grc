// Exercises list and the exercise record.
import { useNavigate } from 'react-router-dom';
import { Button, EmptyState, LookupChip, RecordPage, ResourceList, todayInZone, useAuth, useResource } from '../../core';
import { ExerciseFindings } from './ExerciseFindings';
import { ExerciseParticipants } from './ExerciseParticipants';
import { daysPhrase } from './shared';

export function ExerciseList() {
  const navigate = useNavigate();
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
      actions={<Button icon="calendar" onClick={() => navigate('/exercises/calendar')}>Calendar</Button>}
    />
  );
}

function ActionsTab({ exerciseId }: { exerciseId: string }) {
  const action = useResource('action');
  const { can } = useAuth();
  if (!action || !can('actions.view')) {
    return (
      <EmptyState icon="check-square" title="Actions are not available"
        message="The action tracker is not switched on, or you do not have access to it. Findings stay on the Findings tab." />
    );
  }
  return (
    <ResourceList
      type="action"
      baseFilter={{ source_type: 'exercise', source_id: exerciseId }}
      columns={['ref', 'title', 'status', 'priority', 'owner_id', 'due_on']}
      filters={['status', 'priority', 'owner_id']}
      createFields={['title', 'description', 'priority', 'owner_id', 'due_on']}
      createInitial={{ source: 'exercise', source_type: 'exercise', source_id: exerciseId }}
      onCreated={() => undefined}
    />
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
        { key: 'participants', label: 'Participants', content: ({ row }) => <ExerciseParticipants exerciseId={row.id} /> },
        { key: 'findings', label: 'Findings', content: ({ row }) => <ExerciseFindings exerciseId={row.id} /> },
        { key: 'actions', label: 'Actions', content: ({ row }) => <ActionsTab exerciseId={row.id} /> },
      ]}
    />
  );
}
