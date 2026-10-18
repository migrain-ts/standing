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
