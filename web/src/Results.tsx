import { useEffect, useMemo, useRef, useState } from 'react';
import { computeCoverage, gaps, missCurve, skillSupply, summarise } from './engine/coverage';
import { shiftDefs } from './engine/time';
import { validateEdit } from './engine/validate';
import type { Assignment, CovRow, Day, RunResult } from './engine/types';
import { DAYS } from './engine/types';
import { coverageXlsx, download, rosterCsv, rosterRows, rosterXlsx } from './exporters';

const f1 = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const f0 = (x: number) => Math.round(x).toLocaleString();
type Tab = 'summary' | 'roster' | 'coverage' | 'gaps' | 'curve' | 'checks';

function Kpi({ v, l, s }: { v: string; l: string; s?: string }) {
  return <div className="kpi"><div className="v">{v}</div><div className="l">{l}</div>{s && <div className="s">{s}</div>}</div>;
}

export default function Results({ initial }: { initial: RunResult }) {
  const cfg = initial.config;
  const shifts = useMemo(() => shiftDefs(cfg), [cfg]);
  const [assign, setAssign] = useState<Assignment[]>(initial.assignments);
  const [tab, setTab] = useState<Tab>('summary');
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView({ behavior: 'smooth' }); }, []);
  const agentById = useMemo(() => new Map(initial.agents.map((a) => [a.agentId, a])), [initial.agents]);
  const queues = useMemo(() => [...new Set(initial.req.map((r) => r.q))].sort(), [initial.req]);

  const cov = useMemo(() => computeCoverage(assign, initial.req, cfg), [assign, initial.req, cfg]);
  const cov0 = useMemo(() => computeCoverage(initial.assignments, initial.req, cfg), [initial]);
  const sum = summarise(cov);
  const sum0 = summarise(cov0);

  const violations = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of assign) {
      const v = validateEdit(agentById.get(a.agentId)!, a.queue, a.shiftIdx, a.dayOff, shifts);
      if (v.length) m.set(a.agentId, v);
    }
    return m;
  }, [assign, agentById, shifts]);

  const editedCount = assign.filter((a, i) => { const o = initial.assignments.find((x) => x.agentId === a.agentId)!; return o.queue !== a.queue || o.shiftIdx !== a.shiftIdx || o.dayOff !== a.dayOff; }).length;
  const gapRows = gaps(cov);

  function setRow(id: string, patch: Partial<Assignment>) {
    setAssign((cur) => cur.map((a) => (a.agentId === id ? { ...a, ...patch } : a)));
  }
  function exportAll(kind: 'csv' | 'xlsx' | 'cov' | 'state') {
    const rows = rosterRows(assign, initial.assignments, initial.agents, cfg);
    const m = initial.month;
    if (violations.size && (kind === 'csv' || kind === 'xlsx') &&
      !confirm(`${violations.size} agent(s) currently break a rule (shown in red on the Roster tab). Export anyway? The 'Rule Check' column will flag them.`)) return;
    if (kind === 'csv') download(rosterCsv(rows), `roster_${m}.csv`);
    if (kind === 'xlsx') download(rosterXlsx(rows), `roster_${m}.xlsx`);
    if (kind === 'cov') download(coverageXlsx(cov, initial.agents, initial.req, initial.issues), `coverage_${m}.xlsx`);
    if (kind === 'state') download(new Blob([JSON.stringify(initial.state, null, 1)], { type: 'application/json' }), `rotation_state.json`);
  }

  const tabs: [Tab, string][] = [['summary', 'Summary'], ['roster', `Roster (${assign.length})`], ['coverage', 'Coverage'],
    ['gaps', `Gaps (${gapRows.length})`], ['curve', 'Outbound miss curve'], ['checks', `Data checks${initial.issues.length ? ` (${initial.issues.length})` : ''}`]];

  return (
    <div className="card" ref={top}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>2 · Roster for {initial.month}</h2>
        <div className="row">
          <button onClick={() => exportAll('csv')}>Roster CSV</button>
          <button className="primary" onClick={() => exportAll('xlsx')}>Roster XLSX</button>
          <button onClick={() => exportAll('cov')}>Coverage XLSX</button>
          <button onClick={() => exportAll('state')} title="Upload this next month so duty rotates">Rotation file</button>
        </div>
      </div>
      {violations.size > 0 && <div className="warn"><b>{violations.size} agent(s) break a rule</b> after your edits (red rows in the Roster tab).</div>}
      <div className="tabs">{tabs.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>

      {tab === 'summary' && <>
        <div className="kpis">
          <Kpi v={String(assign.length)} l="Agents rostered" s={initial.issues.length ? `${initial.issues.length} left out (bad rows)` : 'all agents placed'} />
          <Kpi v={`${f1(sum.total.missPct)}%`} l="Expected miss (model estimate)" s={editedCount ? `before edits ${f1(sum0.total.missPct)}%` : 'on the sizing-period demand'} />
          <Kpi v={`${f1(initial.historicalMissPct)}%`} l="Actual miss, same period" s="from the uploaded file — a different measure, see note" />
          <Kpi v={String(initial.systemPeakConcurrent)} l="Peak agents needed at once" s={`≈ ${Math.ceil(initial.systemPeakConcurrent / (cfg.productiveHours / cfg.shiftHours))} people rostered once breaks are allowed for`} />
          <Kpi v={f0(sum.total.expMissed)} l="Expected missed calls / week" s={editedCount ? `${editedCount} edit(s) so far` : undefined} />
          <Kpi v={String(gapRows.length)} l="Under-covered queue slots" s="queue × day × half-hour" />
        </div>
        <div className="note">
          Sized on {initial.sizingFrom} → {initial.sizingTo} ({initial.sizingDays} days){initial.incidentDays.length ? `; incident day(s) excluded: ${initial.incidentDays.join(', ')}` : '; no incident days found'}.
          Solver: {initial.solver.status} in {f1(initial.solver.seconds)}s. The “expected miss” is a planning proxy (calls ÷ people needed × people short) for comparing rosters; it is not a forecast of the abandon rate, so don't compare it directly to the actual miss.
        </div>
        <div className="tw"><table>
          <caption>One row per queue. Source: uploaded call-volume file, averaged by weekday and half-hour; scheduled agents from the roster as currently edited.</caption>
          <thead><tr><th>Queue</th><th className="n">Calls / week</th><th className="n">Expected missed</th><th className="n">Expected miss %</th><th className="n">Peak agents needed</th><th className="n">Worst shortfall</th></tr></thead>
          <tbody>{sum.perQueue.map((s) => <tr key={s.queue}><td>{s.queue}</td><td className="n">{f0(s.offered)}</td><td className="n">{f0(s.expMissed)}</td><td className="n">{f1(s.missPct)}%</td><td className="n">{s.peakRequiredBodies}</td><td className="n">{s.peakShort}</td></tr>)}</tbody>
        </table></div>
      </>}

      {tab === 'roster' && <RosterTab assign={assign} initial={initial} queues={queues} shifts={shifts} violations={violations} setRow={setRow}
        onReset={() => setAssign(initial.assignments)} editedCount={editedCount} deltaMissed={sum.total.expMissed - sum0.total.expMissed} />}
      {tab === 'coverage' && <CoverageTab cov={cov} queues={queues} />}
      {tab === 'gaps' && <GapsTab cov={cov} gapRows={gapRows} />}
      {tab === 'curve' && <CurveTab cov={cov} />}
      {tab === 'checks' && <ChecksTab r={initial} />}
    </div>
  );
}

function RosterTab({ assign, initial, queues, shifts, violations, setRow, onReset, editedCount, deltaMissed }: {
  assign: Assignment[]; initial: RunResult; queues: string[]; shifts: ReturnType<typeof shiftDefs>; violations: Map<string, string[]>;
  setRow: (id: string, p: Partial<Assignment>) => void; onReset: () => void; editedCount: number; deltaMissed: number;
}) {
  const [q, setQ] = useState('all');
  const [text, setText] = useState('');
  const [only, setOnly] = useState<'all' | 'edited' | 'bad'>('all');
  const orig = useMemo(() => new Map(initial.assignments.map((a) => [a.agentId, a])), [initial]);
  const rows = assign.filter((a) => {
    if (q !== 'all' && a.queue !== q) return false;
    if (text && !(`${a.agentId} ${a.name}`.toLowerCase().includes(text.toLowerCase()))) return false;
    const o = orig.get(a.agentId)!;
    const ed = o.queue !== a.queue || o.shiftIdx !== a.shiftIdx || o.dayOff !== a.dayOff;
    if (only === 'edited' && !ed) return false;
    if (only === 'bad' && !violations.has(a.agentId)) return false;
    return true;
  });
  const agents = new Map(initial.agents.map((a) => [a.agentId, a]));
  return <>
    <div className="row" style={{ marginBottom: 10 }}>
      <select value={q} onChange={(e) => setQ(e.target.value)}><option value="all">All queues</option>{queues.map((x) => <option key={x}>{x}</option>)}</select>
      <input type="text" placeholder="Search name / ID" value={text} onChange={(e) => setText(e.target.value)} />
      <select value={only} onChange={(e) => setOnly(e.target.value as 'all')}><option value="all">All agents</option><option value="edited">Edited only</option><option value="bad">Rule violations only</option></select>
      <span style={{ color: 'var(--mute)' }}>{rows.length} shown · {editedCount} edited · change vs generated roster: {deltaMissed >= 0 ? '+' : ''}{f1(deltaMissed)} missed calls/week</span>
      <button onClick={onReset} disabled={!editedCount}>Reset all edits</button>
    </div>
    <div className="tw"><table>
      <caption>One row per agent. Change queue, shift or day off — rules and coverage re-check instantly. Blue = edited, red = breaks a rule.</caption>
      <thead><tr><th>Agent ID</th><th>Name</th><th>Skills</th><th>Queue</th><th>Shift</th><th>Day off</th><th>Check</th></tr></thead>
      <tbody>{rows.map((a) => {
        const v = violations.get(a.agentId); const o = orig.get(a.agentId)!;
        const ed = o.queue !== a.queue || o.shiftIdx !== a.shiftIdx || o.dayOff !== a.dayOff;
        return <tr key={a.agentId} className={v ? 'bad' : ed ? 'edited' : ''}>
          <td>{a.agentId}</td><td>{a.name}</td><td>{agents.get(a.agentId)!.queues.join(' · ')}</td>
          <td><select value={a.queue} onChange={(e) => setRow(a.agentId, { queue: e.target.value })}>{queues.map((x) => <option key={x}>{x}</option>)}</select></td>
          <td><select value={a.shiftIdx} onChange={(e) => setRow(a.agentId, { shiftIdx: +e.target.value })}>{shifts.map((s) => <option key={s.idx} value={s.idx}>{s.start}–{s.end}{s.evening ? ' (evening)' : ''}</option>)}</select></td>
          <td><select value={a.dayOff} onChange={(e) => setRow(a.agentId, { dayOff: e.target.value as Day })}>{DAYS.map((d) => <option key={d}>{d}</option>)}</select></td>
          <td>{v ? <span className="chip bad" title={v.join('\n')}>{v[0]}</span> : <span className="chip ok">OK</span>}</td>
        </tr>;
      })}</tbody>
    </table></div>
  </>;
}

function CoverageTab({ cov, queues }: { cov: CovRow[]; queues: string[] }) {
  const [q, setQ] = useState(queues[0]);
  const slots = [...new Set(cov.map((c) => c.slot))].sort();
  const get = (d: Day, s: string) => cov.find((c) => c.q === q && c.dow === d && c.slot === s);
  const color = (c?: CovRow) => {
    if (!c || c.Rreq === 0) return '#f2f4f7';
    if (c.short === 0) return c.scheduled > c.Rreq * 1.25 ? '#b7e4c7' : '#d8f3dc';
    const f = c.short / c.Rreq;
    return f > 0.5 ? '#f4a3a0' : f > 0.25 ? '#f9c9a6' : '#fde9b8';
  };
  return <>
    <div className="row"><select value={q} onChange={(e) => setQ(e.target.value)}>{queues.map((x) => <option key={x}>{x}</option>)}</select>
      <span style={{ color: 'var(--mute)' }}>Each cell: scheduled / required agents (bodies on shift, after break allowance).</span></div>
    <div className="legend"><span><i style={{ background: '#d8f3dc' }} />covered</span><span><i style={{ background: '#b7e4c7' }} />over 25% spare</span><span><i style={{ background: '#fde9b8' }} />short &lt;25%</span><span><i style={{ background: '#f9c9a6' }} />short 25–50%</span><span><i style={{ background: '#f4a3a0' }} />short &gt;50%</span></div>
    <div className="tw"><table className="heat">
      <thead><tr><th>Slot</th>{DAYS.map((d) => <th key={d}>{d.slice(0, 3)}</th>)}</tr></thead>
      <tbody>{slots.map((s) => <tr key={s}><th>{s}</th>{DAYS.map((d) => { const c = get(d, s); return <td key={d} style={{ background: color(c) }} title={c ? `mean ${f1(c.offered)} calls · expected missed ${f1(c.expMissed)}` : ''}>{c ? `${c.scheduled}/${c.Rreq}` : '–'}</td>; })}</tr>)}</tbody>
    </table></div>
  </>;
}

function GapsTab({ cov, gapRows }: { cov: CovRow[]; gapRows: CovRow[] }) {
  const byQ = [...gapRows.reduce((m, c) => { const e = m.get(c.q) ?? { n: 0, peak: 0, miss: 0 }; e.n++; e.peak = Math.max(e.peak, c.short); e.miss += c.expMissed; m.set(c.q, e); return m; }, new Map<string, { n: number; peak: number; miss: number }>())].sort((a, b) => b[1].miss - a[1].miss);
  const top = [...gapRows].sort((a, b) => b.expMissed - a.expMissed).slice(0, 150);
  if (!gapRows.length) return <div className="note">No gaps: every queue slot is fully covered.</div>;
  return <>
    <div className="note">Gaps are where the available agents cannot meet demand. They are listed, never hidden. A queue with gaps needs more skilled agents (or a skill added to existing agents), not a different shift pattern.</div>
    <div className="tw" style={{ marginBottom: 14 }}><table>
      <caption>One row per queue: how many (day × half-hour) slots are short, the worst shortfall, and expected missed calls per week.</caption>
      <thead><tr><th>Queue</th><th className="n">Short slots</th><th className="n">Worst shortfall (agents)</th><th className="n">Expected missed / week</th></tr></thead>
      <tbody>{byQ.map(([q, e]) => <tr key={q}><td>{q}</td><td className="n">{e.n}</td><td className="n">{e.peak}</td><td className="n">{f0(e.miss)}</td></tr>)}</tbody></table></div>
    <div className="tw"><table>
      <caption>150 worst slots by expected missed calls (full list is in the Coverage XLSX “Gaps” sheet).</caption>
      <thead><tr><th>Queue</th><th>Day</th><th>Slot</th><th className="n">Required</th><th className="n">Scheduled</th><th className="n">Short</th><th className="n">Expected missed</th></tr></thead>
      <tbody>{top.map((c) => <tr key={`${c.q}${c.dow}${c.slot}`}><td>{c.q}</td><td>{c.dow}</td><td>{c.slot}</td><td className="n">{c.Rreq}</td><td className="n">{c.scheduled}</td><td className="n">{c.short}</td><td className="n">{f1(c.expMissed)}</td></tr>)}</tbody></table></div>
  </>;
}

function CurveTab({ cov }: { cov: CovRow[] }) {
  const mc = missCurve(cov);
  const max = Math.max(1, ...mc.map((m) => m.weekly));
  const total = mc.reduce((a, m) => a + m.weekly, 0);
  return <>
    <div className="note">Calls expected to go unanswered, by clock hour, summed over the week ({f0(total)} total). This is the volume the separate outbound call-back team has to absorb.</div>
    <svg viewBox={`0 0 ${mc.length * 60 + 40} 190`} style={{ width: '100%', maxWidth: 900 }}>
      {mc.map((m, i) => { const h = (m.weekly / max) * 140; return <g key={m.hour}>
        <rect x={30 + i * 60} y={150 - h} width={44} height={h} fill="#2b5cff" rx={3} />
        <text x={52 + i * 60} y={144 - h} fontSize="11" textAnchor="middle" fill="#344054">{f0(m.weekly)}</text>
        <text x={52 + i * 60} y={170} fontSize="11" textAnchor="middle" fill="#667085">{m.hour}</text></g>; })}
    </svg>
    <div className="tw"><table>
      <caption>One row per clock hour; columns are expected missed calls for that weekday.</caption>
      <thead><tr><th>Hour</th>{DAYS.map((d) => <th className="n" key={d}>{d.slice(0, 3)}</th>)}<th className="n">Week</th></tr></thead>
      <tbody>{mc.map((m) => <tr key={m.hour}><td>{m.hour}</td>{m.byDay.map((v, i) => <td className="n" key={i}>{f0(v)}</td>)}<td className="n"><b>{f0(m.weekly)}</b></td></tr>)}</tbody></table></div>
  </>;
}

function ChecksTab({ r }: { r: RunResult }) {
  const supply = skillSupply(r.agents, r.req);
  return <>
    {r.issues.length > 0 && <div className="tw" style={{ marginBottom: 14 }}><table>
      <caption>Agent rows that were left out of the roster because of bad data. Fix them in the agent file and re-run.</caption>
      <thead><tr><th>Agent ID</th><th>Name</th><th>Problem</th></tr></thead>
      <tbody>{r.issues.map((i, k) => <tr key={k}><td>{i.agentId}</td><td>{i.name}</td><td>{i.issue}</td></tr>)}</tbody></table></div>}
    {!r.issues.length && <div className="note">All agent rows were valid.</div>}
    <div className="tw" style={{ marginBottom: 14 }}><table>
      <caption>One row per queue. “With skill” counts every agent who can serve the queue, so multi-skill agents appear under several queues and rows overlap.</caption>
      <thead><tr><th>Queue</th><th className="n">Peak agents needed</th><th className="n">Agents with skill</th><th className="n">Agents with it as primary</th><th className="n">Avg handle time (s)</th></tr></thead>
      <tbody>{supply.map((s) => <tr key={s.queue}><td>{s.queue}</td><td className="n">{s.peakBodiesNeeded}</td><td className="n">{s.agentsWithSkill}</td><td className="n">{s.agentsPrimary}</td><td className="n">{Math.round(r.aht[s.queue])}</td></tr>)}</tbody></table></div>
  </>;
}
