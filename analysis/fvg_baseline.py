"""Do fair value gaps hold more often than a random band of the same size, born at the same time?

study_fvg.py answered "gap + Level vs gap alone" (flat). This asks the prior question: is a gap
better than chance at all? Control = the same gap, same direction, same height, same birth time,
but shifted a random 2-5 gap-heights away (either side), so it sits at a price the impulse did
NOT skip over. Same retest / hold / flip race, same trading window.

    .venv/Scripts/python.exe analysis/fvg_baseline.py
"""
import numpy as np
import pandas as pd
import study_fvg as S

RNG = np.random.default_rng(20260912)


def shifted(gaps):
    k = RNG.uniform(2.0, 5.0, len(gaps)) * RNG.choice([-1.0, 1.0], len(gaps))
    g = gaps.copy()
    g['bot'] = gaps['bot'] + k * gaps['height']
    g['top'] = gaps['top'] + k * gaps['height']
    return g


def table(sym):
    print(f'\n===== {sym}  real gaps vs same-size bands shifted 2-5 heights away  '
          f'(F={S.F_DEFAULT} x ATR, body>={S.B_DEFAULT}) =====')
    print(f'  {"tf":>4} {"group":>8} {"N":>6} {"hold":>6} {"flip":>6} {"rate":>7} {"95% CI":>15}')
    df = S.load(sym)
    book = S.Book(df, sym)
    for tf in S.TFS:
        gaps = S.find_gaps(S.fold(df, tf), tf)
        gaps = gaps[(gaps['atr_mult'] >= S.F_DEFAULT) & (gaps['body_ratio'] >= S.B_DEFAULT)]
        rows = {}
        for lab, gg in (('real', gaps), ('control', shifted(gaps))):
            res = S.resolve_gaps(book, gg)
            h, f, u, r = S.rate(res)
            lo, hi = S.wilson(h, h + f)
            ci = f'{100*lo:4.1f}-{100*hi:4.1f}%' if np.isfinite(lo) else 'n/a'
            print(f'  {tf:>4} {lab:>8} {h+f:>6} {h:>6} {f:>6} {S.pct(r):>7} {ci:>15}')
            rows[lab] = r
        lift = rows['real'] / rows['control'] if rows['control'] else np.nan
        print(f'       lift (real/control) = {lift:.2f}')


if __name__ == '__main__':
    for sym in ('NQ', 'GC'):
        table(sym)
