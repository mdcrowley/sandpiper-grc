-- Spend on the contract and vendor lists (E45-43): a contract's annual value and a vendor's annual
-- spend (its active contracts), worked out by the application (vendors/spend.ts) at every start
-- and whenever a contract is saved.
alter table contracts add column if not exists annual_value numeric;
alter table vendors add column if not exists annual_spend numeric;
