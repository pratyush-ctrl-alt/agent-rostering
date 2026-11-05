"""Stage 0: load and clean the half-hourly export (BUILD_SPEC s3, with PRD s0 fixes)."""
import numpy as np
import pandas as pd


def to_sec(x):
    if isinstance(x, str):
        h, m, s = x.split(':')
        return int(h) * 3600 + int(m) * 60 + int(s)
    return np.nan


def load_clean(path, sheet='result', cfg=None):
    df = pd.read_excel(path, sheet_name=sheet)
    df['aht_s'] = df['aht'].apply(to_sec)
    df['dt'] = pd.to_datetime(df['date part'])
    df['dow'] = df['dt'].dt.day_name()
    df['slot'] = df['time slot'].astype(str).str[:5]
    df = df[~df['dt'].dt.month.isin(cfg['exclude_months'])].copy()
    df['Q'] = df['queue multiFilter'].replace(cfg['queue_merges'])
    daily = df.groupby('date part')['calls'].sum()
    thr = daily.median() * cfg['incident_threshold']
    incident_days = list(daily[daily > thr].index)
    df = df[~df['date part'].isin(incident_days)].copy()
    df = df.rename(columns={'calls': 'offered', 'connected calls': 'answered',
                            'missed calls in business': 'missed'})
    df['date'] = df['dt']
    return df, incident_days
