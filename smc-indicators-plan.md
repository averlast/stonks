# SMC Mastery Indicators & Strategy Plan

Based on the SMC Mastery Guide for MNQ Futures trading.

## Overview

Create a **hybrid system**:
1. **SMC Mastery Indicator** - Visual overlay for manual trading guidance
2. **SMC Mastery Strategy** - Separate file for backtesting the 3 setups

Both will work on 5m and 15m timeframes with full alert support.

---

## Part 1: SMC Mastery Indicator

**File:** `indicators/smc-mastery-indicator.pine`

### Visual Components (all toggleable)

#### 1. Market Structure (BOS/CHoCH)
- Swing high/low detection with configurable lookback
- **BOS labels** - Break of Structure (trend continuation)
- **CHoCH labels** - Change of Character (potential reversal)
- Trend state tracking (bullish/bearish/neutral)
- Lines connecting swing points to show structure

#### 2. Fair Value Gaps (FVGs)
- Bullish FVG boxes (gap between C1 high and C3 low)
- Bearish FVG boxes (gap between C1 low and C3 high)
- **Premium/Discount zones** - Split each FVG at 50%
- 50% midline for optimal entries
- Mitigation tracking (fade out when touched)
- **Breakaway vs Rejection classification** - Check if 3rd candle continues (strong) or reverses (weak)

#### 3. Order Blocks (OBs)
- Bullish OB: Last bearish candle(s) before bullish BOS
- Bearish OB: Last bullish candle(s) before bearish BOS
- Mark from open to close (bodies, not wicks)
- 50% level highlight (strongest reaction zone)
- Mitigation tracking

#### 4. Golden Zones (OB + FVG Overlap)
- Auto-detect when FVG overlaps with OB
- Highlight with distinct gold color
- Priority visual indicator

#### 5. Key Levels & Sessions
- **PDH/PDL** - Previous Day High/Low (external liquidity)
- **ORB Range** - Opening Range (9:30-9:45 ET) with high/low lines
- **Session backgrounds:**
  - NY Session (9:30-1:30 ET) - light green
  - 10AM Reversal Window (10:00-10:30 ET) - orange
  - Lunch Lull (12:00-12:45 ET) - red (caution)
- Current day high/low

#### 6. Liquidity Sweep Detection
- **Sweep** = Wick through level, close back inside (reversal signal)
- **Run** = Close through level (continuation signal)
- Visual markers on PDH/PDL/swing levels when swept or run

### Alerts

| Alert | Trigger |
|-------|---------|
| CHoCH Bullish | First break above swing high in downtrend |
| CHoCH Bearish | First break below swing low in uptrend |
| BOS Bullish | Break above swing high in uptrend |
| BOS Bearish | Break below swing low in downtrend |
| Sweep @ PDH | Wick above PDH, close below |
| Sweep @ PDL | Wick below PDL, close above |
| Run @ PDH | Close above PDH |
| Run @ PDL | Close below PDL |
| ORB Break Up | Close above ORB High |
| ORB Break Down | Close below ORB Low |
| Golden Zone Formed | New OB+FVG overlap detected |
| Price at Golden Zone | Price enters unmitigated golden zone |

### Input Groups

1. **Daily Bias (Manual TDA)** - Set your bias each session
   - Options: Bullish / Bearish / Neutral (no trade)
   - Visual indicator showing current bias on chart
   - Filters alerts to only show setups aligned with bias
2. **Structure Settings** - Swing lookback, show BOS/CHoCH
3. **FVG Settings** - Show FVGs, min size, show premium/discount
4. **Order Block Settings** - Show OBs, lookback for OB candles
5. **Golden Zone Settings** - Show golden zones
6. **Levels & Sessions** - Show PDH/PDL, ORB, session backgrounds
7. **Alerts** - Toggle each alert type
8. **Colors** - Customizable colors for all elements
9. **Text & Sizes** - Configurable label/table text sizes
   - Label Size: tiny / small / normal / large (default: normal)
   - Table Size: tiny / small / normal / large (default: normal)
   - All labels use `size.normal` or larger by default (no tiny text)

---

## Part 2: SMC Mastery Strategy

**File:** `indicators/smc-mastery-strategy.pine`

### Three Setups (from the guide)

#### Setup 1: Sweep Setup (CRT Reversal)
**Entry Logic:**
1. Price sweeps external liquidity (PDH/PDL/swing) - wick through, close back
2. Wait for CHoCH on 5m/15m
3. Mark FVG formed during CHoCH move
4. Enter when price retraces to FVG
5. Stop beyond sweep high/low
6. Target opposite external liquidity

**Filters:**
- Only during 10:00-11:30 AM ET (primary sweep window)
- Require CHoCH confirmation
- FVG must be in correct zone (premium for shorts, discount for longs)

#### Setup 2: Run Setup (Continuation)
**Entry Logic:**
1. Price CLOSES beyond external liquidity (not just wick)
2. FVG forms during/after breakout
3. Wait for price to retest FVG
4. Enter at FVG touch
5. Stop below FVG (longs) / above FVG (shorts)
6. Target next external liquidity

**Filters:**
- All timeframes aligned (bullish = only long runs, bearish = only short runs)
- FVG should overlap or be near the broken level

#### Setup 3: ORB Setup (Opening Range Breakout)
**Entry Logic:**
1. Mark 9:30-9:45 range (15m ORB)
2. Wait for candle to CLOSE beyond ORB level
3. Check if breakout direction matches 4H bias
4. Enter on retest of ORB level/FVG
5. Stop at opposite ORB level (or below FVG)
6. Target PDH/PDL

**Filters:**
- ORB range under 40 points (over 60 = skip)
- Only trade breakouts aligned with higher timeframe bias
- Primary window: 9:45-10:30 AM ET

### Risk Management

- Position sizing based on dollar risk ($200-400 per trade)
- MNQ = $2 per point per contract
- Auto-calculate contracts: `qty = riskAmount / (stopPoints * 2)`
- Max 30 MNQ contracts

### Session Filters

- Only trade 9:30 AM - 1:30 PM ET
- Avoid lunch lull (12:00-12:45 ET) - no new entries
- No new trades after 1:00 PM

### Strategy Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Daily Bias** | Neutral | Bullish/Bearish/Neutral - set before session |
| Risk Per Trade | $300 | Dollar amount risked |
| Stop Type | FVG-based | Beyond entry FVG/OB |
| Target Type | External Liquidity | PDH/PDL or next swing |
| Min R:R | 2.0 | Skip trades under 2:1 |
| Max Trades/Day | 2 | Per the guide's discipline |
| ORB Duration | 15 min | First 15 minutes |
| ORB Max Width | 40 pts | Skip if range too wide |

**Bias Logic:**
- Bullish bias → Only take: Long Sweeps, Long Runs, Long ORB breaks
- Bearish bias → Only take: Short Sweeps, Short Runs, Short ORB breaks
- Neutral → No trades (sit out unclear days)

---

## Implementation Order

1. **SMC Mastery Indicator** (core visuals)
   - Market structure (BOS/CHoCH)
   - FVGs with premium/discount
   - Order Blocks
   - Golden Zones
   - Key levels (PDH/PDL, ORB)
   - Session overlays
   - Sweep/Run detection
   - Alerts

2. **SMC Mastery Strategy** (backtesting)
   - Import/recreate core detection logic
   - Implement 3 setups with filters
   - Risk management
   - Session filters

---

## Key Improvements Over Previous Indicators

| Issue in Old Code | Fix in New Code |
|-------------------|-----------------|
| FVG detection too simple | Add breakaway vs rejection check (3rd candle direction) |
| No sweep vs run distinction | Explicit sweep (wick+close back) vs run (close through) logic |
| BOS/CHoCH logic conflated | Proper state machine: CHoCH = first break against trend, BOS = continuation |
| Entries at any FVG touch | Require premium/discount zone alignment per direction |
| No Golden Zone priority | Highlight OB+FVG overlap as highest probability |
| Fixed stop/target % | Dynamic stops based on structure (beyond FVG, beyond sweep) |
| Missing 10AM reversal window | Explicit session phases with visual cues |
| Generic alerts | Setup-specific alerts (Sweep @PDH, ORB Break, etc.) |
| Text too small | Configurable text sizes, default to normal |

---

## Files to Create

```
indicators/
  smc-mastery-indicator.pine    # Visual overlay
  smc-mastery-strategy.pine     # Backtesting strategy
```
