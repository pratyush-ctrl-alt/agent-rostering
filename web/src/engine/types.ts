export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type Day = (typeof DAYS)[number];

export interface Config {
  serviceLevel: { target: number; thresholdSec: number };
  shiftHours: number;
  productiveHours: number;
  shiftWindows: [string, string][];
  eveningCutoff: string;
  operatingWindow: [string, string];
  queueMerges: Record<string, string>;
  excludeMonths: number[];
  incidentThreshold: number;
  sizingMonths: 'all' | number;
  offdayPenalty: Record<Day, number>;
  solverTimeLimitSec: number;
}

export interface Shift { idx: number; start: string; end: string; slots: number[]; evening: boolean }

/** One cleaned half-hourly volume row. */
export interface VolRow {
  date: string; // YYYY-MM-DD
  dow: Day;
  slot: string; // HH:MM
  q: string;
  offered: number;
  answered: number;
  missed: number;
  ahtS: number; // NaN if missing
}

export interface Agent {
  agentId: string;
  name: string;
  queues: string[]; // first = primary
  primary: string;
  availableSunday: boolean;
  eveningOk: boolean;
  fixedDayOff: Day | null;
  typeId: string;
}

export interface AgentIssue { agentId: string; name: string; issue: string }

export interface Req {
  q: string; dow: Day; slot: string;
  offered: number; // mean calls in the slot
  R: number; // required concurrent agents
  Rreq: number; // rostered bodies after productive-hours adjustment
  w: number; // calls missed per missing body
}

export interface Assignment { agentId: string; name: string; queue: string; shiftIdx: number; dayOff: Day }

export interface CovRow extends Req { scheduled: number; short: number; expMissed: number; missPct: number }

export interface RotationState { months: Record<string, Record<string, number>>; next: Record<string, number> }

export interface QueueSummary { queue: string; offered: number; expMissed: number; peakRequiredBodies: number; peakShort: number; missPct: number }

export interface RunResult {
  month: string;
  config: Config;
  incidentDays: string[];
  sizingFrom: string; sizingTo: string; sizingDays: number;
  historicalMissPct: number;
  systemPeakConcurrent: number;
  aht: Record<string, number>;
  req: Req[];
  agents: Agent[];
  issues: AgentIssue[];
  assignments: Assignment[];
  solver: { status: string; objective: number; nTypes: number; nVars: number; seconds: number };
  state: RotationState;
}
