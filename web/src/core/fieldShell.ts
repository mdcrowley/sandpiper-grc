// The props every form control shares, and how they map onto a Mantine input.
import './records.css';

export interface FieldProps {
  label: string;
  required?: boolean;
  disabled?: boolean;
  /** Validation message shown under the control. */
  error?: string;
  /** Help text shown under the control. */
  hint?: string;
  /** Keep the label for assistive technology but hide it visually (filter bars). */
  hideLabel?: boolean;
  className?: string;
  /** Control size (default `sm`). */
  size?: 'xs' | 'sm' | 'md';
}

const ORDER: ('label' | 'input' | 'description' | 'error')[] = ['label', 'input', 'description', 'error'];

/** Mantine input props for the shared field props: label, required marker, hint, error. */
export function fieldShell({ label, required, disabled, error, hint, hideLabel, className, size }: FieldProps) {
  return {
    label: hideLabel ? undefined : label,
    'aria-label': hideLabel ? label : undefined,
    required: required || undefined,
    withAsterisk: Boolean(required) && !hideLabel,
    disabled,
    error: error || undefined,
    description: hint || undefined,
    className: ['rc-field', className].filter(Boolean).join(' '),
    inputWrapperOrder: ORDER,
    size: size ?? 'sm',
  };
}
