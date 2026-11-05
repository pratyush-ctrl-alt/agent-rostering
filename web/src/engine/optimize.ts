import { opSlots, shiftDefs } from './time';
import type { Agent, Config, Day, Req } from './types';
import { DAYS } from './types';

const TIE_OFFDAY = 1e-5; // per unit of offdayPenalty, per agent
const TIE_OFFPRIMARY = 1e-6; // per agent placed off their primary queue

export interface Counts { typeId: string; queue: string; shiftIdx: number; dayOff: Day; n: number }
export interface SolveOutput { counts: Counts[]; status: string; objective: number; nTypes: number; nVars: number; seconds: number }

/** Minimal shape of the highs-js legacy solver we use. */
export interface HighsLike {
  solve(lp: string, options?: Record<string, unknown>): { Status: string; ObjectiveValue: number; Columns: Record<string, { Primal: number }> };
}

export function allowedOffs(a: { availableSunday: boolean; fixedDayOff: Day | null }): Day[] {
  if (a.fixedDayOff) return [a.fixedDayOff];
  if (!a.availableSunday) return ['Sunday'];
  return [...DAYS];
}

const fnum = (x: number) => (Number.isInteger(x) ? String(x) : x.toPrecision(12));

function wrapTerms(terms: string[], per = 8): string {
  const lines: string[] = [];
  for (let i = 0; i < terms.length; i += per) lines.push('  ' + terms.slice(i, i + per).join(' + '));
  return lines.join(' +\n');
}

/**
 * Integrated assignment MILP (PRD s5). Agents with identical constraints form TYPES;
 * n[type,q,s,o] = number of that type on queue q, shift s, day-off o.
 *   min  sum w*short + tiny tie-breakers
 *   s.t. sum_{q,s,o} n = |type|                       (everyone placed exactly once)
 *        sum n[(q,s,o): s covers t, o != d] + short >= Rreq[q,d,t]
 */
export function solveRoster(req: Req[], agents: Agent[], cfg: Config, highs: HighsLike): SolveOutput {
  const t0 = Date.now();
  const shifts = shiftDefs(cfg);
  const slots = opSlots(cfg);
  const queues = new Set(req.map((r) => r.q));

  const typeMap = new Map<string, { a: Agent; n: number }>();
  for (const a of agents) {
    const t = typeMap.get(a.typeId);
    if (t) t.n += 1; else typeMap.set(a.typeId, { a, n: 1 });
  }
  const types = [...typeMap.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([typeId, v]) => ({ typeId, ...v }));
  for (const t of types) for (const q of t.a.queues)
    if (!queues.has(q)) throw new Error(`Queue '${q}' has no call-volume data (agent ${t.a.agentId}).`);

  interface V { ti: number; q: string; s: number; o: Day }
  const vars: V[] = [];
  types.forEach((t, ti) => {
    for (const q of t.a.queues) for (const s of shifts) {
      if (s.evening && !t.a.eveningOk) continue;
      for (const o of allowedOffs(t.a)) vars.push({ ti, q, s: s.idx, o });
    }
  });

  const rq = req.filter((r) => r.Rreq > 0);
  const rowOf = new Map<string, number>();
  rq.forEach((r, i) => rowOf.set(`${r.q}|${r.dow}|${r.slot}`, i));
  const rowVars: number[][] = rq.map(() => []);
  vars.forEach((v, k) => {
    for (const d of DAYS) {
      if (d === v.o) continue;
      for (const tt of shifts[v.s].slots) {
        const ri = rowOf.get(`${v.q}|${d}|${slots[tt]}`);
        if (ri !== undefined) rowVars[ri].push(k);
      }
    }
  });

  // ---- LP text
  const obj: string[] = [];
  vars.forEach((v, k) => {
    const c = TIE_OFFDAY * (cfg.offdayPenalty[v.o] ?? 0) + (v.q !== types[v.ti].a.primary ? TIE_OFFPRIMARY : 0);
    if (c > 0) obj.push(`${fnum(c)} n${k}`);
  });
  rq.forEach((r, i) => obj.push(`${fnum(r.w)} s${i}`));

  const lines: string[] = ['Minimize', ' obj:', wrapTerms(obj), 'Subject To'];
  const byType: number[][] = types.map(() => []);
  vars.forEach((v, k) => byType[v.ti].push(k));
  types.forEach((t, ti) => lines.push(` t${ti}:`, wrapTerms(byType[ti].map((k) => `n${k}`)), `  = ${t.n}`));
  rq.forEach((r, i) => lines.push(` c${i}:`, wrapTerms([...rowVars[i].map((k) => `n${k}`), `s${i}`]), `  >= ${r.Rreq}`));
  lines.push('Bounds');
  rq.forEach((r, i) => lines.push(` 0 <= s${i} <= ${r.Rreq}`));
  lines.push('General');
  for (let i = 0; i < vars.length; i += 10) lines.push(' ' + vars.slice(i, i + 10).map((_, j) => `n${i + j}`).join(' '));
  lines.push('End');

  const res = highs.solve(lines.join('\n'), { time_limit: cfg.solverTimeLimitSec, mip_rel_gap: 1e-4 });
  if (!res.Columns || !Object.keys(res.Columns).length || res.Status === 'Infeasible')
    throw new Error(`Solver returned no usable solution (status: ${res.Status}).`);

  const counts: Counts[] = [];
  vars.forEach((v, k) => {
    const n = Math.round(res.Columns[`n${k}`]?.Primal ?? 0);
    if (n > 0) counts.push({ typeId: types[v.ti].typeId, queue: v.q, shiftIdx: v.s, dayOff: v.o, n });
  });
  const status = res.Status === 'Optimal' ? 'optimal' : `${res.Status.toLowerCase()} (best found)`;
  return { counts, status, objective: res.ObjectiveValue, nTypes: types.length, nVars: vars.length + rq.length, seconds: (Date.now() - t0) / 1000 };
}
