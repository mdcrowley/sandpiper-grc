// The setup wizard's choice of how strictly the second factor is enforced on a new installation
// (E02-17). Embedded in the first-run setup page; its value goes to POST /api/setup as `secondFactor`.
import './account-keys.css';

export type SecondFactorSetting = 'required' | 'notice';
export const DEFAULT_SECOND_FACTOR: SecondFactorSetting = 'required';

const OPTIONS: { value: SecondFactorSetting; title: string; text: string }[] = [
  {
    value: 'required',
    title: 'Require it for administrators and security leads (recommended)',
    text: 'Next you will set up an authenticator app or a passkey before anything else. Administrators and security leads you add later do the same when they first sign in.',
  },
  {
    value: 'notice',
    title: 'Only remind people for now',
    text: 'People see a reminder but can work without a second factor. You can require it later under Administration, Settings.',
  },
];

export function SecondFactorChoice({ value, onChange }: { value: SecondFactorSetting; onChange: (v: SecondFactorSetting) => void }) {
  return (
    <fieldset className="ak-choice">
      <legend>Second sign-in factor</legend>
      <p className="muted ak-choice-intro">
        A second factor (a code from an authenticator app, or a passkey) means a stolen password is not enough to sign in.
        This application holds risk and incident records, so it is required by default.
      </p>
      {OPTIONS.map((o) => (
        <label key={o.value} className="ak-option">
          <input type="radio" name="ak-second-factor" value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
          <span className="ak-option-title">{o.title}</span>
          <span className="ak-option-text">{o.text}</span>
        </label>
      ))}
    </fieldset>
  );
}
