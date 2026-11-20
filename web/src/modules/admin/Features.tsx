// Administration > Features (E14-28): switch optional parts of the application on or off.
// A switched-off part disappears for everyone (menus, search, links, dashboards, imports, the API
// and AI assistants); its records are kept and come back when it is switched on again.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Badge, Button, Card, ConfirmDialog, ErrorState, errorMessage, Loading, PageHeader, TextField, useAuth, useFetch, useMeta, useToast,
} from '../../core';
import { Notice } from './common';
import { adminApi } from './reauth';
import { Switch } from './Switch';

interface Area {
  key: string; label: string; description: string; on: boolean; defaultOn: boolean;
  requires: string[]; requiredBy: string[];
}
/** An option within an area (E18-28): on or off, and a name the installation may change. */
interface AreaOption {
  key: string; area: string | null; group: string; label: string; description: string; on: boolean; defaultOn: boolean;
  name: string | null; defaultName: string | null; nameHint: string | null;
}
interface FeaturesResponse { areas: Area[]; options?: AreaOption[]; assistant: { enabled: boolean } }
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
        {data.options && data.options.length > 0 && <OptionsCard options={data.options} areas={byKey} onChanged={reload} />}
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

/**
 * Options within the parts of the application (E18-28): features that suit some transit organizations
 * but not all. An option that is off hides its fields everywhere and stops its rule; a renamed option
 * relabels its fields. Each change needs the password again and is recorded in the audit log.
 */
function OptionsCard({ options, areas, onChanged }: { options: AreaOption[]; areas: Map<string, Area>; onChanged: () => void }) {
  const toast = useToast();
  const meta = useMeta();
  const [names, setNames] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState<AreaOption | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const send = async (o: AreaOption, change: { on?: boolean; name?: string }, done: string) => {
    setBusy(o.key);
    setErrors((e) => ({ ...e, [o.key]: '' }));
    try {
      await adminApi.patch('/api/admin/features', { options: { [o.key]: change } });
      toast.success(done);
      setAsking(null);
      setNames((n) => { const next = { ...n }; delete next[o.key]; return next; });
      onChanged();
      meta.reload(); // forms, lists and record pages pick up the fields and their names at once
    } catch (err) {
      setErrors((e) => ({ ...e, [o.key]: errorMessage(err) }));
    } finally {
      setBusy(null);
    }
  };

  const groups = [...new Set(options.map((o) => o.group))];
  return (
    <Card title="Options within the parts">
      <p className="adm-setting-text adm-options-intro">
        Some features suit some transit organizations but not others: a public agency, a private operator, a contractor
        running service for an agency. Switch off what your organization does not use, and give the rest the name your
        organization uses. An option that is off disappears from forms, lists, exports, imports, reports, the API and AI
        assistants, and its rule stops; recorded values are kept.
      </p>
      {groups.map((g) => (
        <section key={g} className="adm-option-group" aria-label={g}>
          <h3 className="adm-option-group-title">{g}</h3>
          <ul className="adm-feature-list">
            {options.filter((o) => o.group === g).map((o) => {
              const area = o.area ? areas.get(o.area) : undefined;
              const areaOff = Boolean(area && !area.on);
              const typed = names[o.key] ?? o.name ?? '';
              const renamed = o.name !== null && typed.trim() !== (o.name ?? '');
              return (
                <li key={o.key} className="adm-feature">
                  <div className="adm-feature-about">
                    <div className="adm-setting-title">
                      <span>{o.label}</span>
                      <Badge color={o.on && !areaOff ? 'green' : 'gray'}>{areaOff ? `Off with ${area!.label.toLowerCase()}` : o.on ? 'On' : 'Off'}</Badge>
                    </div>
                    <p className="adm-setting-text">{o.description}</p>
                    {o.name !== null && o.on && (
                      <form
                        className="adm-option-name"
                        onSubmit={(e) => { e.preventDefault(); if (renamed) void send(o, { name: typed }, `${o.label}: name saved.`); }}
                      >
                        <TextField
                          label="Name shown on screens" value={typed} disabled={areaOff}
                          onChange={(v) => setNames((n) => ({ ...n, [o.key]: v }))}
                          hint={`${o.nameHint ?? ''} The default is "${o.defaultName}".`.trim()}
                        />
                        <div className="adm-option-name-actions">
                          <Button type="submit" disabled={!renamed || areaOff} loading={busy === o.key}>Save name</Button>
                          {o.name !== o.defaultName && (
                            <Button variant="ghost" disabled={areaOff || busy === o.key}
                              onClick={() => void send(o, { name: '' }, `${o.label}: default name restored.`)}>
                              Use the default
                            </Button>
                          )}
                        </div>
                      </form>
                    )}
                    {errors[o.key] && <p className="field-error" role="alert">{errors[o.key]}</p>}
                  </div>
                  <div className="adm-feature-control">
                    <Switch
                      label={`${o.label}: ${o.on ? 'on' : 'off'}`} hideLabel checked={o.on} disabled={areaOff || busy === o.key}
                      onChange={(on) => (on ? void send(o, { on: true }, `${o.label} switched on.`) : setAsking(o))}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <ConfirmDialog
        open={asking !== null}
        title={asking ? `Switch off "${asking.label.toLowerCase()}"?` : ''}
        confirmLabel="Switch off"
        danger
        busy={busy !== null}
        onCancel={() => setAsking(null)}
        onConfirm={() => asking && void send(asking, { on: false }, `${asking.label} switched off.`)}
        message={asking && (
          <div className="stack">
            <p>
              Its fields disappear for everyone and its rule stops applying. Values already recorded are kept, and switching it
              back on shows them again.
            </p>
            {errors[asking.key] && <p className="field-error" role="alert">{errors[asking.key]}</p>}
          </div>
        )}
      />
    </Card>
  );
}
