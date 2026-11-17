# Project map

Concise navigation for Ribo Studio (repo `ibrahimbilal/ribo-studio`). Deep detail: `.cursor/skills/ribo-project/` topic files (see that skill’s table). Release changelog: root [`CHANGELOG.md`](../../CHANGELOG.md). Agent notes: [CHANGELOG.md](CHANGELOG.md).

## Stack

- Monorepo workspaces: `client/` (Vue 3 + Pinia + vue-router + Tailwind 4), `server/` (Express 5 + FFmpeg), `shared/` (path imports, not a package).
- Node `^20.19.0 || >=22.12.0`. Dev: Vite `5173`, API `3001`. Prod: Express serves `client/dist` + API.
- No accounts, no cloud project storage. Browser IndexedDB + `server/tmp/`.

## Apps (routes)

| App | Route | Client | Shared | Server |
| --- | --- | --- | --- | --- |
| Dashboard | `/` | `client/src/views/` | — | — |
| Shorts (Ranking) | `/shorts` | `client/src/apps/ranking-videos/`, `client/src/stores/project.ts`, `client/src/components/` | `shared/frame.ts`, `shared/timeline.ts` | `server/src/render.ts`, clips/export in `index.ts` |
| Shorts (Image Motion) | `/shorts` (mode) | `client/src/apps/image-motion-shorts/` | `shared/imageMotion.ts`, `shared/imageMotionTimeline.ts` | `server/src/renderImageMotion.ts` |
| Screensaver | `/screensaver` | `client/src/apps/frame-screensaver/` | `shared/screensaver*.ts`, `shared/subscribeAnimation*.ts` | `server/src/renderScreensaver*.ts`, `server/src/screensaverCfr/`, `server/src/subscribeAnimationCache*.ts` |
| Thumbnails | `/thumbnails` | `client/src/apps/thumbnail-studio/` | `shared/thumbnail*.ts` | Browser-only export (no FFmpeg) |
| Image Upscaler | `/upscale` | `client/src/apps/image-upscaler/` | `shared/imageUpscaler.ts` | `server/src/imageUpscaler*.ts`, `realesrgan*.ts` |
| Audio Looper | `/looper` | `client/src/apps/audio-looper/` | `shared/audioLooper*.ts`, `shared/audioProcessingPlan.ts`, `shared/audioExecutionPlan.ts`, `shared/audioCompatibility.ts` | `server/src/renderAudioLooper.ts`, `audioLooperRoutes.ts`, `audioProcessing.ts`, `encodeOnceLoopCopy.ts`, `audioPeriodCache.ts`, `screensaverAudioMux.ts` |

Router: `client/src/app/router.ts`. Nav: `client/src/app/navigation.ts`.

## Platform shell

| Responsibility | Path |
| --- | --- |
| Shell, toasts, page transition | `client/src/App.vue` |
| Design tokens / shared classes | `client/src/style.css`, `docs/ui-design-system.md` |
| Sidebar / header / mobile drawer / app version | `client/src/components/layout/` (`AppVersionLabel.vue`, `AppTempStorageButton.vue`, `AppThemeToggle.vue`) |
| Global Settings modal + panels | `client/src/components/settings/` (Appearance / Integrations / Backup), store `client/src/stores/globalSettings.ts`, schema `shared/globalSettings.ts`, backup `shared/settingsBackup.ts`, appearance `client/src/lib/appearance.ts`, language `client/src/lib/locale.ts`, i18n `client/src/i18n/` (`messages/*` + `locales/*`) |
| Shared UI primitives | `client/src/components/ui/` |
| Renderer health, notifications | `client/src/stores/platform.ts` |
| Export queue / job poll / notifications | `client/src/lib/managedExportJobs.ts`, `exportQueueRunner.ts`, `jobPoll.ts`, `renderNotifications.ts` |
| IndexedDB / session reset | `client/src/lib/idb.ts`, `sessionCleanup.ts`, `serverUploadCleanup.ts` |

## Server core

| Responsibility | Path |
| --- | --- |
| HTTP routes | `server/src/index.ts` |
| Global settings (server prefs) | `server/src/globalSettings.ts`, `globalSettingsRoutes.ts` → `server/tmp/global-settings.json` |
| Storage overview / system info | `server/src/storageOverview.ts`, `systemInfo.ts` |
| FFmpeg job queue (one at a time) | `server/src/jobs.ts` |
| Disk / expiry / cleanup | `server/src/storage.ts`, `diskSpace.ts` |
| Encoders / threading | `server/src/encoders.ts`, `ffmpegThreading.ts`, `ffmpegUtil.ts` |
| Temp data | `server/tmp/` (gitignored) |

## Scripts

- Root scripts: `package.json` (`dev`, `typecheck`, `test:*`, `bench:*`, `release:*`).
- Releases: `.cursor/skills/release-manager/`; SemVer in root `package.json`; UI via `client/src/lib/appVersion.ts`.
- Optional AI Lite binaries: `tools/realesrgan/` (gitignored natives).

## Where to change (quick)

| Task | Open |
| --- | --- |
| Ranking preview/export paint | `client/src/lib/drawOverlay.ts`, `format.ts`, `shared/frame.ts`, `shared/timeline.ts`, `server/src/render.ts` |
| Ranking editor state | `client/src/stores/project.ts` |
| Screensaver encode | `server/src/renderScreensaver.ts`, `renderScreensaverHybrid.ts`, `screensaverCfr/` |
| Screensaver subscribe animation cache | `shared/subscribeAnimationCache*.ts`, `shared/subscribeAnimationTemplates.ts`, `server/src/subscribeAnimationCache*.ts` |
| Screensaver background audio | `shared/screensaverAudio.ts`, `server/src/audioAssets.ts`, `screensaverAudioRoutes.ts`, `screensaverAudioMux.ts`; preview playlist `ScreensaverPreviewAudio.vue` + `GET /api/screensaver/audio/:id/track/:index` |
| Looper → Screensaver | `client/.../audio-looper/lib/sendToScreensaver.ts`, `sendToScreensaverSelection.ts`, `LooperSendToScreensaver.vue`, `POST /api/screensaver/audio/from-looper-plan`, `POST /api/screensaver/audio/:id/clone-order` |
| Screensaver Export All | `client/.../frame-screensaver/lib/exportAllPlan.ts`, `ScreensaverProjectList.vue`, store `exportAllProjects` |
| Shared UI look | `client/src/style.css`, `client/src/components/ui/` |
| New app route | `router.ts`, `navigation.ts`, new `client/src/apps/<name>/` |

## Context docs

- Architecture: [ARCHITECTURE.md](ARCHITECTURE.md)
- Features: [FEATURES.md](FEATURES.md)
- Conventions: [CONVENTIONS.md](CONVENTIONS.md)
- Decisions: [DECISIONS.md](DECISIONS.md)
- Maintenance: [MAINTENANCE.md](MAINTENANCE.md)
- Release changelog: root [`CHANGELOG.md`](../../CHANGELOG.md) (Keep a Changelog; version in root `package.json`)
- Agent changelog: [CHANGELOG.md](CHANGELOG.md)
- Versioning: `.cursor/rules/versioning.mdc` (always applied); skill: `.cursor/skills/release-manager/`
