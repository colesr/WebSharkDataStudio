// ---------------------------------------------------------------------------
// Small, dependency-free statistical helpers (standard numerical algorithms).
// Used by the A/B test cell now and the drift monitor later.
// ---------------------------------------------------------------------------

/** Error function (Abramowitz & Stegun 7.1.26), |error| < 1.5e-7. */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/** Two-sided p-value for a z statistic. */
export function normalTwoTailedP(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)))
}

// ---- log-gamma + incomplete beta (Student's t) ----------------------------

function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155,
    0.1208650973866179e-2, -0.5395239384953e-5,
  ]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) {
    y += 1
    ser += cof[j] / y
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x)
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200
  const EPS = 3e-12
  const FPMIN = 1e-300
  let qab = a + b
  let qap = a + 1
  let qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return h
}

/** Regularized incomplete beta I_x(a,b). */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
  )
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a
  return 1 - (bt * betacf(b, a, 1 - x)) / b
}

/** Two-sided p-value for Student's t with df degrees of freedom. */
export function studentTwoTailedP(t: number, df: number): number {
  if (!isFinite(t) || df <= 0) return 1
  const x = df / (df + t * t)
  return betai(df / 2, 0.5, x)
}

// ---- lower incomplete gamma (chi-square) ----------------------------------

function gser(a: number, x: number): number {
  const ITMAX = 300
  const EPS = 3e-12
  const gln = gammaln(a)
  if (x <= 0) return 0
  let ap = a
  let sum = 1 / a
  let del = sum
  for (let n = 0; n < ITMAX; n++) {
    ap += 1
    del *= x / ap
    sum += del
    if (Math.abs(del) < Math.abs(sum) * EPS) break
  }
  return sum * Math.exp(-x + a * Math.log(x) - gln)
}

function gcf(a: number, x: number): number {
  const ITMAX = 300
  const EPS = 3e-12
  const FPMIN = 1e-300
  const gln = gammaln(a)
  let b = x + 1 - a
  let c = 1 / FPMIN
  let d = 1 / b
  let h = d
  for (let i = 1; i <= ITMAX; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = b + an / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < EPS) break
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h
}

/** Regularized lower incomplete gamma P(a,x). */
export function gammp(a: number, x: number): number {
  if (x <= 0 || a <= 0) return 0
  if (x < a + 1) return gser(a, x)
  return 1 - gcf(a, x)
}

/** Upper-tail p-value for a chi-square statistic with df degrees of freedom. */
export function chiSquareP(x: number, df: number): number {
  if (x <= 0 || df <= 0) return 1
  return 1 - gammp(df / 2, x / 2)
}
