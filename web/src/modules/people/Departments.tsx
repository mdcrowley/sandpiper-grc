// Departments as records (E41-01): each with the department it sits under and a manager. People,
// positions, assets, actions, projects and business processes point at one, and a role's grants
// can be limited to the departments of its members (Administration > Roles > Which records).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  api, Button, errorMessage, Modal, RecordPage, RecordPicker, ResourceList, useAuth, useToast,
  type RecordContext,
} from '../../core';

const FIELDS = ['name', 'parent_id', 'manager_id', 'description'];

export function DepartmentList() {
  return (
    <div className="stack">
      <ResourceList
        type="department"
        title="Departments"
        columns={['name', 'parent_id', 'manager_id']}
        filters={['parent_id', 'manager_id']}
        createFields={FIELDS}
      />
      <p className="muted">
        A department's manager, and everyone in it or in a department below it, can be given access to just that department's
        records: under Administration &gt; Roles, choose Their departments for an area in Which records.
      </p>
    </div>
  );
}

/** Moves everything that points at this department to another one, then removes it. */
function MergeButton({ rec }: { rec: RecordContext }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [into, setInto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const merge = async () => {
    if (!into) return;
    setBusy(true);
    try {
      await api.post(`/api/departments/${rec.row.id}/merge`, { into });
      toast.success('Departments merged.');
      navigate(`/people/departments/${into}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };
  return (
    <>
      <Button onClick={() => { setInto(null); setOpen(true); }}>Merge into…</Button>
      <Modal open={open} size="sm" title={`Merge “${String(rec.row.name)}” into another department`} onClose={() => setOpen(false)} dirty={!!into}>
        <form className="form" noValidate onSubmit={(e) => { e.preventDefault(); void merge(); }}>
          <p>
            Everyone and everything in this department (accounts, the staff roster, positions and records) moves to the department you
            choose, departments below it move under that one, and this department is removed. The merge is recorded in the audit log.
          </p>
          <RecordPicker label="Merge into" type="department" value={into} onChange={(v) => setInto(v)} required />
          <div className="form-actions">
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" variant="danger" loading={busy} disabled={!into || into === rec.row.id}>Merge</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function DepartmentDetail() {
  const { can } = useAuth();
  return (
    <RecordPage
      type="department"
      subtitle={(row) => row._display?.parent_id ? `Part of ${row._display.parent_id}` : ''}
      actions={(rec) => (can('people.delete') ? <MergeButton rec={rec} /> : null)}
      summaryFields={FIELDS}
      tabs={[
        {
          key: 'people', label: 'People',
          content: ({ row }: RecordContext) => (
            <ResourceList type="person" baseFilter={{ department_id: row.id }} columns={['ref', 'full_name', 'position_id', 'status']}
              createFields={['full_name', 'employee_number', 'email', 'position_id', 'status']} createInitial={{ department_id: row.id }} onCreated={() => undefined} />
          ),
        },
        {
          key: 'below', label: 'Departments below',
          content: ({ row }: RecordContext) => (
            <ResourceList type="department" baseFilter={{ parent_id: row.id }} columns={['name', 'manager_id']}
              createFields={FIELDS} createInitial={{ parent_id: row.id }} onCreated={() => undefined} />
          ),
        },
      ]}
    />
  );
}
