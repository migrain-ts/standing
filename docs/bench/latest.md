# Benchmark

| Metric | Value |
| --- | --- |
| Date | 2026-10-18T22:53:45.885Z |
| CPU | Apple M1 Max |
| Cores | 10 |
| Memory | 32.0 GiB |
| Node | v26.5.0 |
| Parameters | 5000 buyers, 60 s arrival window, up to 2 seats each, abandon rate 0 |
| Duration | 60.4 s |
| HTTP requests | 19195 |
| Requests per second | 318.0 |
| Holds ok / conflicts | 3398 / 314 |
| Orders paid | 3390 |
| Seats sold (database) | 4788 |
| Hold latency p50 / p95 | 9 ms / 16 ms |
| Pay latency p50 / p95 | 160 ms / 167 ms |
| Oversold | 0 |

These numbers describe one laptop running the load generator, the API, the worker, Postgres, Redis and the web app together in Docker. They are not a capacity claim for a real deployment. Reproduce with `npm run bench` against the compose stack.

## Notes (added by hand on 2026-10-19; `npm run bench` rewrites this file without them)

- **Where things ran.** `npm run bench` runs `apps/simulator/src/bench.ts` on the host with `tsx`; the API, worker, Postgres, Redis and web run in the compose containers on the same laptop. The `Node` row is `process.version` of that host-side load generator (v26.5.0). The containers run Node 22 (`FROM node:22-slim` in `docker/node.Dockerfile`).
- **Pay latency is mostly a sleep.** The payment gateway is simulated: `payHold` sleeps `PAYMENT_LATENCY_MS` before its transaction (default 150 ms, which the compose file does not override; `apps/api/src/config.ts`). A p50 of 160 ms is therefore about 150 ms of configured delay plus about 10 ms of real work. It says nothing about a real bank.
- **Why 3,712 hold requests for 5,000 buyers.** "Holds ok / conflicts" counts hold requests answered 201 or 409 (3,398 + 314 = 3,712), not buyers. In `apps/simulator/src/buyer.ts` a buyer reads the availability before each attempt and leaves as `soldOut` without sending a hold when no free seat is left (it wants 1 or 2 consecutive seats and falls back to 1; seats held by other buyers count as taken). The event is in the 4,800-seat Halcyon Arena venue and 4,788 seats were sold, so late arrivals found the venue (nearly) full. At least 1,288 buyers (5,000 − 3,712) therefore never got a 201 or 409. The exact split between sold-out exits, errors and re-queues is **not broken down**: the per-outcome counters (`soldOut`, `errors`, `declined`) exist in the run stats but are not written to this file.
- **3,398 holds, 3,390 orders.** With an abandon rate of 0, the 8 unpaid holds ended through two declined payments (the simulated gateway declines 5% of attempts by default, and a buyer tries twice), an expiry or an error. This is not broken down either.
- **Oversold** is computed in SQL after the run (`bench.ts`: tickets issued minus seats sold, plus seats sold more than once), not counted by the simulator.
