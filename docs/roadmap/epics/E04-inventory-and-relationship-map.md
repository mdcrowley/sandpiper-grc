# E04 Inventory and relationship map

**Status:** in progress

## Goal

Hold one trustworthy picture of what the organisation runs: its systems, the assets
people use, the sites they are in, the kinds of data held, and how these depend on each
other. Other modules (tickets, risks, vendors, incidents) point at these records.

## Scope notes

- Covers `server/src/modules/inventory/` and `web/src/modules/inventory/`.
- Asset CSV import and JSON ingest are tracked in
  [E13](E13-imports-api-integrations.md).
- Asset types, statuses, hosting types, criticality tiers and sensitivity levels are
  configurable lists.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E04-01 | Systems register | done | P1 |
| E04-02 | Assets register | done | P1 |
| E04-03 | Sites | done | P2 |
| E04-04 | Data categories | done | P2 |
| E04-05 | Integrations between systems | done | P2 |
| E04-06 | Data categories and sites linked to systems | done | P2 |
| E04-07 | Relationship map | done | P2 |
| E04-08 | Downstream impact of a system | done | P2 |
| E04-09 | Asset check-out, check-in and assignment history | done | P2 |
| E04-10 | Disposal gate with recorded approval | done | P2 |
| E04-11 | Canned inventory reports | done | P2 |
| E04-12 | Routed disposal approval | open | P2 |
| E04-13 | Use the department list on assets | open | P3 |

---

### E04-01 Systems register

**Status:** done · **Priority:** P1 · **Type:** feature

As an IT lead, I keep a register of every business system with its owners, vendor,
hosting, criticality, recovery targets and how people sign in to it.

**Acceptance criteria**

- [x] Systems are numbered automatically
- [x] Business and technical owner, vendor and contract
- [x] Hosting type, provider and region
- [x] Criticality tier, recovery time and recovery point objectives, manual fallback
- [x] Authentication method and multi-factor status
- [x] List, detail page with tabs, history, comments and links

**Implemented in:** `system` resource (`server/src/modules/inventory/index.ts`); `web/src/modules/inventory/Systems.tsx`, `SystemTabs.tsx`

### E04-02 Assets register

**Status:** done · **Priority:** P1 · **Type:** feature

As an agent, I record each device, licence or subscription with its tag, who has it,
where it is, what it cost and when its warranty and support end.

**Acceptance criteria**

- [x] Unique asset tag, generated when not given
- [x] Type, status, make, model, serial number
- [x] Owner, user, department, site and location
- [x] Purchase date, cost, funding source and outside-funder interest
- [x] Warranty and support end dates
- [x] Links to a vendor, contract and system

**Implemented in:** `asset` resource and `checkAsset` (`server/src/modules/inventory/index.ts`); `web/src/modules/inventory/Assets.tsx`

### E04-03 Sites

**Status:** done · **Priority:** P2 · **Type:** feature

As an IT lead, I record each site with what it is for, the technology there, its power
and physical protection, and its network links.

**Acceptance criteria**

- [x] Site records with the fields above
- [x] A site page lists the systems that serve it
- [x] Assets can be assigned to a site

**Implemented in:** `site` resource (`server/src/modules/inventory/index.ts`); `GET /api/sites/:id/systems` (`relations.ts`); `web/src/modules/inventory/Sites.tsx`

### E04-04 Data categories

**Status:** done · **Priority:** P2 · **Type:** feature

As a security lead, I list the kinds of data the organisation holds, how sensitive each
is, who looks after it, who it is shared with and how long it is kept.

**Acceptance criteria**

- [x] Data category records with sensitivity, custodian, sharing, governing rule and retention period
- [x] Sensitivity levels are a configurable list that says which count as sensitive
- [x] A category page lists the systems that hold it

**Implemented in:** `data_category` resource (`server/src/modules/inventory/index.ts`); `GET /api/data-categories/:id/systems` (`relations.ts`); `web/src/modules/inventory/DataCategories.tsx`

### E04-05 Integrations between systems

**Status:** done · **Priority:** P2 · **Type:** feature

As an IT lead, I record which systems send data to which, in what direction and by what
method.

**Acceptance criteria**

- [x] Add, list and remove integrations from a system page
- [x] Direction and method are configurable lists
- [x] Changes are audited on both systems

**Implemented in:** `/api/systems/:id/integrations` (`server/src/modules/inventory/relations.ts`); `web/src/modules/inventory/SystemTabs.tsx`

### E04-06 Data categories and sites linked to systems

**Status:** done · **Priority:** P2 · **Type:** feature

As an IT lead, I say which data categories each system holds and which sites rely on
it.

**Acceptance criteria**

- [x] Link and unlink data categories on a system
- [x] Link and unlink sites on a system
- [x] Changes are audited

**Implemented in:** `/api/systems/:id/data-categories`, `/api/systems/:id/sites` (`server/src/modules/inventory/relations.ts`); `web/src/modules/inventory/SystemTabs.tsx`

### E04-07 Relationship map

**Status:** done · **Priority:** P2 · **Type:** feature

As anyone planning a change or handling an incident, I can see systems, vendors, sites
and data categories as a map and focus on one system's neighbourhood.

**Acceptance criteria**

- [x] A graph of typed nodes and edges
- [x] Focus on one system with a chosen number of hops
- [x] Only records the user may see are included
- [x] Opens from the navigation and from a system

**Implemented in:** `GET /api/systems/graph` (`server/src/modules/inventory/relations.ts`); `web/src/modules/inventory/SystemMap.tsx`, `graph.tsx`

### E04-08 Downstream impact of a system

**Status:** done · **Priority:** P2 · **Type:** feature

As an incident lead, I pick a system and see everything downstream of it through its
integrations, so I know what else is affected when it fails.

**Acceptance criteria**

- [x] Follows integrations transitively
- [x] Shown on the relationship map for the chosen system

**Implemented in:** `GET /api/systems/:id/impact` (`server/src/modules/inventory/relations.ts`); `web/src/modules/inventory/SystemMap.tsx`

### E04-09 Asset check-out, check-in and assignment history

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I check an asset out to a person and back in again, and the asset keeps a
history of who had it and when.

**Acceptance criteria**

- [x] Check-out records the person and date
- [x] Check-in closes the assignment
- [x] The full assignment history is shown on the asset

**Implemented in:** `/api/assets/:id/assignments`, `/check-out`, `/check-in` (`server/src/modules/inventory/lifecycle.ts`); `web/src/modules/inventory/AssetDialogs.tsx`

### E04-10 Disposal gate with recorded approval

**Status:** done · **Priority:** P2 · **Type:** feature

As an agent, I cannot mark an asset as disposed until an approval is recorded, and an
asset with an outside funder's interest also needs an approval reference.

**Acceptance criteria**

- [x] Disposal always needs who approved and when
- [x] An asset flagged with funder interest also needs an approval reference
- [x] The rule holds however the asset is changed (page, API, import)
- [x] Disposal date and method are recorded

**Implemented in:** `POST /api/assets/:id/dispose`, `disposalProblem` (`server/src/modules/inventory/lifecycle.ts`); `web/src/modules/inventory/AssetDialogs.tsx`

### E04-11 Canned inventory reports

**Status:** done · **Priority:** P2 · **Type:** feature

As an IT lead, I can run seven ready-made reports and export each to CSV.

**Acceptance criteria**

- [x] Assets past support
- [x] Warranty expiring in the next 90 days
- [x] Assets by site
- [x] Unassigned assets
- [x] Systems without an owner
- [x] Systems without recovery targets
- [x] Systems holding sensitive data without multi-factor
- [x] CSV export with an audit entry and permission checks

**Implemented in:** `GET /api/inventory/reports`, `/api/inventory/reports/:key` (`server/src/modules/inventory/reports.ts`); `web/src/modules/inventory/Reports.tsx`

### E04-12 Routed disposal approval

**Status:** open · **Priority:** P2 · **Type:** feature

As an approver, I receive a disposal request and approve or refuse it in the
application. Today the approval is a name and date typed in by the agent.

**Acceptance criteria**

- [ ] An agent requests disposal; the asset shows "awaiting approval"
- [ ] A person with `assets.approve` approves or refuses with a comment
- [ ] The approver cannot be the requester
- [ ] The decision is audited and unlocks the disposal step
- [ ] Depends on notifications ([E14-03](E14-platform-services.md)) to tell the approver

### E04-13 Use the department list on assets

**Status:** open · **Priority:** P3 · **Type:** debt

As an administrator, I want an asset's department chosen from the same department list
as users, so reports group consistently. Today it is free text.

**Acceptance criteria**

- [ ] The asset form offers the department list
- [ ] Existing text values are matched to departments where they agree
- [ ] The "assets by site" style reports can group by department
