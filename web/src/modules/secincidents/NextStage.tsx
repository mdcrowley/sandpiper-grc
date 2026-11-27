// E45-34: the incident's next step as the primary button in the header ("Declare incident", "Mark
// contained", "Mark recovering", "Close incident"), with the checks the step needs. A failing
// blocking check keeps the button's confirm disabled and links to the tab where it is put right.
import { useState } from 'react';
import { api, Button, errorMessage, Icon, Modal, useFetch, useToast } from '../../core';

interface StepCheck { key: string; label: string; ok: boolean; blocking: boolean; tab?: string; detail?: string }
interface NextStep {
  current: { value: string; label: string; stage: string };
  next: { value: string; label: string; stage: string; action: string } | null;
  checks: StepCheck[];
  ready: boolean;
}

export function NextStageButton({ incidentId, declared, version, onMoved, goTo, blockedReason }: {
  incidentId: string; declared: boolean; version: string; onMoved: () => void; goTo: (tab: string) => void;
  /** Why the lifecycle rules do not allow the move, or an empty string. */
  blockedReason: (to: string, label: string) => string;
}) {
  const toast = useToast();
  const step = useFetch<NextStep>(`/api/security-incidents/${incidentId}/next-step?v=${encodeURIComponent(version)}`, { keepPrevious: true });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = step.data;
  if (!data?.next) return null;
  const next = data.next;
  const declaring = next.stage === 'declared' && !declared;
  const blocked = data.checks.filter((c) => c.blocking && !c.ok);
  const notAllowed = blockedReason(next.value, next.label);

  async function move() {
    setBusy(true);
    try {
      await api.post(`/api/security-incidents/${incidentId}/advance`, { to: next.value });
      toast.success(declaring ? 'Incident declared. The notification clocks are running.' : `Status changed to ${next.label}.`);
      setOpen(false);
      onMoved();
    } catch (err) {
      toast.error(errorMessage(err));
      step.reload();
    } finally {
      setBusy(false);
    }
  }

  const icon = next.stage === 'closed' ? 'check' : declaring ? 'alert' : 'arrow-right';
  return (
    <>
      <Button variant="primary" icon={icon} disabled={Boolean(notAllowed)} title={notAllowed || undefined}
        onClick={() => { step.reload(); setOpen(true); }}>{next.action}</Button>
      <Modal open={open} title={declaring ? 'Declare this incident?' : `${next.action}?`} onClose={() => setOpen(false)}
        footer={(
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={blocked.length > 0} onClick={move}>{next.action}</Button>
          </>
        )}>
        <div className="stack">
          <p>
            {declaring
              ? 'Declaring starts a clock for every notification that applies to this incident, counted from the discovery time, and everyone who can see security incidents is told.'
              : next.stage === 'closed'
                ? 'Closing is time-stamped and logged, and sets the date the post-incident review is due.'
                : `The status changes from ${data.current.label} to ${next.label}; the change is time-stamped and logged.`}
          </p>
          {data.checks.length > 0 && (
            <ul className="si-step-checks" aria-label="Checks for this step">
              {data.checks.map((c) => (
                <li key={c.key} className={c.ok ? 'is-ok' : c.blocking ? 'is-blocking' : 'is-warning'}>
                  <Icon name={c.ok ? 'check-circle' : 'alert-circle'} size={18} />
                  <div>
                    <strong>{c.label}</strong>
                    <span className="si-step-state">{c.ok ? 'Done' : c.blocking ? 'Needed before this step' : 'Not yet (you can still go ahead)'}</span>
                    {c.detail && <span className="si-step-detail">{c.detail}</span>}
                  </div>
                  {!c.ok && c.tab && (
                    <Button size="sm" variant="ghost" onClick={() => { setOpen(false); goTo(c.tab!); }}>Open</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
