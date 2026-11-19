import { Link } from 'react-router-dom';
import { PageHeader } from '../../core';
import { ConnectAssistantCard } from './ConnectCard';

/** /account/ai-assistant: the "Connect an AI assistant" card on a page of its own. */
export function ConnectAssistantPage() {
  return (
    <div className="mcp-page">
      <PageHeader
        title="Connect an AI assistant"
        breadcrumbs={[{ label: 'Account security', to: '/account/security' }, { label: 'Connect an AI assistant' }]}
        subtitle="Use Sandpiper GRC from an AI assistant through the Model Context Protocol (MCP), with your own permissions."
      />
      <div className="mcp-layout">
        <ConnectAssistantCard />
        <aside className="mcp-aside stack">
          <section className="card card-body stack">
            <h2 className="mcp-aside-title">What an assistant can do</h2>
            <ul className="mcp-list">
              <li>Find and read records you can see: tickets, assets, changes, contracts, risks and more.</li>
              <li>Summarize your work, what is overdue, risks, framework progress, incidents and service levels.</li>
              <li>With a read-and-write connection, and if your administrator allows it: create and update records, comment and link.</li>
            </ul>
          </section>
          <section className="card card-body stack">
            <h2 className="mcp-aside-title">Keeping it safe</h2>
            <ul className="mcp-list">
              <li>It acts as you and never sees more than you do. Restricted records stay hidden unless you may see them.</li>
              <li>Nothing can be deleted through an assistant. Every change it makes is recorded in the history with the token&apos;s name.</li>
              <li>Read what the assistant proposes before you let it change anything. Disconnect it here when you stop using it.</li>
            </ul>
            <p className="muted">Your other API tokens are on <Link to="/account/security">Account security</Link>.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
