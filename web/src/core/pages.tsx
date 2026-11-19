import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

/** A centered full-page message with its own heading and ways onward. */
function FullPage({ icon, code, title, message }: { icon: IconName; code: string; title: string; message: string }) {
  useEffect(() => {
    const before = document.title;
    document.title = `${title} · ${before.split(' · ').pop()}`;
    return () => { document.title = before; };
  }, [title]);

  return (
    <div className="fullpage-state">
      <div className="state">
        <span className="state-icon"><Icon name={icon} size={30} /></span>
        <p className="muted">{code}</p>
        <h1 className="state-title">{title}</h1>
        <p className="state-message">{message}</p>
        <div className="state-action row">
          <Link className="btn btn-primary" to="/">Go to the overview</Link>
          <Link className="btn btn-secondary" to="/help">Open Help</Link>
        </div>
      </div>
    </div>
  );
}

/** Catch-all page for addresses no module handles. */
export function NotFound() {
  return (
    <FullPage
      icon="search"
      code="Error 404"
      title="Page not found"
      message="There is nothing at this address. It may have moved, or the link may be incomplete. Press / to search for what you need."
    />
  );
}

/** Shown when a route needs a permission the user does not hold. */
export function Forbidden() {
  return (
    <FullPage
      icon="lock"
      code="No access"
      title="You do not have access to this page"
      message="Your role does not include this area. Ask an administrator if you need it for your work."
    />
  );
}
