# Support Rostering Engine

Monthly roster for named support agents: assigns each agent one queue, one 9-hour shift window
and one weekly day off so that expected missed calls on last month's demand are minimised.
Design docs: `BUILD_SPEC.md` (engine) and `PRD_rostering_tool.md` (overrides the spec where they differ).

## Run
```bash
pip install -r requirements.txt
python run.py --agents data/templates/agents_SYNTHETIC_sample.csv            # latest month in data
python run.py --month 2026-06 --sizing-months all --agents my_agents.csv
python stageA.py                                                             # demand summary only
python -m pytest -q tests
```
Outputs (in `output/`): `roster_<month>.xlsx/.csv`, `coverage_<month>.xlsx`
(sheets: Coverage, Gaps, Queue summary, Hourly miss curve, Miss curve by day,
Skill supply vs need, Agent input issues). `state/rotation_state.json` is updated.

## Monthly workflow
1. Drop the new half-hourly export into `data/raw/`, point `input_file` at it in `config.yaml`.
2. Prepare the agent list CSV (template: `data/templates/agents_template.csv`).
3. `python run.py --agents <file>`; review **Gaps** and **Agent input issues** first.
4. Hand-adjust, export the final roster.

## Agent list
`agent_id, name, queues, available_sunday, evening_ok, fixed_day_off`
- `queues`: `;`-separated, **first = primary**, rest = alternates (e.g. `Kannada;Default`).
  The solver may place a multi-skill agent on any listed queue; off-primary placement carries a tiny penalty only.
- Hindi / English / Default / Gujarati / Bengali / undefined all mean the `Default` queue.
- `available_sunday=N` forces the weekly off to be Sunday. `evening_ok=N` bars any shift ending
  after `evening_cutoff` (19:00 → 11–20 and 12–21 are barred). `fixed_day_off` pins the off day.
- Contradictory or unknown-queue rows are listed under *Agent input issues* and excluded (never silent).

## How it works
`clean.py` (drop Mar/Apr, merge queues, drop incident days) → `erlang.py` (Erlang-C required concurrent
agents per queue/day/half-hour; merged Default rows are **summed** per date before averaging) →
`model.build_requirements` (÷ productive_hours/shift_hours = rostered bodies) →
`optimize.py` (one MILP on HiGHS via `scipy.optimize.milp`; agents with identical constraints are grouped
so counts are integer variables) → `assign.py` (names + monthly rotation of Sunday/evening patterns) →
`outputs.py` (coverage, gaps, miss curve; `compute_coverage` works on any hand-edited roster).

## Known limits / assumptions
- Miss model is linear in shortfall: expected misses = (offered ÷ bodies required) × bodies short.
  It is a proxy for ranking rosters, not a prediction of the actual abandon rate; do not compare it
  directly to historical miss%.
- Forecast is the historical day-of-week × half-hour mean on the sizing months (`sizing_months`).
- 9-hour shifts, 4 fixed starts, 6 working days, single day off, own-skill queues only.
- Tenure priority and queue minimum-staffing floors: not implemented (hooks only).
