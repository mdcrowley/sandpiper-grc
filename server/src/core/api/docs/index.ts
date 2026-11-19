// Central descriptions of the modules' hand-written routes, for the OpenAPI document (E13-09).
// A module may describe a route itself with ctx.describeRoute(...) beside it; that description is
// registered later and replaces the entry here. Entries for routes that no longer exist are
// harmless (only registered routes are listed), and `core/api/coverage.test.ts` fails when a
// registered route has no description at all.
import type { RouteDoc } from '../../module.ts';
import { DOCS as attachments } from './attachments.ts';
import { DOCS as changes } from './changes.ts';
import { DOCS as frameworks } from './frameworks.ts';
import { DOCS as inventory } from './inventory.ts';
import { DOCS as notifications } from './notifications.ts';
import { DOCS as policies } from './policies.ts';
import { DOCS as projects } from './projects.ts';
import { DOCS as reports } from './reports.ts';
import { DOCS as risks } from './risks.ts';
import { DOCS as secincidents } from './secincidents.ts';
import { DOCS as tickets } from './tickets.ts';
import { DOCS as training } from './training.ts';
import { DOCS as vendors } from './vendors.ts';
import { DOCS as vulnerabilities } from './vulnerabilities.ts';

export const MODULE_DOCS: Record<string, RouteDoc[]> = {
  attachments, changes, frameworks, inventory, notifications, policies, projects, reports, risks,
  secincidents, tickets, training, vendors, vulnerabilities,
};
