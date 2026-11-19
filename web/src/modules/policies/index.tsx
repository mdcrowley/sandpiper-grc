// Policies and exceptions: the policy library with versions and acknowledgements, and the
// register of time-limited exceptions.
import type { ModuleDef } from '../../core';
import { ExceptionDetail, ExceptionList } from './ExceptionPages';
import { MyAcknowledgements } from './MyAcknowledgements';
import { PolicyEditor } from './PolicyEditor';
import { PolicyLibrary } from './PolicyLibrary';
import { PolicyDetail } from './PolicyPage';
import { PolicyReader } from './PolicyReader';
import './policies.css';

const mod: ModuleDef = {
  key: 'policies',
  nav: [
    { group: 'Cybersecurity', label: 'Policies', path: '/policies', icon: 'file-text', permission: 'policies.view', order: 80 },
    // No permission: everyone who is asked to acknowledge a policy needs to reach their own list.
    { group: 'Cybersecurity', label: 'My acknowledgements', path: '/policies/acknowledgements', icon: 'check-square', order: 85 },
    { group: 'Cybersecurity', label: 'Exceptions', path: '/exceptions', icon: 'clock', permission: 'exceptions.view', order: 90 },
  ],
  routes: [
    { path: '/policies', element: <PolicyLibrary />, permission: 'policies.view' },
    { path: '/policies/acknowledgements', element: <MyAcknowledgements /> },
    { path: '/policies/acknowledgements/:ackId', element: <PolicyReader /> },
    { path: '/policies/:id', element: <PolicyDetail />, permission: 'policies.view' },
    { path: '/policies/:id/edit', element: <PolicyEditor />, permission: 'policies.edit' },
    { path: '/exceptions', element: <ExceptionList />, permission: 'exceptions.view' },
    { path: '/exceptions/:id', element: <ExceptionDetail />, permission: 'exceptions.view' },
  ],
  create: [
    { label: 'Policy', path: '/policies?new=1', permission: 'policies.create', icon: 'file-text' },
    { label: 'Exception', path: '/exceptions?new=1', permission: 'exceptions.create', icon: 'clock' },
  ],
};

export default mod;
