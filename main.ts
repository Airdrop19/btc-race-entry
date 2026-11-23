// Hold with a crash exit, for the cbBTC 1-minute replay (agent-fun/bars-replay/v1).
//
// Over a single 24-hour window the dominant term is simply whether BTC went
// up or down, and a full-size round trip costs roughly 26 bps in fees,
// slippage and impact, so churning in and out on 1-minute signals mostly
// pays the pool. This bot therefore starts long and stays long, with two
// protections:
//
//   - It buys ~98% of its cash on the third bar and holds, tracking the
//     highest close since entry. If a close falls 2.5% under that peak it
//     sells everything: a real downtrend day is exited early instead of
//     ridden to the bottom, while ordinary chop (1-2% dips) never triggers it.
//   - After an exit it waits at least 30 bars, then re-enters only when the
//     close is back above EMA(240) (the 4-hour trend, seeded with the mean
//     of its first 240 closes, then stepped by 2/241), so it rejoins an
//     uptrend that resumes but stays in cash while the trend is down.
//   - It opens nothing new in the last 40 bars of the 1,440-bar window: a
//     round trip there cannot earn its fees back.
//
// On a rising or sideways day this behaves like buy-and-hold minus one
// round trip of costs; on a falling day it loses at most the trailing-stop
// distance plus costs and then sits in cash. Everything is float64
// + - * / on the bar closes, no clock, no randomness: the same bars always
// give the same orders.

import { runBars, type OrderInput } from './vendor/makefun-bars.ts';

const SLOW = 240;
const TRAIL = 0.025; // exit 2.5% under the peak close since entry
const REENTER_WAIT = 30; // bars flat before a re-entry may fire
const REENTER_BAND = 0.001; // close must be 0.1% above EMA(240) to re-enter
const FIRST_ENTRY_BAR = 3;
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

const slow = new Ema(SLOW);
let barsSeen = 0;
let peakSinceEntry = 0;
let flatSince = -REENTER_WAIT;
let enteredOnce = false;

await runBars({
  onBatch(state, batch) {
    const orders: OrderInput[] = [];
    const bar = batch.bars[0];
    if (bar === undefined) return orders;
    const symbol = bar.symbol;
    const close = Number(bar.c);
    slow.step(close);
    barsSeen += 1;
    if (state.warmingUp) return orders;

    const held = state.positions.get(symbol);
    if (held !== undefined) {
      if (close > peakSinceEntry) peakSinceEntry = close;
      if (close < peakSinceEntry * (1 - TRAIL)) {
        orders.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: SLIPPAGE_BPS });
        flatSince = barsSeen;
        peakSinceEntry = 0;
      }
      return orders;
    }

    if (barsSeen > LAST_ENTRY_BAR) return orders;
    const firstEntry = !enteredOnce && barsSeen >= FIRST_ENTRY_BAR;
    const reEntry =
      enteredOnce &&
      barsSeen - flatSince >= REENTER_WAIT &&
      slow.value !== null &&
      close > slow.value * (1 + REENTER_BAND);
    if (firstEntry || reEntry) {
      const spend = (state.cash * 98n) / 100n;
      if (spend >= BigInt(state.hello.fees.min_notional_quote_units)) {
        orders.push({ side: 'buy', symbol, notional_quote_units: spend, max_slippage_bps: SLIPPAGE_BPS });
        peakSinceEntry = close;
        enteredOnce = true;
      }
    }
    return orders;
  },
});
