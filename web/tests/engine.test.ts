import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-ignore - runtime import of the wasm loader
import loadHighs from 'highs';
import { DEFAULT_CONFIG } from '../src/engine/config';
import { runPipeline } from '../src/engine/pipeline';
import { computeCoverage, gaps, summarise } from '../src/engine/coverage';
import { shiftDefs } from '../src/engine/time';
import { validateEdit } from '../src/engine/validate';
import type { Config } from '../src/engine/types';

const VOL = '../data/raw/Half_Hourly_Support_Data_-_Jun26.xlsx';
const AG = '../data/templates/agents_SYNTHETIC_sample.csv';
const have = existsSync(VOL) && existsSync(AG);
const buf = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

describe.skipIf(!have)('parity with the Python engine (real June file + synthetic agents)', () => {
  const cfg: Config = { ...DEFAULT_CONFIG, excludeMonths: [3, 4], solverTimeLimitSec: 60 };
  it('reproduces Stage A benchmarks and a valid optimal roster', async () => {
    const highs: any = await loadHighs();
    const r = runPipeline({ volume: buf(VOL), agents: buf(AG), config: cfg }, highs);
    // Stage A (Python: peak 213, Default 119, incident 2026-05-26)
    expect(r.incidentDays).toEqual(['2026-05-26']);
    expect(r.systemPeakConcurrent).toBe(213);
    const defPeak = Math.max(...r.req.filter((x) => x.q === 'Default').map((x) => x.R));
    expect(defPeak).toBe(119);
    // Stage B
    expect(r.solver.status).toBe('optimal');
    expect(r.assignments.length).toBe(230);
    const cov = computeCoverage(r.assignments, r.req, cfg);
    const { total } = summarise(cov);
    console.log('JS expected missed', total.expMissed.toFixed(1), 'miss%', total.missPct.toFixed(2), 'gaps', gaps(cov).length, 'solve s', r.solver.seconds);
    // Python (scipy/HiGHS): 6425.5 expected missed, 11.9% -> allow 1% for MIP-gap differences
    expect(total.expMissed).toBeGreaterThan(6425.5 * 0.99);
    expect(total.expMissed).toBeLessThan(6425.5 * 1.01);
    // hard constraints
    const shifts = shiftDefs(cfg);
    const byId = new Map(r.agents.map((a) => [a.agentId, a]));
    expect(new Set(r.assignments.map((a) => a.agentId)).size).toBe(230);
    for (const a of r.assignments) {
      expect(validateEdit(byId.get(a.agentId)!, a.queue, a.shiftIdx, a.dayOff, shifts)).toEqual([]);
    }
  });
});
