// Search-as-you-type pickers for users and records, built on the Mantine Combobox.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { CloseButton, Combobox, Loader, TextInput, useCombobox } from '@mantine/core';
import { IconSearch } from '@tabler/icons-react';
import { api, qs } from './api';
import { useDebounced } from './hooks';
import { rememberLabel } from './labels';
import { usePopupHost } from './popups';
import { fieldShell, type FieldProps } from './fieldShell';

export interface PickOption {
  id: string;
  label: string;
  ref?: string | null;
}

export interface PickerProps extends FieldProps {
  /** The selected id, or null. */
  value: string | null;
  /** Label of the current value, e.g. `row._display?.assignee_id`. */
  display?: string;
  onChange: (id: string | null, option?: PickOption) => void;
  placeholder?: string;
}

interface AsyncComboboxProps extends PickerProps {
  /** 'user' or a record type key: where picked labels are remembered. */
  kind: string;
  load: (q: string) => Promise<PickOption[]>;
}

function AsyncCombobox({ value, display, onChange, load, kind, placeholder = 'Type to search…', ...field }: AsyncComboboxProps) {
  const host = usePopupHost();
  const [picked, setPicked] = useState<PickOption | null>(null);
  const shown = !value ? '' : picked?.id === value ? picked.label : display ?? '';
  const [text, setText] = useState(shown);
  const [options, setOptions] = useState<PickOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const open = combobox.dropdownOpened;
  const query = useDebounced(open && text !== shown ? text.trim() : '', 200);

  useEffect(() => {
    if (!open) setText(shown);
  }, [open, shown]);

  useEffect(() => {
    if (!open) return;
    let stale = false;
    setLoading(true);
    load(query).then(
      (found) => {
        if (stale) return;
        setOptions(found);
        setFailed(false);
        setLoading(false);
      },
      () => {
        if (stale) return;
        setFailed(true);
        setLoading(false);
      },
    );
    return () => { stale = true; };
  }, [open, query, load]);

  // Highlight the first match so Enter picks it.
  useEffect(() => {
    if (open && options && options.length > 0) combobox.selectFirstOption();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, open]);

  const choose = (id: string) => {
    const option = options?.find((o) => o.id === id);
    if (!option) return;
    rememberLabel(kind, option.id, option.label);
    setPicked(option);
    onChange(option.id, option);
    setText(option.label);
    combobox.closeDropdown();
  };
  const clear = () => {
    onChange(null);
    setText('');
    inputRef.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    // Escape closes the list, not the dialog around it.
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      e.preventDefault();
      combobox.closeDropdown();
    }
  };

  const shell = fieldShell(field);
  return (
    <Combobox store={combobox} onOptionSubmit={choose} {...host.popup}>
      {/* withExpandedAttribute: a combobox must always say whether its list is open (aria-expanded). */}
      <Combobox.Target withExpandedAttribute>
        <TextInput
          {...shell}
          ref={(el) => { inputRef.current = el; host.ref(el); }}
          role="combobox"
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          data-mantine-stop-propagation={open || undefined}
          leftSection={<IconSearch size={15} aria-hidden="true" />}
          rightSectionPointerEvents="all"
          rightSection={
            loading && open ? <Loader size={14} />
              : value && !field.disabled ? (
                <CloseButton size="sm" aria-label={`Clear ${field.label}`} onMouseDown={(e) => e.preventDefault()} onClick={clear} />
              ) : <Combobox.Chevron />
          }
          onChange={(e) => {
            setText(e.currentTarget.value);
            combobox.openDropdown();
            if (e.currentTarget.value === '' && value) onChange(null);
          }}
          onFocus={(e) => { e.currentTarget.select(); combobox.openDropdown(); }}
          onClick={() => combobox.openDropdown()}
          onBlur={() => combobox.closeDropdown()}
          onKeyDownCapture={onKeyDown}
        />
      </Combobox.Target>
      <Combobox.Dropdown>
        {/* The list box scrolls itself: a combobox popup needs no focus of its own (the arrow keys move through it from
            the input), whereas a scroll box inside the list would be a region keyboard users could not reach. */}
        <Combobox.Options aria-label={field.label} className="rc-pick-list">
          {failed && <Combobox.Empty>The list could not be loaded</Combobox.Empty>}
          {!failed && options === null && <Combobox.Empty>Searching…</Combobox.Empty>}
          {!failed && options?.length === 0 && <Combobox.Empty>No matches</Combobox.Empty>}
          {!failed && options?.map((o) => (
            <Combobox.Option key={o.id} value={o.id} active={o.id === value} className="rc-pick-option">
              {o.ref && <span className="rc-ref">{o.ref}</span>}
              <span className="rc-pick-label">{o.label}</span>
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}

/** Pick a user. Searches `/api/users/options`. */
export function UserPicker(props: PickerProps) {
  const load = useCallback((q: string) => api.get<PickOption[]>(`/api/users/options${qs({ q })}`), []);
  return <AsyncCombobox {...props} kind="user" load={load} />;
}

/** Pick a record of the given type. Searches `/api/records/lookup`. */
export function RecordPicker({ type, ...props }: PickerProps & { type: string }) {
  const load = useCallback((q: string) => api.get<PickOption[]>(`/api/records/lookup${qs({ type, q })}`), [type]);
  return <AsyncCombobox {...props} kind={type} load={load} />;
}
