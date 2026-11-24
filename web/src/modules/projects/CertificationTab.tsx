import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Group, List, SimpleGrid, Text } from '@mantine/core';
import {
  api, Badge, Button, Card, ConfirmDialog, EmptyState, errorMessage, ErrorState, formatDate, Icon, Loading, LookupChip, lookupLabel, Menu,
  Stat, TableWrap, useAuth, useFetch, useToast,
} from '../../core';
import { CertItemDialog, IssueDialog, RequirementDialog, WithdrawDialog } from './CertDialogs';
import { useGates } from './gatesContext';
import { todayIso, type Certification, type CertItem, type CertRequirement } from './types';

const CLOSED = ['verified', 'not_applicable'];

function Source({ r }: { r: CertRequirement }) {
  if (r.source) {
    const text = <>{r.source.ref && <span className="ref">{r.source.ref}</span>} {r.source.label}</>;
    return <div className="muted">{r.source.type === 'hazard' ? 'From hazard' : 'From threat'}: {r.source.route ? <Link to={r.source.route}>{text}</Link> : text}</div>;
  }
  return r.basis ? <div className="muted">Basis: {r.basis}</div> : null;
}

function Evidence({ r }: { r: CertRequirement }) {
  const parts = [
    r.evidence_ref,
    r.files ? `${r.files} ${r.files === 1 ? 'file' : 'files'}` : null,
  ].filter(Boolean);
  return (
    <>
      <div>{parts.length ? parts.join(' · ') : <span className="muted">None yet</span>}</div>
      {r.verified_on && <div className="muted">{r.status === 'verified' ? 'Verified' : 'Closed'} {formatDate(r.verified_on)}{r.verified_by_name ? ` by ${r.verified_by_name}` : ''}</div>}
    </>
  );
}

/** One certifiable item and its requirements. */
function ItemCard({ item, canEdit, sources, onChanged, onEdit, onRemove }: {
  item: CertItem; canEdit: boolean; sources: string[]; onChanged: () => void; onEdit: () => void; onRemove: () => void;
}) {
  const [dialog, setDialog] = useState<{ requirement: CertRequirement | null; verify: boolean } | null>(null);
  const today = todayIso();
  return (
    <Card
      flush
      title={(
        <span>
          <Link to={`/projects/certifiable-items/${item.id}`}><span className="ref">{item.ref}</span> {item.name}</Link>
        </span>
      )}
      actions={(
        <Group gap={6} wrap="nowrap">
          <LookupChip list="cert_item_status" value={item.status} />
          <Badge color={item.required ? 'purple' : 'gray'}>{item.required ? 'Required' : 'Not required'}</Badge>
          {canEdit && (
            <Menu
              label={`Actions for ${item.name}`} icon="more" iconOnly variant="ghost" size="sm" align="end"
              items={[
                { label: 'Add requirement', icon: 'plus', onSelect: () => setDialog({ requirement: null, verify: false }) },
                { label: 'Edit item', icon: 'edit', onSelect: onEdit },
                { label: 'Delete item', icon: 'trash', danger: true, separated: true, onSelect: onRemove },
              ]}
            />
          )}
        </Group>
      )}
    >
      {item.description && <Text size="sm" c="dimmed" px="md" pt="sm" className="prose">{item.description}</Text>}
      {item.requirements.length === 0 ? (
        <EmptyState
          icon="shield"
          title="No requirements yet"
          message="Add the requirements this item must meet, each derived from a hazard, a threat or another basis. The item stays open until it has some and every one is verified."
          action={canEdit ? <Button icon="plus" onClick={() => setDialog({ requirement: null, verify: false })}>Add requirement</Button> : undefined}
        />
      ) : (
        <TableWrap label={`Requirements of ${item.name}`} className="prj-scroll">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Requirement</th><th scope="col">Method</th><th scope="col">Verifier</th>
                <th scope="col">Due</th><th scope="col">Evidence</th><th scope="col">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {item.requirements.map((r, n) => {
                if (!r.visible) {
                  return (
                    <tr key={`hidden-${n}`}>
                      <td colSpan={5}><span className="muted"><Icon name="lock" size={13} /> A restricted requirement: you may not see its details.</span></td>
                      <td><LookupChip list="cert_requirement_status" value={r.status} /></td>
                      <td />
                    </tr>
                  );
                }
                const overdue = r.due_on && r.due_on < today && !CLOSED.includes(r.status);
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="prj-cert-req">
                        <Link to={`/projects/certification-requirements/${r.id}`}><span className="ref">{r.ref}</span> {r.title}</Link>
                        {r.restricted && <> <Badge color="red">Restricted</Badge></>}
                      </div>
                      <Source r={r} />
                    </td>
                    <td>{r.verification_method ? lookupLabel('cert_verification_method', r.verification_method) : '—'}</td>
                    <td>{r.owner_name ?? '—'}</td>
                    <td>{r.due_on ? <>{formatDate(r.due_on)}{overdue && <span className="prj-over"> overdue</span>}</> : '—'}</td>
                    <td><Evidence r={r} /></td>
                    <td><LookupChip list="cert_requirement_status" value={r.status} /></td>
                    <td>
                      {canEdit && (
                        <Menu
                          label={`Actions for ${r.title}`} icon="more" iconOnly variant="ghost" size="sm" align="end"
                          items={[
                            ...(r.status !== 'verified' ? [{ label: 'Record verification', icon: 'check' as const, onSelect: () => setDialog({ requirement: r, verify: true }) }] : []),
                            { label: 'Edit', icon: 'edit', onSelect: () => setDialog({ requirement: r, verify: false }) },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      <RequirementDialog
        itemId={item.id} requirement={dialog?.requirement ?? null} verify={dialog?.verify} sources={sources}
        open={Boolean(dialog)} onClose={() => setDialog(null)} onSaved={onChanged}
      />
    </Card>
  );
}

/** The certificate in force, or what stands between the project and one. */
function CertificateBanner({ data, projectId, onIssue, onWithdraw }: { data: Certification; projectId: string; onIssue: () => void; onWithdraw: () => void }) {
  const { can } = useAuth();
  const cert = data.certificate;
  if (cert) {
    return (
      <Alert role="status" color="green" variant="light" icon={<Icon name="check-circle" />} title="Certificate of readiness in force">
        <Text size="sm">
          Certifies as ready: <strong>{cert.scope}</strong>. Issued {formatDate(cert.issued_on)} by {cert.issued_by_name}{cert.issued_by_role ? `, ${cert.issued_by_role}` : ''}.
          {cert.open_items.length > 0 && ` Open items accepted: ${cert.open_items.length}.`}
        </Text>
        <Group gap="xs" mt="xs">
          <a className="btn btn-secondary btn-sm" href={`/api/projects/${projectId}/certificates/${cert.id}/pdf`} download>Download the certificate (PDF)</a>
          {can('projects.approve') && <Button size="sm" variant="ghost" icon="x" onClick={onWithdraw}>Withdraw</Button>}
        </Group>
      </Alert>
    );
  }
  if (data.blockers.length) {
    return (
      <Alert role="status" color="amber" variant="light" icon={<Icon name="lock" />}
        title={`The certificate cannot be issued yet: ${data.blockers.length} required ${data.blockers.length === 1 ? 'item is' : 'items are'} open`}>
        <List spacing={2} size="sm">
          {data.blockers.slice(0, 6).map((b) => (
            <List.Item key={b.id}>
              <span className="ref">{b.ref}</span> {b.name}: {b.requirements_total === 0 ? 'no requirements yet' : `${b.requirements_open} of ${b.requirements_total} requirements open`}
            </List.Item>
          ))}
        </List>
        {data.blockers.length > 6 && <Text size="sm">And {data.blockers.length - 6} more.</Text>}
        <Text size="sm" mt="xs">Verify each requirement, or mark it not applicable with a reason.</Text>
      </Alert>
    );
  }
  return (
    <Alert role="status" color="blue" variant="light" icon={<Icon name="shield" />} title="Ready for the certificate of readiness">
      <Text size="sm">
        Every required item is verified.{data.open_items.length > 0 && ` ${data.open_items.length} ${data.open_items.length === 1 ? 'item that is not required is' : 'items that are not required are'} still open; the certificate lists them.`}
        {!can('projects.approve') && ' Someone who may approve projects issues it.'}
      </Text>
      {data.can_issue && <Group mt="xs"><Button variant="primary" icon="check-square" onClick={onIssue}>Issue the certificate</Button></Group>}
    </Alert>
  );
}

function History({ data, projectId }: { data: Certification; projectId: string }) {
  if (!data.history.length) return null;
  return (
    <Card title="Certificates" flush>
      <TableWrap label="Certificates of readiness" className="prj-scroll">
        <table className="table">
          <thead>
            <tr><th scope="col">Issued</th><th scope="col">Certifies as ready</th><th scope="col">Open items</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Download</span></th></tr>
          </thead>
          <tbody>
            {data.history.map((c) => (
              <tr key={c.id}>
                <td>{formatDate(c.issued_on)}<div className="muted">{c.issued_by_name}{c.issued_by_role ? `, ${c.issued_by_role}` : ''}</div></td>
                <td>{c.scope}{c.conditions && <div className="muted prose">Conditions: {c.conditions}</div>}</td>
                <td>{c.open_items.length || 'None'}</td>
                <td>
                  <Badge color={c.status === 'issued' ? 'green' : 'gray'}>{c.status === 'issued' ? 'In force' : 'Withdrawn'}</Badge>
                  {c.status === 'withdrawn' && <div className="muted">{c.withdrawn_at ? formatDate(c.withdrawn_at) : ''}{c.withdrawn_by_name ? ` by ${c.withdrawn_by_name}` : ''}{c.withdraw_reason ? `: ${c.withdraw_reason}` : ''}</div>}
                </td>
                <td><a href={`/api/projects/${projectId}/certificates/${c.id}/pdf`} download aria-label={`Download the certificate issued ${formatDate(c.issued_on)} (PDF)`}>PDF</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

/** E41-08: the project's safety and security certification. */
export function CertificationTab({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const { reload: reloadGates } = useGates();
  const { data, error, reload } = useFetch<Certification>(`/api/projects/${projectId}/certification`);
  const [editing, setEditing] = useState<CertItem | null>(null);
  const [itemOpen, setItemOpen] = useState(false);
  const [removing, setRemoving] = useState<CertItem | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [busy, setBusy] = useState(false);
  const canEdit = can('projects.edit');
  const refresh = () => { reload(); reloadGates(); onChanged(); };

  if (error) return <ErrorState title="The certification could not be loaded" error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const add = canEdit ? <Button variant="primary" icon="plus" onClick={() => { setEditing(null); setItemOpen(true); }}>Add certifiable item</Button> : undefined;
  const sm = data.summary;

  const remove = async () => {
    setBusy(true);
    try {
      await api.del(`/api/certifiable-items/${removing!.id}`);
      toast.success('Item deleted, with its requirements.');
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
      setRemoving(null);
    }
  };

  return (
    <div className="stack">
      {data.items.length === 0 ? (
        <EmptyState
          icon="shield"
          title="Nothing to certify yet"
          message="Add the parts of this project that must be shown safe and secure before they are used, such as a vehicle type, a signal system or a station. Each gets requirements derived from hazards and threats, verified with evidence, and a certificate of readiness is issued when every required item is verified."
          action={add}
        />
      ) : (
        <>
          <CertificateBanner data={data} projectId={projectId} onIssue={() => setIssuing(true)} onWithdraw={() => setWithdrawing(true)} />
          <SimpleGrid cols={{ base: 2, md: 4 }} spacing="md">
            <Stat label="Certifiable items" value={sm.items} hint={`${sm.required_items} required`} icon="shield" />
            <Stat label="Required items open" value={sm.required_open} color={sm.required_open ? 'amber' : 'green'} icon="lock" />
            <Stat label="Requirements verified" value={`${sm.requirements_verified} of ${sm.requirements}`} hint={sm.requirements_not_applicable ? `${sm.requirements_not_applicable} not applicable` : undefined} icon="check" />
            <Stat label="Requirements open" value={sm.requirements_open} icon="clock" />
          </SimpleGrid>
          <Group justify="space-between" gap="sm">
            <Text size="sm" c="dimmed">
              {data.gates_requiring.length
                ? `Gates that need a certificate of readiness in force: ${data.gates_requiring.join(', ')}.`
                : 'No gate needs a certificate of readiness. An administrator can require one on a gate template (Project settings).'}
              {data.hidden > 0 && ` ${data.hidden} restricted ${data.hidden === 1 ? 'requirement is' : 'requirements are'} counted but not shown to you.`}
            </Text>
            {add}
          </Group>
          {data.items.map((item) => (
            <ItemCard
              key={item.id} item={item} canEdit={canEdit} sources={data.sources} onChanged={refresh}
              onEdit={() => { setEditing(item); setItemOpen(true); }} onRemove={() => setRemoving(item)}
            />
          ))}
        </>
      )}
      <History data={data} projectId={projectId} />

      <CertItemDialog projectId={projectId} item={editing} open={itemOpen} onClose={() => setItemOpen(false)} onSaved={refresh} />
      <IssueDialog data={data} projectId={projectId} open={issuing} onClose={() => setIssuing(false)} onDone={refresh} />
      {data.certificate && (
        <WithdrawDialog projectId={projectId} certificateId={data.certificate.id} open={withdrawing} onClose={() => setWithdrawing(false)} onDone={refresh} />
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        title="Delete this item?"
        message={`"${removing?.name ?? ''}" and its ${removing?.requirements_total ?? 0} requirements will be removed from the project. The deletion is recorded in the history.`}
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
