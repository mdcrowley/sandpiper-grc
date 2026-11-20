// Custom fields on saved reports, dashboards, report schedules and report packs (E18-45).
// Administrators add them under Administration > Custom fields; the reporting dialogs ask them
// (with `useCustomFieldInputs`), the pages show them (`CustomFieldsCard`), and copies carry them over.
import { useNavigate } from 'react-router-dom';
import { Button, useAuth, useResource, customFieldNames } from '../../core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

/** A record's custom field values (`cf_<key>`), to carry over to a copy of it. */
export function customValues(row: Row | undefined): Row {
  return Object.fromEntries(Object.entries(row ?? {}).filter(([k]) => k.startsWith('cf_')));
}

/** The server's field messages in one line, for a refusal that has no dialog to show them in. */
export function fieldMessages(err: unknown): string | null {
  const fields = (err as { fields?: Record<string, string> } | null)?.fields;
  const list = Object.values(fields ?? {});
  return list.length ? list.join(' ') : null;
}

const ADMIN_LABELS: Record<string, string> = {
  report_definition: 'reports', dashboard: 'dashboards', report_schedule: 'report schedules', report_pack: 'report packs',
};

/**
 * For administrators: opens Administration > Custom fields at this record type, where its fields
 * are added, ordered, made required or switched off.
 */
export function CustomFieldsLink({ type }: { type: keyof typeof ADMIN_LABELS }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const resource = useResource(type);
  if (!can('admin.administer')) return null;
  const count = customFieldNames(resource).length;
  return (
    <Button variant="ghost" icon="settings" onClick={() => navigate(`/admin/custom-fields?type=${encodeURIComponent(type)}`)}
      title={`Add or change the custom fields asked when ${ADMIN_LABELS[type]} are saved`}>
      Custom fields{count ? ` (${count})` : ''}
    </Button>
  );
}
