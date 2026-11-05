import * as XLSX from 'xlsx';
import type { Agent, AgentIssue, Config, Day, VolRow } from './types';
import { DAYS } from './types';

type Rec = Record<string, unknown>;

function sheetRows(buf: ArrayBuffer, preferSheet?: string): Rec[] {
  const wb = XLSX.read(buf, { type: 'array', raw: true });
  const name = preferSheet && wb.SheetNames.includes(preferSheet) ? preferSheet : wb.SheetNames[0];
  const raw = XLSX.utils.sheet_to_json<Rec>(wb.Sheets[name], { defval: '', raw: true });
  return raw.map((r) => {
    const o: Rec = {};
    for (const [k, v] of Object.entries(r)) o[k.trim().toLowerCase().replace(/\s+/g, '_')] = v;
    return o;
  });
}

const pad = (n: number) => String(n).padStart(2, '0');

function toDate(v: unknown): string {
  if (typeof v === 'number') { // Excel serial date
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  return String(v).trim().slice(0, 10);
}

function toHM(v: unknown): string {
  if (typeof v === 'number') { // fraction of a day
    const m = Math.round(v * 24 * 60);
    return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
  }
  const s = String(v).trim();
  return s.length >= 5 ? s.slice(0, 5) : s;
}

function toSec(v: unknown): number {
  if (typeof v === 'number') return v < 1 ? Math.round(v * 86400) : v; // fraction of day, or already seconds
  if (typeof v === 'string' && v.includes(':')) {
    const [h, m, s] = v.split(':').map(Number);
    return h * 3600 + m * 60 + (s || 0);
  }
  return NaN;
}

const num = (v: unknown) => (v === '' || v == null ? NaN : Number(v));

export const VOLUME_COLUMNS = ['date part', 'time slot', 'queue multiFilter', 'calls', 'connected calls', 'missed calls in business', 'aht'];

/** Parse the half-hourly call-volume export (xlsx or csv). Throws a readable error if columns are missing. */
export function parseVolume(buf: ArrayBuffer): VolRow[] {
  const recs = sheetRows(buf, 'result');
  if (!recs.length) throw new Error('Call-volume file is empty.');
  const need = ['date_part', 'time_slot', 'queue_multifilter', 'calls', 'connected_calls', 'missed_calls_in_business', 'aht'];
  const missing = need.filter((c) => !(c in recs[0]));
  if (missing.length) throw new Error(`Call-volume file is missing columns: ${missing.join(', ')}`);
  const out: VolRow[] = [];
  for (const r of recs) {
    const date = toDate(r['date_part']);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    out.push({
      date,
      dow: DAYS[(new Date(date + 'T00:00:00Z').getUTCDay() + 6) % 7],
      slot: toHM(r['time_slot']),
      q: String(r['queue_multifilter']).trim(),
      offered: num(r['calls']),
      answered: num(r['connected_calls']),
      missed: num(r['missed_calls_in_business']),
      ahtS: toSec(r['aht']),
    });
  }
  if (!out.length) throw new Error('No valid dated rows found in the call-volume file.');
  return out;
}

// ---------------------------------------------------------------- agents

const LANG_ALIAS: Record<string, string> = { hindi: 'Default', english: 'Default', default: 'Default', 'hindi/english': 'Default' };

const yn = (v: unknown, dflt: boolean) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '' ? dflt : ['y', 'yes', 'true', '1'].includes(s);
};

function toDay(v: unknown): Day | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  const d = DAYS.find((x) => x.toLowerCase() === s || x.toLowerCase().slice(0, 3) === s.slice(0, 3));
  if (!d) throw new Error(`unknown day '${v}'`);
  return d;
}

const split = (v: unknown) => String(v ?? '').replace(/,/g, ';').split(';').map((x) => x.trim()).filter(Boolean);

export const AGENT_HEADER = ['agent_id', 'name', 'primary_queue', 'alternate_queues', 'available_sunday', 'evening_ok', 'fixed_day_off'];

/** Parse the agent list. Rows with bad data are returned as issues and excluded (never silently dropped). */
export function parseAgents(buf: ArrayBuffer, cfg: Config, validQueues: string[]): { agents: Agent[]; issues: AgentIssue[] } {
  const recs = sheetRows(buf);
  if (!recs.length) throw new Error('Agent file is empty.');
  if (!('agent_id' in recs[0])) throw new Error("Agent file needs an 'agent_id' column.");
  if (!('primary_queue' in recs[0]) && !('queues' in recs[0])) throw new Error("Agent file needs a 'primary_queue' column.");
  const qmap: Record<string, string> = {};
  validQueues.forEach((q) => (qmap[q.toLowerCase()] = q));
  Object.assign(qmap, LANG_ALIAS);
  for (const [k, v] of Object.entries(cfg.queueMerges)) qmap[k.toLowerCase()] = v;

  const agents: Agent[] = [];
  const issues: AgentIssue[] = [];
  const seen = new Set<string>();
  for (const r of recs) {
    const agentId = String(r['agent_id']).trim();
    const name = String(r['name'] ?? '').trim();
    if (!agentId && !name) continue; // blank line
    try {
      if (!agentId) throw new Error('missing agent_id');
      if (seen.has(agentId)) throw new Error('duplicate agent_id');
      seen.add(agentId);
      const toks = 'primary_queue' in r ? [...split(r['primary_queue']), ...split(r['alternate_queues'])] : split(r['queues']);
      const queues: string[] = [];
      for (const t of toks) {
        const q = qmap[t.toLowerCase()];
        if (!q) throw new Error(`unknown queue '${t}'`);
        if (!queues.includes(q)) queues.push(q);
      }
      if (!queues.length) throw new Error('no primary queue');
      const availableSunday = yn(r['available_sunday'], true);
      const eveningOk = yn(r['evening_ok'], true);
      const fixedDayOff = toDay(r['fixed_day_off']);
      if (fixedDayOff && !availableSunday && fixedDayOff !== 'Sunday')
        throw new Error(`contradiction: unavailable Sunday but fixed day off is ${fixedDayOff}`);
      agents.push({ agentId, name, queues, primary: queues[0], availableSunday, eveningOk, fixedDayOff,
        typeId: `${queues.join('+')}|sun=${+availableSunday}|eve=${+eveningOk}|off=${fixedDayOff ?? '-'}` });
    } catch (e) {
      issues.push({ agentId, name, issue: (e as Error).message });
    }
  }
  return { agents, issues };
}
