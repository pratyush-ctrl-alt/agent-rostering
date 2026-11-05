import { assignNames, emptyState } from './assign';
import { buildDemand, buildRequirements, cleanVolume, filterSizingMonths } from './demand';
import { solveRoster, type HighsLike } from './optimize';
import { parseAgents, parseVolume } from './parse';
import type { Config, RotationState, RunResult } from './types';

export interface RunInput {
  volume: ArrayBuffer;
  agents: ArrayBuffer;
  config: Config;
  month?: string; // YYYY-MM; default = latest month in the data
  state?: RotationState;
}

/** Whole monthly run: clean -> Erlang demand -> integrated MILP -> named assignment. */
export function runPipeline(input: RunInput, highs: HighsLike, progress: (m: string) => void = () => {}): RunResult {
  const cfg = input.config;
  progress('Reading call-volume file…');
  const raw = parseVolume(input.volume);
  const cleaned = cleanVolume(raw, cfg);
  if (!cleaned.rows.length) throw new Error('No call-volume rows left after cleaning (check excluded months).');
  const months = [...new Set(cleaned.rows.map((r) => r.date.slice(0, 7)))].sort();
  const month = input.month || months[months.length - 1];
  const upTo = cleaned.rows.filter((r) => r.date.slice(0, 7) <= month);
  const sz = filterSizingMonths(upTo, cfg.sizingMonths);

  progress('Computing demand (Erlang-C)…');
  const { prof, aht } = buildDemand(sz, cfg);
  const req = buildRequirements(prof, cfg);
  const queues = [...new Set(req.map((r) => r.q))].sort();

  progress('Reading agent file…');
  const { agents, issues } = parseAgents(input.agents, cfg, queues);
  if (!agents.length) throw new Error('No valid agents found in the agent file.');

  progress(`Optimising ${agents.length} agents (this can take up to ${cfg.solverTimeLimitSec}s)…`);
  const sol = solveRoster(req, agents, cfg, highs);

  progress('Assigning names…');
  const { assignments, state } = assignNames(sol.counts, agents, cfg, month, input.state ?? emptyState());

  const bySlot = new Map<string, number>();
  for (const r of req) bySlot.set(`${r.dow}|${r.slot}`, (bySlot.get(`${r.dow}|${r.slot}`) ?? 0) + r.R);
  const slotSet = new Set(req.map((r) => r.slot));
  const hist = sz.filter((r) => slotSet.has(r.slot));
  const missed = hist.reduce((a, r) => a + (r.missed || 0), 0);
  const offered = hist.reduce((a, r) => a + (r.offered || 0), 0);
  const dates = sz.map((r) => r.date).sort();

  return {
    month, config: cfg, incidentDays: cleaned.incidentDays,
    sizingFrom: dates[0], sizingTo: dates[dates.length - 1], sizingDays: new Set(dates).size,
    historicalMissPct: offered ? (100 * missed) / offered : 0,
    systemPeakConcurrent: Math.max(...bySlot.values()),
    aht, req, agents, issues, assignments,
    solver: { status: sol.status, objective: sol.objective, nTypes: sol.nTypes, nVars: sol.nVars, seconds: sol.seconds },
    state,
  };
}
