// Service desk: tickets, problems, knowledge base, catalogue and the dashboard.
import type { ModuleDef } from '../../core';
import { CatalogueDetail, CatalogueList } from './Catalogue';
import { ServiceDeskDashboard } from './Dashboard';
import { KnowledgeArticle, KnowledgeList } from './Knowledge';
import { ProblemDetail, ProblemList } from './Problems';
import { TicketDetail } from './TicketDetail';
import { TicketList } from './TicketList';
import './tickets.css';

const mod: ModuleDef = {
  key: 'tickets',
  nav: [
    { group: 'Service desk', label: 'Tickets', path: '/tickets', icon: 'ticket', permission: 'tickets.view', order: 10 },
    { group: 'Service desk', label: 'Service desk dashboard', path: '/tickets/dashboard', icon: 'chart', permission: 'tickets.view', order: 15 },
    { group: 'Service desk', label: 'Service catalogue', path: '/catalogue', icon: 'folder', permission: 'tickets.view', order: 20 },
    { group: 'Service desk', label: 'Problems', path: '/problems', icon: 'bug', permission: 'tickets.view', order: 30 },
    { group: 'Service desk', label: 'Knowledge base', path: '/knowledge', icon: 'book', permission: 'knowledge.view', order: 40 },
  ],
  routes: [
    { path: '/tickets', element: <TicketList />, permission: 'tickets.view' },
    { path: '/tickets/dashboard', element: <ServiceDeskDashboard />, permission: 'tickets.view' },
    { path: '/tickets/:id', element: <TicketDetail />, permission: 'tickets.view' },
    { path: '/problems', element: <ProblemList />, permission: 'tickets.view' },
    { path: '/problems/:id', element: <ProblemDetail />, permission: 'tickets.view' },
    { path: '/knowledge', element: <KnowledgeList />, permission: 'knowledge.view' },
    { path: '/knowledge/:id', element: <KnowledgeArticle />, permission: 'knowledge.view' },
    { path: '/knowledge/:id/edit', element: <KnowledgeArticle editing />, permission: 'knowledge.edit' },
    { path: '/catalogue', element: <CatalogueList />, permission: 'tickets.view' },
    { path: '/catalogue/:id', element: <CatalogueDetail />, permission: 'tickets.view' },
  ],
  create: [
    { label: 'Ticket', path: '/tickets?new=1', permission: 'tickets.create', icon: 'ticket' },
    { label: 'Problem', path: '/problems?new=1', permission: 'tickets.create', icon: 'bug' },
    { label: 'Knowledge article', path: '/knowledge?new=1', permission: 'knowledge.create', icon: 'book' },
  ],
};

export default mod;
