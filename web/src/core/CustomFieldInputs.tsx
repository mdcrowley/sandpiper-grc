// An administrator's custom fields for a hand-written form (E18-34). ResourceForm and RecordPage show
// custom fields by themselves; a form that keeps its own state (a wizard, a quick dialog) adds them
// with this hook:
//
//   const custom = useCustomFieldInputs('ticket');            // { initial: row } when editing
//   ...
//   {custom.inputs}                                            // the controls, grouped by section
//   ...
//   const extra = custom.collect();                            // null: a required one is empty (shown)
//   if (!extra) return;
//   await api.post('/api/tickets', { ...body, ...extra });     // or api.patch(..., { ...patch, ...extra })
//   ...
//   } catch (err) { if (err instanceof ApiError) custom.showErrors(err.fields); }
import { useMemo, useState, type ReactNode } from 'react';
import type { Row } from './api';
import { FieldControl, isMissing, toApiValue, toFormValue } from './FieldControl';
import { customFieldNames, useResource, type FieldMeta } from './meta';
import './records.css';

export interface CustomFieldInputsOptions {
  /** The record being edited: its values start the controls, and `collect` returns only what changed. */
  initial?: Row;
  /** Only these custom fields (names `cf_<key>`). Default: every active one. */
  only?: string[];
  /** Heading for fields without a section of their own. Default "More details". */
  defaultSection?: string;
  /** Leave out the section headings (for a form that already sits under one). */
  flat?: boolean;
}

export interface CustomFieldInputs {
  /** The custom fields shown, in order (empty when the type has none). */
  names: string[];
  /** The controls, laid out like ResourceForm's; null when there are no custom fields. */
  inputs: ReactNode;
  /** Current values, as the controls hold them. */
  values: Record<string, unknown>;
  /** Whether anything was changed. */
  dirty: boolean;
  /**
   * The values to send, keyed by field name. Creating: every filled field. Editing (`initial`
   * given): only the changed ones. Returns null, and shows the messages, when a required field is
   * empty.
   */
  collect: () => Record<string, unknown> | null;
  /** Shows the server's field messages that belong to custom fields; true when any did. */
  showErrors: (fields: Record<string, string> | undefined) => boolean;
  /** Back to the starting values. */
  reset: () => void;
}

const WIDE = ['longtext', 'json'];

/** Custom fields for a hand-written create or edit form. */
export function useCustomFieldInputs(type: string, options: CustomFieldInputsOptions = {}): CustomFieldInputs {
  const resource = useResource(type);
  const { initial, only, defaultSection = 'More details', flat = false } = options;
  const names = useMemo(
    () => customFieldNames(resource).filter((f) => !only || only.includes(f)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resource, (only ?? []).join('|')],
  );
  const metaOf = (f: string): FieldMeta => resource!.fields[f];
  const start = useMemo(
    () => Object.fromEntries(names.map((f) => [f, toFormValue(metaOf(f), initial?.[f])])),
    // The starting values are fixed when the form opens (or when the field list changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [names.join('|')],
  );
  const [values, setValues] = useState<Record<string, unknown>>(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Fields added after the first render (metadata reloaded) get their starting value.
  const current = useMemo(() => ({ ...start, ...values }), [start, values]);

  const set = (field: string, value: unknown) => {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors(({ [field]: _gone, ...rest }) => rest);
  };

  const collect = () => {
    const found: Record<string, string> = {};
    const out: Record<string, unknown> = {};
    for (const f of names) {
      const meta = metaOf(f);
      if (meta.readOnly) continue;
      let value: unknown;
      try {
        value = toApiValue(meta, current[f]);
      } catch {
        found[f] = `${meta.label} must be valid JSON.`;
        continue;
      }
      if (isMissing(meta, value)) found[f] = `${meta.label} is required.`;
      else if (initial) {
        if (JSON.stringify(value) !== JSON.stringify(toApiValue(meta, toFormValue(meta, initial[f])))) out[f] = value;
      } else if (value !== null && value !== undefined) out[f] = value;
    }
    setErrors(found);
    return Object.keys(found).length ? null : out;
  };

  const showErrors = (fields: Record<string, string> | undefined) => {
    const mine = Object.fromEntries(Object.entries(fields ?? {}).filter(([f]) => names.includes(f)));
    setErrors(mine);
    return Object.keys(mine).length > 0;
  };

  const grid = (list: string[]) => (
    <div className="rc-form-grid">
      {list.map((f) => {
        const meta = metaOf(f);
        return (
          <div
            key={f}
            className={`rc-form-cell${WIDE.includes(meta.type) ? ' rc-form-cell-wide' : ''}${meta.type === 'boolean' ? ' rc-form-cell-check' : ''}`}
            data-field={f}
            data-invalid-field={errors[f] ? 'true' : undefined}
          >
            <FieldControl
              meta={meta} value={current[f]} onChange={(v) => set(f, v)} error={errors[f]}
              display={(initial?._display as Record<string, string> | undefined)?.[f]}
            />
          </div>
        );
      })}
    </div>
  );

  let inputs: ReactNode = null;
  if (resource && names.length) {
    if (flat) inputs = grid(names);
    else {
      const bySection = new Map<string, string[]>();
      for (const f of names) {
        const title = metaOf(f).section || defaultSection;
        bySection.set(title, [...(bySection.get(title) ?? []), f]);
      }
      inputs = (
        <div className="rc-custom-inputs">
          {[...bySection].map(([title, list]) => (
            <fieldset key={title} className="rc-form-section">
              <legend className="rc-form-legend">{title}</legend>
              {grid(list)}
            </fieldset>
          ))}
        </div>
      );
    }
  }

  return {
    names, inputs, values: current, dirty: JSON.stringify(current) !== JSON.stringify(start),
    collect, showErrors, reset: () => { setValues(start); setErrors({}); },
  };
}
