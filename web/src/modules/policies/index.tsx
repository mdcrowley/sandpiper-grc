// Documents and exceptions: the document-control library (types and hierarchy, numbering, controlled
// distribution, versions with their dates, reviews, Word conversion and import), acknowledgments,
// and the register of time-limited exceptions. One menu entry for the library; the register, reviews,
// groups, import, kiosk and settings are tabs on it for the people whose role uses them.
import type { ModuleDef } from '../../core';
import { ExceptionDetail, ExceptionList } from './ExceptionPages';
import { MyAcknowledgments } from './MyAcknowledgments';
import { PolicyEditor } from './PolicyEditor';
import { PolicyDetail } from './PolicyPage';
import { PolicyReader } from './PolicyReader';
import './policies.css';
import './documents/documents.css';
import { Kiosk } from './Kiosk';
import { DocumentReader } from './documents/DocumentReader';
import { DistributionGroups } from './documents/Groups';
import { DocumentImport } from './documents/Import';
import { Library } from './documents/Library';
import { Moved } from './documents/Moved';
import { Approvals, ExternalDocuments, Register } from './documents/Register';
import { ReviewsDue } from './documents/Reviews';
import { DocumentSettings } from './documents/Settings';
import { VersionUpload } from './documents/VersionUpload';

const mod: ModuleDef = {
  key: 'policies',
  nav: [
    // No permission: everyone reads the documents distributed to them (E43-12).
    { group: 'Documents', label: 'Document library', path: '/documents', icon: 'book', order: 10 },
    // E44-10: the Settings tab is also a card on the Administration page.
    { group: 'Documents', label: 'Document settings', path: '/documents/settings', icon: 'settings', permission: 'policies.administer', order: 19, menu: false, parent: '/documents', hub: 'Area settings', hint: 'Document numbers, department codes and acknowledgment reminders.' },
    // Exceptions to a document are risk decisions: they sit with Risk and compliance.
    { group: 'Risk and compliance', label: 'Exceptions', path: '/exceptions', icon: 'clock', permission: 'exceptions.view', order: 50 },
    // The person's own acknowledgments: a tab of My work, not a menu entry.
    { group: 'Home', label: 'My acknowledgments', path: '/policies/acknowledgments', icon: 'check-square', order: 34, menu: false, parent: '/my-work', tab: 'Acknowledgments' },
  ],
  routes: [
    { path: '/documents', element: <Library /> },
    { path: '/documents/register', element: <Register />, permission: 'policies.view' },
    { path: '/documents/approvals', element: <Approvals />, permission: 'policies.approve' },
    { path: '/documents/reviews', element: <ReviewsDue />, permission: 'policies.edit' },
    { path: '/documents/external', element: <ExternalDocuments />, permission: 'policies.view' },
    { path: '/documents/groups', element: <DistributionGroups />, permission: 'policies.administer' },
    { path: '/documents/import', element: <DocumentImport />, permission: 'policies.administer' },
    // A supervisor's signed-in device where roster people acknowledge (E29-10); never a public route.
    { path: '/documents/kiosk', element: <Kiosk />, permission: 'policies.edit' },
    { path: '/documents/settings', element: <DocumentSettings />, permission: 'policies.administer' },
    // My acknowledgments is a tab of My work; its address stays /policies/acknowledgments.
    { path: '/documents/acknowledgments', element: <Moved to="/policies/acknowledgments" /> },
    { path: '/documents/:id', element: <DocumentReader /> },
    // Addresses from before the Documents menu (wave 24) keep working.
    { path: '/policies', element: <Moved to="/documents/register" /> },
    { path: '/policies/kiosk', element: <Moved to="/documents/kiosk" /> },
    { path: '/policies/acknowledgments', element: <MyAcknowledgments /> },
    { path: '/policies/acknowledgments/:ackId', element: <PolicyReader /> },
    { path: '/policies/:id', element: <PolicyDetail />, permission: 'policies.view' },
    { path: '/policies/:id/edit', element: <PolicyEditor />, permission: 'policies.edit' },
    { path: '/policies/:id/upload', element: <VersionUpload />, permission: 'policies.edit' },
    { path: '/exceptions', element: <ExceptionList />, permission: 'exceptions.view' },
    { path: '/exceptions/:id', element: <ExceptionDetail />, permission: 'exceptions.view' },
  ],
  create: [
    { label: 'Document', path: '/documents/register?new=1', permission: 'policies.create', icon: 'file-text' },
    { label: 'Exception', path: '/exceptions?new=1', permission: 'exceptions.create', icon: 'clock' },
  ],
};

export default mod;
