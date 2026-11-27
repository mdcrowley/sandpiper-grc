// Attachments: files on any record. The panel is exported from ./AttachmentsPanel for record
// pages to embed; this module adds the cross-record evidence page, the file settings page and
// the backups page (the server's own daily backups live in this module on the server too).
import type { ModuleDef } from '../../core';
import { BackupSettings } from './BackupSettings';
import { ExpiringEvidenceFiles } from './ExpiringEvidenceFiles';
import { FileSettings } from './FileSettings';

const mod: ModuleDef = {
  key: 'attachments',
  nav: [
    // Files on any record whose evidence date is near, under Vendors > Evidence (E44-06: it needs the vendors permission to be offered).
    { group: 'Vendors', label: 'Expiring evidence files', path: '/attachments/expiring', icon: 'file-text', permission: 'vendors.view', order: 32, menu: false, parent: '/evidence', tab: 'Expiring files' },
    { group: 'Administration', label: 'File settings', path: '/admin/attachments', icon: 'upload', permission: 'admin.administer', order: 63, menu: false, hub: 'Data and operations', hint: 'Allowed file types, size limits, malware scanning and storage.' },
    { group: 'Administration', label: 'Backups', path: '/admin/backups', icon: 'database', permission: 'admin.administer', order: 64, menu: false, hub: 'Data and operations', hint: 'The daily verified copy and how many to keep.' },
  ],
  routes: [
    { path: '/attachments/expiring', element: <ExpiringEvidenceFiles /> },
    { path: '/admin/attachments', element: <FileSettings />, permission: 'admin.administer' },
    { path: '/admin/backups', element: <BackupSettings />, permission: 'admin.administer' },
  ],
};
export default mod;
