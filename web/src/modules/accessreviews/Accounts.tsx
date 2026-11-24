// The register of accounts on each system (E41-02): the list with its flags, the import of one
// system's own account file, matching holders to the staff roster again, and one account's page.
import { useState } from 'react';
import { api, Button, errorMessage, LookupChip, PageHeader, RecordPage, ResourceList, useAuth, useToast } from '../../core';
import type { Row } from '../../core';
import { AccessTabs, ImportDialog } from './shared';

export const ACCOUNT_FIELDS = ['system_id', 'account_name', 'display_name', 'email', 'employee_number', 'holder_person_id', 'account_kind', 'role_on_system', 'privileged', 'status', 'last_seen_on', 'notes'];

export function AttentionChip({ value }: { value: unknown }) {
  return value ? <LookupChip list="system_account_attention" value={String(value)} /> : null;
}

/** The accounts list, for one system (its page's tab) or every system. */
export function AccountsList({ systemId, title }: { systemId?: string; title?: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const reload = () => window.dispatchEvent(new CustomEvent('grc:list-changed'));
  const rematch = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ changed: number }>('/api/system-accounts/rematch', systemId ? { system_id: systemId } : {});
      toast.success(res.changed ? `${res.changed} account${res.changed === 1 ? '' : 's'} matched or flagged differently.` : 'Every account was already up to date.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const actions = can('systems.edit') ? (
    <>
      <Button icon="upload" onClick={() => setImporting(true)}>Import a system's file</Button>
      <Button variant="ghost" icon="refresh" loading={busy} onClick={rematch}>Match holders again</Button>
    </>
  ) : undefined;
  return (
    <>
      <ResourceList
        type="system_account"
        title={title}
        urlState={!systemId}
        baseFilter={systemId ? { system_id: systemId } : undefined}
        columns={[
          'ref', 'account_name', ...(systemId ? [] : [{ field: 'system_id', priority: 1 as const }]),
          { field: 'attention', priority: 1, render: (r: Row) => <AttentionChip value={r.attention} /> },
          'holder_person_id', 'display_name', 'role_on_system', 'privileged', 'account_kind', 'status', 'last_seen_on',
          { field: 'match_method', hidden: true }, { field: 'source', hidden: true }, { field: 'removed_on', hidden: true },
        ]}
        filters={['attention', 'status', 'account_kind', 'privileged', ...(systemId ? [] : ['system_id']), 'holder_person_id', 'last_seen_on', 'source']}
        createFields={systemId ? ACCOUNT_FIELDS.filter((f) => f !== 'system_id') : ACCOUNT_FIELDS}
        createInitial={systemId ? { system_id: systemId } : undefined}
        actions={actions}
      />
      <ImportDialog open={importing} onClose={() => setImporting(false)} onDone={reload} systemId={systemId} />
    </>
  );
}

export function AccountListPage() {
  return (
    <div className="stack">
      <PageHeader title="Accounts on systems"
        subtitle="Every account each system holds, with its holder on the staff roster. Active accounts of people who have left, are on leave or are not on the roster are flagged." />
      <AccessTabs active="accounts" />
      <AccountsList />
    </div>
  );
}

export function AccountDetail() {
  return (
    <RecordPage
      type="system_account"
      title={(row) => String(row.account_name ?? 'Account')}
      status={(row) => (
        <span className="row">
          {row.status && <LookupChip list="system_account_status" value={String(row.status)} />}
          <AttentionChip value={row.attention} />
        </span>
      )}
      summaryFields={[...ACCOUNT_FIELDS, 'match_method', 'attention', 'source', 'last_imported_at', 'removal_requested_on', 'removed_on']}
    />
  );
}
