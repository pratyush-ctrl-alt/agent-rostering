import * as XLSX from 'xlsx';
import { gaps, missCurve, skillSupply, summarise } from './engine/coverage';
import { shiftDefs } from './engine/time';
import { validateEdit } from './engine/validate';
import { AGENT_HEADER } from './engine/parse';
import type { Agent, Assignment, Config, CovRow, Req } from './engine/types';
import { DAYS } from './engine/types';

export function rosterRows(assign: Assignment[], original: Assignment[], agents: Agent[], cfg: Config) {
  const shifts = shiftDefs(cfg);
  const byId = new Map(agents.map((a) => [a.agentId, a]));
  const orig = new Map(original.map((a) => [a.agentId, a]));
  return assign.map((a) => {
    const ag = byId.get(a.agentId)!;
    const o = orig.get(a.agentId);
    const viol = validateEdit(ag, a.queue, a.shiftIdx, a.dayOff, shifts);
    return {
      'Agent ID': a.agentId, Name: a.name, Queue: a.queue,
      'Shift Start': shifts[a.shiftIdx].start, 'Shift End': shifts[a.shiftIdx].end,
      'Day Off': a.dayOff, 'Working Days': DAYS.filter((d) => d !== a.dayOff).join(', '),
      Skills: ag.queues.join(';'), 'On Primary Queue': a.queue === ag.primary ? 'Y' : 'N',
      Edited: o && (o.queue !== a.queue || o.shiftIdx !== a.shiftIdx || o.dayOff !== a.dayOff) ? 'Y' : '',
      'Rule Check': viol.length ? 'VIOLATION: ' + viol.join('; ') : 'OK',
    };
  });
}

const xlsxBlob = (wb: XLSX.WorkBook) =>
  new Blob([XLSX.write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/octet-stream' });

export function rosterXlsx(rows: ReturnType<typeof rosterRows>) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Roster');
  return xlsxBlob(wb);
}

export function rosterCsv(rows: ReturnType<typeof rosterRows>) {
  return new Blob([XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows))], { type: 'text/csv' });
}

export function coverageXlsx(cov: CovRow[], agents: Agent[], req: Req[], issues: { agentId: string; name: string; issue: string }[]) {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: object[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ note: 'none' }]), name);
  add('Coverage', cov.map((c) => ({ queue: c.q, day: c.dow, slot: c.slot, mean_offered_calls: +c.offered.toFixed(2),
    required_concurrent: c.R, required_bodies: c.Rreq, scheduled_bodies: c.scheduled, agents_short: c.short,
    expected_missed_calls: +c.expMissed.toFixed(2), miss_pct: +c.missPct.toFixed(1) })));
  add('Gaps', gaps(cov).map((c) => ({ queue: c.q, day: c.dow, slot: c.slot, required_bodies: c.Rreq,
    scheduled_bodies: c.scheduled, agents_short: c.short, expected_missed_calls: +c.expMissed.toFixed(2) })));
  add('Queue summary', summarise(cov).perQueue.map((s) => ({ ...s, expMissed: +s.expMissed.toFixed(1), offered: +s.offered.toFixed(1), missPct: +s.missPct.toFixed(1) })));
  const mc = missCurve(cov);
  add('Hourly miss curve', mc.map((m) => ({ hour: m.hour, missed_calls_per_week: +m.weekly.toFixed(1) })));
  add('Miss curve by day', mc.map((m) => ({ hour: m.hour, ...Object.fromEntries(DAYS.map((d, i) => [d, +m.byDay[i].toFixed(1)])) })));
  add('Skill supply vs need', skillSupply(agents, req));
  add('Agent input issues', issues);
  return xlsxBlob(wb);
}

export const AGENT_TEMPLATE_CSV = [
  AGENT_HEADER.join(','),
  'A001,Ravi K,Default,,Y,Y,',
  'A002,Priya S,Tamil,Default,Y,N,',
  'A003,Lakshmi R,Telugu,Default;Tamil,N,Y,',
  'A004,Example Fixed Off,Default,,Y,Y,Wednesday',
].join('\n');

export const VOLUME_TEMPLATE_CSV = [
  'date part,time slot,queue multiFilter,calls,connected calls,missed calls in business,aht',
  '2026-06-01,09:00:00,Default,160,67,93,00:14:41',
  '2026-06-01,09:00:00,Kannada,15,4,11,00:12:24',
  '2026-06-01,09:30:00,Default,172,90,82,00:14:10',
].join('\n');

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
