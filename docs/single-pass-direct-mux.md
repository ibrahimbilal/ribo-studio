# Single-Pass Direct Mux

Disk-I/O optimized final assembly for Screensaver **Optimized CFR** (and Hybrid where eligible).

## Problem

After unique CFR segments are encoded, production used to:

1. Stream-copy concat into a full-duration `cfr-video.mp4` (with `+faststart`)
2. Optionally materialize a full-duration `looped.mp3` for Encode-Once audio
3. Mux again into `outputs/{id}.mp4` (with `+faststart`)
4. Run CFR packet validation, then a second metadata probe

Long 4K exports became disk-bound (near-100% disk active time) while CPU/RAM stayed low.

## Strategy

```ts
type ScreensaverMuxStrategy = 'LEGACY_MULTI_PASS' | 'SINGLE_PASS_DIRECT_MUX'
```

Resolved by `shared/screensaverMuxStrategy.ts`:

| Flag | Default | Effect |
| --- | --- | --- |
| `RIBO_SINGLE_PASS_DIRECT_MUX` | on | Master switch; `0` forces legacy multi-pass |
| `RIBO_DIRECT_AUDIO_PERIOD_LOOP` | follows master | Loop verified MP3 period at mux; skip `looped.mp3` |
| `RIBO_DISK_IO_DIAG` | off | Verbose per-stage `[DiskIO]` lines |

Eligibility bits are independent: direct video can succeed while audio still materializes `looped.mp3`.

## Optimized pipeline

```text
Cached video segments
  → ffconcat manifest
  → single FFmpeg mux (-c:v copy) [+ optional -stream_loop period.mp3]
  → outputs/{id}.mp4 (+faststart once)
  → validateCfrPackets → verifyVideoOutput (reuses probe)
```

### No audio

Concat demuxer writes the final MP4 directly (no `cfr-video.mp4`, no second remux).

### Encode-Once audio

Verified MP3 period is prepared (cache + delay strip). When direct audio loop is enabled, mux uses `-stream_loop -1` on the period. AAC period looping remains rejected.

## Fallback

If single-pass mux fails:

1. Delete partial output
2. Recheck free disk space
3. Fall back to `LEGACY_MULTI_PASS` (intermediate video + existing audio materialization)
4. Log the reason once; no silent infinite retry

## Faststart policy

- **Final** MP4: keep `+faststart`
- **Segments / intermediates**: omit `+faststart` (no functional benefit for concat consumers)

## Free space

Before assemble/mux, estimate required free space from duration/resolution/audio. Clear error if insufficient. Recheck before legacy fallback.

## Telemetry

`[DiskIO]` summary logs strategy, whether full-duration video/audio intermediates were skipped, cache hit, peak temp bytes, mux/verify durations, FFmpeg and faststart counts, fallback flag.

## PoC

```bash
npm run poc:single-pass-direct-mux
# optional longer measured runs:
RIBO_POC_DIRECT_MUX_LONG=1 npm run poc:single-pass-direct-mux
```

Report: [`docs/single-pass-direct-mux-poc-report.md`](single-pass-direct-mux-poc-report.md) (generated).

## Limitations

- Full CFR packet validation still reads every video packet (correctness over I/O).
- Direct MP3→MP4 looping relies on the same Encode-Once period gates; failure falls back to materialized audio.
- Hybrid VFR uses the same mux helpers; primary long-duration acceptance is Optimized CFR.
- Download path already streams via `res.download` — unchanged.
- FFmpeg queue remains one job at a time.
