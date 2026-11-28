// Procurement and budgets (E46): solicitations from planning to award (offers, evaluation committee,
// scores, award, protests, the resulting contract), purchase orders with approval and receiving, vendor
// invoices with the three-way match, approval and payment (E46-66), and operating and capital budgets
// against committed and spent, kept as versions: adopted, then amended (E46-67). Committee members score from their own
// pages (/procurement/evaluate/:id) without a procurement role. The Overview panel is HomeWidget.tsx.
import type { ModuleDef } from '../../core';
import { BudgetDetail, BudgetLineDetail, BudgetLineList, BudgetList, BudgetVersionDetail, BudgetVersionList } from './Budgets';
import { EvaluatePage, MyEvaluations } from './Evaluate';
import { InvoiceDetail, InvoiceLineRedirect, InvoiceList } from './Invoices';
import { OrderDetail, OrderLineRedirect, OrderList } from './Orders';
import './procurement.css';
import { ProcurementSettings } from './Settings';
import { OfferDetail, OfferList, SolicitationDetail, SolicitationList } from './Solicitations';

const view = 'procurement.view';

const mod: ModuleDef = {
  key: 'procurement',
  nav: [
    { group: 'Vendors', label: 'Procurement', path: '/procurement', icon: 'clipboard', permission: view, order: 40, tabs: 'Solicitations' },
    { group: 'Vendors', label: 'Purchase orders', path: '/procurement/purchase-orders', icon: 'box', permission: view, order: 41, menu: false, parent: '/procurement', tab: 'Purchase orders' },
    { group: 'Vendors', label: 'Invoices', path: '/procurement/invoices', icon: 'file-text', permission: view, order: 41.5, menu: false, parent: '/procurement', tab: 'Invoices' },
    { group: 'Vendors', label: 'Budgets', path: '/procurement/budgets', icon: 'chart', permission: view, order: 42, menu: false, parent: '/procurement', tab: 'Budgets' },
    { group: 'Vendors', label: 'Procurement settings', path: '/procurement/settings', icon: 'settings', permission: 'procurement.administer', order: 43, menu: false, parent: '/procurement', tab: 'Settings', hub: 'Area settings', hint: 'Methods and their limits, the required clauses, the standard evaluation criteria and the invoice match tolerance.' },
  ],
  routes: [
    { path: '/procurement', element: <SolicitationList />, permission: view },
    { path: '/procurement/solicitations', element: <SolicitationList />, permission: view },
    { path: '/procurement/solicitations/:id', element: <SolicitationDetail />, permission: view },
    { path: '/procurement/offers', element: <OfferList />, permission: view },
    { path: '/procurement/offers/:id', element: <OfferDetail />, permission: view },
    { path: '/procurement/purchase-orders', element: <OrderList />, permission: view },
    { path: '/procurement/purchase-orders/:id', element: <OrderDetail />, permission: view },
    { path: '/procurement/purchase-order-lines/:id', element: <OrderLineRedirect />, permission: view },
    { path: '/procurement/invoices', element: <InvoiceList />, permission: view },
    { path: '/procurement/invoices/:id', element: <InvoiceDetail />, permission: view },
    { path: '/procurement/invoice-lines/:id', element: <InvoiceLineRedirect />, permission: view },
    { path: '/procurement/budget-versions', element: <BudgetVersionList />, permission: view },
    { path: '/procurement/budget-versions/:id', element: <BudgetVersionDetail />, permission: view },
    { path: '/procurement/budgets', element: <BudgetList />, permission: view },
    { path: '/procurement/budgets/:id', element: <BudgetDetail />, permission: view },
    { path: '/procurement/budget-lines', element: <BudgetLineList />, permission: view },
    { path: '/procurement/budget-lines/:id', element: <BudgetLineDetail />, permission: view },
    { path: '/procurement/settings', element: <ProcurementSettings />, permission: 'procurement.administer' },
    // A committee member's own pages: being on the committee is what lets them in.
    { path: '/procurement/evaluations', element: <MyEvaluations /> },
    { path: '/procurement/evaluate/:id', element: <EvaluatePage /> },
  ],
  create: [
    { label: 'Solicitation', path: '/procurement?new=1', permission: 'procurement.create', icon: 'clipboard' },
    { label: 'Purchase order', path: '/procurement/purchase-orders?new=1', permission: 'procurement.create', icon: 'box' },
    { label: 'Budget', path: '/procurement/budgets?new=1', permission: 'procurement.create', icon: 'chart' },
  ],
};
export default mod;
