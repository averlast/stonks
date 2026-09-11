"""Fuel gauge v2: directional travel, not two-sided range.

travel_t = (close_t - session_open) / ADR   (net one-way progress, signed)
runner room = further favorable extension in that SAME direction, close_t -> exit, as %ADR
  up-day:   (max(high[t:exit]) - close_t)/ADR
  down-day: (close_t - min(low[t:exit]))/ADR
Question: once the day has netted X% of ADR one way, how much more does the runner get?
"""
import pandas as pd, numpy as np
from datetime import time

def load(sym):
    df = pd.read_parquet(f'data/bars/{sym}/2022-08-01_2026-08-22_v0_ohlcv-1m.parquet',
                         columns=['et','open','high','low','close','volume'])
    df['date']=df['et'].dt.date; df['t']=df['et'].dt.time
    return df

def run(sym, anchor, adr_end, exit_t, checkpoints, name):
    df=load(sym)
    sess=df[(df['t']>=anchor)&(df['t']<adr_end)].copy()
    rng=sess.groupby('date').agg(hi=('high','max'),lo=('low','min'))
    rng['adr']=(rng['hi']-rng['lo']).shift(1).rolling(14,min_periods=10).mean()
    rows=[]
    win=df[(df['t']>=anchor)&(df['t']<=exit_t)].copy()
    for date,g in win.groupby('date'):
        adr=rng.loc[date,'adr'] if date in rng.index else np.nan
        if not np.isfinite(adr) or adr<=0: continue
        g=g.sort_values('et').reset_index(drop=True)
        sopen=g.loc[0,'open']
        by={r['t']:i for i,r in g.iterrows()}
        for cp in checkpoints:
            if cp not in by: continue
            i=by[cp]; row=g.loc[i]
            travel=(row['close']-sopen)/adr
            d=np.sign(travel) or 1
            fut=g.loc[i:]
            if d>0: room=(fut['high'].max()-row['close'])/adr
            else:   room=(row['close']-fut['low'].min())/adr
            rows.append((abs(travel),room))
    fu=pd.DataFrame(rows,columns=['travel','room'])
    print(f"\n===== {name}  (N={len(fu)}) =====")
    fu['b']=pd.cut(fu['travel'],[0,.10,.20,.30,.45,.60,9])
    tab=fu.groupby('b',observed=True).agg(N=('travel','size'),
        mean_runner_room_pctADR=('room',lambda x:round(x.mean()*100,0)),
        median_room_pctADR=('room',lambda x:round(x.median()*100,0)),
        pct_room_lt_10=('room',lambda x:round((x<.10).mean()*100,0)))
    print(tab.to_string())

run('NQ',time(9,30),time(16,0),time(13,0),
    [time(10,0),time(11,0),time(12,0)],"NQ directional fuel -> exit 13:00")
run('GC',time(18,0),time(21,0),time(21,0),
    [time(19,30),time(19,45),time(20,0)],"GC directional fuel -> exit 21:00")
