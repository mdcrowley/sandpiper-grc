// Shared pieces of the fleet pages: the section tabs and small types.
import { useNavigate } from 'react-router-dom';
import { Tabs, useAuth } from '../../core';

const SECTIONS = [
  { key: 'vehicles', label: 'Vehicles', path: '/vehicles' },
  { key: 'models', label: 'Vehicle models', path: '/vehicle-models' },
  { key: 'services', label: 'Services', path: '/services' },
  { key: 'coverage', label: 'Equipment coverage', path: '/fleet/coverage' },
  { key: 'impact', label: 'What is affected', path: '/fleet/impact' },
] as const;
export type FleetSection = (typeof SECTIONS)[number]['key'];

export function FleetTabs({ active }: { active: FleetSection }) {
  const navigate = useNavigate();
  const { can } = useAuth();
  // Coverage and impact name assets and systems: show them only to people who may see those.
  const shown = SECTIONS.filter((s) => (s.key === 'coverage' ? can('assets.view') : s.key === 'impact' ? can('systems.view') : true));
  return (
    <Tabs
      label="Fleet sections"
      active={active}
      tabs={shown.map((s) => ({ key: s.key, label: s.label }))}
      onChange={(key) => navigate(SECTIONS.find((s) => s.key === key)?.path ?? '/vehicles')}
    />
  );
}

export interface Installation {
  id: string;
  vehicle_id: string;
  asset_id: string;
  installed_on: string;
  install_notes: string | null;
  removed_on: string | null;
  removal_reason: string | null;
  fleet_number: string;
  tag: string | null;
  asset_name: string | null;
  asset_type: string | null;
  asset_type_label: string | null;
  asset_status_label: string | null;
  asset_status_color: string;
  installed_by: string | null;
  removed_by: string | null;
  current: boolean;
  working: boolean;
}

export interface AffectedVehicle {
  id: string; fleet_number: string; mode_label: string | null; status_label: string | null; depot_name: string | null; route: string;
  equipment: { asset_id: string; tag: string | null; name: string; system_id: string }[];
}
export interface AffectedService {
  id: string; route_code: string; name: string; mode_label: string | null; route: string;
  dependencies: { system_id: string; dependency_label: string | null }[];
}
