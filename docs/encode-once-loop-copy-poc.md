# Encode-Once Loop-Copy — Proof of Concept Report

Generated: 2026-11-15T18:08:11.835Z
FFmpeg: ffmpeg version 6.1.1-essentials_build-www.gyan.dev Copyright (c) 2000-2023 the FFmpeg developers
Platform: win32 x64
Node: v26.13.0
POC_QUICK: 0

## Root cause (production today)

For looper-plan recipes that need decode (e.g. mixed sample rates), Screensaver mux:
1. Builds **one loop-period WAV** via `renderAudioLooper` (correct — not full timeline).
2. Then at mux runs `-stream_loop -1` on that WAV with `buildScreensaverAudioFilter({ duration: jobDuration })`
   and **AAC-encodes the entire Screensaver duration** (e.g. 14400s).

So the waste is full-timeline lossy encode, not a multi-hour WAV file.

## Pipelines compared

### A — Current / STANDARD_PROCESSING
```text
sources → filter(resample/concat) → WAV period → stream_loop + AAC encode(full target)
```

### B — ENCODE_ONCE_LOOP_COPY (MP3 period; AAC period blocked)
```text
sources → filter(resample/concat) → MP3 period file → strip delay → stream_loop -c copy → packet trim
```

AAC period + packet loop produced near-silent joins (encoder priming / MDCT splice).
Forced `libmp3lame` `.mp3` period is used (this FFmpeg build rejects mp3-in-m4a); final MP4 mux still `-c:a copy`.

## Fixtures

- Short playlist: MP3 256 kbps @ 44100 Hz (8.046s) + MP3 256 kbps @ 48000 Hz (7.536s)
- Long playlist: MP3 256 kbps @ 44100 Hz (16.039s) + MP3 256 kbps @ 48000 Hz (14.040s)
- Common sample rate target: 48000 Hz stereo
- Target AAC bitrate policy: 256 kbps (source-quality preserve)

Note: The reported production period (~776.466s) was **not** synthesized verbatim;
scaled periods exercise the same mixed-rate + repetition shape. Encode-input duration
is the primary efficiency metric (should stay ≈ period for path B).

## Results (measured)

| Case | Target s | Period s | A wall ms | B wall ms | A encode input s | B encode input s | A temp B | B temp B | Continuity | Fallback |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| period-only | 15.581714 | 15.582 | 349 | 656 | 15.581714 | 15.595 | 3479317 | 1502672 | PASS | NO |
| 30min | 1800 | 15.582 | 13979 | 3285 | 1800 | 15.595 | 60914968 | 58669520 | PASS | NO |
| 2h | 7200 | 30.079 | 59623 | 12215 | 7200 | 30.080 | 237512253 | 232397266 | PASS | NO |
| 4h | 14400 | 15.582 | 128380 | 22698 | 14400 | 15.595 | 466479077 | 461869520 | PASS | NO |
| 8h | 28800 | 15.582 | 243537 | 161434 | 28800 | 15.595 | 929980902 | 922669520 | PASS | NO |

### Per-case detail

#### period-only

- Quality strategy: HIGH_QUALITY_REENCODE
- Execution strategy (planner): STANDARD_PROCESSING
- Target bitrate kbps: 256
- Natural period / aligned period: 15.581714s / 15.594667s
- Frame-aligned period: true
- Join RMS / baseline RMS / ratio: 0.0 / 0.0 / 0.00
- A out bytes / bitrate: 502981 / 256465
- B out bytes / bitrate: 502317 / 256000
- Continuity notes: Stripped container start_time=0.0230s before loop.; No repetition — join continuity skipped.

#### 30min

- Quality strategy: HIGH_QUALITY_REENCODE
- Execution strategy (planner): ENCODE_ONCE_LOOP_COPY
- Target bitrate kbps: 256
- Natural period / aligned period: 15.581714s / 15.594667s
- Frame-aligned period: true
- Join RMS / baseline RMS / ratio: 2579.1 / 3982.0 / 0.65
- A out bytes / bitrate: 57938632 / 256003
- B out bytes / bitrate: 57603885 / 256000
- Continuity notes: Stripped container start_time=0.0230s before loop.

#### 2h

- Quality strategy: HIGH_QUALITY_REENCODE
- Execution strategy (planner): ENCODE_ONCE_LOOP_COPY
- Target bitrate kbps: 256
- Natural period / aligned period: 30.079184s / 30.080000s
- Frame-aligned period: true
- Join RMS / baseline RMS / ratio: 2790.6 / 2725.0 / 1.02
- A out bytes / bitrate: 231751915 / 256000
- B out bytes / bitrate: 230403885 / 256000
- Continuity notes: Stripped container start_time=0.0230s before loop.

#### 4h

- Quality strategy: HIGH_QUALITY_REENCODE
- Execution strategy (planner): ENCODE_ONCE_LOOP_COPY
- Target bitrate kbps: 256
- Natural period / aligned period: 15.581714s / 15.594667s
- Frame-aligned period: true
- Join RMS / baseline RMS / ratio: 2579.1 / 3982.0 / 0.65
- A out bytes / bitrate: 463502741 / 256000
- B out bytes / bitrate: 460803885 / 256000
- Continuity notes: Stripped container start_time=0.0230s before loop.

#### 8h

- Quality strategy: HIGH_QUALITY_REENCODE
- Execution strategy (planner): ENCODE_ONCE_LOOP_COPY
- Target bitrate kbps: 256
- Natural period / aligned period: 15.581714s / 15.594667s
- Frame-aligned period: true
- Join RMS / baseline RMS / ratio: 2579.1 / 3982.0 / 0.65
- A out bytes / bitrate: 927004566 / 256000
- B out bytes / bitrate: 921603885 / 256000
- Continuity notes: Stripped container start_time=0.0230s before loop.

## Continuity gate verdict

**PASS** — Join continuity vs continuous encode was within acceptance thresholds for all repeated-target cases.

Production integration may proceed with feature flag + automatic fallback.

## Acceptance mapping

| Criterion | Status |
| --- | --- |
| Only ~period seconds of AAC encode input | PASS (measured) |
| Join continuity vs continuous path | PASS |
| YouTube upload verification | NOT RUN |
| Production integration | ENABLED (default) with `RIBO_ENCODE_ONCE_LOOP_COPY` rollback |

