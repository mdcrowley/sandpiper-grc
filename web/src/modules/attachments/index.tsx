// Attachments: files on any record. The panel is exported from ./AttachmentsPanel for record
// pages to embed; this module adds the cross-record evidence page and the settings page.
import type { ModuleDef } from '../../core';
import { ExpiringEvidenceFiles } from './ExpiringEvidenceFiles';
import { FileSettings } from './FileSettings';

const mod: ModuleDef = {
  key: 'attachments',
  nav: [
    { group: 'Reports', label: 'Expiring evidence files', path: '/attachments/expiring', icon: 'file-text', order: 60 },
    { group: 'Administration', label: 'File settings', path: '/admin/attachments', icon: 'upload', permission: 'admin.administer', order: 70 },
  ],
  routes: [
    { path: '/attachments/expiring', element: <ExpiringEvidenceFiles /> },
    { path: '/admin/attachments', element: <FileSettings />, permission: 'admin.administer' },
  ],
};
export default mod;
