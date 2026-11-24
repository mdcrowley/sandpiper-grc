import { describe, expect, it } from 'vitest';
import { dashboardOff, widgetOff } from './offTypes';
import type { Widget } from './types';

// BW-04: a standard dashboard about switched-off areas only is not listed; on a mixed one only the
// widgets about them are left out.
const w = (id: string, type?: string): Widget => ({ id, kind: type ? 'chart' : 'text', title: id, x: 0, y: 0, w: 4, h: 3, config: type ? { spec: { type } } : { text: 'About' } } as Widget);
const off = new Set(['ticket', 'contract']);

describe('dashboards and switched-off areas', () => {
  it('finds the widgets about a switched-off area', () => {
    expect(widgetOff(w('a', 'ticket'), off)).toBe(true);
    expect(widgetOff(w('b', 'risk'), off)).toBe(false);
    expect(widgetOff(w('c'), off)).toBe(false);
    // A figure over time (E41-04) about a switched-off area is left out too.
    const fig = (type: string) => ({ ...w('f'), kind: 'figure', config: { figureId: 'x', figureType: type } } as Widget);
    expect(widgetOff(fig('ticket'), off)).toBe(true);
    expect(widgetOff(fig('risk'), off)).toBe(false);
  });
  it('a dashboard is off only when every widget about records is', () => {
    expect(dashboardOff([w('a', 'ticket'), w('b', 'contract'), w('t')], off)).toBe(true);
    expect(dashboardOff([w('a', 'ticket'), w('b', 'risk')], off)).toBe(false);
    expect(dashboardOff([w('t')], off)).toBe(false);
    expect(dashboardOff([], off)).toBe(false);
  });
});
