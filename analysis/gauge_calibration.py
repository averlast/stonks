"""Calibrate the two continue-vs-fade gauges from 4y of 1m bars.

Gauges (both in % of ADR):
  rubber-band = |close - sessionVWAP| / ADR   (how far from fair value)
  fuel        = (running session H - L) / ADR  (how much of a normal day is used)

NQ: RTH 09:30-16:00, VWAP anchored 09:30, traded window 10:00-13:00.
GC: Asia evening 18:00-21:00, VWAP anchored 18:00, traded ~19:30-20:15.
ADR = 14-day trailing mean of the session range (as-of-day, shifted 1, no lookahead).
"""
import pandas as pd, numpy as np
from datetime import time

def load(sym):
    df = pd.read_parquet(f'data/bars/{sym}/2022-08-01_2026-08-22_v0_ohlcv-1m.parquet',
                         columns=['et','open','high','low','close','volume'])
    df['date'] = df['et'].dt.date
    df['t'] = df['et'].dt.time
    df['tp'] = (df['high']+df['low']+df['close'])/3.0
    return df

def analyze(sym, sess_start, sess_end, vwap_anchor, checkpoints, fwd_min, name):
    df = load(sym)
    m = (df['t']>=sess_start) & (df['t']<df['sess_end_dummy'] if False else df['t']<sess_end)
    sess = df[(df['t']>=vwap_anchor) & (df['t']<sess_end)].copy()
    # per-day session range for ADR (from vwap_anchor..sess_end)
    rng = sess.groupby('date').agg(hi=('high','max'), lo=('low','min'))
    rng['range'] = rng['hi']-rng['lo']
    rng['adr'] = rng['range'].shift(1).rolling(14, min_periods=10).mean()  # trailing, no lookahead
    print(f"\n===== {name} ({sym}) =====")
    print(f"session {vwap_anchor}-{sess_end}, ADR pts: median={rng['range'].median():.1f} "
          f"mean={rng['range'].mean():.1f}  |  trailing-ADR median={rng['adr'].median():.1f}")

    rb_rows, fuel_rows = [], []
    for date, g in sess.groupby('date'):
        adr = rng.loc[date,'adr']
        if not np.isfinite(adr) or adr<=0: continue
        g = g.sort_values('et').reset_index(drop=True)
        cumv = g['volume'].cumsum()
        vwap = (g['tp']*g['volume']).cumsum() / cumv.replace(0,np.nan)
        run_hi = g['high'].cummax(); run_lo = g['low'].cummin()
        g = g.assign(vwap=vwap, run_hi=run_hi, run_lo=run_lo)
        final_hi = g['high'].max(); final_lo = g['low'].min()
        by_time = {r['t']: i for i,r in g.iterrows()}
        for cp in checkpoints:
            if cp not in by_time: continue
            i = by_time[cp]; row = g.loc[i]
            if not np.isfinite(row['vwap']): continue
            stretch = (row['close']-row['vwap'])/adr           # signed, +above vwap
            used = (row['run_hi']-row['run_lo'])/adr
            # rubber-band forward outcome
            j = i+fwd_min
            if j < len(g):
                fwd = g.loc[j]
                cont_move = (fwd['close']-row['close'])*np.sign(stretch)  # + = continuation won
                stretch_after = abs(fwd['close']-fwd['vwap'])/adr
                shrank = stretch_after < abs(stretch)
                rb_rows.append((abs(stretch), cont_move/adr, shrank))
            # fuel forward outcome: additional range added to session end
            add_range = ((final_hi-final_lo)-(row['run_hi']-row['run_lo']))/adr
            fuel_rows.append((used, add_range))

    rb = pd.DataFrame(rb_rows, columns=['stretch','cont_move_adr','shrank'])
    fu = pd.DataFrame(fuel_rows, columns=['used','add_range_adr'])

    print(f"\n  RUBBER-BAND  (N={len(rb)}, fwd={fwd_min}m)  "
          f"cont_move = fwd move in continuation direction (+cont / -fade), as %ADR")
    bins=[0,.10,.20,.30,.40,.50,.75,9]
    rb['b']=pd.cut(rb['stretch'],bins)
    tab=rb.groupby('b',observed=True).agg(N=('stretch','size'),
        mean_cont_move_pctADR=('cont_move_adr',lambda x:round(x.mean()*100,1)),
        pct_reverted=('shrank',lambda x:round(x.mean()*100,0)))
    print(tab.to_string())

    print(f"\n  FUEL  (N={len(fu)})  add_range = extra range added to session end, as %ADR")
    fu['b']=pd.cut(fu['used'],[0,.25,.40,.55,.70,.85,1.0,9])
    tab2=fu.groupby('b',observed=True).agg(N=('used','size'),
        mean_add_range_pctADR=('add_range_adr',lambda x:round(x.mean()*100,0)),
        pct_lt_10pct=('add_range_adr',lambda x:round((x<.10).mean()*100,0)))
    print(tab2.to_string())

# NQ: RTH, anchor 09:30, traded 10-13, checkpoints hourly, 30m forward
analyze('NQ', time(9,30), time(16,0), time(9,30),
        [time(10,0),time(11,0),time(12,0),time(12,30)], 30, "NQ RTH, traded 10:00-13:00")
# GC: evening, anchor 18:00, end 21:00, checkpoints in traded burst, 15m forward
analyze('GC', time(18,0), time(21,0), time(18,0),
        [time(19,30),time(19,45),time(20,0),time(20,15)], 15, "GC Asia evening, traded 19:30-20:15")
