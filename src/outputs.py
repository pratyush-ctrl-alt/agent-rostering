"""Coverage, gap and miss-curve computation from a roster + output writers.
compute_coverage works on ANY roster (generated or hand-edited), so the UI can call
it after each edit to re-validate and refresh coverage."""
import numpy as np
import pandas as pd
from model import DAYS, op_slots, shift_defs


def compute_coverage(roster, req, cfg):
    """roster needs columns: queue, shift_idx, day_off. Returns one row per
    (queue, day, slot) with required vs scheduled bodies, shortfall and expected misses."""
    shifts = shift_defs(cfg)
    slots = op_slots(cfg)
    queues = sorted(req['Q'].unique())
    qi = {q: i for i, q in enumerate(queues)}
    present = np.zeros((len(queues), 7, len(slots)), dtype=int)
    for r in roster.itertuples():
        if r.queue not in qi:
            continue
        for d, dn in enumerate(DAYS):
            if dn != r.day_off:
                present[qi[r.queue], d, shifts[r.shift_idx]['slots']] += 1
    cov = req.rename(columns={'Q': 'queue', 'dow': 'day'}).copy()
    cov['scheduled'] = [present[qi[q], DAYS.index(d), slots.index(s)]
                        for q, d, s in zip(cov['queue'], cov['day'], cov['slot'])]
    cov['short'] = (cov['R_req'] - cov['scheduled']).clip(lower=0)
    cov['exp_missed'] = cov['w'] * cov['short']
    cov['miss_pct'] = np.where(cov['offered'] > 0, 100 * cov['exp_missed'] / cov['offered'], 0.0)
    cov['day'] = pd.Categorical(cov['day'], DAYS, ordered=True)
    return cov.sort_values(['queue', 'day', 'slot']).reset_index(drop=True)


def summarise(cov):
    per_q = (cov.groupby('queue').agg(offered=('offered', 'sum'), exp_missed=('exp_missed', 'sum'),
                                      peak_required_bodies=('R_req', 'max'),
                                      peak_short=('short', 'max'))
                .assign(miss_pct=lambda d: 100 * d['exp_missed'] / d['offered']).reset_index())
    tot = {'offered': cov['offered'].sum(), 'exp_missed': cov['exp_missed'].sum()}
    tot['miss_pct'] = 100 * tot['exp_missed'] / tot['offered']
    return per_q, tot


def gaps(cov):
    g = cov[cov['short'] > 0][['queue', 'day', 'slot', 'R_req', 'scheduled', 'short', 'exp_missed']]
    return g.rename(columns={'R_req': 'required_bodies', 'scheduled': 'scheduled_bodies',
                             'short': 'agents_short', 'exp_missed': 'expected_missed_calls'})


def miss_curve(cov):
    h = cov.assign(hour=cov['slot'].str[:2] + ':00')
    weekly = h.groupby('hour')['exp_missed'].sum().rename('missed_calls_per_week')
    pivot = h.pivot_table(index='hour', columns='day', values='exp_missed', aggfunc='sum',
                          observed=False).reindex(columns=DAYS)
    return weekly.reset_index(), pivot.reset_index()


def skill_supply(agents, req):
    """Informational: agents able to serve each queue at all (multi-skill agents are counted
    under every queue they can serve, so rows overlap) vs that queue's peak bodies needed."""
    peak = req.groupby('Q')['R_req'].max()
    return pd.DataFrame([{'queue': q, 'peak_bodies_needed': int(peak[q]),
                          'agents_with_skill': int(sum(q in qs for qs in agents['queues'])),
                          'agents_primary': int((agents['primary'] == q).sum())}
                         for q in peak.index])


def roster_table(roster):
    from_ = roster.copy()
    return from_


def write_outputs(roster, cov, per_q, tot, agents_issues, supply, cfg, month, outdir):
    import os
    os.makedirs(outdir, exist_ok=True)
    shifts = shift_defs(cfg)
    ro = pd.DataFrame({
        'Agent ID': roster['agent_id'], 'Name': roster['name'], 'Queue': roster['queue'],
        'Shift Start': [shifts[i]['start'] for i in roster['shift_idx']],
        'Shift End': [shifts[i]['end'] for i in roster['shift_idx']],
        'Day Off': roster['day_off'],
        'Working Days': [', '.join(d for d in DAYS if d != o) for o in roster['day_off']],
        'Skills': roster['skills'], 'On Primary Queue': np.where(roster['queue'] == roster['primary'], 'Y', 'N')})
    rp = os.path.join(outdir, f'roster_{month}.xlsx')
    ro.to_excel(rp, index=False)
    ro.to_csv(os.path.join(outdir, f'roster_{month}.csv'), index=False)
    weekly, pivot = miss_curve(cov)
    cp = os.path.join(outdir, f'coverage_{month}.xlsx')
    with pd.ExcelWriter(cp) as w:
        cov.rename(columns={'R': 'required_concurrent', 'R_req': 'required_bodies',
                            'offered': 'mean_offered_calls'}).drop(columns=['w']).to_excel(
            w, sheet_name='Coverage', index=False)
        gaps(cov).to_excel(w, sheet_name='Gaps', index=False)
        per_q.to_excel(w, sheet_name='Queue summary', index=False)
        weekly.to_excel(w, sheet_name='Hourly miss curve', index=False)
        pivot.to_excel(w, sheet_name='Miss curve by day', index=False)
        supply.to_excel(w, sheet_name='Skill supply vs need', index=False)
        pd.DataFrame(agents_issues or [{'agent_id': '', 'name': '', 'issue': 'none'}]).to_excel(
            w, sheet_name='Agent input issues', index=False)
    return rp, cp
