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
    { group: 'Reports', label: 'Expiring evidence files', path: '/attachments/expiring', icon: 'file-text', order: 60 },
    { group: 'Administration', label: 'File settings', path: '/admin/attachments', icon: 'upload', permission: 'admin.administer', order: 70 },
    { group: 'Administration', label: 'Backups', path: '/admin/backups', icon: 'database', permission: 'admin.administer', order: 71 },
  ],
  routes: [
    { path: '/attachments/expiring', element: <ExpiringEvidenceFiles /> },
    { path: '/admin/attachments', element: <FileSettings />, permission: 'admin.administer' },
    { path: '/admin/backups', element: <BackupSettings />, permission: 'admin.administer' },
  ],
};
export default mod;
