import { requiredAgents } from './erlang';
import { opSlots } from './time';
import type { Config, Day, Req, VolRow } from './types';
import { DAYS } from './types';

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/** Stage 0: drop excluded months, merge queues, drop incident days. Returns cleaned rows. */
export function cleanVolume(rows: VolRow[], cfg: Config): { rows: VolRow[]; incidentDays: string[] } {
  let r = rows.filter((x) => !cfg.excludeMonths.includes(parseInt(x.date.slice(5, 7), 10)));
  r = r.map((x) => ({ ...x, q: cfg.queueMerges[x.q] ?? x.q }));
  const daily = new Map<string, number>();
  for (const x of r) daily.set(x.date, (daily.get(x.date) ?? 0) + (x.offered || 0));
  if (!daily.size) return { rows: [], incidentDays: [] };
  const thr = median([...daily.values()]) * cfg.incidentThreshold;
  const incidentDays = [...daily.entries()].filter(([, v]) => v > thr).map(([d]) => d).sort();
  const bad = new Set(incidentDays);
  return { rows: r.filter((x) => !bad.has(x.date)), incidentDays };
}

/** PRD s0.3: keep the last n calendar months present in the data ('all' = no filter). */
export function filterSizingMonths(rows: VolRow[], n: 'all' | number): VolRow[] {
  if (n === 'all') return rows;
  const months = [...new Set(rows.map((x) => x.date.slice(0, 7)))].sort();
  const keep = new Set(months.slice(-n));
  return rows.filter((x) => keep.has(x.date.slice(0, 7)));
}

/** Stage A. Merged rows are SUMMED per (queue,date,slot) before averaging across dates (PRD s0.1). */
export function buildDemand(rows: VolRow[], cfg: Config): { prof: Omit<Req, 'Rreq' | 'w'>[]; aht: Record<string, number> } {
  const slots = new Set(opSlots(cfg));
  const d = rows.filter((x) => slots.has(x.slot));

  const num = new Map<string, number>();
  const den = new Map<string, number>();
  for (const x of d) {
    if (!Number.isNaN(x.answered)) den.set(x.q, (den.get(x.q) ?? 0) + x.answered);
    const w = x.answered * x.ahtS;
    if (!Number.isNaN(w)) num.set(x.q, (num.get(x.q) ?? 0) + w);
  }
  const aht: Record<string, number> = {};
  for (const q of den.keys()) aht[q] = (num.get(q) ?? 0) / (den.get(q) as number);

  // sum per (q,date,slot)
  const perDate = new Map<string, { q: string; dow: Day; slot: string; v: number }>();
  for (const x of d) {
    const k = `${x.q}|${x.date}|${x.slot}`;
    const e = perDate.get(k);
    const v = Number.isNaN(x.offered) ? 0 : x.offered;
    if (e) e.v += v; else perDate.set(k, { q: x.q, dow: x.dow, slot: x.slot, v });
  }
  // mean across dates per (q,dow,slot)
  const acc = new Map<string, { q: string; dow: Day; slot: string; sum: number; n: number }>();
  for (const e of perDate.values()) {
    const k = `${e.q}|${e.dow}|${e.slot}`;
    const a = acc.get(k);
    if (a) { a.sum += e.v; a.n += 1; } else acc.set(k, { q: e.q, dow: e.dow, slot: e.slot, sum: e.v, n: 1 });
  }
  const prof = [...acc.values()].map((a) => {
    const offered = a.sum / a.n;
    return { q: a.q, dow: a.dow, slot: a.slot, offered,
      R: requiredAgents(offered, aht[a.q], 1800, cfg.serviceLevel.target, cfg.serviceLevel.thresholdSec) };
  });
  prof.sort((a, b) => a.q.localeCompare(b.q) || DAYS.indexOf(a.dow) - DAYS.indexOf(b.dow) || a.slot.localeCompare(b.slot));
  return { prof, aht };
}

/** Add rostered-bodies requirement (productive-hours adjustment) and per-body miss weight. */
export function buildRequirements(prof: Omit<Req, 'Rreq' | 'w'>[], cfg: Config): Req[] {
  const ratio = cfg.productiveHours / cfg.shiftHours;
  return prof.map((p) => {
    const Rreq = p.R > 0 ? Math.ceil(p.R / ratio - 1e-9) : 0;
    // Weight per missing BODY = offered / Rreq (deviation from BUILD_SPEC, see README).
    return { ...p, Rreq, w: Rreq > 0 ? p.offered / Rreq : 0 };
  });
}
