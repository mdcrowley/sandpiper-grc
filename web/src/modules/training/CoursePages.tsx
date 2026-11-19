// Courses list and the course record.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, LookupChip, RecordPage, ResourceList, useAuth } from '../../core';
import { CourseAssignments } from './CourseAssignments';
import { CoursePeople, CourseProgressBar } from './CourseProgress';

const repeat = (months: unknown) => {
  const n = Number(months);
  if (!n) return 'Once';
  return n === 12 ? 'Every year' : n % 12 === 0 ? `Every ${n / 12} years` : `Every ${n} months`;
};

export function CourseList() {
  const navigate = useNavigate();
  const { can } = useAuth();
  return (
    <ResourceList
      type="course"
      title="Courses"
      columns={[
        'ref', 'title', 'category', 'format',
        { field: 'recurrence_months', label: 'Repeats', sortable: true, render: (row) => repeat(row.recurrence_months) },
        'mandatory', 'owner_id', 'status',
      ]}
      filters={['category', 'format', 'mandatory', 'status', 'owner_id']}
      createFields={['title', 'description', 'category', 'provider', 'format', 'duration_minutes', 'recurrence_months', 'due_days', 'mandatory', 'self_certify', 'owner_id']}
      bulkFields={['category', 'mandatory', 'self_certify', 'owner_id', 'status']}
      actions={(
        <>
          <Button onClick={() => navigate('/training')}>Training overview</Button>
          {can('training.create') && <Button icon="upload" onClick={() => navigate('/training/import')}>Import completions</Button>}
        </>
      )}
    />
  );
}

export function CourseDetail() {
  // Bumped whenever records change, so the progress bar above the tabs reloads.
  const [version, setVersion] = useState(0);
  const changed = () => setVersion((v) => v + 1);
  return (
    <RecordPage
      type="course"
      status={(row) => (
        <span className="row">
          {row.mandatory && <Badge color="purple">Mandatory</Badge>}
          {row.self_certify && <Badge color="teal">Self-certified</Badge>}
          <Badge color="gray">{repeat(row.recurrence_months)}</Badge>
          <LookupChip list="course_status" value={row.status} />
        </span>
      )}
      subtitle={(row) => row.description}
      banner={({ row }) => <CourseProgressBar key={version} courseId={row.id} />}
      summaryFields={[
        'title', 'description', 'category', 'provider', 'format', 'duration_minutes', 'recurrence_months', 'due_days', 'mandatory',
        'self_certify', 'owner_id', 'status',
      ]}
      tabs={[
        { key: 'people', label: 'People', content: ({ row }) => <CoursePeople key={version} courseId={row.id} courseTitle={row.title} onChanged={changed} /> },
        { key: 'rules', label: 'Assignment rules', content: ({ row }) => <CourseAssignments courseId={row.id} onChanged={changed} /> },
      ]}
    />
  );
}
