"""Do swing pivots cluster at round numbers, or is it superstition?

For each candidate spacing K, measure how often a swing high/low lands within `tol` of a multiple
of K, vs what pure chance predicts (uniform price => expected = 2*tol/K). lift = observed/expected.
lift ~1 = no edge (drop it). lift >>1 = round numbers really attract reversals (keep that spacing).
"""
import pandas as pd, numpy as np

def pivots(df, L):
    hi = df['high'].values; lo = df['low'].values
    n = len(df)
    is_ph = np.zeros(n, bool); is_pl = np.zeros(n, bool)
    # centered rolling max/min via pandas (window 2L+1)
    rmax = df['high'].rolling(2*L+1, center=True).max().values
    rmin = df['low'].rolling(2*L+1, center=True).min().values
    is_ph = (hi == rmax)
    is_pl = (lo == rmin)
    ph = hi[is_ph]; pl = lo[is_pl]
    return np.concatenate([ph, pl])

def test(sym, tick, incs, tol, L=10):
    df = pd.read_parquet(f'data/bars/{sym}/2022-08-01_2026-08-22_v0_ohlcv-1m.parquet',
                         columns=['high','low'])
    piv = pivots(df, L)
    print(f"\n===== {sym} =====  pivots={len(piv):,}  tol=±{tol} pts  (L={L})")
    print(f"{'spacing':>8} {'observed%':>10} {'chance%':>9} {'lift':>6}")
    for K in incs:
        d = np.abs(piv - np.round(piv / K) * K)     # distance to nearest multiple of K
        obs = (d <= tol).mean()
        chance = min(1.0, 2*tol / K)
        lift = obs / chance if chance > 0 else np.nan
        print(f"{K:>8} {obs*100:>9.1f} {chance*100:>8.1f} {lift:>6.2f}")

# NQ tick 0.25; candidates from 5 up to 100
test('NQ', 0.25, [5, 10, 25, 50, 100], tol=1.0)
# GC tick 0.1; smaller candidates
test('GC', 0.1, [1, 5, 10, 25, 50], tol=0.5)
