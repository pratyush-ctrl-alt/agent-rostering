"""Generate a SYNTHETIC agent list (not real people) for syntax/smoke testing only."""
import csv, random
random.seed(7)
plan = {'Default': 118, 'Kannada': 22, 'Unpaid_Desktop': 19, 'Marathi': 19,
        'Tamil': 15, 'Malayalam': 13, 'Telugu': 12, 'M2D': 12}
rows, n = [], 1
for q, k in plan.items():
    for _ in range(k):
        skills = [q] if q == 'Default' else [q] + (['Default'] if random.random() < 0.7 else [])
        sun = 'N' if random.random() < 0.15 else 'Y'
        eve = 'N' if random.random() < 0.2 else 'Y'
        fixed = random.choice(['Wednesday', 'Saturday']) if (random.random() < 0.04 and sun == 'Y') else ''
        rows.append([f"S{n:03d}", f"Synthetic Agent {n:03d}", skills[0], ';'.join(skills[1:]), sun, eve, fixed]); n += 1
hdr = ['agent_id', 'name', 'primary_queue', 'alternate_queues', 'available_sunday', 'evening_ok', 'fixed_day_off']
with open('data/templates/agents_SYNTHETIC_sample.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(hdr); w.writerows(rows)
with open('data/templates/agents_template.csv', 'w', newline='') as f:
    w = csv.writer(f); w.writerow(hdr)
    w.writerows([['A001', 'Ravi K', 'Default', '', 'Y', 'Y', ''],
                 ['A002', 'Priya S', 'Tamil', 'Default', 'Y', 'N', ''],
                 ['A003', 'Lakshmi R', 'Telugu', 'Default;Tamil', 'N', 'Y', ''],
                 ['A004', 'Example Fixed Off', 'Default', '', 'Y', 'Y', 'Wednesday']])
print(len(rows), 'synthetic agents')
