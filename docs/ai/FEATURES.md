# Features

Verified product surfaces and where they live. Deep detail: `.cursor/skills/ribo-project/` topic files.

## Platform

- Multi-app shell with sidebar, header, notifications, renderer health, New project — `App.vue`, `components/layout/`, `stores/platform.ts`.
- Dashboard cards from `navItems` — `client/src/app/navigation.ts`, `views/`.
- Shared export notifications / cancel / download — `AppNotifications.vue`, `renderNotifications.ts`, `managedExportJobs.ts`.
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
- Export: Fast VFR or Optimized CFR — `renderScreensaver.ts`, `renderScreensaverHybrid.ts`, `screensaverCfr/`.
- Optional subscribe animation overlay with persistent PNG-sequence cache (static + per-channel dynamic) — `shared/screensaverSubscribeAnimation.ts`, `shared/subscribeAnimationCache*.ts`, `server/src/subscribeAnimationCache*.ts`, hybrid/CFR paths.
- Multi-project IndexedDB library — `screensaverProjectLibrary.ts`.
- **Export All** — batch-submit eligible saved projects to the shared FFmpeg queue (immutable snapshots, no parallel encodes) — `exportAllPlan.ts`, `ScreensaverProjectList.vue`, screensaver store.
- Create Thumbnail / Send to Image Motion — `createThumbnail.ts`, `sendToImageMotion.ts`.
- Background audio up to **1 GiB** via server audio-assets (`shared/screensaverAudio.ts`, `/api/screensaver/audio*`); multiple projects may share one `audioAssetId`.

## Thumbnail Studio

- Browser-only 16:9 badges (resolution + duration) — `apps/thumbnail-studio/`, `renderThumbnail.ts`.
- Transfer from Screensaver — `stageTransfer.ts`, `shared/thumbnailTransfer.ts`.
- No FFmpeg; PNG/JPEG download only.

## Image Upscaler

- Two-stage upscale (Sharp Lanczos3 default; optional Real-ESRGAN) then export fit — `apps/image-upscaler/`, `imageUpscaler*.ts`, `realesrgan*.ts`.
- Batch, ZIP, re-export, Send to Screensaver — store + routes under `/api/image-upscaler/*`.
- Not persisted to IndexedDB. Docs: `docs/image-upscaler.md`.

## Audio Looper

- Loop audio to exact duration (Simple / Seamless; playlist crossfade) — `apps/audio-looper/`, `shared/audioLooper*.ts`, `shared/audioLooperChannels.ts`, `shared/audioProcessingPlan.ts`, `renderAudioLooper.ts`.
- Source-Quality-First planner: stream copy when compatible (honored end-to-end into Screensaver mux — no unconditional WAV), lossless PCM only when complex transforms need decode, source-aware bitrates when re-encoding (`streamCopy` / `lossyEncodeCount` / separate source vs stream bitrate logs).
- Shares FFmpeg queue as `kind: 'audio-looper'`. Formats MP3/WAV/FLAC. Channel policy: mono-only → mono; stereo/mixed → stereo; multi-channel preserved on WAV/FLAC or downmixed for MP3. Probe: `POST /api/audio-looper/probe`.
- **Send to Screensaver** transfers original sources + settings as an audio recipe (`POST /api/screensaver/audio/from-looper-plan`) — no intermediate lossy export required; multi-select attaches one shared asset to many Screensaver projects (`LooperSendToScreensaver.vue`, `sendToScreensaver.ts`, `screensaverAudioRefs.ts`).

## Cross-cutting

| Feature | Location |
| --- | --- |
| Design system | `client/src/style.css`, `docs/ui-design-system.md` |
| File drop / status / toggles | `FileDropZone.vue`, `FileStatusBox.vue`, `ToggleSwitch.vue` |
| Audio fields | `client/src/components/audio/` |
| Card reorder drag | `composables/useCardReorder.ts` |
| URL / oEmbed import | `shared/urls.ts`, `server/src/oembed.ts` |
| Encoder probe | `server/src/encoders.ts`, `GET /api/encoders` |
