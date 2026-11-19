# E20 Safety management

**Status:** in progress (core built)

## Goal

Give a transit operator's safety team a hazard log scored on the safety hazard matrix, a
record of safety events with their investigation and corrective actions, and safety
performance indicators measured against targets, all in the same place as the rest of its
governance, risk and compliance work.

## Scope notes

- Module `safety` (server `server/src/modules/safety`, web `web/src/modules/safety`),
  permission module `safety`. Events that hold personal information are restricted
  (`security.view`), as everywhere else in the product.
- Hazards use the `hazard_4x5` scale kept by the risks module, read through its scale code;
  nothing is copied. Corrective actions and mitigations are `action` records.
- No jurisdiction's reporting rules or thresholds are built in: types, severities, statuses and
  which severities notify are lookup lists; indicators are defined by the operator.

## Issues

| ID | Title | Status | Priority |
|---|---|---|---|
| E20-01 | Hazard log scored on the hazard matrix | done | P1 |
| E20-02 | Safety events | done | P1 |
| E20-03 | Investigation, closing rule and corrective actions | done | P1 |
| E20-04 | Restricted safety events | done | P1 |
| E20-05 | Links between events and hazards | done | P2 |
| E20-06 | Safety performance indicators and exposure | done | P1 |
| E20-07 | Notifications for serious events and overdue corrective actions | done | P1 |
| E20-08 | Safety dashboard | done | P1 |
| E20-09 | Invented sample safety data | done | P2 |
| E20-10 | `safety` permission key and a Safety role | open | P1 |
| E20-11 | A Safety navigation group | open | P2 |
| E20-12 | Hazard review reminders | open | P3 |
| E20-13 | Report a safety event from the self-service portal | open | P3 |
| E20-14 | Indicator figures for readers without `security.view` | done | P3 |

---

### E20-01 Hazard log scored on the hazard matrix

**Status:** done · **Priority:** P1 · **Type:** feature

As a safety manager, I record hazards with their source, consequence, existing controls,
owner and review date, and score them now and after mitigation.

**Acceptance criteria**

- [x] Likelihood and severity must be levels of the hazard matrix, both or neither
- [x] Rating and score worked out by the risks module's scale code; an administrator's change to the matrix applies
- [x] `GET /api/safety/scale` gives the matrix to `safety.view` holders
- [x] Mitigations are actions (source "Safety")
- [x] Matrix picker names each cell's rating in text and marks the chosen cell

**Implemented in:** `server/src/modules/safety/hazards.ts`; `web/src/modules/safety/Hazards.tsx`, `shared.tsx`

### E20-02 Safety events

**Status:** done · **Priority:** P1 · **Type:** feature

As anyone in the safety team, I record what happened, when, where (site, vehicle, route), how
serious it was and what was done at once.

**Acceptance criteria**

- [x] Types: collision, passenger injury, near miss, operator assault, fire, derailment, unsafe condition, slip/trip/fall, other
- [x] Severities: no harm, minor, moderate, serious, major or fatal
- [x] Not in the future; people injured a whole number; the form starts at the current time

**Implemented in:** `server/src/modules/safety/events.ts`; `web/src/modules/safety/Events.tsx`

### E20-03 Investigation, closing rule and corrective actions

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] Investigator, due date, root cause and category, findings
- [x] Closing needs a root cause and no open corrective actions (409 `actions_open`); closed date set and cleared on reopening
- [x] Corrective actions on the event page via the action tracker panel

### E20-04 Restricted safety events

**Status:** done · **Priority:** P1 · **Type:** security

**Acceptance criteria**

- [x] `restricted: 'flag'` with a `restricted` field; types with `meta.restrict` (passenger injury, operator assault) start restricted
- [x] Hidden without `security.view` in lists, records, links, hazard event lists and vehicle and service event lists; counted, without details, in the dashboard and indicators for everyone (E20-14)
- [x] Corrective actions inherit the restriction

### E20-05 Links between events and hazards

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] Link and unlink from the event; listed on the hazard; audited on both

### E20-06 Safety performance indicators and exposure

**Status:** done · **Priority:** P1 · **Type:** feature

As a safety manager, I define indicators such as events per 100,000 vehicle-miles and follow
them month by month against a target.

**Acceptance criteria**

- [x] Filters by event types, severities and modes; count or rate per exposure (vehicle-miles, vehicle-hours, boardings) per N
- [x] Target at most or at least; on target / off target per month
- [x] Exposure entered per month for the whole operation or per mode; per-mode figures are added up when there is no whole-operation figure
- [x] Trend chart with the target, and a table alternative

**Implemented in:** `server/src/modules/safety/indicators.ts`; `web/src/modules/safety/Indicators.tsx`

### E20-07 Notifications for serious events and overdue corrective actions

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] `app.notify` to `safety.view` holders and the investigator when an event is recorded at, or raised to, a severity with `meta.notify`
- [x] Overdue corrective actions reported once a day to the investigator and `safety.edit` holders (`POST /api/safety/reminders/run`, hourly timer)
- [x] New notification kind "Safety events" that people can switch off

**Implemented in:** `events.ts`, `reminders.ts`

### E20-08 Safety dashboard

**Status:** done · **Priority:** P1 · **Type:** feature

**Acceptance criteria**

- [x] Tiles that open the records behind them; events by month, type and severity; open hazards on the matrix; indicators with trends
- [x] Light and dark themes; the numbers are available as tables or lists

**Implemented in:** `GET /api/safety/summary`; `web/src/modules/safety/Dashboard.tsx`

### E20-09 Invented sample safety data

**Status:** done · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [x] Dev profile: 12 hazards, a year of events across the sample fleet, corrective actions, 12 months of exposure, 5 indicators

### E20-10 `safety` permission key and a Safety role

**Status:** open · **Priority:** P1 · **Type:** feature

Today `safety` is not in `MODULE_KEYS` (`server/src/modules/admin/shared.ts`), so only `*` grants it.

**Acceptance criteria**

- [ ] `safety` added to `MODULE_KEYS` and to the developer guide's list
- [ ] A default "Safety manager" role (switched off) with `safety.*`, `actions.*`, `fleet.view`, `sites.view`, `dashboards.view`; Security lead gains `safety.view`

### E20-11 A Safety navigation group

**Status:** open · **Priority:** P2 · **Type:** feature

**Acceptance criteria**

- [ ] `Safety` added to `NAV_GROUPS` and `GROUP_ICON` (`web/src/core/module.ts`, `Shell.tsx`); the safety pages move there from Cybersecurity

### E20-12 Hazard review reminders

**Status:** open · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [ ] The owner is reminded when a hazard's review date is near or past

### E20-13 Report a safety event from the self-service portal

**Status:** open · **Priority:** P3 · **Type:** feature

**Acceptance criteria**

- [ ] Staff without safety permissions can report an event; the safety team triages it

### E20-14 Indicator figures for readers without `security.view`

**Status:** done · **Priority:** P3 · **Type:** decision

Indicators counted only the events the reader could see, so the figures differed by reader
when events were restricted.

**Decision:** people never see different numbers. The safety dashboard and every indicator
count every event, restricted or not, for everyone who holds `safety.view`; restriction
protects an event's details, which these figures never return. The events behind a figure
are still listed only for people who may open them. The rule applies to every figure in the
application (E18-40).

**Acceptance criteria**

- [x] Decide whether aggregate counts may include restricted events, and document it in `docs/security.md` ("Figures are the same for everyone")
- [x] `GET /api/safety/summary` and `GET /api/safety-indicators/:id/trend` count every event (`server/src/modules/safety/indicators.ts`)
