// Administration > Features (E14-28): switch optional parts of the application on or off.
// A switched-off part disappears for everyone (menus, search, links, dashboards, imports, the API
// and AI assistants); its records are kept and come back when it is switched on again.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Card, ConfirmDialog, ErrorState, errorMessage, Loading, PageHeader, useAuth, useFetch, useToast,
} from '../../core';
import { Notice } from './common';
import { adminApi } from './reauth';
import { Switch } from './Switch';

interface Area {
  key: string; label: string; description: string; on: boolean; defaultOn: boolean;
  requires: string[]; requiredBy: string[];
}
interface FeaturesResponse { areas: Area[]; assistant: { enabled: boolean } }
interface Pending { area: Area; on: boolean; also: Area[] }

const names = (areas: Area[]) => {
  const l = areas.map((a) => a.label.toLowerCase());
  return l.length <= 1 ? l.join('') : `${l.slice(0, -1).join(', ')} and ${l[l.length - 1]}`;
};

export function FeaturesPage() {
  const toast = useToast();
  const auth = useAuth();
  const { data, error, reload } = useFetch<FeaturesResponse>('/api/admin/features');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading features" />;
  const byKey = new Map(data.areas.map((a) => [a.key, a]));

  /** Turning one area on or off, with what has to change with it so the switches stay consistent. */
  const ask = (area: Area, on: boolean) => {
    setFailure('');
    const also = on
      ? area.requires.map((k) => byKey.get(k)!).filter((a) => a && !a.on)
      : area.requiredBy.map((k) => byKey.get(k)!).filter((a) => a && a.on);
    setPending({ area, on, also });
  };

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    setFailure('');
    const features = Object.fromEntries([pending.area, ...pending.also].map((a) => [a.key, pending.on]));
    try {
      await adminApi.patch('/api/admin/features', { features });
      toast.success(`${[pending.area, ...pending.also].map((a) => a.label).join(', ')} switched ${pending.on ? 'on' : 'off'}.`);
      setPending(null);
      reload();
      await auth.refresh(); // the menu, pages and search follow at once
    } catch (err) {
      setFailure(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const offCount = data.areas.filter((a) => !a.on).length;

  return (
    <>
      <PageHeader
        title="Features"
        subtitle="Switch on the parts of the application your organization uses. A part that is off disappears for everyone; its records are kept."
      />
      <div className="stack adm-features">
        <Notice>
          A switched-off part is hidden everywhere: the menu, search, record links, the relationship map, dashboards and reports,
          imports and exports, webhooks, the API and AI assistants. Its reminders stop. Nothing is deleted, and switching it back
          on restores everything. Each change needs your password again and is recorded in the audit log.
        </Notice>
        <Card title="Parts of the application" actions={<span className="muted">{offCount ? `${offCount} of ${data.areas.length} switched off` : 'All switched on'}</span>}>
          <ul className="adm-feature-list" aria-label="Parts of the application">
            {data.areas.map((a) => (
              <li key={a.key} className="adm-feature">
                <div className="adm-feature-about">
                  <div className="adm-setting-title">
                    <span id={`feature-${a.key}`}>{a.label}</span>
                    <Badge color={a.on ? 'green' : 'gray'}>{a.on ? 'On' : 'Off'}</Badge>
                  </div>
                  <p className="adm-setting-text">{a.description}</p>
                  {(a.requires.length > 0 || a.requiredBy.length > 0) && (
                    <p className="adm-feature-deps">
                      {a.requires.length > 0 && <>Needs {names(a.requires.map((k) => byKey.get(k)!).filter(Boolean))}. </>}
                      {a.requiredBy.length > 0 && <>Needed by {names(a.requiredBy.map((k) => byKey.get(k)!).filter(Boolean))}.</>}
                    </p>
                  )}
                </div>
                <div className="adm-feature-control">
                  <Switch label={`${a.label}: ${a.on ? 'on' : 'off'}`} hideLabel checked={a.on} onChange={(on) => ask(a, on)} />
                </div>
              </li>
            ))}
            <li className="adm-feature">
              <div className="adm-feature-about">
                <div className="adm-setting-title">
                  <span>AI assistant access</span>
                  <Badge color={data.assistant.enabled ? 'green' : 'gray'}>{data.assistant.enabled ? 'On' : 'Off'}</Badge>
                </div>
                <p className="adm-setting-text">
                  Lets AI assistants such as Claude use the application through the MCP endpoint, with their own tokens and rules.
                  It has its own page: <Link to="/admin/ai-assistants">AI assistant access</Link>.
                </p>
              </div>
            </li>
          </ul>
          <p className="muted adm-setting-note">
            Inventory, the action tracker, notifications, files, administration, the Overview and Help are always on.
            The audience roles (Requester, Approver, Executive viewer, Auditor) are switched on the <Link to="/admin/roles">Roles</Link> page.
          </p>
        </Card>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `Switch ${pending.area.label.toLowerCase()} ${pending.on ? 'on' : 'off'}?` : ''}
        confirmLabel={pending?.on ? 'Switch on' : 'Switch off'}
        danger={pending ? !pending.on : false}
        busy={busy}
        onCancel={() => { setPending(null); setFailure(''); }}
        onConfirm={() => void apply()}
        message={pending && (
          <div className="stack">
            {pending.on ? (
              <p>{pending.area.label} appears again for everyone whose role includes it, with all its records.</p>
            ) : (
              <p>
                {pending.area.label} disappears for everyone, administrators and API tokens included, and its reminders stop.
                Data is kept; turning it back on restores everything.
              </p>
            )}
            {pending.also.length > 0 && (
              <Notice tone="caution">
                {pending.on
                  ? <>{pending.area.label} needs {names(pending.also)}, which will be switched on too.</>
                  : <>{names(pending.also).replace(/^./, (c) => c.toUpperCase())} {pending.also.length > 1 ? 'need' : 'needs'} it, and will be switched off too.</>}
              </Notice>
            )}
            {failure && <p className="field-error" role="alert">{failure}</p>}
          </div>
        )}
      />
    </>
  );
}
