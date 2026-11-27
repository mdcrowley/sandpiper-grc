// The severity policy: days allowed to fix a finding by severity, and the share of that
// period a finding gets when it is on a critical system.
import { useEffect, useState } from 'react';
import {
  api, ApiError, Button, Card, ErrorState, errorMessage, Icon, Loading, NumberField, PageHeader, Select, StatusChip, useFetch, useLookup, useToast,
} from '../../core';
import type { ColorName } from '../../core';
import { SectionTabs, SeverityChip, useVulnAccess } from './shared';
import type { Policy } from './shared';
import { KnownExploitedCard } from './KnownExploited';

type Percent = Record<string, number | null>;
const shortened = (days: number, percent: number | null | undefined) => (percent && percent < 100 ? Math.max(1, Math.ceil((days * percent) / 100)) : days);

export function PolicySettings() {
  const access = useVulnAccess();
  const toast = useToast();
  const severities = useLookup('vulnerability_severity');
  const { data, error, reload } = useFetch<Policy>('/api/vulnerabilities/policy');
  const [days, setDays] = useState<Record<string, number | null>>({});
  const [fast, setFast] = useState('');
  const [percent, setPercent] = useState<Percent>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const reset = (p: Policy) => {
    setDays(p.days);
    setFast(p.knownExploitedSeverity ?? '');
    setPercent(Object.fromEntries(p.criticalityTiers.map((t) => [t.value, p.criticalityPercent[t.value] ?? null])));
    setErrors({});
  };
  useEffect(() => { if (data) reset(data); }, [data]);

  const header = (
    <>
      <PageHeader title="Severity policy" subtitle="How long a finding may stay open. The fix-by date of every finding comes from here."
        breadcrumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'Severity policy' }]} />
      <SectionTabs active="policy" />
    </>
  );
  if (error && !data) return <div className="stack">{header}<ErrorState title="The policy could not be loaded" error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} label="Loading the policy" /></div>;

  const tiers = data.criticalityTiers;
  const clean = (p: Percent) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== null && v < 100));
  const dirty = JSON.stringify({ days, fast, percent: clean(percent) })
    !== JSON.stringify({ days: data.days, fast: data.knownExploitedSeverity ?? '', percent: clean(Object.fromEntries(tiers.map((t) => [t.value, data.criticalityPercent[t.value] ?? null]))) });
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const saved = await api.post<Policy>('/api/vulnerabilities/policy', { days, knownExploitedSeverity: fast, ...(tiers.length ? { criticalityPercent: percent } : {}) });
      toast.success(`Policy saved. Fix-by dates changed on ${saved.recalculated ?? 0} open findings.`);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const timed = severities.filter((s) => days[s.value]);

  return (
    <div className="stack">
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      {header}
      {!access.administer && (
        <div className="notice"><Icon name="lock" size={16} /><span>You can read the policy. Changing it needs the permission to administer vulnerabilities.</span></div>
      )}

      <Card title="Days allowed by severity">
        <div className="stack">
          <p className="muted vuln-note">Counted from the day a finding is first seen. Leave a severity empty for no fix-by date.</p>
          <div className="vuln-policy">
            {severities.map((s) => (
              <div key={s.value} className="vuln-policy-row">
                <SeverityChip value={s.value} />
                <NumberField label={`Days allowed for ${s.label}`} hideLabel value={days[s.value] ?? null} min={1} max={3650} step={1}
                  disabled={!access.administer} error={errors[`days.${s.value}`]}
                  onChange={(v) => setDays((d) => ({ ...d, [s.value]: v }))} />
                <span className="muted">{days[s.value] ? (days[s.value] === 1 ? 'day' : 'days') : 'No fix-by date'}</span>
              </div>
            ))}
          </div>
          <Select label="Known-exploited findings use the period for" value={fast} placeholder="Their own severity (no shortening)"
            options={severities.map((s) => ({ value: s.value, label: s.label }))} disabled={!access.administer}
            onChange={setFast} error={errors.knownExploitedSeverity} className="vuln-narrow"
            hint="A finding marked as known exploited gets this period when it is shorter than its own." />
        </div>
      </Card>

      {tiers.length > 0 && (
        <Card title="Shorter periods for critical systems">
          <div className="stack">
            <p className="muted vuln-note">
              A finding on a system takes the system's criticality from the inventory. Give a criticality a share of the period to bring its fix-by dates forward:
              50 means half the days allowed. Leave it empty for the whole period.
            </p>
            <div className="vuln-policy">
              {tiers.map((t) => {
                const p = percent[t.value];
                return (
                  <div key={t.value} className="vuln-policy-row">
                    <StatusChip color={t.color as ColorName} label={t.label} />
                    <NumberField label={`Share of the period for ${t.label}, per cent`} hideLabel value={p ?? null} min={1} max={100} step={5}
                      disabled={!access.administer} error={errors[`criticalityPercent.${t.value}`]} placeholder="100"
                      onChange={(v) => setPercent((c) => ({ ...c, [t.value]: v }))} />
                    <span className="muted">
                      {p && p < 100
                        ? `% of the period: ${timed.map((s) => `${s.label} ${shortened(days[s.value]!, p)}`).join(', ')} days`
                        : '% of the period: no shortening'}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="muted vuln-note">
              A change to a system's criticality reaches its open findings within a day. A finding with no system, or with a fix-by date set by hand, is not affected.
            </p>
          </div>
        </Card>
      )}

      <Card>
        <div className="stack">
          <p className="muted vuln-note">
            Saving recalculates the fix-by date of every open finding, except those where the date was set by hand.
            Fixed and closed findings keep the date they had. Every change is recorded in the audit log.
          </p>
          {access.administer && (
            <div className="form-actions">
              <Button disabled={!dirty || busy} onClick={() => reset(data)}>Discard changes</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>Save policy</Button>
            </div>
          )}
        </div>
      </Card>
    </form>
    <KnownExploitedCard />
    </div>
  );
}
