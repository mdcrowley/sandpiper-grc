/** An on/off switch. `label` is always read out; it is shown unless `hideLabel`. */
export function Switch({ label, checked, onChange, disabled, hideLabel }: {
  label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; hideLabel?: boolean;
}) {
  return (
    <label className="adm-switch" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="adm-switch-track" aria-hidden="true" />
      <span className={hideLabel ? 'sr-only' : undefined}>{label}</span>
      {hideLabel && <span aria-hidden="true">{checked ? 'On' : 'Off'}</span>}
    </label>
  );
}
