// A quarterly status update of an objective or an initiative, given in a dialog.
import { useState } from 'react';
import { Modal, ResourceForm, useFetch, useToast } from '../../core';
import { quarterExample, type StrategySettingsData } from './shared';

const UPDATE_FIELDS = ['period', 'status', 'narrative', 'reported_on'];

export interface UpdateSubject { objective_id?: string; initiative_id?: string; label: string; period?: string }

export function UpdateDialog({ subject, onClose, onSaved }: { subject: UpdateSubject; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [dirty, setDirty] = useState(false);
  const { objective_id, initiative_id, period } = subject;
  // Quarters follow the organization's fiscal year (Strategy > Settings).
  const settings = useFetch<StrategySettingsData>('/api/strategy/settings');
  const fiscal = (settings.data?.fiscal_year_start_month ?? 1) > 1;
  return (
    <Modal open title={`Status update: ${subject.label}`} onClose={onClose} dirty={dirty}>
      <ResourceForm
        type="strategy_update" fields={UPDATE_FIELDS} customFields={false}
        initial={{ ...(objective_id ? { objective_id } : { initiative_id }), ...(period ? { period } : {}) }}
        hints={{ period: `The ${fiscal ? 'fiscal ' : ''}quarter, for example ${quarterExample(settings.data)}. Left empty: the quarter of the report date.` }}
        onDirtyChange={setDirty} submitLabel="Save the update"
        onSaved={() => { toast.success('Update saved.'); onSaved(); }} onCancel={onClose}
      />
    </Modal>
  );
}
