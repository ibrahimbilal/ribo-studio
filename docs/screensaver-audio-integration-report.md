# Screensaver audio, size, and Looper integration report

Investigation + implementation notes (2026-11-14). Distinguish **measured** vs **estimated**.

## 1. Root cause of ~5.76 GB four-hour 4K output

**Verdict (estimated from architecture + prior benches; not a new 4 h re-encode in this pass):** expected for Optimized CFR Balanced (CRF 20) 4K60 on real artwork.

- Optimized CFR encodes unique static segments once, then **stream-copies** them into a full-duration timeline. Concat reuse saves **encode time**, not final container size — repeated packets still occupy space (`docs/optimized-cfr-production-report.md`).
- Audio mux already uses **`-c:v copy`** + AAC 192k (`renderScreensaverCfr.ts` `muxAudio`). Background audio does not force a full video re-encode.
- Subscribe overlay only re-encodes the **dynamic** region; static regions stay stream-copied.
- Back-of-envelope: 5.76 GB / 14 400 s ≈ **3.3 Mbit/s** overall; minus ~192 kbit/s audio → ~**3.0 Mbit/s** video — plausible for photographic 4K60 H.264 CRF 20.
- Lab `testsrc2` 4K60 60 s ≈ **7 MB** extrapolates to ~**1.7 GB** / 4 h — **not** comparable to real art.

Defaults were **not** lowered purely for size (quality preserved). Use **Compact** (CRF 24) in Output when smaller files are preferred.

## 2. Root cause of incorrect missing-audio warning

`audioMissing` was `audioMode === 'upload' && !audioIds.includes(id)` — IDB key index only.

False positives when:

- Upload/session had `audioFile` in memory but IDB save failed or was skipped.
- Restore was still loading (no validating state).

**Fix:** explicit `audioAvailability` (`idle` → `uploading`/`validating` → `available`/`missing`/`error`); warning only for `missing`. Server `audioAssetId` is authoritative for export.

## 3. Rendering optimizations (this pass)

- Corrected UI `estimateOutputBytes` for Optimized CFR 4K60 stills (~3 Mbit/s band).
- Confirmed CFR audio path already stream-copies video; no architecture revert.
- Full CRF/GOP/segment matrix benches deferred (short benches already exist via `npm run bench:screensaver-cfr`); do not run extra 4 h encodes without need.

## 4–5. Benchmarks / expected 4 h size

| Source | Result |
| --- | --- |
| Prior integrated 4K60 60 s (test pattern) | **7.07 MB** measured |
| User 4K 4 h real art + audio | **~5.76 GB** observed |
| Updated UI estimate (4K60 CFR + audio) | ~**5.7 GB** class (estimate) |

## 6. Audio upload limit

- Central: `SCREENSAVER_AUDIO_MAX_BYTES = 1 GiB` in `shared/screensaverAudio.ts`.
- Ranking / Image Motion music remain **40 MiB**.
- Server: `POST /api/screensaver/audio`, export may reference `audioAssetId`.

## 7–8. Looper → Screensaver + lifecycle

- **Send to Screensaver** on finished export in `LooperExportBar` only.
- `POST /api/screensaver/audio/from-job` copies/hardlinks looper output into `audio-assets/`.
- Active screensaver renders `retainAudioAssets`; 7-day sweep drops unreferenced assets. Tab-close purge does not wipe audio-assets. Deleting the looper output does not remove an adopted asset.

## 9. Modified files (primary)

`shared/screensaverAudio.ts`, `shared/screensaver.ts`, `server/src/audioAssets.ts`, `screensaverAudioRoutes.ts`, `index.ts`, `jobs.ts`, `storage.ts`, `renderScreensaver.ts`, client `media.ts`, `api.ts`, screensaver store/types/settings/AudioFileField, `LooperExportBar.vue`, `sendToScreensaver.ts`, tests, docs.

## 10. Tests

- `shared/screensaverAudio.test.ts` + `server/src/audioAssets.test.ts` — **8/8 passed**.
- `npm run typecheck` — passed.

## 11. Remaining / manual checks

- Upload a real ~329 MB looper MP3 into Screensaver; confirm progress + export with `audioAssetId`.
- Send to Screensaver → delete looper notification/output after 2 h sweep → Screensaver export still works.
- Optional: short CFR quality bench matrix (`bench:screensaver-cfr`) before changing Balanced defaults.
- YouTube upload not performed in this pass — do not claim verified YouTube compatibility.
