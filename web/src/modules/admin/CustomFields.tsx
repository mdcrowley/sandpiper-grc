// Custom fields (/admin/custom-fields): an administrator's own fields on a record type.
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SegmentedControl } from '@mantine/core';
import {
  ApiError, Button, Card, Checkbox, EmptyState, ErrorState, errorMessage, humanize, IconButton, Loading, Modal, NumberField, PageHeader, Select,
  StatusChip, TableWrap, TextArea, TextField, useFetch, useMeta, useToast,
} from '../../core';
import { Notice } from './common';
import { adminApi } from './reauth';
import { Switch } from './Switch';

type CustomType = 'text' | 'longtext' | 'number' | 'currency' | 'date' | 'boolean' | 'select' | 'multiselect' | 'user' | 'ref';

interface CustomField {
  id: string;
  record_type: string;
  key: string;
  label: string;
  type: CustomType;
  required: boolean;
  list_key: string | null;
  ref_type: string | null;
  section: string | null;
  position: number;
  help: string | null;
  active: boolean;
  name: string;
}
interface Response { fields: CustomField[]; types: CustomType[]; recordTypes: { type: string; label: string; plural: string }[] }

/** The types in the words people use. */
const TYPE_NAMES: Record<CustomType, string> = {
  text: 'Text', longtext: 'Long text', number: 'Number', currency: 'Currency', date: 'Date', boolean: 'Checkbox',
  select: 'Single choice', multiselect: 'Multiple choice', user: 'User', ref: 'Record link',
};
const TYPE_HINTS: Record<CustomType, string> = {
  text: 'One line of text.', longtext: 'Several lines of text.', number: 'A number.', currency: 'An amount of money in the organization’s currency.',
  date: 'A day.', boolean: 'Yes or no.', select: 'One value from a list.', multiselect: 'Any number of values from a list.',
  user: 'A person who uses the application.', ref: 'Another record, such as a system or a vendor.',
};
const isChoice = (t: string) => t === 'select' || t === 'multiselect';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^([0-9])/, 'f_$1').slice(0, 40);

export function CustomFieldsPage() {
  const toast = useToast();
  const meta = useMeta();
  const [params, setParams] = useSearchParams();
  const fromMeta = useMemo(
    () => Object.values(meta.resources ?? {}).map((r) => ({ type: r.type, label: r.label, plural: r.plural })),
    [meta.resources],
  );
  const sortedMeta = useMemo(() => [...fromMeta].sort((a, b) => a.label.localeCompare(b.label)), [fromMeta]);
  const type = params.get('type') || sortedMeta[0]?.type || '';
  const { data, error, reload, loading } = useFetch<Response>(type ? `/api/admin/custom-fields?record_type=${encodeURIComponent(type)}` : null, { keepPrevious: true });
  const types = useMemo(() => {
    const seen = new Map(sortedMeta.map((t) => [t.type, t]));
    for (const t of data?.recordTypes ?? []) if (!seen.has(t.type)) seen.set(t.type, t);
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [sortedMeta, data]);
  const current = types.find((t) => t.type === type);
  const [editing, setEditing] = useState<CustomField | 'new' | null>(null);
  const [busy, setBusy] = useState('');
  const fields = type ? (data?.fields ?? []).filter((f) => f.record_type === type) : [];

  const pick = (t: string) => setParams(t ? { type: t } : {}, { replace: false });

  // Moving a field renumbers the list in tens, so positions stay distinct and easy to read.
  const move = async (i: number, by: -1 | 1) => {
    const next = [...fields];
    const [f] = next.splice(i, 1);
    next.splice(i + by, 0, f);
    setBusy(f.id);
    try {
      for (const [n, field] of next.entries()) {
        if (field.position !== (n + 1) * 10) await adminApi.patch(`/api/admin/custom-fields/${field.id}`, { position: (n + 1) * 10 });
      }
      toast.success(`"${f.label}" moved ${by < 0 ? 'up' : 'down'}.`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
      reload();
      meta.reload();
    }
  };

  const setActive = async (f: CustomField, on: boolean) => {
    setBusy(f.id);
    try {
      if (on) await adminApi.patch(`/api/admin/custom-fields/${f.id}`, { active: true });
      else await adminApi.del(`/api/admin/custom-fields/${f.id}`);
      toast.success(on ? `"${f.label}" switched back on. Values entered before are shown again.` : `"${f.label}" switched off. Its values are kept.`);
      reload();
      meta.reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <PageHeader
        title="Custom fields"
        subtitle="Your own fields on a record type, without any change to the software."
        actions={<Button variant="primary" icon="plus" disabled={!current || !data} onClick={() => setEditing('new')}>Add field</Button>}
      />
      <Notice>
        <p>
          A custom field appears on the record type’s forms and record pages, can be added as a list column and filter, and is included in exports,
          the history and webhooks. <strong>Switching a field off hides it everywhere and keeps the values already entered</strong>; switch it on
          again to bring them back. A field’s key and type cannot be changed after it is added.
        </p>
      </Notice>
      <div className="adm-toolbar adm-toolbar-top">
        <Select
          className="adm-toolbar-grow" label="Record type" placeholder="Choose a record type" searchable
          options={types.map((t) => ({ value: t.type, label: t.label }))} value={type} onChange={pick}
        />
      </div>
      <Card flush title={current ? `Custom fields on ${current.plural.toLowerCase()}` : undefined}>
        {!type ? (
          <EmptyState icon="edit" title="Choose a record type" message="Pick the kind of record whose fields you want to see or add to." />
        ) : error ? <ErrorState error={error} onRetry={reload} />
          : !data ? <div className="card-body"><Loading lines={5} label="Loading custom fields" /></div>
          : fields.length === 0 ? (
            <EmptyState
              icon="edit" title={`No custom fields on ${current?.plural.toLowerCase() ?? 'this record type'} yet`}
              message="Add a field for anything your organization records that the built-in fields do not cover."
              action={current && <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>Add field</Button>}
            />
          ) : (
            <TableWrap label={current ? `Custom fields on ${current.plural.toLowerCase()}` : 'Custom fields'} className={`adm-table-frame${loading ? ' table-loading' : ''}`} aria-busy={loading}>
              <table className="table adm-custom">
                <thead>
                  <tr>
                    <th scope="col">Order</th><th scope="col">Field</th><th scope="col">Type</th>
                    <th scope="col">Section</th><th scope="col">State</th><th scope="col"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map((f, i) => (
                    <tr key={f.id} className={f.active ? undefined : 'adm-retired'}>
                      <td>
                        <span className="adm-order">
                          <span className="adm-order-n">{i + 1}</span>
                          <IconButton size="sm" icon="arrow-up" label={`Move up: ${f.label}`} disabled={Boolean(busy) || i === 0} onClick={() => void move(i, -1)} />
                          <IconButton size="sm" icon="arrow-down" label={`Move down: ${f.label}`} disabled={Boolean(busy) || i === fields.length - 1} onClick={() => void move(i, 1)} />
                        </span>
                      </td>
                      <td className="adm-wrap">
                        <strong>{f.label}</strong>{f.required && <span className="muted"> (required)</span>}
                        <div className="muted adm-small"><code>{f.name}</code>{f.help ? ` · ${f.help}` : ''}</div>
                      </td>
                      <td className="adm-wrap">
                        {TYPE_NAMES[f.type] ?? f.type}
                        {isChoice(f.type) && f.list_key && (
                          <div className="adm-small"><Link to={`/admin/lists?list=${encodeURIComponent(f.list_key)}`}>Options in Lists</Link></div>
                        )}
                        {f.type === 'ref' && f.ref_type && <div className="muted adm-small">to {types.find((t) => t.type === f.ref_type)?.label ?? f.ref_type}</div>}
                      </td>
                      <td className="adm-wrap">{f.section ?? <span className="muted">—</span>}</td>
                      <td>{f.active ? <StatusChip color="green" label="In use" /> : <StatusChip color="gray" label="Switched off" />}</td>
                      <td className="adm-row-actions">
                        <span className="row adm-row-buttons">
                          <Button size="sm" aria-label={`Edit ${f.label}`} onClick={() => setEditing(f)}>Edit</Button>
                          <Button size="sm" variant="ghost" loading={busy === f.id} onClick={() => void setActive(f, !f.active)}>
                            {f.active ? 'Switch off' : 'Switch on'}
                          </Button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
      </Card>
      {editing && current && data && (
        <FieldDialog
          key={editing === 'new' ? 'new' : editing.id} field={editing === 'new' ? null : editing} recordType={current}
          types={data.types} recordTypes={types} nextPosition={(Math.max(0, ...fields.map((f) => f.position)) || 0) + 10}
          onClose={() => setEditing(null)}
          onSaved={(label, created) => {
            setEditing(null);
            toast.success(created ? `Field "${label}" added.` : `Field "${label}" saved.`);
            reload();
            meta.reload();
          }}
        />
      )}
    </>
  );
}

function FieldDialog({ field, recordType, types, recordTypes, nextPosition, onClose, onSaved }: {
  field: CustomField | null; recordType: { type: string; label: string; plural: string }; types: CustomType[];
  recordTypes: { type: string; label: string }[]; nextPosition: number; onClose: () => void; onSaved: (label: string, created: boolean) => void;
}) {
  const lists = useFetch<{ list_key: string; count: number }[]>(field ? null : '/api/lookups');
  const [label, setLabel] = useState(field?.label ?? '');
  const [key, setKey] = useState(field?.key ?? '');
  const [keyTouched, setKeyTouched] = useState(Boolean(field));
  const [type, setType] = useState<string>(field?.type ?? 'text');
  const [source, setSource] = useState<'new' | 'list'>('new');
  const [options, setOptions] = useState('');
  const [list, setList] = useState('');
  const [to, setTo] = useState(field?.ref_type ?? '');
  const [required, setRequired] = useState(field?.required ?? false);
  const [section, setSection] = useState(field?.section ?? '');
  const [help, setHelp] = useState(field?.help ?? '');
  const [position, setPosition] = useState<number | null>(field?.position ?? nextPosition);
  const [active, setActive] = useState(field?.active ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const draft = JSON.stringify([label, key, type, source, options, list, to, required, section, help, position, active]);
  const [start] = useState(draft);
  const shownKey = keyTouched ? key : slug(label);
  const clearError = (k: string) => setErrors(({ [k]: _gone, ...rest }) => rest);
  const optionLines = options.split('\n').map((s) => s.trim()).filter(Boolean);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Record<string, string> = {};
    if (!label.trim()) found.label = 'Enter a label.';
    if (!field) {
      if (!/^[a-z][a-z0-9_]{0,39}$/.test(shownKey)) found.key = 'Use lower-case letters, numbers and underscores, starting with a letter (at most 40).';
      if (isChoice(type) && source === 'new' && optionLines.length === 0) found.options = 'Add at least one option, one to a line.';
      if (isChoice(type) && source === 'list' && !list) found.list = 'Choose a list.';
      if (type === 'ref' && !to) found.to = 'Choose the record type to link to.';
    }
    if (position !== null && !Number.isInteger(position)) found.position = 'Use a whole number.';
    setErrors(found);
    setFormError('');
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      if (field) {
        await adminApi.patch(`/api/admin/custom-fields/${field.id}`, {
          label: label.trim(), required, section: section.trim(), help: help.trim(), position: position ?? 0, active,
          ...(isChoice(field.type) && optionLines.length ? { options: optionLines } : {}),
        });
        onSaved(label.trim(), false);
      } else {
        await adminApi.post('/api/admin/custom-fields', {
          record_type: recordType.type, label: label.trim(), key: shownKey, type, required, section: section.trim(), help: help.trim(),
          position: position ?? 0,
          ...(isChoice(type) ? (source === 'list' ? { list } : { options: optionLines }) : {}),
          ...(type === 'ref' ? { to } : {}),
        });
        onSaved(label.trim(), true);
      }
    } catch (err) {
      const fields = err instanceof ApiError ? err.fields : {};
      setErrors(fields);
      // A problem with the record type itself has no field in this dialog.
      const unplaced = Object.entries(fields).filter(([k]) => !['label', 'key', 'type', 'options', 'list', 'to', 'position'].includes(k)).map(([, m]) => m);
      if (Object.keys(fields).length === 0) setFormError(errorMessage(err));
      else if (unplaced.length) setFormError(unplaced.join(' '));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={field ? `Edit "${field.label}"` : `Add a field to ${recordType.plural.toLowerCase()}`} onClose={onClose} dirty={draft !== start}>
      <form className="form" onSubmit={submit} noValidate>
        {formError && <p className="form-error" role="alert">{formError}</p>}
        <div className="form-grid">
          <TextField label="Label" required maxLength={80} value={label} onChange={(v) => { setLabel(v); clearError('label'); }} error={errors.label} hint="What people see beside the field." />
          <TextField
            label="Key" required={!field} disabled={Boolean(field)} maxLength={40} value={shownKey} error={errors.key}
            onChange={(v) => { setKey(v); setKeyTouched(true); clearError('key'); }}
            hint={field ? `Stored as ${field.name}. The key cannot be changed.` : `Made from the label. In the API and exports the field is cf_${shownKey || '…'}.`}
          />
          <Select
            label="Type" required disabled={Boolean(field)} value={type} onChange={(v) => { setType(v || 'text'); clearError('type'); }} error={errors.type}
            options={types.map((t) => ({ value: t, label: TYPE_NAMES[t] ?? humanize(t) }))}
            hint={field ? 'The type cannot be changed. Add a new field instead.' : TYPE_HINTS[type as CustomType]}
          />
          {type === 'ref' && (
            <Select
              label="Links to" required disabled={Boolean(field)} searchable value={to} onChange={(v) => { setTo(v); clearError('to'); }} error={errors.to}
              options={recordTypes.map((t) => ({ value: t.type, label: t.label }))}
            />
          )}
        </div>

        {isChoice(type) && !field && (
          <fieldset className="adm-fieldset">
            <legend className="field-label">Options</legend>
            <SegmentedControl
              aria-label="Where the options come from" value={source} onChange={(v) => setSource(v as 'new' | 'list')}
              data={[{ value: 'new', label: 'New options' }, { value: 'list', label: 'An existing list' }]}
            />
            {source === 'new' ? (
              <TextArea
                label="Options" hideLabel rows={4} value={options} onChange={(v) => { setOptions(v); clearError('options'); }} error={errors.options}
                placeholder={'One option to a line, for example:\nLow\nMedium\nHigh'}
                hint="A new list is made for this field. Colors, order and retiring options are changed under Lists afterwards."
              />
            ) : lists.error ? <ErrorState error={lists.error} onRetry={lists.reload} /> : (
              <Select
                label="List" hideLabel searchable placeholder={lists.data ? 'Choose a list' : 'Loading lists…'} value={list}
                onChange={(v) => { setList(v); clearError('list'); }} error={errors.list}
                options={(lists.data ?? []).map((l) => ({ value: l.list_key, label: `${humanize(l.list_key)} (${l.count})` }))}
                hint="The field offers the values of this list, as other fields using it do."
              />
            )}
          </fieldset>
        )}
        {field && isChoice(field.type) && field.list_key && (
          <TextArea
            label="Add options" rows={3} value={options} onChange={(v) => { setOptions(v); clearError('options'); }} error={errors.options}
            placeholder="One new option to a line"
            hint={`Optional. New options are added to the list “${humanize(field.list_key)}”. Existing ones are renamed or retired under Lists.`}
          />
        )}

        <div className="form-grid">
          <TextField label="Section" maxLength={80} value={section} onChange={setSection} hint="Optional heading the field is grouped under on forms." />
          <NumberField label="Position" step={1} value={position} onChange={(v) => { setPosition(v); clearError('position'); }} error={errors.position} hint="Lower numbers come first among custom fields." />
          <TextArea className="form-cell-wide" label="Help" rows={2} maxRows={6} value={help} onChange={setHelp} hint="Optional. Shown under the field to explain what to enter. Up to 500 characters." />
        </div>
        <Checkbox label="Required" checked={required} onChange={setRequired} hint="People must fill it in when they add or change a record. Work the application does by itself is not held up." />
        {field && (
          <Switch label="In use" checked={active} onChange={setActive} />
        )}
        {field && !active && field.active && <p className="field-hint">Switching off hides the field everywhere. The values already entered are kept and come back if you switch it on again.</p>}
        <div className="form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" loading={busy}>{field ? 'Save changes' : 'Add field'}</Button>
        </div>
      </form>
    </Modal>
  );
}
