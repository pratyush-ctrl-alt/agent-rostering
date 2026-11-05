"""Stage A: Erlang-C demand engine (BUILD_SPEC s4 + PRD s0 corrections)."""
import math
import pandas as pd


def erlang_c(A, N):
    if N <= A:
        return 1.0
    inv = 1.0
    for i in range(1, N + 1):
        inv = 1 + inv * i / A
    B = 1 / inv
    return N * B / (N - A * (1 - B))


def required_agents(calls, aht_s, slot=1800, target=0.80, target_wait=20):
    """Min concurrent agents so >= target of calls are answered within target_wait s."""
    if not (calls > 0 and aht_s and aht_s > 0):
        return 0
    A = calls * aht_s / slot
    N = max(1, math.ceil(A))
    for _ in range(400):
        C = erlang_c(A, N)
        sl = 1 - C * math.exp(-(N - A) * target_wait / aht_s)
        if sl >= target:
            return N
        N += 1
    return N


def slots_in_window(cfg):
    lo, hi = cfg['operating_window']
    out, t = [], int(lo[:2]) * 60 + int(lo[3:])
    end = int(hi[:2]) * 60 + int(hi[3:])
    while t < end:
        out.append(f"{t // 60:02d}:{t % 60:02d}")
        t += 30
    return out


def filter_sizing_months(df, n_months):
    """PRD s0.3: size on the most recent n calendar month(s) present in the data."""
    ym = df['dt'].dt.year * 100 + df['dt'].dt.month
    keep = sorted(ym.unique())[-n_months:]
    return df[ym.isin(keep)].copy()


def build_demand(df, cfg):
    """Returns (profile, aht, R). profile: mean offered per (Q,dow,slot) with merged
    rows SUMMED per date first (PRD s0.1). R[q][dow][slot] = required concurrent agents."""
    slots = slots_in_window(cfg)
    d = df[df['slot'].isin(slots)]
    aht = (d.assign(w=d['answered'] * d['aht_s'])
             .groupby('Q').apply(lambda g: g['w'].sum() / g['answered'].sum(),
                                 include_groups=False))
    prof = (d.groupby(['Q', 'date', 'dow', 'slot'])['offered'].sum()
              .groupby(level=['Q', 'dow', 'slot']).mean().reset_index())
    sl = cfg['service_level']
    prof['R'] = [required_agents(c, aht[q], 1800, sl['target'], sl['threshold_sec'])
                 for q, c in zip(prof['Q'], prof['offered'])]
    return prof, aht
