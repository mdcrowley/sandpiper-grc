// Attachments: files on any record. The panel is exported from ./AttachmentsPanel for record
// pages to embed; this module adds the cross-record evidence page, the file settings page and
// the backups page (the server's own daily backups live in this module on the server too).
import type { ModuleDef } from '../../core';
import { BackupSettings } from './BackupSettings';
import { ExpiringEvidence } from './ExpiringEvidence';
import { FileSettings } from './FileSettings';

const mod: ModuleDef = {
  key: 'attachments',
  nav: [
    // One page for expiring evidence (E44-08): vendor evidence, the evidence library and files on any record, with a source
    // filter. Under Vendors > Evidence (E44-06: it needs the vendors permission to be offered there); the evidence library's
    // Expiring tab shows the same page.
    { group: 'Vendors', label: 'Expiring evidence', path: '/attachments/expiring', icon: 'clock', permission: 'vendors.view', order: 32, menu: false, parent: '/evidence', tab: 'Expiring' },
    { group: 'Administration', label: 'File settings', path: '/admin/attachments', icon: 'upload', permission: 'admin.administer', order: 63, menu: false, hub: 'Data and operations', hint: 'Allowed file types, size limits, malware scanning, the languages scans are read in, and storage.' },
    { group: 'Administration', label: 'Backups', path: '/admin/backups', icon: 'database', permission: 'admin.administer', order: 64, menu: false, hub: 'Data and operations', hint: 'The daily verified copy and how many to keep.' },
  ],
  routes: [
    { path: '/attachments/expiring', element: <ExpiringEvidence /> },
    { path: '/admin/attachments', element: <FileSettings />, permission: 'admin.administer' },
    { path: '/admin/backups', element: <BackupSettings />, permission: 'admin.administer' },
  ],
};
export default mod;
