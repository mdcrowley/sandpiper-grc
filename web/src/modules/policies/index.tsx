// Policies and exceptions: the policy library with versions and acknowledgments, and the
// register of time-limited exceptions.
import type { ModuleDef } from '../../core';
import { ExceptionDetail, ExceptionList } from './ExceptionPages';
import { MyAcknowledgments } from './MyAcknowledgments';
import { PolicyEditor } from './PolicyEditor';
import { PolicyLibrary } from './PolicyLibrary';
import { PolicyDetail } from './PolicyPage';
import { PolicyReader } from './PolicyReader';
import './policies.css';
import { Kiosk } from './Kiosk';

const mod: ModuleDef = {
  key: 'policies',
  nav: [
    { group: 'Cybersecurity', label: 'Policies', path: '/policies', icon: 'file-text', permission: 'policies.view', order: 80 },
    // No permission: everyone who is asked to acknowledge a policy needs to reach their own list.
    { group: 'Cybersecurity', label: 'My acknowledgments', path: '/policies/acknowledgments', icon: 'check-square', order: 81 },
    { group: 'Cybersecurity', label: 'Acknowledgment kiosk', path: '/policies/kiosk', icon: 'check-circle', permission: 'policies.edit', order: 82 },
    { group: 'Cybersecurity', label: 'Exceptions', path: '/exceptions', icon: 'clock', permission: 'exceptions.view', order: 83 },
  ],
  routes: [
    { path: '/policies', element: <PolicyLibrary />, permission: 'policies.view' },
    { path: '/policies/acknowledgments', element: <MyAcknowledgments /> },
    { path: '/policies/acknowledgments/:ackId', element: <PolicyReader /> },
    // A supervisor's signed-in device where roster people acknowledge (E29-10); never a public route.
    { path: '/policies/kiosk', element: <Kiosk />, permission: 'policies.edit' },
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
