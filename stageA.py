"""Stage A summary: python stageA.py [--months N] [--all]"""
import argparse, sys, yaml
sys.path.insert(0, 'src')
from clean import load_clean
from erlang import build_demand, filter_sizing_months

ap = argparse.ArgumentParser(); ap.add_argument('--months', type=int, default=None)
a = ap.parse_args()
cfg = yaml.safe_load(open('config.yaml'))
df, inc = load_clean(cfg['input_file'], cfg['sheet'], cfg)
print('Incident days excluded:', inc)
if a.months is None: a.months = cfg['sizing_months']
sz = filter_sizing_months(df, a.months)
print('Sizing rows:', len(sz), 'dates', sz['date'].min().date(), '->', sz['date'].max().date(),
      'distinct days', sz['date'].nunique())
prof, aht = build_demand(sz, cfg)
print('\nAHT (s) per queue:\n', aht.round(0).to_string())
peak = prof.groupby('Q')['R'].max().sort_values(ascending=False)
print('\nPer-queue peak concurrent:\n', peak.to_string())
sysp = prof.groupby(['dow', 'slot'])['R'].sum()
print('\nSystem simultaneous peak:', sysp.max(), 'at', sysp.idxmax())
print('Weekly required productive hours:', round(prof['R'].sum() * 0.5))
