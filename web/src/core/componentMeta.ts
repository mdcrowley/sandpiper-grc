// Invented record type metadata shared by the component tests (E18-43).
import type { Meta } from './meta';

export const GIZMO_META: Meta = {
  resources: {
    gizmo: {
      type: 'gizmo', label: 'Gizmo', plural: 'Gizmos', module: 'tickets', path: '/api/gizmos', route: '/gizmos',
      titleField: 'name', refField: 'ref', restricted: false,
      fields: {
        ref: { label: 'Reference', type: 'text', readOnly: true },
        name: { label: 'Name', type: 'text', required: true },
        status: { label: 'Status', type: 'lookup', list: 'gizmo_status' },
        cost: { label: 'Cost', type: 'currency' },
        notes: { label: 'Notes', type: 'longtext' },
        cf_depot: { label: 'Depot', type: 'text', custom: true, section: 'Where it is' },
      },
    },
  },
  lookups: {
    gizmo_status: [
      { value: 'open', label: 'Open', color: 'blue', sort: 10 },
      { value: 'in_repair', label: 'In repair', color: 'amber', sort: 20 },
    ],
  },
};
