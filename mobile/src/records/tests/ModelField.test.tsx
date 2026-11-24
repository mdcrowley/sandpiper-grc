// Vehicle and asset models (E39-07): a vehicle's or asset's record view shows its model among the key
// fields (read-only on the phone). Invented values only.
import { render, screen } from '@testing-library/react-native';
import { resetMeta } from '../api';
import { layoutFor } from '../layouts';
import { clearRecent } from '../recent';
import RecordScreen from '../screens/RecordScreen';
import { sampleMeta, server } from './mocks';

jest.mock('../../api/client', () => require('./mocks').clientMock());
jest.mock('expo-router', () => require('./mocks').routerMock());
jest.mock('expo-web-browser', () => require('./mocks').browserMock());
jest.mock('expo-secure-store', () => require('./mocks').secureStoreMock());
jest.mock('expo-screen-capture', () => require('./mocks').captureMock());
jest.mock('../../auth/session', () => require('./mocks').sessionMock());

jest.setTimeout(30_000);

const vehicleMeta = {
  type: 'vehicle', label: 'Vehicle', plural: 'Vehicles', module: 'fleet', path: '/api/vehicles', route: '/vehicles', titleField: 'fleet_number',
  restricted: false,
  fields: {
    fleet_number: { label: 'Fleet number', type: 'text', required: true },
    mode: { label: 'Mode', type: 'lookup', list: 'vehicle_mode', required: true },
    status: { label: 'Status', type: 'lookup', list: 'vehicle_status' },
    model_id: { label: 'Vehicle model', type: 'ref', to: 'vehicle_model' },
    model_overrides: { label: "Values kept instead of the model's", type: 'json' },
    make: { label: 'Make', type: 'text' },
    model: { label: 'Model', type: 'text' },
  },
};

beforeEach(async () => {
  server.reset();
  resetMeta();
  await clearRecent();
  const meta = sampleMeta() as any;
  meta.resources.vehicle = vehicleMeta;
  server.routes['GET /api/meta'] = meta;
  server.routes['GET /api/vehicles/v1'] = {
    id: 'v1', fleet_number: 'EX-4102', mode: 'bus', status: 'in_service', model_id: 'm1', model_overrides: ['make'],
    make: 'Invented Coachline', model: 'IC-12', _display: { mode: 'Bus', status: 'In service', model_id: 'Invented Coachline 12' },
  };
});

describe('a member of a model on the phone', () => {
  it('lists the model among the key fields, after the identifiers', () => {
    const key = layoutFor(vehicleMeta as any).key;
    expect(key).toContain('model_id');
    expect(key.indexOf('model_id')).toBeLessThan(key.indexOf('make'));
  });

  it('shows the vehicle model by name on the record view', async () => {
    await render(<RecordScreen type="vehicle" id="v1" />);
    expect(await screen.findByText('Invented Coachline 12')).toBeTruthy();
    expect(screen.getByText('Vehicle model')).toBeTruthy();
  });
});
