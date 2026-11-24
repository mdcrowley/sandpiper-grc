// What an outside reviewer sees (E41-09): a layout of its own, without the shell, its menus or the
// search, because their account reaches nothing else (the server answers 404 to everything but
// these pages and their own sign-in security). Their reviews, one review's requests, evidence and
// findings, and the account security page. App.tsx shows it for accounts holding the reviewer grant.
import { lazy, Suspense, type ComponentType } from 'react';
import { ActionIcon, Tooltip } from '@mantine/core';
import { Link, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import {
  Badge, Button, Card, DefinitionList, EmptyState, ErrorState, formatDate, formatDateTime, Icon, Loading, modules, PageHeader,
  useAuth, useFetch, useTheme,
} from '../../core';
import { Wordmark } from '../../core/Logo';
import { fileSize, STATE_COLOR, STATE_LABEL, type MyReviews, type ReviewFile, type Workspace } from './types';
import './outsidereviews.css';

const ACCOUNT_SECURITY_PATH = '/account/security';
// The account security page belongs to the admin module; `limited` keeps it to signing in (password, second
// factor, passkeys, sessions), since the rest of that page is out of a reviewer's reach.
const securityLoaders = import.meta.glob<{ AccountSecurityPage: ComponentType<{ limited?: boolean }> }>('../admin/AccountSecurity.tsx');
const loadSecurity = Object.values(securityLoaders)[0];
// Its styles come with the admin module's pages, which a reviewer never opens.
const loadSecurityStyles = Object.values(import.meta.glob('../admin/admin.css'))[0];
const AccountSecurity = loadSecurity
  ? lazy(() => Promise.all([loadSecurity(), loadSecurityStyles?.()]).then(([m]) => ({ default: m.AccountSecurityPage })))
  : null;

function FileList({ grantId, files, empty }: { grantId: string; files: ReviewFile[]; empty?: string }) {
  if (!files.length) return empty ? <p className="muted">{empty}</p> : null;
  return (
    <ul className="or-files">
      {files.map((f) => (
        <li key={f.id}>
          <Icon name={f.is_link ? 'link' : 'paperclip'} size={16} />
          {f.is_link && f.link_url
            ? <a href={f.link_url} target="_blank" rel="noopener noreferrer">{f.link_title ?? f.file_name}</a>
            : <a href={`/api/outside-review/${grantId}/files/${f.id}`} download>{f.file_name}</a>}
          <span className="muted or-small">
            {f.is_link ? 'A link to a document kept elsewhere' : fileSize(f.size_bytes)} · {formatDate(f.uploaded_at)}
            {!f.is_link && !f.scanned ? ' · Not checked for malware' : ''}
          </span>
          {f.description && <span className="or-file-note">{f.description}</span>}
        </li>
      ))}
    </ul>
  );
}

function ReviewList() {
  const { data, error, reload } = useFetch<MyReviews>('/api/outside-review');
  const header = <PageHeader title="Your reviews" subtitle="The audits and reviews you were invited to. Each is open to you until its end date." />;
  if (error) return <div className="stack">{header}<ErrorState error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={3} label="Loading your reviews" /></div>;
  const open = data.reviews.filter((r) => r.state === 'active');
  const ended = data.reviews.filter((r) => r.state !== 'active');
  return (
    <div className="stack">
      {header}
      {open.length === 0 ? (
        <EmptyState icon="clipboard" title="Nothing is open to you" message="Your access has ended, or nothing has been shared with you yet. Ask the person who invited you." />
      ) : (
        <div className="or-cards">
          {open.map((r) => (
            <Card key={r.id} title={[r.ref, r.title].filter(Boolean).join(' ')}>
              <p className="muted">{r.kind} · open to you until {formatDate(r.expires_on)}{r.days_left !== null ? ` (${r.days_left === 0 ? 'last day' : `${r.days_left} day${r.days_left === 1 ? '' : 's'} left`})` : ''}</p>
              <Link className="btn btn-primary" to={`/review/${r.id}`}>Open</Link>
            </Card>
          ))}
        </div>
      )}
      {ended.length > 0 && (
        <Card title="Ended">
          <ul className="or-ended">
            {ended.map((r) => (
              <li key={r.id}>{r.kind} {r.ref ?? ''} <Badge color={STATE_COLOR[r.state]}>{STATE_LABEL[r.state]}</Badge> <span className="muted">{formatDate(r.expires_on)}</span></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ReviewPage() {
  const { grantId } = useParams();
  const { data, error, reload } = useFetch<Workspace>(`/api/outside-review/${grantId}`);
  if (error) {
    return (
      <div className="stack">
        <PageHeader title="Review" breadcrumbs={[{ label: 'Your reviews', to: '/' }]} />
        <ErrorState title="This review is not open to you" error={error} onRetry={reload} />
      </div>
    );
  }
  if (!data) return <Loading lines={6} label="Loading the review" />;
  const { subject, grant } = data;
  return (
    <div className="stack">
      <PageHeader title={subject.title} reference={subject.ref ?? undefined} breadcrumbs={[{ label: 'Your reviews', to: '/' }]}
        subtitle={`${subject.kind} · open to you until ${formatDate(grant.expires_on)}${grant.days_left === 0 ? ' (last day)' : ` (${grant.days_left} day${grant.days_left === 1 ? '' : 's'} left)`}`} />
      <Card title="About">
        <DefinitionList items={subject.facts.map((f) => ({ label: f.label, value: f.value }))} />
        {subject.sections.map((s) => (
          <div key={s.label} className="or-section"><h3 className="or-h3">{s.label}</h3><p className="prose">{s.text}</p></div>
        ))}
      </Card>

      <Card title={`${data.labels.requests} (${data.requests.length})`}>
        {data.requests.length === 0 ? <p className="muted">No requests yet.</p> : (
          <div className="stack">
            {data.requests.map((r) => (
              <section key={r.id} className="or-item" aria-label={r.ref ?? r.request}>
                <p className="or-item-head">
                  {r.ref && <strong>{r.ref}</strong>}
                  <Badge color={r.status === 'accepted' ? 'green' : r.status === 'returned' ? 'orange' : 'blue'}>{r.status_label}</Badge>
                  <span className="muted or-small">
                    {[r.area && `Area ${r.area}`, r.due_on && `Due ${formatDate(r.due_on)}`, r.asked_of && `Asked of ${r.asked_of}`].filter(Boolean).join(' · ')}
                  </span>
                </p>
                <p className="prose">{r.request}</p>
                {r.response_note
                  ? <div><strong>Answer.</strong> <span className="prose">{r.response_note}</span>{r.answered_at && <span className="muted or-small"> ({formatDateTime(r.answered_at)})</span>}</div>
                  : <p className="muted">No answer yet.</p>}
                <FileList grantId={grant.id} files={r.files} />
              </section>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Evidence files (${data.files.length})`}>
        <FileList grantId={grant.id} files={data.files} empty="No evidence files on it yet." />
      </Card>

      <Card title={`${data.labels.findings} (${data.findings.length})`}>
        {data.findings.length === 0 ? <p className="muted">None recorded.</p> : (
          <div className="stack">
            {data.findings.map((f) => (
              <section key={f.id} className="or-item" aria-label={[f.ref, f.title].filter(Boolean).join(' ')}>
                <h3 className="or-h3">{f.ref && <span className="muted">{f.ref} </span>}{f.title}</h3>
                <p className="muted or-small">
                  {[f.rating, f.status_label, f.area && `Area ${f.area}`, f.due_on && `Due ${formatDate(f.due_on)}`].filter(Boolean).join(' · ')}
                </p>
                {f.parts.map((p) => <div key={p.label}><strong>{p.label}.</strong> <span className="prose">{p.text}</span></div>)}
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export function ReviewerApp() {
  const { user, appName, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const { pathname } = useLocation();
  const security = AccountSecurity && modules.some((m) => m.key === 'admin');
  const themeLabel = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <div className="gate">
      <header className="gate-bar">
        <span className="gate-brand"><Wordmark name={appName} size={30} /></span>
        <nav className="or-nav" aria-label="Outside reviewer">
          <Link to="/" aria-current={pathname === '/' || pathname.startsWith('/review/') ? 'page' : undefined}>Your reviews</Link>
          {security && <Link to={ACCOUNT_SECURITY_PATH} aria-current={pathname === ACCOUNT_SECURITY_PATH ? 'page' : undefined}>Account security</Link>}
        </nav>
        <div className="gate-actions">
          {user && <span className="gate-user muted">Signed in as {user.displayName}</span>}
          <Tooltip label={themeLabel}>
            <ActionIcon size={36} className="ui-btn-ghost" onClick={toggle} aria-label={themeLabel}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
            </ActionIcon>
          </Tooltip>
          <Button icon="logout" onClick={() => void logout()}>Sign out</Button>
        </div>
      </header>
      <main id="main" className="content gate-content or-content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={<ReviewList />} />
          <Route path="/review/:grantId" element={<ReviewPage />} />
          {security && AccountSecurity && (
            <Route path={ACCOUNT_SECURITY_PATH} element={<Suspense fallback={<Loading lines={6} />}><AccountSecurity limited /></Suspense>} />
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
