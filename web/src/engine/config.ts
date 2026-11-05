import type { Config } from './types';

export const DEFAULT_CONFIG: Config = {
  serviceLevel: { target: 0.8, thresholdSec: 20 },
  shiftHours: 9,
  productiveHours: 7.5,
  shiftWindows: [['09:00', '18:00'], ['10:00', '19:00'], ['11:00', '20:00'], ['12:00', '21:00']],
  eveningCutoff: '19:00',
  operatingWindow: ['09:00', '21:00'],
  queueMerges: { undefined: 'Default', Gujarati: 'Default', Bengali: 'Default', default_mobile: 'M2D' },
  excludeMonths: [],
  incidentThreshold: 1.8,
  sizingMonths: 'all',
  offdayPenalty: { Monday: 1, Tuesday: 3, Wednesday: 3, Thursday: 3, Friday: 0, Saturday: 1, Sunday: 0 },
  solverTimeLimitSec: 120,
};
