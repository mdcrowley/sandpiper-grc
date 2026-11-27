// Asset tags (wave 13, E37; area `tags`): Administration > Asset tags (formats, stock, series,
// printing, settings), inventory counts, the tag card page and finding a record by its tag number.
// Each page is in its own file with one owner (see the wave 13 contracts). Extension files found by
// other code at build time: InventoryPanel.tsx (the record page's Tags panel), ListActions.tsx (the
// "Find by tag number" box on inventory lists), BulkActions.tsx (print the tags of selected records)
// and PaletteProvider.ts (tag numbers in the global search).
import type { ModuleDef } from '../../core';
import './tags.css';
import { CountDetailPage, CountListPage, CountReportPage } from './Counts';
import { FormatsPage } from './Formats';
import { PrintPage } from './Print';
import { SeriesPage } from './Series';
import { TagSettingsPage } from './Settings';
import { RangePage, StockPage } from './Stock';
import { TagCardPage } from './TagCard';

const mod: ModuleDef = {
  key: 'tags',
  nav: [
    { group: 'Assets', label: 'Asset tags', path: '/admin/asset-tags', icon: 'tag', permission: 'tags.view', order: 22, menu: false, parent: '/assets', tab: 'Tags' },
    { group: 'Assets', label: 'Inventory counts', path: '/inventory-counts', icon: 'check-square', permission: 'tags.view', order: 23, menu: false, parent: '/assets', tab: 'Counts' },
    { group: 'Administration', label: 'Asset tag formats', path: '/admin/asset-tags/settings', icon: 'tag', permission: 'tags.manage', order: 45, menu: false, hub: 'Records setup', hint: 'How tag numbers are made and printed.' },
  ],
  routes: [
    { path: '/admin/asset-tags', element: <FormatsPage />, permission: 'tags.view' },
    { path: '/admin/asset-tags/stock', element: <StockPage />, permission: 'tags.view' },
    { path: '/admin/asset-tags/stock/:id', element: <RangePage />, permission: 'tags.view' },
    { path: '/admin/asset-tags/series', element: <SeriesPage />, permission: 'tags.view' },
    { path: '/admin/asset-tags/print', element: <PrintPage />, permission: 'tags.manage' },
    { path: '/admin/asset-tags/settings', element: <TagSettingsPage />, permission: 'tags.view' },
    { path: '/inventory-counts', element: <CountListPage />, permission: 'tags.view' },
    { path: '/inventory-counts/report', element: <CountReportPage />, permission: 'tags.view' },
    { path: '/inventory-counts/:id', element: <CountDetailPage />, permission: 'tags.view' },
    // The tag card as a page: what a tag number (typed, or from a handheld scanner) is stuck to.
    // Looking up needs no permission beyond seeing the record.
    { path: '/asset-tags/find', element: <TagCardPage /> },
  ],
  create: [
    { label: 'Inventory count', path: '/inventory-counts?new=1', permission: 'tags.count', icon: 'check-square' },
  ],
};
export default mod;
