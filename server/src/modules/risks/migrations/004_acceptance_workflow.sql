-- Risk acceptance on the shared approval workflows (E08-23). Whether accepting the risk needs an
-- executive approver (its rating is at or above its scale's approval threshold), kept on the risk
-- so the "Executive approver" step of the Risk acceptance workflow can be a condition on it.
-- Filled for existing risks at the next start (risks module, seedDefaults) and on every re-rating.
alter table risks add column if not exists acceptance_executive boolean;
