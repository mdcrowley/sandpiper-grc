// The "Legal hold" banner on a held record's page. The server adds `_holds: [{ id, ref }]` to one
// record read through its generated route, for people holding legal.view only (never the matter);
// the generic record page shows this banner when the row carries it.
import { Link } from 'react-router-dom';
import { Icon, useAuth } from '../../core';
import type { Row } from '../../core';

export function HoldBanner({ row }: { row: Row }) {
  const { can } = useAuth();
  const holds = (Array.isArray(row._holds) ? row._holds : []) as { id: string; ref: string }[];
  if (!holds.length) return null;
  return (
    <p className="notice notice-warn" role="status">
      <Icon name="lock" />
      <span>
        <strong>Legal hold.</strong> This record cannot be deleted, anonymized or lose its files while it is held by{' '}
        {holds.map((h, i) => (
          <span key={h.id}>
            {i > 0 && ', '}
            {can('legal.view') ? <Link to={`/admin/legal-holds/${h.id}`}>{h.ref}</Link> : h.ref}
          </span>
        ))}.
      </span>
    </p>
  );
}
