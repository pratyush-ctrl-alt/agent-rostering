import type { Counts } from './optimize';
import { shiftDefs } from './time';
import type { Agent, Assignment, Config, Day, RotationState } from './types';
import { DAYS } from './types';

const score = (o: Day, evening: boolean) => 2 * +(o !== 'Sunday') + (evening ? 1 : 0); // Sunday-working worst, then evening

export const emptyState = (): RotationState => ({ months: {}, next: {} });

/**
 * Stage C. Within a type every agent is interchangeable for coverage, so who draws the unpopular
 * patterns (working Sunday, evening) rotates. Agents are ordered by id and rotated by a per-type offset:
 * fixed within a month (re-running a month reproduces the roster), advanced each new month.
 */
export function assignNames(counts: Counts[], agents: Agent[], cfg: Config, month: string, prev: RotationState): { assignments: Assignment[]; state: RotationState } {
  const shifts = shiftDefs(cfg);
  const state: RotationState = JSON.parse(JSON.stringify(prev ?? emptyState()));
  const isNew = !(month in state.months);
  const used: Record<string, number> = isNew ? { ...state.next } : { ...state.months[month] };
  const nxt: Record<string, number> = { ...state.next };

  const byType = new Map<string, Counts[]>();
  for (const c of counts) { const a = byType.get(c.typeId); if (a) a.push(c); else byType.set(c.typeId, [c]); }

  const out: Assignment[] = [];
  for (const [tid, cs] of [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const pats: { q: string; s: number; o: Day }[] = [];
    for (const c of cs) for (let i = 0; i < c.n; i++) pats.push({ q: c.queue, s: c.shiftIdx, o: c.dayOff });
    pats.sort((a, b) => score(b.o, shifts[b.s].evening) - score(a.o, shifts[a.s].evening)
      || (a.q < b.q ? -1 : a.q > b.q ? 1 : 0) || a.s - b.s || DAYS.indexOf(a.o) - DAYS.indexOf(b.o));
    let pool = agents.filter((a) => a.typeId === tid).sort((a, b) => (a.agentId < b.agentId ? -1 : a.agentId > b.agentId ? 1 : 0));
    if (pool.length !== pats.length) throw new Error(`internal: type ${tid} has ${pats.length} slots for ${pool.length} agents`);
    const off = (used[tid] ?? 0) % pool.length;
    pool = [...pool.slice(off), ...pool.slice(0, off)];
    const nUnpop = pats.filter((p) => score(p.o, shifts[p.s].evening) >= 2).length;
    nxt[tid] = (off + Math.max(1, nUnpop)) % pool.length;
    used[tid] = off;
    pool.forEach((a, i) => out.push({ agentId: a.agentId, name: a.name, queue: pats[i].q, shiftIdx: pats[i].s, dayOff: pats[i].o }));
  }
  if (isNew) { state.months[month] = used; state.next = nxt; }
  out.sort((a, b) => (a.queue < b.queue ? -1 : a.queue > b.queue ? 1 : 0) || a.shiftIdx - b.shiftIdx
    || DAYS.indexOf(a.dayOff) - DAYS.indexOf(b.dayOff) || (a.agentId < b.agentId ? -1 : 1));
  return { assignments: out, state };
}
