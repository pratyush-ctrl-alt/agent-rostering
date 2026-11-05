import { useRef, useState } from 'react';
import { DEFAULT_CONFIG } from './engine/config';
import type { Config, RotationState, RunResult } from './engine/types';
import { AGENT_TEMPLATE_CSV, VOLUME_TEMPLATE_CSV, download } from './exporters';
import Results from './Results';

const readBuf = (f: File) => f.arrayBuffer();

function FilePick({ label, hint, file, onFile, accept, template }: {
  label: string; hint: string; file: File | null; onFile: (f: File | null) => void; accept: string; template?: () => void;
}) {
  return (
    <div className="file">
      <b>{label}</b>
      <input type="file" accept={accept} onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
      {file && <div className="name">✓ {file.name}</div>}
      <small>{hint} {template && <button className="link" onClick={template}>Download template</button>}</small>
    </div>
  );
}

export default function App() {
  const [vol, setVol] = useState<File | null>(null);
  const [agents, setAgents] = useState<File | null>(null);
  const [stateFile, setStateFile] = useState<File | null>(null);
  const [cfg, setCfg] = useState<Config>(DEFAULT_CONFIG);
  const [exclude, setExclude] = useState('');
  const [sizing, setSizing] = useState('all');
  const [month, setMonth] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const setSL = (k: 'target' | 'thresholdSec', v: number) => setCfg({ ...cfg, serviceLevel: { ...cfg.serviceLevel, [k]: v } });

  async function run() {
    setError(''); setResult(null);
    if (!vol || !agents) { setError('Please choose both the call-volume file and the agent list.'); return; }
    setBusy(true); setProgress('Starting…');
    try {
      let state: RotationState | undefined;
      if (stateFile) {
        try { state = JSON.parse(await stateFile.text()); } catch { throw new Error('The rotation file is not valid JSON. Remove it or choose the file this tool exported last month.'); }
      }
      const config: Config = {
        ...cfg,
        excludeMonths: exclude.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => n >= 1 && n <= 12),
        sizingMonths: sizing === 'all' ? 'all' : Math.max(1, parseInt(sizing, 10) || 1),
      };
      const [volume, ag] = [await readBuf(vol), await readBuf(agents)];
      workerRef.current?.terminate();
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = w;
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') setProgress(m.msg);
        else if (m.type === 'done') { setResult(m.result); setBusy(false); w.terminate(); }
        else if (m.type === 'error') { setError(m.msg); setBusy(false); w.terminate(); }
      };
      w.onerror = (e) => { setError(e.message || 'Worker failed'); setBusy(false); };
      w.postMessage({ volume, agents: ag, config, month: month.trim() || undefined, state }, [volume, ag]);
    } catch (e) {
      setError((e as Error).message); setBusy(false);
    }
  }

  return (
    <>
      <header><h1>Support Rostering Tool</h1><span>Everything runs in your browser — files are never uploaded anywhere.</span></header>
      <main>
        <div className="card">
          <h2>1 · Upload</h2>
          <div className="grid2">
            <FilePick label="Call-volume file (last month's half-hourly export)" accept=".xlsx,.xls,.csv" file={vol} onFile={setVol}
              hint="Excel sheet “result” or CSV, same columns as the usual export." template={() => download(new Blob([VOLUME_TEMPLATE_CSV], { type: 'text/csv' }), 'call_volume_template.csv')} />
            <FilePick label="Agent list" accept=".xlsx,.xls,.csv" file={agents} onFile={setAgents}
              hint="One row per agent: agent_id, name, primary_queue, alternate_queues, available_sunday, evening_ok, fixed_day_off."
              template={() => download(new Blob([AGENT_TEMPLATE_CSV], { type: 'text/csv' }), 'agent_list_template.csv')} />
          </div>
          <div className="grid2" style={{ marginTop: 12 }}>
            <FilePick label="Rotation file from last month (optional)" accept=".json" file={stateFile} onFile={setStateFile}
              hint="Upload the rotation file this tool exported last month so Sunday/evening duty moves to different people. Skip it for the first month." />
            <div className="note" style={{ margin: 0 }}>
              <b>Agent list rules.</b> <code>alternate_queues</code> separate with “;”. Hindi / English / Gujarati / Bengali all mean the <b>Default</b> queue.
              <code> available_sunday = N</code> → Sunday is always their day off. <code>evening_ok = N</code> → no shift ending after {cfg.eveningCutoff}.
              <code> fixed_day_off</code> pins the weekly off day. Bad rows are listed and left out, never silently dropped.
            </div>
          </div>
          <details style={{ marginTop: 14 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Settings (defaults are the validated values)</summary>
            <div className="settings">
              <label>Service level target (0–1)<input type="number" step="0.01" min="0.5" max="0.99" value={cfg.serviceLevel.target} onChange={(e) => setSL('target', +e.target.value)} /></label>
              <label>Answer within (seconds)<input type="number" min="5" value={cfg.serviceLevel.thresholdSec} onChange={(e) => setSL('thresholdSec', +e.target.value)} /></label>
              <label>Productive hours per 9-hour shift<input type="number" step="0.1" min="4" max="9" value={cfg.productiveHours} onChange={(e) => setCfg({ ...cfg, productiveHours: +e.target.value })} /></label>
              <label>Evening = shift ending after<input type="text" value={cfg.eveningCutoff} onChange={(e) => setCfg({ ...cfg, eveningCutoff: e.target.value })} /></label>
              <label>Months to ignore (e.g. 3,4)<input type="text" value={exclude} placeholder="none" onChange={(e) => setExclude(e.target.value)} /></label>
              <label>Size on (“all” or last N months)<input type="text" value={sizing} onChange={(e) => setSizing(e.target.value)} /></label>
              <label>Incident day = volume above × median<input type="number" step="0.1" min="1.2" value={cfg.incidentThreshold} onChange={(e) => setCfg({ ...cfg, incidentThreshold: +e.target.value })} /></label>
              <label>Roster month label (YYYY-MM, blank = latest)<input type="text" value={month} placeholder="latest" onChange={(e) => setMonth(e.target.value)} /></label>
              <label>Solver time limit (seconds)<input type="number" min="10" value={cfg.solverTimeLimitSec} onChange={(e) => setCfg({ ...cfg, solverTimeLimitSec: +e.target.value })} /></label>
            </div>
          </details>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" disabled={busy || !vol || !agents} onClick={run}>{busy ? 'Working…' : 'Generate roster'}</button>
            {busy && <span><span className="spin" />{progress}</span>}
          </div>
          {error && <div className="err">{error}</div>}
        </div>
        {result && <Results key={result.month + result.solver.seconds} initial={result} />}
      </main>
    </>
  );
}
