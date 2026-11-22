// Step 0 of wave 13: the stand-in each page shows until its owner builds it. Delete once unused.
import { EmptyState, PageHeader } from '../../core';

export function Placeholder({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="stack">
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState icon="tag" title="Not built yet" message="This page is part of the asset tags work in progress." />
    </div>
  );
}
