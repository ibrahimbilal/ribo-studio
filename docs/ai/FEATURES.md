# Features

Verified product surfaces and where they live. Deep detail: `.cursor/skills/ribo-project/` topic files.

## Platform

- Multi-app shell with sidebar, header, notifications, renderer health, New project — `App.vue`, `components/layout/`, `stores/platform.ts`.
- Header temp-storage control — shows `server/tmp/` size (MB/GB, 2 decimals) and clears disposable temp on click; keeps subscribe-animation-cache — `AppTempStorageButton.vue`, `GET/POST /api/storage/temp*`.
- Dashboard cards from `navItems` — `client/src/app/navigation.ts`, `views/`.
- Shared export notifications / cancel / download / clear all — `AppNotifications.vue`, `renderNotifications.ts`, `managedExportJobs.ts`, `platform.clearAllNotifications`.
- Reload recovery for active FFmpeg jobs — `persistedRenderJobs.ts`, `resumePersistedRenderJobs.ts`, `GET /api/jobs/active`.

## Shorts — Ranking

- Up to 30 clips (local or link title-only); reorder, trim, rank colors, play-at-end, delete all — `stores/project.ts`, `ClipSidebar.vue`, `SelectedClipPanel.vue`.
- Banner word spans + presets — `StylePanel.vue`, `lib/presets.ts`, `lib/title.ts`.
- Canvas overlay preview + MP4 export — `PreviewStage.vue`, `usePlayback.ts`, `drawOverlay.ts`, `exportJob.ts`, `server/src/render.ts`.
- Links never download video (`canDownload: false`).

## Shorts — Image Motion

- Still images → pan motion + transitions + optional music — `apps/image-motion-shorts/`, `shared/imageMotion*.ts`, `renderImageMotion.ts`.
- Mode toggle with Ranking on `/shorts` — `ShortsModeBar.vue`, `RankingVideosView.vue`.

## Screensaver

- Long-form 16:9 from image or looping video; composition, frames, adjustments — `apps/frame-screensaver/`, `shared/screensaverComposition.ts`.
- Export: Fast VFR or Optimized CFR — `renderScreensaver.ts`, `renderScreensaverHybrid.ts`, `screensaverCfr/`. Eligible CFR/Hybrid finals use **Single-Pass Direct Mux** (`shared/screensaverMuxStrategy.ts`, `docs/single-pass-direct-mux.md`): ffconcat → final MP4 without full-duration video intermediates; Encode-Once may loop the MP3 period at mux. Flag `RIBO_SINGLE_PASS_DIRECT_MUX` (default on).
- Optional subscribe animation overlay with persistent PNG-sequence cache (static + per-channel dynamic) — `shared/screensaverSubscribeAnimation.ts`, `shared/subscribeAnimationCache*.ts`, `server/src/subscribeAnimationCache*.ts`, hybrid/CFR paths.
- Multi-project IndexedDB library for the current SPA session — `screensaverProjectLibrary.ts` (cleared on full page load / app reopen via `sessionCleanup.ts`).
- **Export All** — batch-submit eligible saved projects to the shared FFmpeg queue (immutable snapshots, no parallel encodes); queue order is shortest duration first — `exportAllPlan.ts`, `ScreensaverProjectList.vue`, screensaver store.
- Create Thumbnail / Send to Image Motion — `createThumbnail.ts`, `sendToImageMotion.ts`.
- Background audio up to **1 GiB** via server audio-assets (`shared/screensaverAudio.ts`, `/api/screensaver/audio*`); multiple projects may share one `audioAssetId`. When a project has available upload audio, a compact player appears at the bottom of the preview stage (`ScreensaverPreviewAudio.vue`). Looper-plan recipes expose playlist tracks in audio meta + `GET /api/screensaver/audio/:id/track/:index`; the preview player uses one timeline for the full playlist duration with seek-bar markers at track boundaries (trims honored; export crossfade is not simulated).

## Thumbnail Studio

- Browser-only 16:9 badges (resolution + duration) — `apps/thumbnail-studio/`, `renderThumbnail.ts`.
- Multi-project IndexedDB for the current SPA session (cleared on full page load / app reopen via `sessionCleanup.ts`).
- Transfer from Screensaver — `stageTransfer.ts`, `shared/thumbnailTransfer.ts`.
- No FFmpeg; PNG/JPEG download only.

## Image Upscaler

- Two-stage upscale (Sharp Lanczos3 default; optional Real-ESRGAN) then export fit — `apps/image-upscaler/`, `imageUpscaler*.ts`, `realesrgan*.ts`.
- Batch, ZIP, re-export, Send to Screensaver — store + routes under `/api/image-upscaler/*`.
- Not persisted to IndexedDB. Docs: `docs/image-upscaler.md`.

## Audio Looper

- Loop audio to exact duration (Simple / Seamless; playlist crossfade) — `apps/audio-looper/`, `shared/audioLooper*.ts`, `shared/audioLooperChannels.ts`, `shared/audioProcessingPlan.ts`, `renderAudioLooper.ts`.
- Source-Quality-First planner: stream copy when compatible (honored end-to-end into Screensaver mux — no unconditional WAV), lossless PCM only when complex transforms need decode, source-aware bitrates when re-encoding (`streamCopy` / `lossyEncodeCount` / separate source vs stream bitrate logs).
- Screensaver MP4 execution planner (`shared/audioExecutionPlan.ts`): eligible long loops use **Encode-Once Loop-Copy** (one verified MP3 period + packet loop; AAC period looping blocked by continuity POC). Flag `RIBO_ENCODE_ONCE_LOOP_COPY` (default on; set `0`/`false` to force STANDARD). Period cache: `server/tmp/audio-period-cache/`. Report: `docs/encode-once-loop-copy-poc.md`.
- Audio Compatibility panel (`shared/audioCompatibility.ts`, `LooperCompatibilityPanel.vue`): groups tracks by stream signature (not bitrate), per-track indicators, settings vs file mismatch, Encode-Once eligibility, keep/remove incompatible actions — preview of the same planner used at export.
- Shares FFmpeg queue as `kind: 'audio-looper'`. Formats MP3/WAV/FLAC. Channel policy: mono-only → mono; stereo/mixed → stereo; multi-channel preserved on WAV/FLAC or downmixed for MP3. Probe: `POST /api/audio-looper/probe`.
- **Send to Screensaver** transfers original sources + settings as an audio recipe (`POST /api/screensaver/audio/from-looper-plan`) — no intermediate lossy export required; multi-select attaches one shared asset to many Screensaver projects. Playlists (≥2 tracks) can keep the **same order for all projects** or use a **unique order for each project** (first keeps current order; others clone via `POST /api/screensaver/audio/:id/clone-order` with hardlinked sources) (`LooperSendToScreensaver.vue`, `sendToScreensaver.ts`, `screensaverAudioRefs.ts`).

## Cross-cutting

| Feature | Location |
| --- | --- |
| Design system | `client/src/style.css`, `docs/ui-design-system.md` |
| File drop / status / toggles | `FileDropZone.vue`, `FileStatusBox.vue`, `ToggleSwitch.vue` |
| Audio fields | `client/src/components/audio/` |
| Card reorder drag | `composables/useCardReorder.ts` |
| URL / oEmbed import | `shared/urls.ts`, `server/src/oembed.ts` |
| Encoder probe | `server/src/encoders.ts`, `GET /api/encoders` |
