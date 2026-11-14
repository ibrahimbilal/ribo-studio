# Screensaver subscribe animation

Optional subscribe overlay for **static image** Screensaver exports. When enabled, a short animated overlay is composited during export while the rest of the video stays on the project encode path (Fast VFR hybrid segments or Optimized CFR).

## Behavior

- **Disabled:** same encode path as a normal static screensaver export.
- **Enabled:** the client paints a cropped transparent PNG sequence at **`SUBSCRIBE_ANIMATION_FPS` (60)** for **7 seconds** (~420 frames). Frames are stored in a **persistent disk cache** when possible; export prefers `animationCacheKey` over re-uploading multipart frames. The server composites with FFmpeg `overlay` (hybrid 1/60/1 fps segments or Optimized CFR dynamic region), then muxes audio once.

Settings are saved with the Screensaver project (IndexedDB). Overlay **position** / **start time** are applied at composite time and do not invalidate the animation pixel cache.

## Persistent cache

Durable store (survives tab-close cleanup, project delete, and restarts):

`server/tmp/subscribe-animation-cache/`

```text
static/<template-id>/<render-hash>/{0001.png…, manifest.json}
dynamic/<youtube-channel-id>/
  channel.json
  assets/<avatar-content-hash>.<ext>
  animations/<template-id>/<render-hash>/{0001.png…, manifest.json}
```

- **Format:** cropped transparent **PNG sequence** (`png-seq`). Selected after probing WebM VP9 alpha (`npm run probe:subscribe-animation-format`); hybrid/CFR still expect `%04d.png`.
- **Static templates:** `subscribe-only`, `subscribe-alerts`, `like-subscribe-alerts` (shared across channels/projects).
- **Dynamic template:** `channel-card` (keyed by canonical YouTube `channelId` + visual channel fields + avatar **content** hash).
- Cache key: SHA-256 of stable JSON (template, renderer/schema versions, size %, edge distance, output width, fps/duration, and dynamic channel deps only). Excludes position, startSec, background, audio, video duration.
- APIs under `/api/screensaver/subscribe-animation-cache/*`. Background client prep (concurrency 1) on Screensaver init / channel fetch; export awaits or reuses in-flight jobs.
- Management UI: Subscribe Animation section in Screensaver Settings (status, stats, prepare/rebuild/clear).

## Editor

- Enable the toggle, pick a **style**, set **start time**, **position**, **size (% of output width)**, and **distance from edges**.
- **Show on preview canvas** loops the animation on the main editor canvas while tuning (default on).
- **Channel card** style: YouTube **Fetch** for channel name, avatar, subscriber count, and canonical **channel ID** (`POST /api/youtube-channel-lookup`).

### Styles

| Style | Kind | Default size (% output width) |
| --- | --- | --- |
| Channel card | dynamic | 27 |
| Subscribe button only | static | 12 |
| Subscribe + alerts | static | 18 |
| Like + subscribe + alerts | static | 25 |

Edge distance defaults to **0** for all styles. Changing style applies that style’s default size and resets edge to 0.

## Local development

```bash
npm install
npm run dev
```

## Automated verification

```powershell
$env:RIBO_SCREENSAVER_TEST="1"
npm run test:screensaver-subscribe
npm run test:subscribe-animation-cache
```

Cache unit tests cover key stability, multi-channel dirs, retain-safe clear, and corrupt-manifest recovery. Hybrid/CFR regression tests remain under `test:screensaver-subscribe` / `test:screensaver-cfr`.

## Benchmark / format probe

```bash
npm run bench:screensaver-subscribe
npm run probe:subscribe-animation-format
```

Probe writes `server/tmp/subscribe-animation-format-probe.json`.

## Upload limits

Export may send either `animationCacheKey` (no frame upload) or up to **`SUBSCRIBE_ANIMATION_EXPORT_FRAME_CAP`** cropped `animationFrames` PNGs plus composition/audio (multer cap `SCREENSAVER_EXPORT_MAX_MULTIPART_FILES`, **80 MB** per file).

## Rendering

- Preview canvas and export share `renderSubscribeAnimationAt()` with explicit `timeSec` (deterministic frames, not CSS transitions).
- Hybrid encode: [`server/src/renderScreensaverHybrid.ts`](../server/src/renderScreensaverHybrid.ts) — segments A/C loop the composition PNG at 1 fps; segment B overlays the PNG sequence at animation fps; concat with copy or re-encode fallback; audio muxed once for full duration.
- Optimized CFR: [`server/src/screensaverCfr/`](../server/src/screensaverCfr/) — same PNG overlay for the dynamic region; job-local CFR segment cache unchanged.
