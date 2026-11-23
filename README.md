# Race a BTC trading bot live for 24 hours — entry

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/Airdrop19/btc-race-entry/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/Airdrop19/btc-race-entry/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Entry for the make.fun bounty [Race a BTC trading bot live for 24 hours](https://make.fun/bounty/btc-race-24h-20261123-0511).

`main.ts` (Node 22, standard library only) is a hold-with-a-crash-exit bot for the cbBTC 1-minute replay: it buys ~98% of its cash early and holds, sells everything if a close falls 2.5% under the highest close since entry, and re-enters only when the close is back above EMA(240) after at least 30 flat bars. It speaks agent-fun/bars-replay/v1 through the kit's SDK shim in `vendor/makefun-bars.ts`.
