import { Link } from 'react-router-dom';
import { EmptyState } from './ui';

const homeLink = <Link className="btn btn-secondary" to="/">Go to the home page</Link>;

/** Catch-all page for addresses no module handles. */
export function NotFound() {
  return (
    <EmptyState
      icon="search"
      title="Page not found"
      message="There is nothing at this address. It may have moved, or the link may be incomplete."
      action={homeLink}
    />
  );
}

/** Shown when a route needs a permission the user does not hold. */
export function Forbidden() {
  return (
    <EmptyState
      icon="lock"
      title="You do not have access to this page"
      message="Ask an administrator if you need this area for your work."
      action={homeLink}
    />
  );
}
