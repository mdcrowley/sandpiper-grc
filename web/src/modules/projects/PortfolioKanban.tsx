import { Link } from 'react-router-dom';
import { Badge, formatCurrency, formatDate, LookupChip, toColorName } from '../../core';
import { RagWithTrend, TierChip } from './bits';
import type { Portfolio } from './types';

/** One column per stage. Cards are not dragged: a project moves only when its gate is approved. */
export function PortfolioKanban({ data }: { data: Portfolio }) {
  const rows = data.register.filter((p) => p.status !== 'cancelled');
  return (
    <div className="stack">
      <p className="muted">A project moves to the next column when its gate is approved. Cancelled projects are not shown.</p>
      <div className="prj-kanban">
        {data.funnel.map((stage) => {
          const cards = rows.filter((p) => p.stage === stage.stage);
          const overLimit = stage.stage === data.wip.stage && data.wip.exceeded;
          return (
            <section key={stage.stage} className="prj-column" aria-label={`${stage.label}: ${cards.length} projects`}>
              <h2 className="prj-column-head">
                <span>{stage.label}</span>
                <Badge color={overLimit ? 'red' : toColorName(stage.color)}>
                  {cards.length}{stage.stage === data.wip.stage ? ` / limit ${data.wip.limit}` : ''}
                </Badge>
              </h2>
              {cards.length === 0 ? <p className="prj-column-empty">Nothing at this stage.</p> : (
                <ul className="prj-cards">
                  {cards.map((p) => (
                    <li key={p.id}>
                      <Link to={`/projects/${p.id}`} className={`prj-kcard${p.status !== 'active' ? ' prj-kcard-held' : ''}`}>
                        <span><span className="ref">{p.ref}</span></span>
                        <span className="prj-kcard-title">{p.name}</span>
                        <span className="row">
                          <TierChip tier={p.tier} />
                          {p.status !== 'active' && <LookupChip list="project_status" value={p.status} />}
                          <RagWithTrend value={p.rag_overall} trend={p.rag_trend} />
                        </span>
                        {p.gate && (
                          <span className="muted">
                            {p.gate.name} gate: {p.gate.checked} of {p.gate.total}
                            {p.gate.ready ? ', ready for a decision' : ''}
                          </span>
                        )}
                        <span className="muted">
                          {p.budget !== null ? formatCurrency(p.budget) : 'No budget'}
                          {p.target_on ? ` · target ${formatDate(p.target_on)}` : ''}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
