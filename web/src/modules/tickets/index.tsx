// Service desk: tickets, problems, knowledge base, catalog, the dashboard and the settings.
import type { ModuleDef } from '../../core';
import { CatalogDetail, CatalogList } from './Catalog';
import { ServiceDeskDashboard } from './Dashboard';
import { KnowledgeArticle, KnowledgeList } from './Knowledge';
import { ProblemDetail, ProblemList } from './Problems';
import { ServiceDeskSettings } from './Settings';
import { TicketDetail } from './TicketDetail';
import { TicketList } from './TicketList';
import './tickets.css';

const mod: ModuleDef = {
  key: 'tickets',
  nav: [
    { group: 'IT services', label: 'Tickets', path: '/tickets', icon: 'ticket', permission: 'tickets.view', order: 10, tabs: 'Tickets' },
    { group: 'IT services', label: 'Service desk dashboard', path: '/tickets/dashboard', icon: 'chart', permission: 'tickets.view', order: 11, menu: false, parent: '/tickets', tab: 'Dashboard' },
    { group: 'IT services', label: 'Service desk settings', path: '/tickets/settings', icon: 'clock', permission: 'tickets.administer', order: 12, menu: false, parent: '/tickets', tab: 'Settings', hub: 'Area settings', hint: 'Service levels, categories, routing and the business hours.' },
    { group: 'IT services', label: 'Problems', path: '/problems', icon: 'bug', permission: 'tickets.view', order: 20 },
    { group: 'IT services', label: 'Service catalog', path: '/catalog', icon: 'folder', permission: 'tickets.view', order: 40 },
    { group: 'IT services', label: 'Knowledge base', path: '/knowledge', icon: 'book', permission: 'knowledge.view', order: 50 },
  ],
  routes: [
    { path: '/tickets', element: <TicketList />, permission: 'tickets.view' },
    { path: '/tickets/dashboard', element: <ServiceDeskDashboard />, permission: 'tickets.view' },
    { path: '/tickets/settings', element: <ServiceDeskSettings />, permission: 'tickets.view' },
    { path: '/tickets/:id', element: <TicketDetail />, permission: 'tickets.view' },
    { path: '/problems', element: <ProblemList />, permission: 'tickets.view' },
    { path: '/problems/:id', element: <ProblemDetail />, permission: 'tickets.view' },
    { path: '/knowledge', element: <KnowledgeList />, permission: 'knowledge.view' },
    { path: '/knowledge/:id', element: <KnowledgeArticle />, permission: 'knowledge.view' },
    { path: '/knowledge/:id/edit', element: <KnowledgeArticle editing />, permission: 'knowledge.edit' },
    { path: '/catalog', element: <CatalogList />, permission: 'tickets.view' },
    { path: '/catalog/:id', element: <CatalogDetail />, permission: 'tickets.view' },
  ],
  create: [
    { label: 'Ticket', path: '/tickets?new=1', permission: 'tickets.create', icon: 'ticket' },
    { label: 'Problem', path: '/problems?new=1', permission: 'tickets.create', icon: 'bug' },
    { label: 'Knowledge article', path: '/knowledge?new=1', permission: 'knowledge.create', icon: 'book' },
  ],
};

export default mod;
