// Register templates (wave 26): ready-made registers (labor agreements, real property) an administrator
// creates in one click from Administration > Registers. A template is a starting point: the register it
// makes is an ordinary register whose names, fields and statuses can all be changed afterwards.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi, ApiError, Button, EmptyState, ErrorState, errorMessage, Loading, Modal, Notice, TextField, useFetch, useMeta, useToast } from '../../core';
import type { AdminRegister } from './Admin';
import { REGISTERS_CHANGED } from './NavExtras';

interface Template {
  key: string; label: string; plural: string; prefix: string; nav_group: string; icon: string; description: string;
  statuses: string[]; fields: { key: string; label: string; type: string; to?: string }[]; made: boolean; prefixTaken: boolean;
}

const TYPE_WORD: Record<string, string> = {
  text: 'text', longtext: 'long text', number: 'number', currency: 'amount', date: 'date', boolean: 'yes or no', select: 'choice', ref: 'link',
};

/** The dialog that lists the templates and makes a register from one. */
export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const { data, error, reload } = useFetch<{ templates: Template[] }>('/api/admin/registers/templates');
  const toast = useToast();
  const meta = useMeta();
  const navigate = useNavigate();
  const [busy, setBusy] = useState('');
  // A template already made (or whose prefix is taken) needs other names for a second register.
  const [again, setAgain] = useState<Template | null>(null);
  const [names, setNames] = useState({ plural: '', label: '', prefix: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const make = async (t: Template, body: Record<string, string> = {}) => {
    setBusy(t.key);
    setErrors({});
    try {
      const made = await adminApi.post<AdminRegister>(`/api/admin/registers/templates/${t.key}`, body);
      toast.success(`Register "${made.plural}" made from the template.`);
      meta.reload();
      window.dispatchEvent(new Event(REGISTERS_CHANGED));
      onClose();
      navigate(`/admin/registers/${made.key}`);
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fields).length) {
        if (!again) { setAgain(t); setNames({ plural: '', label: '', prefix: '' }); }
        setErrors(err.fields);
      } else toast.error(errorMessage(err));
    } finally {
      setBusy('');
    }
  };

  if (again) {
    const slug = names.plural.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
    return (
      <Modal open title={`Another register from “${again.plural}”`} size="sm" onClose={onClose}
        footer={<><Button onClick={() => { setAgain(null); setErrors({}); }}>Back</Button><Button variant="primary" loading={busy === again.key} onClick={() => void make(again, { ...names, key: slug })}>Make register</Button></>}>
        <div className="stack">
          <Notice tone="info">A register from this template exists already, or its name or prefix is taken. Give the new register names of its own.</Notice>
          <TextField label="Register name" required value={names.plural} onChange={(v) => setNames({ ...names, plural: v })} error={errors.plural ?? errors.key} maxLength={60} />
          <TextField label="One record is called" required value={names.label} onChange={(v) => setNames({ ...names, label: v })} error={errors.label} maxLength={60} />
          <TextField label="Reference prefix" required value={names.prefix} onChange={(v) => setNames({ ...names, prefix: v.toUpperCase() })} error={errors.prefix} maxLength={9} />
        </div>
      </Modal>
    );
  }

  return (
    <Modal open title="Start from a template" size="lg" onClose={onClose}>
      {error ? <ErrorState error={error} onRetry={reload} />
        : !data ? <Loading lines={4} label="Loading the templates" />
        : data.templates.length === 0 ? <EmptyState icon="folder" title="No templates" message="Define a register of your own with New register." />
        : (
          <div className="stack">
            <p className="muted">Each template makes an ordinary register with its own fields and statuses, numbering and menu entry. Change any of it afterwards.</p>
            <ul className="reg-templates">
              {data.templates.map((t) => (
                <li key={t.key} className="reg-template">
                  <div className="reg-template-head">
                    <h3>{t.plural}</h3>
                    <Button variant={t.made ? 'secondary' : 'primary'} size="sm" loading={busy === t.key}
                      onClick={() => (t.made || t.prefixTaken ? (setAgain(t), setNames({ plural: '', label: '', prefix: '' })) : void make(t))}>
                      {t.made ? 'Make another' : 'Make register'}
                    </Button>
                  </div>
                  <p>{t.description}</p>
                  <p className="muted reg-template-meta">
                    In the {t.nav_group} menu · numbered {t.prefix}00001 · statuses {t.statuses.join(', ')}
                  </p>
                  <p className="reg-template-fields">
                    <span className="muted">Fields: </span>
                    {t.fields.map((f, i) => <span key={f.key}>{i ? ', ' : ''}{f.label} <span className="muted">({TYPE_WORD[f.type] ?? f.type})</span></span>)}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
    </Modal>
  );
}
