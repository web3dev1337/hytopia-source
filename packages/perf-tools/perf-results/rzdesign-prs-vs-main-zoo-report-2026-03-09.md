# RZDESIGN PR Sweep vs `upstream/main` on Zoo Game

Date: 2026-03-09

Baseline:
- Engine ref: `upstream/main`
- Commit: `44f2a42979999ef76413a6afdad02b416aecc000`
- Scenario: `zoo-game-full`
- CPU throttle: none

Baseline metrics:
- Avg tick: `0.91ms`
- Avg FPS: `17.02`
- Min FPS: `15`
- Avg frame time: `60.47ms`

## Summary

- Open `RZDESIGN` PRs tested one-by-one against the same Zoo baseline: `18`
- `FAIL`: `13`
- `WARN`: `5`
- `PASS`: `0`

Closest to acceptable:
- `#30` `WARN`
- `#31` `WARN`
- `#33` `WARN`
- `#9` `WARN`
- `#34` `WARN`

Most concerning regressions:
- `#23` strong server and memory regression
- `#24` strongest `p99` regression in the sweep
- `#29` and `#32` both dropped min FPS from `15` to `7`
- `#14` regressed both server tick and client frame time materially

Interesting mixed cases:
- `#22` improved average FPS and average frame time, but still failed on server tick cost and min FPS stability
- `#26` was roughly flat on client averages, but still failed on server tick thresholds
- `#32` improved average FPS, but failed badly on server metrics and min FPS

## Important Note

The initial tail of the sweep for PRs `#14+` was invalid because `run-owned-stack-suite.sh` resolved `pr:<n>` through `origin` only. Those PRs were rerun after fixing the resolver to fall back to `upstream`. Final verdicts below use the successful reruns.

Framework fix:
- Commit: `bec6537`
- PR: https://github.com/web3dev1337/hytopia-source/pull/11

Raw outputs:
- Initial batch: `packages/perf-tools/perf-results/rzdesign-pr-zoo-20260309-083752/`
- Rerun batch: `packages/perf-tools/perf-results/rzdesign-pr-zoo-rerun-20260309-0850-fix/`

## Results

| PR | Title | Overall | Avg Tick | Avg FPS | Min FPS | Avg Frame Time |
| --- | --- | --- | --- | --- | --- | --- |
| #2 | [Add configurable blob shadows for entities with quality-based performance controls](https://github.com/hytopiagg/hytopia-source/pull/2) | FAIL FAIL | 0.91 -> 1.05 (+15.3%) | 17.02 -> 15.71 (+7.7%) | 15.00 -> 14.00 (+6.7%) | 60.47 -> 63.38 (+4.8%) |
| #9 | [Improve movement/camera smoothness with deterministic prediction; ack-aware replay; and tick-aligned input application](https://github.com/hytopiagg/hytopia-source/pull/9) | WARN WARNING | 0.91 -> 0.95 (+3.6%) | 17.02 -> 16.44 (+3.4%) | 15.00 -> 14.00 (+6.7%) | 60.47 -> 59.68 (-1.3%) |
| #10 | [client(camera): smooth fixed-camera world-space follow and eliminate jitter](https://github.com/hytopiagg/hytopia-source/pull/10) | FAIL FAIL | 0.91 -> 1.01 (+11.0%) | 17.02 -> 16.40 (+3.7%) | 15.00 -> 14.00 (+6.7%) | 60.47 -> 62.20 (+2.9%) |
| #12 | [Update ThreeJS  to 0.183 ](https://github.com/hytopiagg/hytopia-source/pull/12) | FAIL FAIL | 0.91 -> 1.02 (+11.9%) | 17.02 -> 16.31 (+4.2%) | 15.00 -> 11.00 (+26.7%) | 60.47 -> 68.09 (+12.6%) |
| #13 | [chore(client): update all dependencies and resolve compatibility changes](https://github.com/hytopiagg/hytopia-source/pull/13) | FAIL FAIL | 0.91 -> 0.98 (+6.7%) | 17.02 -> 16.18 (+5.0%) | 15.00 -> 13.00 (+13.3%) | 60.47 -> 61.64 (+1.9%) |
| #14 | [Enhance Local Server Discovery UI & Mobile Testing Flow](https://github.com/hytopiagg/hytopia-source/pull/14) | FAIL FAIL | 0.91 -> 1.18 (+29.2%) | 17.02 -> 14.16 (+16.8%) | 15.00 -> 12.00 (+20.0%) | 60.47 -> 71.37 (+18.0%) |
| #22 | [Improve adaptive render resolution for high-DPI displays.](https://github.com/hytopiagg/hytopia-source/pull/22) | FAIL FAIL | 0.91 -> 1.18 (+29.0%) | 17.02 -> 21.76 (-27.8%) | 15.00 -> 12.00 (+20.0%) | 60.47 -> 52.17 (-13.7%) |
| #23 | [Optimize chunk visibility with incremental culling updates.](https://github.com/hytopiagg/hytopia-source/pull/23) | FAIL FAIL | 0.91 -> 1.23 (+35.0%) | 17.02 -> 14.58 (+14.4%) | 15.00 -> 12.00 (+20.0%) | 60.47 -> 72.01 (+19.1%) |
| #24 | [Optimize GLTF instancing and outline rendering hot paths.](https://github.com/hytopiagg/hytopia-source/pull/24) | FAIL FAIL | 0.91 -> 1.24 (+36.0%) | 17.02 -> 14.36 (+15.7%) | 15.00 -> 11.00 (+26.7%) | 60.47 -> 70.21 (+16.1%) |
| #26 | [perf(client): skip GPU uploads for unchanged GLTF instance attributes](https://github.com/hytopiagg/hytopia-source/pull/26) | FAIL FAIL | 0.91 -> 1.05 (+14.9%) | 17.02 -> 17.16 (-0.8%) | 15.00 -> 15.00 (0.0%) | 60.47 -> 58.99 (-2.4%) |
| #27 | [perf(client): reuse chunk mesh geometry instead of dispose/recreate cycle](https://github.com/hytopiagg/hytopia-source/pull/27) | FAIL FAIL | 0.91 -> 1.05 (+15.1%) | 17.02 -> 15.82 (+7.0%) | 15.00 -> 13.00 (+13.3%) | 60.47 -> 65.08 (+7.6%) |
| #28 | [perf(client): quick-win settings — discrete GPU; faster quality ramp-up](https://github.com/hytopiagg/hytopia-source/pull/28) | FAIL FAIL | 0.91 -> 0.95 (+4.1%) | 17.02 -> 16.04 (+5.7%) | 15.00 -> 11.00 (+26.7%) | 60.47 -> 63.83 (+5.6%) |
| #29 | [perf(server): reuse Entity.tick() event payload to eliminate per-tick allocations](https://github.com/hytopiagg/hytopia-source/pull/29) | FAIL FAIL | 0.91 -> 1.11 (+21.7%) | 17.02 -> 16.93 (+0.5%) | 15.00 -> 7.00 (+53.3%) | 60.47 -> 68.99 (+14.1%) |
| #30 | [perf(client): render bloom pass at quarter resolution (~16× less fill)](https://github.com/hytopiagg/hytopia-source/pull/30) | WARN WARNING | 0.91 -> 0.97 (+6.1%) | 17.02 -> 16.56 (+2.7%) | 15.00 -> 15.00 (0.0%) | 60.47 -> 60.40 (-0.1%) |
| #31 | [perf(client): cache parsed chunk/batch origin coordinates](https://github.com/hytopiagg/hytopia-source/pull/31) | WARN WARNING | 0.91 -> 0.97 (+5.7%) | 17.02 -> 17.16 (-0.8%) | 15.00 -> 15.00 (0.0%) | 60.47 -> 59.95 (-0.9%) |
| #32 | [perf(server): reuse position/rotation arrays in network entity sync](https://github.com/hytopiagg/hytopia-source/pull/32) | FAIL FAIL | 0.91 -> 1.09 (+18.9%) | 17.02 -> 19.60 (-15.1%) | 15.00 -> 7.00 (+53.3%) | 60.47 -> 64.20 (+6.2%) |
| #33 | [Optimize network hot paths on client and server](https://github.com/hytopiagg/hytopia-source/pull/33) | WARN WARNING | 0.91 -> 0.97 (+6.5%) | 17.02 -> 16.60 (+2.5%) | 15.00 -> 15.00 (0.0%) | 60.47 -> 60.90 (+0.7%) |
| #34 | [feat(client): add gamepad controller support](https://github.com/hytopiagg/hytopia-source/pull/34) | WARN WARNING | 0.91 -> 1.01 (+10.3%) | 17.02 -> 16.27 (+4.4%) | 15.00 -> 13.00 (+13.3%) | 60.47 -> 62.14 (+2.8%) |

## Bottom Line

- On this Zoo scenario, no open `RZDESIGN` PR beat `upstream/main` cleanly.
- The safest-looking PRs from a perf perspective were `#30`, `#31`, `#33`, `#9`, and `#34`, but all still registered warnings.
- The strongest regressions were concentrated in `#14`, `#23`, `#24`, `#29`, and `#32`.
