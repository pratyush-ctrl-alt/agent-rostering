"""CLI: python run.py [--month 2026-06] [--agents agents.csv] [--sizing-months all|N]"""
import argparse, os, sys, yaml
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src'))
import pandas as pd
from clean import load_clean
from erlang import build_demand, filter_sizing_months
from model import build_requirements
from agents import load_agents
from optimize import solve
from assign import assign_names
import outputs as O


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', default='config.yaml')
    ap.add_argument('--month', help='YYYY-MM label / last month of data to use (default: latest)')
    ap.add_argument('--agents', help='agent list CSV (default: config agents_file)')
    ap.add_argument('--sizing-months', help="'all' or integer N (default: config)")
    ap.add_argument('--outdir', default='output')
    ap.add_argument('--time-limit', type=float)
    a = ap.parse_args()
    cfg = yaml.safe_load(open(a.config))
    sm = a.sizing_months if a.sizing_months is not None else cfg['sizing_months']
    sm = sm if sm in ('all', None) else int(sm)

    df, incident = load_clean(cfg['input_file'], cfg['sheet'], cfg)
    ym = df['dt'].dt.strftime('%Y-%m')
    month = a.month or ym.max()
    df = df[ym <= month]
    sz = filter_sizing_months(df, sm)
    prof, aht = build_demand(sz, cfg)
    req = build_requirements(prof, cfg)
    agents, issues = load_agents(a.agents or cfg['agents_file'], cfg, sorted(req['Q'].unique()))

    sol = solve(req, agents, cfg, a.time_limit)
    roster = assign_names(sol['counts'], agents, cfg, month, 'state/rotation_state.json')
    cov = O.compute_coverage(roster, req, cfg)
    per_q, tot = O.summarise(cov)
    supply = O.skill_supply(agents, req)
    rp, cp = O.write_outputs(roster, cov, per_q, tot, issues, supply, cfg, month, a.outdir)

    hist = sz[sz['slot'].isin(prof['slot'].unique())]
    print(f"\n=== Roster {month} ===")
    print(f"Sizing data: {sz['date'].min().date()} -> {sz['date'].max().date()} "
          f"({sz['date'].nunique()} days); incident days excluded: {incident}")
    print(f"Solver: {sol['status']}; {sol['n_types']} agent types, {sol['n_vars']} vars")
    print(f"Agents rostered: {len(roster)} / cap {cfg['headcount_cap']}; "
          f"excluded for bad input: {len(issues)}")
    print(f"System peak concurrent required: {int(prof.groupby(['dow','slot'])['R'].sum().max())}")
    print(f"Expected miss% (model proxy): {tot['miss_pct']:.1f}%   "
          f"| historical miss% on same data: {100*hist['missed'].sum()/hist['offered'].sum():.1f}%")
    print(per_q.round(1).to_string(index=False))
    g = O.gaps(cov)
    print(f"Gap rows (queue/day/slot short): {len(g)}")
    print('Wrote', rp, cp)


if __name__ == '__main__':
    main()
