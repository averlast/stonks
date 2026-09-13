"""Fair value gaps: do gaps lined up with a Level hold better than gaps standing alone?

The deciding test (CONTEXT.md "Fair value gap" / "Lined up"): an FVG is a *place*, and the
doctrine says it only matters when it stacks with a Level the user already trades. So measure
the first retest of every gap and split it by lined-up vs unlined. If lined-up ~= unlined, the
layer is noise and gets dropped (precedent: round numbers, lift ~1.1, analysis/round_numbers.py).

Secondary: pick the ATR size floor, and see whether 15m gaps earn their place next to 30m/1h.

Everything is as-of (no lookahead): ATR is computed through the gap's own third candle, levels
from data strictly before the bar they are read on, and the outcome race starts after the
retest bar.

Definitions are spelled out in analysis/fvg_results.md. Run:
    .venv/Scripts/python.exe analysis/study_fvg.py
"""
import numpy as np
import pandas as pd
from datetime import time

# ----------------------------------------------------------------------------- config
PARQ = 'data/bars/{sym}/2022-08-01_2026-08-22_v0_ohlcv-1m.parquet'
TICK = {'NQ': 0.25, 'GC': 0.10}
PROX = {'NQ': 6 * 0.25, 'GC': 8 * 0.10}          # Absorption-tag proximity: 6 / 8 ticks
WINDOW = {'NQ': (time(10, 0), time(13, 0)),       # RTH traded window
          'GC': (time(19, 30), time(20, 55))}     # Asia-evening run-up
TFS = [15, 30, 60]
F_DEFAULT, B_DEFAULT = 0.5, 0.5
F_SWEEP, B_SWEEP = [0.0, 0.25, 0.5, 1.0], [0.5, 0.7]
ATR_N = 14
NS_MIN = 60_000_000_000                           # one minute in ns

LEVELS = {
    'NQ': ['PDH', 'PDL', 'ONH', 'ONL', 'ORB_H', 'ORB_L', 'ORB_M', 'VWAP'],
    'GC': ['PDH', 'PDL', 'PTH', 'PTL', 'ORB5_H', 'ORB5_L', 'ORB5_M',
           'ORB15_H', 'ORB15_L', 'ORB15_M', 'VWAP'],
}

OUT = []


def say(s=''):
    print(s)
    OUT.append(s)


def wilson(k, n, z=1.96):
    if n == 0:
        return (np.nan, np.nan)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def pct(x):
    return '   n/a' if not np.isfinite(x) else f'{100 * x:5.1f}%'


# ----------------------------------------------------------------------------- data
def load(sym):
    df = pd.read_parquet(PARQ.format(sym=sym),
                         columns=['et', 'open', 'high', 'low', 'close', 'volume'])
    df = df.sort_values('et').reset_index(drop=True)
    # ETH trading day: 18:00 -> 17:00 ET.  (+6h) pushes 18:00 to the next midnight.
    df['sess'] = (df['et'] + pd.Timedelta(hours=6)).dt.normalize().dt.tz_localize(None)
    df['tod'] = df['et'].dt.time
    return df


def window_mask(df, sym):
    a, b = WINDOW[sym]
    m = (df['tod'] >= a) & (df['tod'] < b) & (df['sess'].dt.weekday < 5)
    return m.values


def window_end_ts(df, sym):
    """Absolute end-of-trading-window timestamp for the session each bar belongs to."""
    _, b = WINDOW[sym]
    off = pd.Timedelta(hours=b.hour, minutes=b.minute)
    if sym == 'NQ':                       # window sits on the session's own calendar date
        base = df['sess']
    else:                                 # gold's evening window is the night *before* sess
        base = df['sess'] - pd.Timedelta(days=1)
    return (base + off).dt.tz_localize('America/New_York').values.astype('int64')


def session_window_end(sym, sess_days):
    _, b = WINDOW[sym]
    off = pd.Timedelta(hours=b.hour, minutes=b.minute)
    base = pd.DatetimeIndex(sess_days)
    if sym == 'GC':
        base = base - pd.Timedelta(days=1)
    return (base + off).tz_localize('America/New_York').values.astype('int64')


# ----------------------------------------------------------------------------- levels
def build_levels(df, sym):
    """Per-1m-bar level prices, as-of. Only filled on bars inside the trading window."""
    tod = df['tod'].values
    et = df['et']
    lv = {}

    day = df.groupby('sess').agg(h=('high', 'max'), l=('low', 'min'))
    pdh = day['h'].shift(1)
    pdl = day['l'].shift(1)
    lv['PDH'] = df['sess'].map(pdh).values
    lv['PDL'] = df['sess'].map(pdl).values

    def frozen(mask, name_hi, name_lo, mid=None):
        sub = df[mask]
        g = sub.groupby('sess').agg(h=('high', 'max'), l=('low', 'min'))
        lv[name_hi] = df['sess'].map(g['h']).values
        lv[name_lo] = df['sess'].map(g['l']).values
        if mid:
            lv[mid] = df['sess'].map((g['h'] + g['l']) / 2).values

    def vwap_from(mask):
        sub = df[mask].copy()
        tp = (sub['high'] + sub['low'] + sub['close']) / 3.0
        num = (tp * sub['volume']).groupby(sub['sess']).cumsum()
        den = sub['volume'].groupby(sub['sess']).cumsum()
        out = np.full(len(df), np.nan)
        out[sub.index.values] = (num / den.replace(0, np.nan)).values
        return out

    if sym == 'NQ':
        on = (tod >= time(18, 0)) | (tod < time(9, 30))
        frozen(on, 'ONH', 'ONL')
        orb = (tod >= time(9, 30)) & (tod < time(9, 45))
        frozen(orb, 'ORB_H', 'ORB_L', 'ORB_M')
        lv['VWAP'] = vwap_from((tod >= time(9, 30)) & (tod < time(16, 0)))
    else:
        frozen((tod >= time(18, 0)) & (tod < time(18, 5)), 'ORB5_H', 'ORB5_L', 'ORB5_M')
        frozen((tod >= time(18, 0)) & (tod < time(18, 15)), 'ORB15_H', 'ORB15_L', 'ORB15_M')
        # Pre-Tokyo range: developing 18:00->20:00, frozen at the Tokyo open.
        ptm = (tod >= time(18, 0)) & (tod < time(20, 0))
        sub = df[ptm]
        dev_h = sub.groupby('sess')['high'].cummax()
        dev_l = sub.groupby('sess')['low'].cummin()
        fin = sub.groupby('sess').agg(h=('high', 'max'), l=('low', 'min'))
        pth = df['sess'].map(fin['h']).values.copy()
        ptl = df['sess'].map(fin['l']).values.copy()
        pth[sub.index.values] = dev_h.values      # inside the window -> developing value
        ptl[sub.index.values] = dev_l.values
        lv['PTH'], lv['PTL'] = pth, ptl
        lv['VWAP'] = vwap_from(np.ones(len(df), bool))   # session == anchored at 18:00

    names = LEVELS[sym]
    return np.column_stack([np.asarray(lv[n], float) for n in names]), names


# ----------------------------------------------------------------------------- folding
def fold(df, minutes):
    g = (df.set_index('et')
           .resample(f'{minutes}min', label='left', closed='left')
           .agg(open=('open', 'first'), high=('high', 'max'), low=('low', 'min'),
                close=('close', 'last'), volume=('volume', 'sum')))
    g = g.dropna(subset=['open']).reset_index()
    return g


def find_gaps(g, minutes):
    """All three-candle gaps with no body/size filter; the filters are applied later."""
    t = g['et'].values.astype('int64')
    o, h, l, c = (g[k].values for k in ('open', 'high', 'low', 'close'))
    step = minutes * NS_MIN

    tr = np.maximum(h[1:] - l[1:],
                    np.maximum(np.abs(h[1:] - c[:-1]), np.abs(l[1:] - c[:-1])))
    atr = np.full(len(g), np.nan)
    atr[1:] = pd.Series(tr).rolling(ATR_N).mean().values      # as-of that bar's close

    n = len(g) - 2
    if n <= 0:
        return pd.DataFrame()
    i1, i2, i3 = np.arange(n), np.arange(n) + 1, np.arange(n) + 2
    contig = (t[i3] - t[i1]) == 2 * step

    bull = (l[i3] > h[i1]) & contig
    bear = (h[i3] < l[i1]) & contig
    is_gap = bull | bear
    if not is_gap.any():
        return pd.DataFrame()

    bot = np.where(bull, h[i1], h[i3])
    top = np.where(bull, l[i3], l[i1])
    rng = h[i2] - l[i2]
    body = np.abs(c[i2] - o[i2])
    with np.errstate(invalid='ignore', divide='ignore'):
        bratio = np.where(rng > 0, body / rng, 0.0)
        amult = np.where(atr[i3] > 0, (top - bot) / atr[i3], np.nan)

    k = np.flatnonzero(is_gap & np.isfinite(amult))
    return pd.DataFrame({
        'dir': np.where(bull[k], 1, -1),
        'bot': bot[k], 'top': top[k],
        'height': (top - bot)[k],
        'body_ratio': bratio[k],
        'atr_mult': amult[k],
        'birth': t[i3][k] + step,                 # gap is born at c3's close
    })


# ----------------------------------------------------------------------------- engine
class Book:
    """Everything the 1m resolver needs, packed into numpy."""

    def __init__(self, df, sym):
        self.sym = sym
        self.ts = df['et'].values.astype('int64')
        self.hi = df['high'].values
        self.lo = df['low'].values
        self.cl = df['close'].values
        self.inw = window_mask(df, sym)
        self.wend = window_end_ts(df, sym)
        self.lvl, self.lvl_names = build_levels(df, sym)
        self.prox = PROX[sym]
        # 15m closes, used for every inversion test regardless of drawing TF
        g15 = fold(df, 15)
        self.ts15 = g15['et'].values.astype('int64') + 15 * NS_MIN   # close time
        self.cl15 = g15['close'].values
        a = np.maximum(g15['high'].values[1:] - g15['low'].values[1:],
                       np.maximum(np.abs(g15['high'].values[1:] - g15['close'].values[:-1]),
                                  np.abs(g15['low'].values[1:] - g15['close'].values[:-1])))
        atr15 = np.full(len(g15), np.nan)
        atr15[1:] = pd.Series(a).rolling(ATR_N).mean().values
        self.atr15 = atr15
        # session -> death time (end of the *next* session's trading window)
        days = np.sort(df['sess'].unique())
        wend_by_day = session_window_end(sym, days)
        self.expiry_of = dict(zip(days, np.r_[wend_by_day[1:], wend_by_day[-1]]))
        self.sess = df['sess'].values

    def lineup(self, row, bot, top):
        """Which levels sit inside the band or within proximity of either edge, at `row`."""
        v = self.lvl[row]
        ok = np.isfinite(v) & (((v >= bot) & (v <= top)) |
                               (np.abs(v - bot) <= self.prox) |
                               (np.abs(v - top) <= self.prox))
        return [n for n, f in zip(self.lvl_names, ok) if f]

    def first_15m_beyond(self, t_from, t_to, thresh, below):
        j0 = np.searchsorted(self.ts15, t_from, 'right')
        j1 = np.searchsorted(self.ts15, t_to, 'right')
        if j1 <= j0:
            return None
        c = self.cl15[j0:j1]
        m = (c < thresh) if below else (c > thresh)
        if not m.any():
            return None
        return self.ts15[j0 + int(np.argmax(m))]

    def race(self, e, deadline, target, up, t_fail):
        """From bar e (exclusive), does `target` get hit before the failure time?"""
        j = np.searchsorted(self.ts, deadline, 'right')
        seg_hi, seg_lo = self.hi[e + 1:j], self.lo[e + 1:j]
        m = (seg_hi >= target) if up else (seg_lo <= target)
        t_hit = self.ts[e + 1 + int(np.argmax(m))] if m.any() else None
        if t_fail is not None and t_fail > deadline:
            t_fail = None
        if t_hit is not None and (t_fail is None or t_hit < t_fail):
            return 'hold'
        if t_fail is not None:
            return 'flip'
        return 'unresolved'


def resolve_gaps(book, gaps):
    """First in-window retest of each gap, plus the first return to it once it has flipped."""
    rows = []
    ts = book.ts
    for gp in gaps.itertuples():
        bull = gp.dir > 0
        bot, top, hgt = gp.bot, gp.top, gp.height
        i0 = np.searchsorted(ts, gp.birth, 'left')
        if i0 >= len(ts):
            continue
        sd = book.sess[i0]
        expiry = book.expiry_of.get(sd)
        if expiry is None or expiry <= gp.birth:
            continue
        i1 = np.searchsorted(ts, expiry, 'right')
        if i1 - i0 < 2:
            continue

        hi, lo = book.hi[i0:i1], book.lo[i0:i1]
        inb = (lo <= top) & (hi >= bot)
        if not inb.any():
            continue
        starts = np.flatnonzero(inb & ~np.r_[False, inb[:-1]])
        t_flip = book.first_15m_beyond(gp.birth, expiry, bot if bull else top, bull)

        rec = dict(dir=gp.dir, birth=gp.birth, bot=bot, top=top, height=hgt,
                   body_ratio=gp.body_ratio, atr_mult=gp.atr_mult,
                   n_tests=len(starts), outcome=None, lined=None, levels='',
                   inv_outcome=None, inv_lined=None, inv_levels='')

        # ---- plain gap: first live, in-window test (third-test rule caps it at 3)
        for k, s in enumerate(starts[:3]):
            e = i0 + s
            if not book.inw[e]:
                continue
            if t_flip is not None and ts[e] >= t_flip:
                break                                   # already an Inverse FVG by then
            deadline = min(book.wend[e], expiry)
            tgt = (top + hgt) if bull else (bot - hgt)
            rec['outcome'] = book.race(e, deadline, tgt, bull, t_flip)
            lv = book.lineup(e, bot, top)
            rec['lined'] = len(lv) > 0
            rec['levels'] = ','.join(lv)
            rec['test_no'] = k + 1
            break

        # ---- inverse FVG: first return to the band after it flipped
        if t_flip is not None:
            after = starts[ts[i0 + starts] > t_flip]
            for s in after[:1]:
                e = i0 + s
                if not book.inw[e]:
                    break
                deadline = min(book.wend[e], expiry)
                # flipped bullish gap = resistance: reject = travel a gap-height *down*
                tgt = (bot - hgt) if bull else (top + hgt)
                t_fail = book.first_15m_beyond(ts[e], deadline, top if bull else bot, not bull)
                rec['inv_outcome'] = book.race(e, deadline, tgt, not bull, t_fail)
                lv = book.lineup(e, bot, top)
                rec['inv_lined'] = len(lv) > 0
                rec['inv_levels'] = ','.join(lv)
                break
        rows.append(rec)
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------- tables
def sel(res, F, B):
    return res[(res['atr_mult'] >= F) & (res['body_ratio'] >= B)]


def rate(sub, col='outcome'):
    h = int((sub[col] == 'hold').sum())
    f = int((sub[col] == 'flip').sum())
    u = int((sub[col] == 'unresolved').sum())
    r = h / (h + f) if h + f else np.nan
    return h, f, u, r


def split_table(res, col, lcol, title, note=''):
    say(f'  {title}')
    say(f'    {"group":>9} {"hold":>5} {"flip":>5} {"unres":>6} {"rate":>7} {"95% CI":>15}')
    out = {}
    for lab, mask in (('lined-up', res[lcol] == True), ('unlined', res[lcol] == False)):
        sub = res[mask]
        h, f, u, r = rate(sub, col)
        lo, hi = wilson(h, h + f)
        ci = f'{100*lo:4.1f}-{100*hi:4.1f}%' if np.isfinite(lo) else '    n/a'
        say(f'    {lab:>9} {h:>5} {f:>5} {u:>6} {pct(r):>7} {ci:>15}')
        out[lab] = r
    lift = (out['lined-up'] / out['unlined']
            if np.isfinite(out['unlined']) and out['unlined'] else np.nan)
    say(f'    lift (lined/unlined) = {lift:.2f}' + (f'   {note}' if note else ''))
    say()
    return lift


def run_symbol(sym):
    say('=' * 78)
    say(f'{sym}   window {WINDOW[sym][0].strftime("%H:%M")}-{WINDOW[sym][1].strftime("%H:%M")} ET'
        f'   proximity +/-{PROX[sym]} pts   defaults F={F_DEFAULT} x ATR{ATR_N}, body B={B_DEFAULT}')
    say('=' * 78)
    df = load(sym)
    book = Book(df, sym)
    per_tf = {}
    for tf in TFS:
        g = fold(df, tf)
        gaps = find_gaps(g, tf)
        res = resolve_gaps(book, gaps)
        per_tf[tf] = res

        d = sel(res, F_DEFAULT, B_DEFAULT)
        h, f, u, r = rate(d)
        say(f'-- {sym} {tf}m gaps ' + '-' * 50)
        say(f'  [1] born (any filter) {len(res):>6} | pass F/B filter {len(d):>6} | '
            f'retested in-window {h+f+u:>5}  -> hold {h}, flip {f}, unresolved {u}')
        say(f'      overall hold rate {pct(r)}   median gap height '
            f'{d["height"].median():.2f} pts ({d["atr_mult"].median():.2f} x ATR)')
        say()
        lift = split_table(d, 'outcome', 'lined',
                           '[2] HEADLINE - first-retest hold rate, lined-up vs unlined')

        # [2b] VWAP is a moving level that is always near price; check the static levels alone
        d = d.copy()
        d['lined_static'] = d['levels'].apply(
            lambda s: bool([x for x in s.split(',') if x and x != 'VWAP']))
        say('  [2b] same split, but "lined-up" counts static levels only (VWAP excluded)')
        say(f'    {"group":>9} {"hold":>5} {"flip":>5} {"unres":>6} {"rate":>7} {"95% CI":>15}')
        rr = {}
        for lab, m in (('lined-up', d['lined_static']), ('unlined', ~d['lined_static'])):
            sub = d[m]
            h2, f2, u2, r2 = rate(sub)
            lo2, hi2 = wilson(h2, h2 + f2)
            ci = f'{100*lo2:4.1f}-{100*hi2:4.1f}%' if np.isfinite(lo2) else '    n/a'
            say(f'    {lab:>9} {h2:>5} {f2:>5} {u2:>6} {pct(r2):>7} {ci:>15}')
            rr[lab] = r2
        lf2 = (rr['lined-up'] / rr['unlined']
               if np.isfinite(rr['unlined']) and rr['unlined'] else np.nan)
        say(f'    lift (lined/unlined) = {lf2:.2f}')
        say()

        # [3] by level
        say('  [3] hold rate by which Level lined up (a gap can line up with several)')
        say(f'    {"level":>9} {"hold":>5} {"flip":>5} {"rate":>7}')
        dl = d[d['outcome'].isin(['hold', 'flip'])]
        for nm in book.lvl_names:
            m = dl['levels'].str.split(',').apply(lambda xs: nm in xs)
            sub = dl[m]
            h2, f2, _, r2 = rate(sub)
            if h2 + f2 == 0:
                continue
            flag = '  (small N)' if h2 + f2 < 30 else ''
            say(f'    {nm:>9} {h2:>5} {f2:>5} {pct(r2):>7}{flag}')
        say()

        # [4] inverse
        inv = d[d['inv_outcome'].notna()]
        say(f'  [4] Inverse FVG, first return to the flipped band (N={len(inv)})')
        if len(inv):
            split_table(inv, 'inv_outcome', 'inv_lined',
                        'reject rate (hold column = rejected), lined-up vs unlined')
        else:
            say('      no returns in-window\n')

    # [5] sweeps
    say(f'-- {sym} [5] size-floor / body sweep ' + '-' * 32)
    say(f'  {"tf":>4} {"F":>5} {"B":>4} | {"lined N":>8} {"lined%":>7} | '
        f'{"unlined N":>9} {"unlin%":>7} | {"lift":>5}')
    for tf in TFS:
        for B in B_SWEEP:
            for F in F_SWEEP:
                d = sel(per_tf[tf], F, B)
                a = d[d['lined'] == True]
                b = d[d['lined'] == False]
                h1, f1, _, r1 = rate(a)
                h2, f2, _, r2 = rate(b)
                lf = r1 / r2 if (np.isfinite(r1) and np.isfinite(r2) and r2) else np.nan
                say(f'  {tf:>4} {F:>5} {B:>4} | {h1+f1:>8} {pct(r1):>7} | '
                    f'{h2+f2:>9} {pct(r2):>7} | {lf:>5.2f}')
    say()
    return book, per_tf, df


# ----------------------------------------------------------------------------- mirror
def mirror_test(sym, book, per_tf, df):
    """Level tests WITH a lined-up gap vs level tests WITHOUT one, anchored at the Level."""
    say(f'-- {sym} [6] mirror test: Level tests with vs without a lined-up gap ' + '-' * 8)
    ts, hi, lo, cl = book.ts, book.hi, book.lo, book.cl
    wrows = np.flatnonzero(book.inw)
    sess = book.sess
    # as-of 15m ATR for every 1m bar (the travel unit for a level, which has no height)
    j = np.searchsorted(book.ts15, ts, 'right') - 1
    atr_at = np.where(j >= 0, book.atr15[np.clip(j, 0, None)], np.nan)

    say(f'  {"tf":>4} {"group":>10} {"hold":>5} {"flip":>5} {"rate":>7} {"95% CI":>15}')
    for tf in TFS:
        g = sel(per_tf[tf], F_DEFAULT, B_DEFAULT)
        gb = g['birth'].values
        order = np.argsort(gb)
        gb, gbot, gtop = gb[order], g['bot'].values[order], g['top'].values[order]
        gdie = np.full(len(g), np.inf)
        rows = []
        # group window bars into contiguous per-day runs
        breaks = np.flatnonzero(np.diff(wrows) != 1) + 1
        for run in np.split(wrows, breaks):
            if len(run) < 5:
                continue
            for li, nm in enumerate(book.lvl_names):
                L = book.lvl[run, li]
                if not np.isfinite(L).all():
                    continue
                inz = (lo[run] <= L + book.prox) & (hi[run] >= L - book.prox)
                if not inz.any():
                    continue
                s = int(np.argmax(inz & ~np.r_[False, inz[:-1]]))
                e = run[s]
                Lp = L[s]
                X = atr_at[e] * 0.5
                if not np.isfinite(X) or X <= 0:
                    continue
                up = (cl[e - 1] if s > 0 else cl[e]) > Lp     # approached from above = support
                deadline = book.wend[e]
                tgt = Lp + X if up else Lp - X
                t_fail = book.first_15m_beyond(ts[e], deadline, Lp - X if up else Lp + X, up)
                oc = book.race(e, deadline, tgt, up, t_fail)
                k0 = np.searchsorted(gb, ts[e] - 2 * 86400 * 10**9, 'left')
                k1 = np.searchsorted(gb, ts[e], 'right')
                has = False
                if k1 > k0:
                    bb, tt = gbot[k0:k1], gtop[k0:k1]
                    has = bool((((Lp >= bb) & (Lp <= tt)) |
                                (np.abs(Lp - bb) <= book.prox) |
                                (np.abs(Lp - tt) <= book.prox)).any())
                rows.append((nm, oc, has))
        m = pd.DataFrame(rows, columns=['level', 'outcome', 'has_gap'])
        for lab, val in (('with gap', True), ('no gap', False)):
            sub = m[m['has_gap'] == val]
            h, f, _, r = rate(sub)
            lo_, hi_ = wilson(h, h + f)
            ci = f'{100*lo_:4.1f}-{100*hi_:4.1f}%' if np.isfinite(lo_) else '    n/a'
            say(f'  {tf:>4} {lab:>10} {h:>5} {f:>5} {pct(r):>7} {ci:>15}')
    say()


# ----------------------------------------------------------------------------- main
if __name__ == '__main__':
    for sym in ('NQ', 'GC'):
        book, per_tf, df = run_symbol(sym)
        mirror_test(sym, book, per_tf, df)
