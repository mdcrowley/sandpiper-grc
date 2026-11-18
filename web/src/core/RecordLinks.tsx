// Related records of one record, grouped by type, with an add dialog and remove.
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ActionIcon, Badge, Button, Text, Tooltip } from '@mantine/core';
import { IconLink, IconTrash } from '@tabler/icons-react';
import { api, errorMessage } from './api';
import { useAuth } from './auth';
import { LookupSelect, RecordPicker, Select, TextField } from './fields';
import { useFetch, type FetchState } from './hooks';
import { recordHref, useMeta } from './meta';
import { ConfirmDialog, Modal, useToast } from './overlay';
import { recordQuery, type PanelProps } from './RecordHistory';
import { EmptyState, ErrorState, Loading } from './ui';
import './records.css';

export interface RecordLink {
  id: string;
  relation: string;
  direction: 'out' | 'in';
  type: string;
  typeLabel: string;
  recordId: string;
  label: string;
  ref: string | null;
  route: string;
}

export interface LinksPanelProps extends PanelProps {
  /** Defaults to whether the user holds `<module>.edit` for this record type. */
  editable?: boolean;
  /** Links already being loaded by the page (RecordPage shares its request). */
  linksState?: FetchState<RecordLink[]>;
}

/** Related records grouped by type, with add (record picker + relation) and remove. */
export function LinksPanel({ type, id, editable, linksState }: LinksPanelProps) {
  const { resources, lookups } = useMeta();
  const { can } = useAuth();
  const toast = useToast();
  const own = useFetch<RecordLink[]>(linksState ? null : `/api/links${recordQuery(type, id)}`);
  const { data, error, reload } = linksState ?? own;
  const [adding, setAdding] = useState(false);
  const [toType, setToType] = useState('');
  const [toId, setToId] = useState<string | null>(null);
  const [relation, setRelation] = useState('related to');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<RecordLink | null>(null);

  const resource = resources[type];
  const canEdit = editable ?? (resource ? can(`${resource.module}.edit`) : false);
  const typeOptions = Object.values(resources)
    .filter((r) => can(`${r.module}.view`))
    .map((r) => ({ value: r.type, label: r.label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!toType || !toId || !relation.trim()) return;
    setBusy(true);
    try {
      await api.post('/api/links', { from_type: type, from_id: id, to_type: toType, to_id: toId, relation: relation.trim() });
      setToId(null);
      setAdding(false);
      toast.success('Link added.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await api.del(`/api/links/${removing.id}`);
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  const groups = new Map<string, RecordLink[]>();
  for (const link of data ?? []) groups.set(link.typeLabel, [...(groups.get(link.typeLabel) ?? []), link]);
  const addButton = canEdit && (
    <Button variant="default" size="xs" leftSection={<IconLink size={14} aria-hidden="true" />} onClick={() => setAdding(true)}>Add link</Button>
  );

  return (
    <div className="rc-links">
      {error ? (
        <ErrorState title="Related records could not be loaded" error={error} onRetry={reload} />
      ) : !data ? (
        <Loading label="Loading related records" />
      ) : data.length === 0 ? (
        <EmptyState icon="link" title="No related records"
          message={canEdit ? 'Link this record to tickets, systems, risks and other records it relates to.' : undefined}
          action={addButton || undefined} />
      ) : (
        <>
          <div className="rc-links-bar">
            <Text size="sm" c="dimmed">{data.length} related {data.length === 1 ? 'record' : 'records'}</Text>
            {addButton}
          </div>
          {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([typeLabel, links]) => (
            <section key={typeLabel} className="rc-links-group" aria-label={typeLabel}>
              <h3 className="rc-links-heading">{typeLabel} <Badge size="sm" variant="light" color="gray" circle>{links.length}</Badge></h3>
              <ul className="rc-links-list">
                {links.map((link) => (
                  <li key={link.id}>
                    <Link className="rc-links-target" to={recordHref(link.route, link.recordId)}>
                      {link.ref && <span className="rc-ref">{link.ref}</span>}
                      <span className="rc-truncate">{link.label}</span>
                    </Link>
                    <Tooltip label={link.direction === 'in' ? 'Linked from that record' : 'Linked from this record'}>
                      <Badge size="sm" variant="outline" color="gray" className="rc-links-relation">
                        {link.direction === 'in' ? `← ${link.relation}` : link.relation}
                      </Badge>
                    </Tooltip>
                    {canEdit && (
                      <ActionIcon variant="subtle" color="gray" size="sm" aria-label={`Remove link to ${link.label}`} onClick={() => setRemoving(link)}>
                        <IconTrash size={15} />
                      </ActionIcon>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      <Modal open={adding} title="Add a related record" size="md" onClose={() => setAdding(false)}>
        <form className="rc-form" onSubmit={add}>
          <div className="rc-form-grid">
            <div className="rc-form-cell">
              <Select label="Record type" required options={typeOptions} value={toType} onChange={(v) => { setToType(v); setToId(null); }} />
            </div>
            <div className="rc-form-cell">
              {lookups.link_relation
                ? <LookupSelect label="Relation" required list="link_relation" value={relation} onChange={setRelation} />
                : <TextField label="Relation" required value={relation} onChange={setRelation} maxLength={60} hint="For example: related to, caused by, blocks" />}
            </div>
            <div className="rc-form-cell rc-form-cell-wide">
              <RecordPicker key={toType} label="Record" required type={toType} disabled={!toType} value={toId} onChange={setToId}
                placeholder={toType ? 'Type a reference or title' : 'Choose a record type first'} />
            </div>
          </div>
          <div className="rc-form-actions">
            <Button variant="default" onClick={() => setAdding(false)}>Cancel</Button>
            <Button type="submit" loading={busy && !removing} disabled={!toType || !toId || !relation.trim()}>Add link</Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={removing !== null}
        title="Remove link"
        message={`Remove the link to "${removing?.label}"? The record itself is not deleted.`}
        confirmLabel="Remove link"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
