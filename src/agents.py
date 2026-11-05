"""Agent list loader. Input columns (PRD s3b / s8):
agent_id, name, queues (';'-separated, FIRST = primary), available_sunday, evening_ok,
fixed_day_off. Alternatively: primary_queue + alternate_queues (';'-separated)."""
import pandas as pd
from model import DAYS

LANG_ALIAS = {'hindi': 'Default', 'english': 'Default', 'default': 'Default', 'hindi/english': 'Default'}


def _yn(v, default=True):
    if pd.isna(v) or str(v).strip() == '':
        return default
    return str(v).strip().lower() in ('y', 'yes', 'true', '1')


def _day(v):
    if pd.isna(v) or str(v).strip() == '':
        return None
    s = str(v).strip().lower()
    for d in DAYS:
        if d.lower() == s or d.lower()[:3] == s[:3]:
            return d
    raise ValueError(f"unknown day '{v}'")


def _queue_map(valid_queues, cfg):
    m = {q.lower(): q for q in valid_queues}
    m.update(LANG_ALIAS)
    for k, v in cfg['queue_merges'].items():
        m[str(k).lower()] = v
    return m


def _split(v):
    if pd.isna(v):
        return []
    return [p.strip() for p in str(v).replace(',', ';').split(';') if p.strip()]


def load_agents(path, cfg, valid_queues):
    """Returns (agents_df, issues). Agents with contradictory/unknown data go to `issues`
    and are excluded from the solve (never silently dropped)."""
    raw = pd.read_csv(path, dtype=str)
    raw.columns = [c.strip().lower() for c in raw.columns]
    qmap = _queue_map(valid_queues, cfg)
    rows, issues = [], []
    if raw['agent_id'].duplicated().any():
        raise ValueError(f"duplicate agent_id: {raw.loc[raw['agent_id'].duplicated(), 'agent_id'].tolist()}")
    for _, r in raw.iterrows():
        aid = r['agent_id']
        try:
            toks = (_split(r.get('queues')) if 'queues' in raw.columns and not pd.isna(r.get('queues'))
                    else _split(r.get('primary_queue')) + _split(r.get('alternate_queues')))
            qs = []
            for t in toks:
                if t.lower() not in qmap:
                    raise ValueError(f"unknown queue '{t}'")
                q = qmap[t.lower()]
                if q not in qs:
                    qs.append(q)
            if not qs:
                raise ValueError("no queue")
            sun = _yn(r.get('available_sunday'), True)
            eve = _yn(r.get('evening_ok'), True)
            fixed = _day(r.get('fixed_day_off'))
            if fixed and not sun and fixed != 'Sunday':
                raise ValueError(f"contradiction: unavailable Sunday but fixed day off is {fixed}")
        except ValueError as e:
            issues.append({'agent_id': aid, 'name': r.get('name', ''), 'issue': str(e)})
            continue
        rows.append({'agent_id': aid, 'name': r.get('name', ''), 'queues': tuple(qs),
                     'primary': qs[0], 'available_sunday': sun, 'evening_ok': eve,
                     'fixed_day_off': fixed})
    df = pd.DataFrame(rows)
    df['type_id'] = [f"{'+'.join(q)}|sun={int(s)}|eve={int(e)}|off={f or '-'}"
                     for q, s, e, f in zip(df['queues'], df['available_sunday'],
                                           df['evening_ok'], df['fixed_day_off'])]
    return df, issues
