"""Stage C: turn type-level counts into named agents, with monthly rotation (BUILD_SPEC s6).

Within a type every agent is interchangeable for coverage, so who draws the unpopular
patterns (working Sunday, evening shift) is free to rotate. Rule: patterns are ranked by
unpopularity; agents are ordered by agent_id then rotated by a per-type offset. The offset
is fixed within a month (re-running a month reproduces the roster) and advances each new
month by the number of unpopular slots, so a different set of agents takes them."""
import json
import os
import pandas as pd
from model import DAYS, shift_defs


def _score(o, evening):
    return 2 * (o != 'Sunday') + (1 if evening else 0)   # Sunday-working worst, then evening


def load_state(path):
    if os.path.exists(path):
        return json.load(open(path))
    return {'months': {}, 'next': {}}


def assign_names(counts, agents, cfg, month, state_path):
    shifts = shift_defs(cfg)
    state = load_state(state_path)
    new_month = month not in state['months']
    used = dict(state['next']) if new_month else state['months'][month]
    nxt = dict(state['next'])
    out = []
    for tid, g in counts.groupby('type_id'):
        pats = []
        for r in g.itertuples():
            pats += [(r.queue, r.shift_idx, r.day_off)] * int(r.n)
        pats.sort(key=lambda p: (-_score(p[2], shifts[p[1]]['evening']), p[0], p[1], DAYS.index(p[2])))
        pool = agents[agents['type_id'] == tid].sort_values('agent_id').to_dict('records')
        assert len(pats) == len(pool), f"type {tid}: {len(pats)} slots vs {len(pool)} agents"
        off = used.get(tid, 0) % len(pool)
        pool = pool[off:] + pool[:off]
        n_unpop = sum(1 for p in pats if _score(p[2], shifts[p[1]]['evening']) >= 2)
        nxt[tid] = (off + max(1, n_unpop)) % len(pool)
        used[tid] = off
        for a, (q, si, o) in zip(pool, pats):
            out.append({'agent_id': a['agent_id'], 'name': a['name'], 'queue': q,
                        'shift_idx': si, 'day_off': o, 'skills': ';'.join(a['queues']),
                        'primary': a['primary']})
    if new_month:
        state['months'][month] = used
        state['next'] = nxt
    os.makedirs(os.path.dirname(state_path) or '.', exist_ok=True)
    json.dump(state, open(state_path, 'w'), indent=1, sort_keys=True)
    return pd.DataFrame(out).sort_values(['queue', 'shift_idx', 'day_off', 'agent_id']).reset_index(drop=True)
