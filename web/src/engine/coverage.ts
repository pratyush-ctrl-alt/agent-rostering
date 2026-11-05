import { opSlots, shiftDefs } from './time';
import type { Assignment, Config, CovRow, QueueSummary, Req } from './types';
import { DAYS } from './types';

/** Coverage for ANY roster (generated or hand-edited): required vs scheduled bodies, shortfall, expected misses. */
export function computeCoverage(assignments: Pick<Assignment, 'queue' | 'shiftIdx' | 'dayOff'>[], req: Req[], cfg: Config): CovRow[] {
  const shifts = shiftDefs(cfg);
  const slots = opSlots(cfg);
  const present = new Map<string, number[][]>(); // queue -> [day][slot]
  for (const a of assignments) {
    let g = present.get(a.queue);
    if (!g) { g = DAYS.map(() => slots.map(() => 0)); present.set(a.queue, g); }
    DAYS.forEach((d, di) => { if (d !== a.dayOff) for (const t of shifts[a.shiftIdx].slots) g![di][t] += 1; });
  }
  return req.map((r) => {
    const scheduled = present.get(r.q)?.[DAYS.indexOf(r.dow)]?.[slots.indexOf(r.slot)] ?? 0;
    const short = Math.max(0, r.Rreq - scheduled);
    const expMissed = r.w * short;
    return { ...r, scheduled, short, expMissed, missPct: r.offered > 0 ? (100 * expMissed) / r.offered : 0 };
  });
}

export function summarise(cov: CovRow[]): { perQueue: QueueSummary[]; total: { offered: number; expMissed: number; missPct: number } } {
  const m = new Map<string, QueueSummary>();
  for (const c of cov) {
    const s = m.get(c.q) ?? { queue: c.q, offered: 0, expMissed: 0, peakRequiredBodies: 0, peakShort: 0, missPct: 0 };
    s.offered += c.offered; s.expMissed += c.expMissed;
    s.peakRequiredBodies = Math.max(s.peakRequiredBodies, c.Rreq); s.peakShort = Math.max(s.peakShort, c.short);
    m.set(c.q, s);
  }
  const perQueue = [...m.values()].sort((a, b) => a.queue.localeCompare(b.queue)).map((s) => ({ ...s, missPct: (100 * s.expMissed) / s.offered }));
  const offered = perQueue.reduce((a, s) => a + s.offered, 0);
  const expMissed = perQueue.reduce((a, s) => a + s.expMissed, 0);
  return { perQueue, total: { offered, expMissed, missPct: (100 * expMissed) / offered } };
}

export const gaps = (cov: CovRow[]) => cov.filter((c) => c.short > 0);

/** Leftover missed calls by clock hour (sizes the outbound call-back team). */
export function missCurve(cov: CovRow[]): { hour: string; weekly: number; byDay: number[] }[] {
  const m = new Map<string, number[]>();
  for (const c of cov) {
    const h = c.slot.slice(0, 2) + ':00';
    const a = m.get(h) ?? DAYS.map(() => 0);
    a[DAYS.indexOf(c.dow)] += c.expMissed;
    m.set(h, a);
  }
  return [...m.entries()].sort().map(([hour, byDay]) => ({ hour, byDay, weekly: byDay.reduce((x, y) => x + y, 0) }));
}

/** Informational: agents able to serve each queue vs that queue's peak bodies needed (multi-skill agents count under every queue). */
export function skillSupply(agents: { queues: string[]; primary: string }[], req: Req[]) {
  const peak = new Map<string, number>();
  for (const r of req) peak.set(r.q, Math.max(peak.get(r.q) ?? 0, r.Rreq));
  return [...peak.entries()].sort().map(([queue, need]) => ({
    queue, peakBodiesNeeded: need,
    agentsWithSkill: agents.filter((a) => a.queues.includes(queue)).length,
    agentsPrimary: agents.filter((a) => a.primary === queue).length,
  }));
}
