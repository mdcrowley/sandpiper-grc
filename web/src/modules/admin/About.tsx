// Administration > About (E42-06): the installed version, and whether a newer release exists. The
// update check asks the project's GitHub releases at most once a day, and only while it is on here,
// outbound connections are on and api.github.com is an allowed host (Administration > Settings).
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, Card, ErrorState, errorMessage, formatDate, formatDateTime, Loading, PageHeader, StatusChip, useFetch, useToast } from '../../core';
import { Notice } from './common';
import { Switch } from './Switch';

interface Release { version: string; url: string; publishedAt: string | null; name: string | null }
interface About {
  version: string;
  commit: string | null;
  node?: string;
  database?: 'embedded' | 'server';
  startedAt?: string;
  updateCheck: {
    enabled: boolean;
    blockedBy: null | 'outbound_off' | 'host_not_allowed';
    checking: boolean;
    checkedAt: string | null;
    error: string | null;
    latest: Release | null;
    newer: boolean;
    releasesPage: string;
  };
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="facts-item"><dt>{label}</dt><dd>{children}</dd></div>;
}

export function AboutPage() {
  const toast = useToast();
  const { data, error, reload } = useFetch<About>('/api/admin/about');
  const [saving, setSaving] = useState(false);
  // A check that is still running is shown when it finishes.
  const checking = Boolean(data?.updateCheck.checking);
  useEffect(() => {
    if (!checking) return undefined;
    const timer = window.setTimeout(reload, 3000);
    return () => window.clearTimeout(timer);
  }, [checking, reload, data]);

  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading version" />;
  const u = data.updateCheck;

  const toggle = async (on: boolean) => {
    setSaving(true);
    try {
      await api.patch('/api/admin/about', { updateCheck: on });
      toast.success(on ? 'The update check is on.' : 'The update check is off. Nothing is asked of GitHub.');
      reload();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  let result: ReactNode;
  if (!u.enabled) result = <span className="muted">Off.</span>;
  else if (u.blockedBy === 'outbound_off') {
    result = <span className="muted">Not checked: outbound connections are off (<Link to="/admin/settings#settings-integrations">Settings, Outbound connections</Link>).</span>;
  } else if (u.blockedBy === 'host_not_allowed') {
    result = <span className="muted">Not checked: add <code>api.github.com</code> to the allowed hosts (<Link to="/admin/settings#settings-integrations">Settings, Outbound connections</Link>).</span>;
  } else if (u.checking && !u.checkedAt) result = <span className="muted">Checking…</span>;
  else if (u.error) result = <span>The last check failed: {u.error} It is tried again a day later.</span>;
  else if (u.newer && u.latest) {
    result = (
      <span>
        <StatusChip color="blue" label="Update available" /> Version {u.latest.version}
        {u.latest.publishedAt ? `, released ${formatDate(u.latest.publishedAt)}` : ''}.{' '}
        <a href={u.latest.url} target="_blank" rel="noreferrer noopener">Release notes</a>
      </span>
    );
  } else if (u.latest) result = <span><StatusChip color="green" label="Up to date" /> Version {u.latest.version} is the newest release.</span>;
  else result = <span className="muted">Not checked yet.</span>;

  return (
    <>
      <PageHeader title="About" subtitle="The version installed here, and whether a newer release exists." />
      <div className="stack">
        <Card title="This installation">
          <dl className="facts facts-rows">
            <Fact label="Version">Sandpiper GRC {data.version}</Fact>
            <Fact label="Commit">{data.commit ? <code>{data.commit.slice(0, 12)}</code> : <span className="muted">Not known</span>}</Fact>
            {data.node && <Fact label="Node.js">{data.node}</Fact>}
            {data.database && <Fact label="Database">{data.database === 'server' ? 'PostgreSQL server' : 'Embedded (in the data folder)'}</Fact>}
            {data.startedAt && <Fact label="Server started">{formatDateTime(data.startedAt)}</Fact>}
          </dl>
        </Card>
        <Card title="Updates">
          <div className="stack">
            <Switch label="Check for new versions once a day" checked={u.enabled} disabled={saving} onChange={(v) => void toggle(v)} />
            <dl className="facts facts-rows">
              <Fact label="Newest release">{result}</Fact>
              {u.checkedAt && u.enabled && <Fact label="Last checked">{formatDateTime(u.checkedAt)}</Fact>}
            </dl>
            <Notice>
              The check asks the release list on GitHub for the newest version. It sends nothing about this installation,
              your organization or its people, and it never installs anything. It runs only while this switch is on, outbound connections are
              on and <code>api.github.com</code> is an allowed host. The result is shown here only. All releases:{' '}
              <a href={u.releasesPage} target="_blank" rel="noreferrer noopener">{u.releasesPage}</a>. How to upgrade is in the
              Help pages under Administration, &quot;Updating the server&quot;.
            </Notice>
          </div>
        </Card>
      </div>
    </>
  );
}
