// The severity policy: days allowed to fix a finding, by severity.
import { useEffect, useState } from 'react';
import {
  api, ApiError, Button, Card, ErrorState, errorMessage, Icon, Loading, NumberField, PageHeader, Select, useFetch, useLookup, useToast,
} from '../../core';
import { SectionTabs, SeverityChip, useVulnAccess } from './shared';
import type { Policy } from './shared';

export function PolicySettings() {
  const access = useVulnAccess();
  const toast = useToast();
  const severities = useLookup('vulnerability_severity');
  const { data, error, reload } = useFetch<Policy>('/api/vulnerabilities/policy');
  const [days, setDays] = useState<Record<string, number | null>>({});
  const [fast, setFast] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDays(data.days);
    setFast(data.knownExploitedSeverity ?? '');
  }, [data]);

  const header = (
    <>
      <PageHeader title="Severity policy" subtitle="How long a finding of each severity may stay open. The fix-by date of every finding comes from here."
        breadcrumbs={[{ label: 'Vulnerabilities', to: '/vulnerabilities' }, { label: 'Severity policy' }]} />
      <SectionTabs active="policy" />
    </>
  );
  if (error && !data) return <div className="stack">{header}<ErrorState title="The policy could not be loaded" error={error} onRetry={reload} /></div>;
  if (!data) return <div className="stack">{header}<Loading lines={6} label="Loading the policy" /></div>;

  const dirty = JSON.stringify({ days, fast }) !== JSON.stringify({ days: data.days, fast: data.knownExploitedSeverity ?? '' });
  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const saved = await api.post<Policy>('/api/vulnerabilities/policy', { days, knownExploitedSeverity: fast });
      toast.success(`Policy saved. Fix-by dates changed on ${saved.recalculated ?? 0} open findings.`);
      reload();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {header}
      {!access.administer && (
        <div className="notice"><Icon name="lock" size={16} /><span>You can read the policy. Changing it needs the permission to administer vulnerabilities.</span></div>
      )}
      <Card title="Days allowed, counted from the day a finding is first seen">
        <form className="form" onSubmit={(e) => { e.preventDefault(); void save(); }}>
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
          <p className="muted">
            Leave a severity empty for no fix-by date. Saving recalculates the fix-by date of every open finding, except those where the date was set by hand.
            Fixed and closed findings keep the date they had. Every change is recorded in the audit log.
          </p>
          {access.administer && (
            <div className="form-actions">
              <Button disabled={!dirty || busy} onClick={() => { setDays(data.days); setFast(data.knownExploitedSeverity ?? ''); setErrors({}); }}>Discard changes</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>Save policy</Button>
            </div>
          )}
        </form>
      </Card>
    </div>
  );
}
