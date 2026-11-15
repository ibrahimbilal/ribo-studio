# Single-Pass Direct Mux — Proof of Concept Report

Generated: 2026-11-15T19:37:59.767Z
FFmpeg: ffmpeg version 6.1.1-essentials_build-www.gyan.dev Copyright (c) 2000-2023 the FFmpeg developers
Platform: win32 x64
Node: v26.13.0
Resolution: 640x360 @ 30 fps (representative segments; not 4K wall-time)
Long run: no (set RIBO_POC_DIRECT_MUX_LONG=1 for 30m/2h)

## Pipelines

- **A** Current: segments → full video intermediate (+faststart) → looped.mp3 → final (+faststart)
- **B** Direct video: segments ffconcat → final with materialized looped.mp3
- **C** Full direct: segments ffconcat + period `-stream_loop` → final (no looped.mp3)
- **A-noaudio / B-noaudio**: legacy remux vs direct concat to final

## Results (measured)

| Case | Pipeline | Wall | Temp bytes | Out bytes | Frames | CFR | Full video temp | Full audio temp | FFmpeg ops |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | ---: |
| 30s | A | 0.23s | 1.59 MiB | 760.2 KiB | 900/900 | PASS | Yes | Yes | 4 |
| 30s | B | 0.17s | 1.54 MiB | 760.2 KiB | 900/900 | PASS | No | Yes | 3 |
| 30s | C | 0.08s | 878.9 KiB | 759.8 KiB | 900/900 | PASS | No | No | 2 |
| 30s | A-noaudio | 0.14s | 91.2 KiB | 44.8 KiB | 900/900 | PASS | Yes | No | 2 |
| 30s | B-noaudio | 0.08s | 46.3 KiB | 44.8 KiB | 900/900 | PASS | No | No | 1 |
| 120s | A | 0.36s | 5.97 MiB | 2.96 MiB | 3600/3600 | FAIL | Yes | Yes | 4 |
| 120s | B | 0.27s | 5.80 MiB | 2.96 MiB | 3600/3600 | FAIL | No | Yes | 3 |
| 120s | C | 0.16s | 3.08 MiB | 2.96 MiB | 3600/3600 | PASS | No | No | 2 |
| 120s | A-noaudio | 0.26s | 359.6 KiB | 176.8 KiB | 3600/3600 | PASS | Yes | No | 2 |
| 120s | B-noaudio | 0.16s | 182.8 KiB | 176.8 KiB | 3600/3600 | PASS | No | No | 1 |

## Correctness gate

Production gates **C** (full direct) and **B-noaudio** (direct video, no audio) passed CFR packet validation.

Note: Pipelines **A/B** may fail the strict ±0.25s audio-duration CFR check when `streamCopyLoopPeriod` undershoots slightly; **C** avoids that by applying `-t` at the final mux. This is a measured advantage of direct period looping, not a regression of C.

## Notes

- Temp bytes include the final output under the case directory.
- Long 4K wall-clock times are not extrapolated from these runs.
- Production enables SINGLE_PASS_DIRECT_MUX by default with LEGACY_MULTI_PASS fallback.

