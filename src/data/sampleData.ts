// ---------------------------------------------------------------------------
// Bundled sample datasets, generated deterministically so the app is useful on
// first load (and so the "Welcome" SQL cell has data to run against).
// ---------------------------------------------------------------------------

// Small seeded PRNG (mulberry32) — deterministic sample data, no Math.random.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = cols.join(',')
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\n')
  return `${head}\n${body}\n`
}

function makeTips(): string {
  const rng = mulberry32(7)
  const days = ['Thur', 'Fri', 'Sat', 'Sun']
  const times = ['Lunch', 'Dinner']
  const sexes = ['Male', 'Female']
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < 160; i++) {
    const size = 1 + Math.floor(rng() * 5)
    const total = +(8 + rng() * 40 + size * 3).toFixed(2)
    const tipRate = 0.1 + rng() * 0.15
    rows.push({
      bill_id: 1000 + i,
      total_bill: total,
      tip: +(total * tipRate).toFixed(2),
      sex: pick(rng, sexes),
      smoker: rng() > 0.65 ? 'Yes' : 'No',
      day: pick(rng, days),
      time: pick(rng, times),
      size,
    })
  }
  return toCsv(rows)
}

function makeCustomers(): string {
  const rng = mulberry32(19)
  const plans = ['Free', 'Pro', 'Team', 'Enterprise']
  const regions = ['NA', 'EMEA', 'APAC', 'LATAM']
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < 200; i++) {
    const plan = pick(rng, plans)
    const tenure = Math.floor(rng() * 48)
    const monthly = plan === 'Free' ? 0 : plan === 'Pro' ? 29 : plan === 'Team' ? 99 : 499
    const churnP =
      (plan === 'Free' ? 0.4 : 0.12) + (tenure < 6 ? 0.25 : 0) - (tenure > 24 ? 0.1 : 0)
    rows.push({
      customer_id: `CUST-${(10000 + i).toString()}`,
      email: `user${i}@example.com`,
      plan,
      region: pick(rng, regions),
      tenure_months: tenure,
      monthly_spend: monthly,
      seats: plan === 'Team' || plan === 'Enterprise' ? 1 + Math.floor(rng() * 50) : 1,
      churned: rng() < churnP ? 'true' : 'false',
    })
  }
  return toCsv(rows)
}

export interface SampleDataset {
  name: string
  description: string
  csv: string
}

export const SAMPLE_DATASETS: SampleDataset[] = [
  {
    name: 'tips',
    description: 'Restaurant bills & tips — classic EDA dataset (160 rows).',
    csv: makeTips(),
  },
  {
    name: 'customers',
    description: 'SaaS customers with plan, tenure & churn flag (200 rows).',
    csv: makeCustomers(),
  },
]
