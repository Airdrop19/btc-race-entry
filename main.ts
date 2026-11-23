// Trend rider for the cbBTC 1-minute replay (agent-fun/bars-replay/v1).
//
// Idea: on 1-minute bars most moves are noise, and a full-size round trip costs
// roughly 26 bps in fees, slippage and impact, so this bot only trades when a
// slower trend is clearly in place, and then rides it with a trailing stop:
//
//   - Indicators over closes: EMA(15) and EMA(60), each seeded with the mean
//     of its first span of closes, then stepped by 2/(span+1). Plus the
//     trailing 45-bar return as a momentum check.
//   - Entry (flat -> long, ~98% of cash): fast EMA above slow EMA by more
//     than 0.08% of price, close above the slow EMA, and the 45-bar return
//     above +0.25%. All three must hold, which keeps it out of sideways chop
//     where EMA crosses whipsaw.
//   - Exit (long -> flat, whole position): the fast EMA falls back under the
//     slow EMA, or the close drops 1.0% under the highest close since entry
//     (trailing stop), or the position is worth 1.5% under its cost (hard
//     stop). Once the position is up 2% the trailing stop tightens to 0.5%
//     so a good leg is not given back.
//   - After an exit the bot waits 20 bars before entering again, holds at
//     least 5 bars before a non-stop exit, and opens nothing new in the last
//     40 bars of the 1,440-bar window (a late round trip cannot pay its fees).
//
// Everything is float64 + - * / on the bar closes, no clock, no randomness:
// the same bars always give the same orders.

import { runBars, type OrderInput } from './vendor/makefun-bars.ts';

const FAST = 15;
const SLOW = 60;
const MOM_BARS = 45;
const MOM_MIN = 0.0025; // +0.25% over the trailing 45 bars
const GAP_MIN = 0.0008; // fast EMA at least 0.08% above slow EMA
const TRAIL = 0.01; // trailing stop: 1.0% under the peak close since entry
const TRAIL_TIGHT = 0.005; // tightened to 0.5% once up 2%
const LOCK_AT = 0.02; // unrealised gain that tightens the trailing stop
const HARD_STOP = 0.985; // exit when worth 1.5% under cost
const COOLDOWN = 20; // bars to wait after an exit
const MIN_HOLD = 5; // bars before a trend-break exit may fire
const LAST_ENTRY_BAR = 1400; // of the window's 1,440 bars
const SLIPPAGE_BPS = 60;

class Ema {
  span: number;
  warm: number[] = [];
  value: number | null = null;
  constructor(span: number) {
    this.span = span;
  }
  step(close: number): void {
    if (this.value !== null) {
      this.value += (2 / (this.span + 1)) * (close - this.value);
      return;
    }
    this.warm.push(close);
    if (this.warm.length === this.span) {
      this.value = this.warm.reduce((a, x) => a + x, 0) / this.span;
    }
  }
}

const fast = new Ema(FAST);
const slow = new Ema(SLOW);
const closes: number[] = [];
let barsSeen = 0;
let peakSinceEntry = 0;
let entryBar = -1;
let lastExitBar = -COOLDOWN;

await runBars({
  onBatch(state, batch) {
    const orders: OrderInput[] = [];
    const bar = batch.bars[0];
    if (bar === undefined) return orders;
    const symbol = bar.symbol;
    const close = Number(bar.c);
    closes.push(close);
    if (closes.length > 200) closes.shift();
    fast.step(close);
    slow.step(close);
    barsSeen += 1;
    if (state.warmingUp) return orders;

    const held = state.positions.get(symbol);
    if (held !== undefined) {
      if (close > peakSinceEntry) peakSinceEntry = close;
      const value = state.value(symbol, held.qty);
      const gain = held.cost > 0n ? Number(value) / Number(held.cost) - 1 : 0;
      const trail = gain >= LOCK_AT ? TRAIL_TIGHT : TRAIL;
      const trendBreak = fast.value !== null && slow.value !== null && fast.value < slow.value;
      const heldBars = barsSeen - entryBar;
      const stopHit = close < peakSinceEntry * (1 - trail) || value * 1000n < held.cost * 985n;
      if (stopHit || (trendBreak && heldBars >= MIN_HOLD)) {
        orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: SLIPPAGE_BPS });
        lastExitBar = barsSeen;
        peakSinceEntry = 0;
        entryBar = -1;
      }
      return orders;
    }

    // Flat: look for an entry.
    if (barsSeen > LAST_ENTRY_BAR || barsSeen - lastExitBar < COOLDOWN) return orders;
    if (fast.value === null || slow.value === null || closes.length <= MOM_BARS) return orders;
    const mom = close / closes[closes.length - 1 - MOM_BARS]! - 1;
    const gap = (fast.value - slow.value) / close;
    if (fast.value > slow.value && close > slow.value && mom > MOM_MIN && gap > GAP_MIN) {
      const spend = (state.cash * 98n) / 100n;
      if (spend >= BigInt(state.hello.fees.min_notional_quote_units)) {
        orders.push({ side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: SLIPPAGE_BPS });
        peakSinceEntry = close;
        entryBar = barsSeen;
      }
    }
    return orders;
  },
});
