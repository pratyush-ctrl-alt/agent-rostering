import io, json
import pandas as pd
import pytest, yaml
from agents import load_agents
from assign import assign_names
from model import DAYS, build_requirements, op_slots, shift_defs, validate_edit
from optimize import solve
import outputs as O

CFG = yaml.safe_load(open('config.yaml'))
SHIFTS = shift_defs(CFG)


def make_req(rated=None):
    """Tiny hand-made demand (NOT real data): Default and Tamil, flat across the week."""
    rated = rated or {'Default': (60.0, 6), 'Tamil': (20.0, 2)}
    rows = [{'Q': q, 'dow': d, 'slot': s, 'offered': o, 'R': r}
            for q, (o, r) in rated.items() for d in DAYS for s in op_slots(CFG)]
    return build_requirements(pd.DataFrame(rows), CFG)


def agents_from(csv_text, tmp_path):
    p = tmp_path / 'a.csv'
    p.write_text(csv_text)
    return load_agents(p, CFG, ['Default', 'Tamil'])


CSV = """agent_id,name,queues,available_sunday,evening_ok,fixed_day_off
""" + "\n".join(
    [f"D{i:02d},D{i},Default,{'N' if i % 4 == 0 else 'Y'},{'N' if i % 3 == 0 else 'Y'}," + ("Wednesday" if i == 1 else "")
     for i in range(1, 21)] +
    [f"T{i:02d},T{i},Tamil;Default,Y,{'N' if i == 1 else 'Y'}," for i in range(1, 7)])


def run(tmp_path, csv=CSV, req=None):
    ag, issues = agents_from(csv, tmp_path)
    req = req if req is not None else make_req()
    sol = solve(req, ag, CFG, time_limit=30)
    roster = assign_names(sol['counts'], ag, CFG, '2026-06', str(tmp_path / 'state.json'))
    return ag, issues, req, sol, roster


def test_hard_constraints_and_one_assignment(tmp_path):
    ag, issues, req, sol, roster = run(tmp_path)
    assert not issues and len(roster) == len(ag) and roster['agent_id'].is_unique
    m = roster.merge(ag, on='agent_id', suffixes=('', '_a'))
    for r in m.itertuples():
        if not r.available_sunday:
            assert r.day_off == 'Sunday', "no-Sunday agent got a Sunday shift"
        if not r.evening_ok:
            assert not SHIFTS[r.shift_idx]['evening'], "no-evening agent got a late shift"
        if isinstance(r.fixed_day_off, str):
            assert r.day_off == r.fixed_day_off
        assert r.queue in r.queues
        assert validate_edit(ag.set_index('agent_id').loc[r.agent_id], r.queue, r.shift_idx, r.day_off, SHIFTS) == []


def test_shortfall_is_reported_not_hidden(tmp_path):
    ag, issues, req, sol, roster = run(tmp_path)
    cov = O.compute_coverage(roster, req, CFG)
    g = O.gaps(cov)
    assert len(g) > 0 and (g['agents_short'] > 0).all()      # 26 agents cannot cover this demand
    assert cov['short'].sum() > 0


def test_solver_objective_matches_recomputed_misses(tmp_path):
    ag, issues, req, sol, roster = run(tmp_path)
    cov = O.compute_coverage(roster, req, CFG)
    assert cov['exp_missed'].sum() == pytest.approx(sol['objective'], abs=0.5)  # tie-breakers are tiny


def test_contradictory_agent_is_flagged_and_excluded(tmp_path):
    csv = CSV + "\nX01,Bad,Default,N,Y,Tuesday"
    ag, issues, *_ = run(tmp_path, csv)
    assert [i['agent_id'] for i in issues] == ['X01'] and 'X01' not in set(ag['agent_id'])


def test_unknown_queue_flagged(tmp_path):
    ag, issues = agents_from(CSV + "\nX02,Bad,Klingon,Y,Y,", tmp_path)
    assert any(i['agent_id'] == 'X02' for i in issues)


def test_gujarati_maps_to_default_and_hindi_alias(tmp_path):
    ag, issues = agents_from("agent_id,name,queues,available_sunday,evening_ok,fixed_day_off\nG1,g,Gujarati;Tamil,Y,Y,\nH1,h,Hindi,Y,Y,", tmp_path)
    assert ag.set_index('agent_id').loc['G1', 'queues'] == ('Default', 'Tamil')
    assert ag.set_index('agent_id').loc['H1', 'queues'] == ('Default',)


def test_rotation_idempotent_within_month_and_rotates_across(tmp_path):
    ag, issues, req, sol, r1 = run(tmp_path)
    again = assign_names(sol['counts'], ag, CFG, '2026-06', str(tmp_path / 'state.json'))
    pd.testing.assert_frame_equal(r1, again)                      # same month -> same roster
    nxt = assign_names(sol['counts'], ag, CFG, '2026-07', str(tmp_path / 'state.json'))
    key = lambda df: df.set_index('agent_id')[['queue', 'shift_idx', 'day_off']]
    assert not key(r1).equals(key(nxt))                           # next month -> different people on unpopular slots
    assert sorted(nxt['agent_id']) == sorted(r1['agent_id'])
    json.load(open(tmp_path / 'state.json'))                      # state persisted


def test_more_agents_never_increase_misses(tmp_path):
    _, _, req, sol_small, r_small = run(tmp_path)
    big = CSV + "\n" + "\n".join(f"E{i:02d},E{i},Default,Y,Y," for i in range(30))
    _, _, _, sol_big, r_big = run(tmp_path, big)
    assert sol_big['objective'] <= sol_small['objective'] + 1e-6
