// An old address of a Documents page: goes to the new one, keeping the query (list filters) and the
// fragment, so bookmarks and links in notifications sent before the move still work.
import { Navigate, useLocation } from 'react-router-dom';

export function Moved({ to }: { to: string }) {
  const { search, hash } = useLocation();
  return <Navigate replace to={`${to}${search}${hash}`} />;
}
