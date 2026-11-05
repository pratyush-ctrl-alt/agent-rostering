import type { Config, Shift } from './types';

export const hm = (s: string) => parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10);
export const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function opSlots(cfg: Config): string[] {
  const out: string[] = [];
  for (let t = hm(cfg.operatingWindow[0]); t < hm(cfg.operatingWindow[1]); t += 30) out.push(fmt(t));
  return out;
}

export function shiftDefs(cfg: Config): Shift[] {
  const slots = opSlots(cfg);
  const cutoff = hm(cfg.eveningCutoff);
  return cfg.shiftWindows.map(([a, b], idx) => ({
    idx, start: a, end: b,
    slots: slots.map((s, k) => (hm(a) <= hm(s) && hm(s) < hm(b) ? k : -1)).filter((k) => k >= 0),
    evening: hm(b) > cutoff,
  }));
}
