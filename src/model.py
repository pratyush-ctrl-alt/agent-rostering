"""Shared definitions: days, shift windows, requirements table, edit validation."""
import math
import pandas as pd

DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']


def hm(s):
    return int(s[:2]) * 60 + int(s[3:5])


def fmt(m):
    return f"{m // 60:02d}:{m % 60:02d}"


def op_slots(cfg):
    lo, hi = hm(cfg['operating_window'][0]), hm(cfg['operating_window'][1])
    return [fmt(t) for t in range(lo, hi, 30)]


def shift_defs(cfg):
    """List of shift dicts: idx, start, end, slots (indices into op_slots), evening."""
    slots = op_slots(cfg)
    cutoff = hm(cfg['evening_cutoff'])
    out = []
    for i, (a, b) in enumerate(cfg['shift_windows']):
        covered = [k for k, s in enumerate(slots) if hm(a) <= hm(s) < hm(b)]
        out.append({'idx': i, 'start': a, 'end': b, 'slots': covered,
                    'evening': hm(b) > cutoff})
    return out


def build_requirements(prof, cfg):
    """prof: Q,dow,slot,offered,R. Adds R_req (rostered bodies, productive-hours
    adjusted, BUILD_SPEC s5) and w (calls missed per missing body)."""
    ratio = cfg['productive_hours'] / cfg['shift_hours']
    r = prof.copy()
    r['R_req'] = [int(math.ceil(x / ratio - 1e-9)) if x > 0 else 0 for x in r['R']]
    # MY DEVIATION from BUILD_SPEC s5 (offered / R): weight per missing *body* is
    # offered / R_req, so a fully unstaffed slot costs exactly `offered` calls, never more.
    r['w'] = [o / q if q > 0 else 0.0 for o, q in zip(r['offered'], r['R_req'])]
    return r


def validate_edit(agent, queue, shift_idx, day_off, shifts):
    """Return a list of rule violations for placing `agent` (dict/Series with queues,
    available_sunday, evening_ok, fixed_day_off) on (queue, shift, day_off). Empty = legal."""
    v = []
    if queue not in agent['queues']:
        v.append(f"queue {queue} not in agent skills {list(agent['queues'])}")
    if shifts[shift_idx]['evening'] and not agent['evening_ok']:
        v.append("agent cannot work evening shifts")
    if day_off not in DAYS:
        v.append(f"unknown day off {day_off}")
    else:
        if not agent['available_sunday'] and day_off != 'Sunday':
            v.append("agent unavailable Sunday, so Sunday must be the day off")
        fixed = agent.get('fixed_day_off')
        if isinstance(fixed, str) and fixed and day_off != fixed:
            v.append(f"agent has fixed day off {fixed}")
    return v
