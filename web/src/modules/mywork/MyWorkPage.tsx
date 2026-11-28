// My work: one card per list of work waiting for the person, the same lists (and so the same counts)
// as the Overview's My work section, plus access reviews and the reports delivered to them. A list
// whose area is switched off, or that the person's role does not include, is left out. Everyone may
// report a safety hazard or ask for help here (Report a problem, wave 26), for the areas that are on.
import { useCallback, useMemo, useState } from 'react';
import { Icon, PageHeader, formatDateTime, moduleOn, modules, useAuth, useFetch, useMeta } from '../../core';
import { DueChip, WorkCard, WorkTally, type WorkItem } from '../home/parts';
import { SourcesProvider } from '../home/sources';
import type { WidgetCtx } from '../home/types';
import { MY_WORK_WIDGETS } from '../home/widgetsMyWork';
import { MyReports, ReportProblem, type ReportOptions } from './ReportProblem';
import '../home/home.css';
import './mywork.css';

const ROWS = 5;
// The Overview's lists shown here. Notifications stay on the bell.
const LISTS = ['my-tickets', 'my-actions', 'my-approvals', 'my-due-work', 'my-training', 'my-acknowledgments', 'my-certifications'];

interface MineReview { review_id: string; ref: string | null; title: string; due_on: string | null; system_id: string; system_name: string | null; signed_off_at: string | null; total: number; decided: number }

function MyAccessReviews() {
  const { data, error, reload } = useFetch<MineReview[]>('/api/access-reviews/mine');
  const open = data?.filter((r) => !r.signed_off_at);
  const items = open?.slice(0, ROWS).map((r): WorkItem => ({
    key: `${r.review_id}-${r.system_id}`, to: `/access-reviews/${r.review_id}/systems/${r.system_id}`,
    title: r.system_name ?? r.title, reference: r.ref, meta: <DueChip date={r.due_on} />,
  }));
  return (
    <WorkCard id="my-access-reviews" title="My access reviews" icon="key" to="/access-reviews/mine"
      items={items} count={open?.length} error={error} reload={reload} emptyText="No system is waiting for your review." />
  );
}

interface Delivered { id: string; title: string; created_at: string }

/** Reports delivered to the person. Something to read, not work to do: not counted as waiting. */
function DeliveredReports({ report }: { report: (id: string, n: number | null) => void }) {
  const { data, error, reload } = useFetch<Delivered[]>('/api/reports/snapshots');
  const items = data?.slice(0, ROWS).map((s): WorkItem => ({
    key: s.id, to: `/reports/snapshots/${s.id}`, title: s.title, meta: <span className="muted">{formatDateTime(s.created_at)}</span>,
  }));
  const quiet = useCallback((id: string, n: number | null) => report(id, n === null ? null : 0), [report]);
  return (
    <WorkTally.Provider value={quiet}>
      <WorkCard id="delivered-reports" title="Delivered to me" icon="bell" to="/reports/snapshots"
        items={items} count={data?.length} error={error} reload={reload} emptyText="Nothing has been delivered to you yet." />
    </WorkTally.Provider>
  );
}

export function MyWorkPage() {
  const { user, can, areaOn } = useAuth();
  const { resources } = useMeta();
  const has = useCallback((key: string) => modules.some((m) => m.key === key) && moduleOn(key, areaOn), [areaOn]);
  const ctx = useMemo<WidgetCtx>(() => ({
    userId: user?.id ?? '',
    can: (permission) => can(permission),
    sees: (type) => Boolean(resources[type]) && can(`${resources[type].module}.view`),
    hasModule: has,
  }), [user, can, resources, has]);

  const lists = MY_WORK_WIDGETS.filter((w) => LISTS.includes(w.id) && w.visible(ctx));
  const watching = MY_WORK_WIDGETS.find((w) => w.id === 'my-watching');
  const reviews = has('accessreviews') && can('systems.view');
  const delivered = has('reports');

  // What everyone may report here (null kinds are switched off), and a version to re-read My reports after sending.
  const reportOptions = useFetch<ReportOptions>(has('work') ? '/api/work/report/options' : null);
  const canReport = Boolean(reportOptions.data?.safety || reportOptions.data?.help);
  const [sentVersion, setSentVersion] = useState(0);

  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const report = useCallback((id: string, count: number | null) => {
    setCounts((prev) => (prev[id] === count || (count === null && !(id in prev)) ? prev : { ...prev, [id]: count }));
  }, []);
  const expected = [...lists.map((w) => w.id), ...(reviews ? ['my-access-reviews'] : [])];
  const known = expected.map((id) => counts[id]);
  const allCounted = expected.length > 0 && known.every((n) => typeof n === 'number');
  const waiting = known.reduce<number>((sum, n) => sum + (n ?? 0), 0);

  return (
    <div className="stack mywork">
      <PageHeader title="My work" subtitle="What is waiting for you, in one place. Each tab opens one list in full."
        actions={<ReportProblem options={reportOptions.data} onSent={() => setSentVersion((v) => v + 1)} />} />
      <p className="mywork-total" role="status">
        {allCounted
          ? waiting === 0
            ? <><Icon name="check-circle" size={18} /> <strong>You are up to date.</strong> Nothing is waiting for you.</>
            : <><strong>{waiting}</strong> {waiting === 1 ? 'item is' : 'items are'} waiting for you.</>
          : ' '}
      </p>
      <SourcesProvider ctx={ctx} needed={new Set()}>
        <WorkTally.Provider value={report}>
          <div className="home-work-grid">
            {lists.map((w) => <div key={w.id} className="home-cell" data-widget={w.id}>{w.render()}</div>)}
            {reviews && <div className="home-cell" data-widget="my-access-reviews"><MyAccessReviews /></div>}
            {delivered && <div className="home-cell" data-widget="delivered-reports"><DeliveredReports report={report} /></div>}
            {watching && <div className="home-cell" data-widget="my-watching">{watching.render()}</div>}
          </div>
        </WorkTally.Provider>
      </SourcesProvider>
      {canReport && <MyReports version={sentVersion} />}
    </div>
  );
}
