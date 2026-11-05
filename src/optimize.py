"""Stage B: integrated assignment MILP (PRD s5) solved with HiGHS via scipy.optimize.milp.

Agents with identical constraints are grouped into TYPES (same queues/primary, Sunday,
evening, fixed-off). Variable n[type,q,s,o] = how many agents of that type go on queue q,
shift s, day-off o. Equivalent to one binary per named agent but without symmetry; the
named people are filled in afterwards by assign.py.

minimise  sum w[q,d,t]*short[q,d,t]            (expected missed calls, linear proxy)
        + tiny tie-breakers (off-day penalty, off-primary-queue)
s.t.  sum_{q,s,o} n[type,q,s,o] = |type|                      every agent placed once
      sum n[type,q,s,o | s covers t, o != d] + short >= R_req[q,d,t]
"""
import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds
from scipy.sparse import coo_matrix
import pandas as pd
from model import DAYS, op_slots, shift_defs

TIE_OFFDAY = 1e-5     # per unit of offday_penalty, per agent
TIE_OFFPRIMARY = 1e-6  # per agent placed off their primary queue


def allowed_offs(sun, fixed):
    if isinstance(fixed, str) and fixed:
        return [fixed]
    if not sun:
        return ['Sunday']
    return list(DAYS)


def solve(req, agents, cfg, time_limit=None):
    shifts = shift_defs(cfg)
    slots = op_slots(cfg)
    ntime = len(slots)
    queues = sorted(req['Q'].unique())
    types = (agents.groupby('type_id')
                   .agg(n=('agent_id', 'size'), queues=('queues', 'first'),
                        primary=('primary', 'first'), sun=('available_sunday', 'first'),
                        eve=('evening_ok', 'first'), fixed=('fixed_day_off', 'first'))
                   .reset_index())
    unknown = {q for qs in types['queues'] for q in qs} - set(queues)
    if unknown:
        raise ValueError(f"agent queues with no demand data: {sorted(unknown)}")

    # --- decision variables n[type,q,s,o]
    var = []
    for ti, t in types.iterrows():
        for q in t['queues']:
            for s in shifts:
                if s['evening'] and not t['eve']:
                    continue
                for o in allowed_offs(t['sun'], t['fixed']):
                    var.append((ti, q, s['idx'], o))
    nv = len(var)

    # --- shortfall variables only where bodies are required
    rq = req[req['R_req'] > 0].reset_index(drop=True)
    row_of = {(r.Q, r.dow, r.slot): i for i, r in enumerate(rq.itertuples())}
    slot_idx = {s: i for i, s in enumerate(slots)}
    ns = len(rq)
    N = nv + ns

    c = np.zeros(N)
    pen = cfg['offday_penalty']
    for k, (ti, q, si, o) in enumerate(var):
        c[k] = TIE_OFFDAY * pen.get(o, 0) + (TIE_OFFPRIMARY if q != types.at[ti, 'primary'] else 0)
    c[nv:] = rq['w'].values

    # --- constraints
    rows, cols, vals = [], [], []
    lb, ub = [], []
    r_i = 0
    by_type = {}
    for k, (ti, *_r) in enumerate(var):
        by_type.setdefault(ti, []).append(k)
    for ti, ks in by_type.items():
        for k in ks:
            rows.append(r_i); cols.append(k); vals.append(1.0)
        lb.append(types.at[ti, 'n']); ub.append(types.at[ti, 'n']); r_i += 1
    base = r_i
    for i in range(ns):               # coverage rows
        rows.append(base + i); cols.append(nv + i); vals.append(1.0)
        lb.append(float(rq.at[i, 'R_req'])); ub.append(np.inf)
    for k, (ti, q, si, o) in enumerate(var):
        for d in DAYS:
            if d == o:
                continue
            for tt in shifts[si]['slots']:
                ri = row_of.get((q, d, slots[tt]))
                if ri is not None:
                    rows.append(base + ri); cols.append(k); vals.append(1.0)
    A = coo_matrix((vals, (rows, cols)), shape=(base + ns, N)).tocsr()

    lo = np.zeros(N)
    hi = np.empty(N)
    for k, (ti, *_r) in enumerate(var):
        hi[k] = types.at[ti, 'n']
    hi[nv:] = rq['R_req'].values
    integrality = np.r_[np.ones(nv), np.zeros(ns)]

    res = milp(c, constraints=LinearConstraint(A, lb, ub), integrality=integrality,
               bounds=Bounds(lo, hi),
               options={'time_limit': float(time_limit or cfg['solver_time_limit_sec']),
                        'mip_rel_gap': 1e-4, 'disp': False})
    if res.x is None:
        raise RuntimeError(f"solver returned no solution: status={res.status} {res.message}")

    x = np.rint(res.x[:nv]).astype(int)
    counts = pd.DataFrame([{'type_id': types.at[ti, 'type_id'], 'queue': q, 'shift_idx': si,
                            'day_off': o, 'n': int(x[k])}
                           for k, (ti, q, si, o) in enumerate(var) if x[k] > 0])
    status = {0: 'optimal', 1: 'time/iteration limit (best found)'}.get(res.status, f'status {res.status}')
    return {'counts': counts, 'status': status, 'message': res.message,
            'objective': float(res.fun), 'n_types': len(types), 'n_vars': N}
