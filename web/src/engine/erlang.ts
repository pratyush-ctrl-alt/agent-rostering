export function erlangC(A: number, N: number): number {
  if (N <= A) return 1.0;
  let inv = 1.0;
  for (let i = 1; i <= N; i++) inv = 1 + (inv * i) / A;
  const B = 1 / inv;
  return (N * B) / (N - A * (1 - B));
}

/** Min concurrent agents so >= target of calls are answered within targetWait seconds. */
export function requiredAgents(calls: number, ahtS: number, slot = 1800, target = 0.8, targetWait = 20): number {
  if (!(calls > 0 && ahtS && ahtS > 0)) return 0;
  const A = (calls * ahtS) / slot;
  let N = Math.max(1, Math.ceil(A));
  for (let k = 0; k < 400; k++) {
    const C = erlangC(A, N);
    const sl = 1 - C * Math.exp((-(N - A) * targetWait) / ahtS);
    if (sl >= target) return N;
    N += 1;
  }
  return N;
}
