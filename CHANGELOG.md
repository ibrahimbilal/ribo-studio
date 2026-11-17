# Changelog

All notable user-facing changes to Ribo Studio are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Authoritative version: root `package.json` `"version"`.
Detailed agent-oriented development notes: `docs/ai/CHANGELOG.md`.

## [Unreleased]

## [1.6.1] — 2026-11-17

### Fixed

- Toast borders and success/error text use theme tokens so light mode no longer keeps dark-only toast colors.

## [1.6.0] — 2026-11-17

### Added

- Header **theme toggle** — one-click light/dark switch (persists via Appearance settings; System remains available in Global Settings).
- **Global Settings** — sidebar Settings opens an application-wide modal (General, Appearance, Performance, Storage & Cache, Export, Integrations, Backup & Restore, About) with persistent preferences, Subscribe Animation cache management, storage overview, and system information.
- **Appearance** — Light / Dark / System theme, accent colors, interface density, and UI animation toggle (application chrome only; never affects exports or canvas timelines). Light theme uses semantic shell/panel tokens so dashboard cards, sidebar, and header stay readable.
- **Integrations** — centralized YouTube channel registry (add by URL / ID / @handle, default channel, refresh, remove with project-reference warnings), public metadata status, and external engine detection (FFmpeg / FFprobe / upscalers).
- **Backup & Restore** — export/import versioned settings JSON with category selection, merge or replace-category modes, preview, safe rollback, and preference reset (projects, media, caches, channels, and credentials are preserved).
- Global Screensaver output prefs: Rendering mode, Quality/Profile, Preview rendering, and Encoding method (shared across projects; also editable from Screensaver Settings).

### Fixed

- Dark theme shell colors and icon-action contrast so dashboard, sidebar, header, and preview wells stay readable after the Appearance rollout.

### Changed

- Desktop sidebar stays as a fixed icon rail; app names appear as tooltips on the right on hover/focus.
- Screensaver Rendering mode / Quality / Preview rendering / Encoding method are no longer per-project; Global Settings is the source of truth (video/loop exports still force Fast VFR).
- Dynamic channel-card cache keeps one entry per channel theme (Light/Dark); Fetching updated channel data replaces the previous same-theme cache.
- YouTube channel management lives in Global Settings → Integrations; Screensaver Settings uses the shared channel selector (Storage & Cache still manages animation caches).
- Encoding method in Global Settings applies to Screensaver and both Shorts apps (Ranking and Image Motion).

## [1.5.0] — 2026-11-16

### Added

- Header notifications: **Clear all** dismisses finished export rows (in-progress renders stay until cancelled).
- Screensaver: compact audio player at the bottom of the preview when a project has background audio; Looper playlists use one full-duration seek bar with track boundary markers.
- Audio Looper **Send to Screensaver**: choose **Same order for all projects** or **Unique order for each project** when sending a multi-track playlist.
- Header control (left of notifications) shows temp folder size and clears disposable server temp files on click; subscribe animation cache is kept.

### Fixed

- Screensaver preview audio player no longer jumps to the start when seeking (audio download now supports HTTP Range).
- Screensaver preview audio for Looper→Screensaver recipes now plays the full playlist instead of only the first track.

### Changed

- Screensaver **Export all** queues projects from shortest duration to longest.
- Screensaver Create Thumbnail no longer offers **Link to source**; new thumbnails are always a snapshot.
- Export status opens as a floating overlay so expanding it no longer shrinks the studio work area.
- Closing the app/tab now deletes idle Screensaver background audio under `server/tmp/audio-assets/`, and Screensaver / Thumbnail Studio projects no longer return after a full reopen (those libraries reset on each page load).
- Screensaver Optimized CFR (and eligible Hybrid) exports use **Single-Pass Direct Mux**: assemble cached video segments straight into the final MP4 without a full-duration `cfr-video.mp4` / `video-only.mp4` intermediate, and skip full-duration `looped.mp3` when Encode-Once direct period looping is safe. Reduces temporary disk use and logical I/O on long 4K exports. Disable with `RIBO_SINGLE_PASS_DIRECT_MUX=0` (legacy multi-pass fallback remains automatic on failure).

## [1.4.0] — 2026-11-15

### Added

- Audio Looper: **Audio Compatibility** panel — see which tracks can stream-copy together, why processing is required, and keep/remove incompatible tracks before export.
- Screensaver: Encode-Once Loop-Copy for eligible Looper→Screensaver exports — encode one verified audio period, then packet-copy the rest (much faster long exports; preserves source bitrate policy). Disable with `RIBO_ENCODE_ONCE_LOOP_COPY=0` if needed.
- Audio Looper: colored format badges (MP3 / WAV / FLAC / …) on track cards.

## [1.3.0] — 2026-11-14

### Added

- Audio Looper: **Send to Screensaver** multi-select — attach one shared audio asset to many Screensaver projects without duplicating large files.
- Screensaver: **Export all** submits eligible saved projects to the existing render queue (per-project snapshots, queue positions, skip already-exporting).

## [1.2.0] — 2026-11-14

### Added

- Screensaver: persistent Subscribe Animation cache (transparent PNG sequences on disk, shared across projects; static templates + per–YouTube-channel dynamic channel-card assets). Background prep, cache status in Settings, and export reuse via `animationCacheKey` without re-rendering when inputs are unchanged.

## [1.1.0] — 2026-11-14

### Added

- Ranking clip sidebar: **Delete all** button with confirm dialog (same pattern as Image Motion / Upscaler lists).
- Audio Looper: **Send to Screensaver** transfers original tracks and loop settings (no intermediate lossy export); Screensaver encodes or stream-copies once into the video.
- Screensaver: durable background-audio asset store (`/api/screensaver/audio*`) with upload progress and FLAC support.
- Source-Quality-First audio processing: stream copy when compatible, source-aware bitrates when re-encoding, and export labels for Original Stream Preserved / Lossless Processing / High-Quality Re-encoding.

### Fixed

- Audio Looper: stream-copy exports that slightly miss the target duration are trimmed or re-looped with packet copy first; lossy re-encode is only a last resort.
- Looper→Screensaver: plain MP3/AAC stream-copy is no longer forced through a WAV intermediate and AAC re-encode; compatible transfers keep `STREAM_COPY` with `lossyEncodeCount=0`.
- Screensaver: background audio re-encode now honors high bitrates (e.g. 320 kbps) instead of landing near ~220–290 kbps with FFmpeg’s native AAC encoder; Looper→Screensaver no longer applies volume/fades twice.
- Audio Looper: channel handling preserves Mono/Stereo correctly (mono-only projects stay mono; stereo playlists stay stereo with L/R separation); large uploads get channel labels via ffprobe when the waveform decode is skipped.

### Changed

- Screensaver: new projects default to background audio **100% volume** and **no fades** (was 70% / 2s–3s), so plain MP3/AAC can stream-copy into the export.
- Screensaver mux no longer hardcodes AAC 192 kbps; plain AAC/MP3 background audio can stream-copy into MP4.
- Audio Looper avoids unnecessary re-encoding (conditional filters; MP3 playlist stream copy when codecs/rates/channels match).
- Screensaver background audio limit raised to **1 GiB** (centralized in `shared/screensaverAudio.ts`); export prefers `audioAssetId` over multipart re-upload.
- Screensaver missing-audio warning only appears when availability is confirmed `missing` (not while uploading/validating or when a valid in-memory/server asset exists).
- Optimized CFR 4K60 size estimate aligned with measured ~3 Mbit/s photographic stills (≈5+ GB / 4 h class), not the old 1 fps still baseline.
- Audio Looper: **Shuffle** is an icon-only control in the tracks header (left of Delete all); **Restore order** removed.
- Renamed remaining internal `vvr` / `VVR_*` identifiers to `ribo` / `RIBO_*` (packages, IndexedDB, env keys, Cursor skills/rules). Existing browser data and `VVR_*` env values migrate once onto the new names.
- Windows launcher output renamed from `Video factory.exe` to **`Ribo Studio.exe`** (`npm run build:launcher`).

### Removed

- Hostinger upload/deploy tooling (`hostinger-ribo-deploy` skill/rule, `npm run pack:hostinger`, `scripts/make-deploy-archive.mjs`, `archiver`).

## [1.0.0] — 2026-11-13

First official stable release of **Ribo Studio** (repository [ibrahimbilal/ribo-studio](https://github.com/ibrahimbilal/ribo-studio)).

This rebaseline establishes SemVer **1.0.0** as the product baseline. It is a branding and release-process milestone, not a rewrite of the application or its development history. Git commits, branches, and any existing tags remain unchanged. At 1.0.0, compatibility-sensitive identifiers still used the legacy `vvr` prefix (`vvr-app`, IndexedDB `vvr`, `vvr-app.zip`, `VVR_*`); those were renamed afterward (see Unreleased).

### Changed

- Product display name: **Video's Factory** → **Ribo Studio** (UI shell, docs, and repository identity).
- Official SemVer baseline set to **1.0.0**. Earlier `package.json` values such as `3.0.0` were arbitrary development metadata only — no matching Git release tag or GitHub Release existed for them.
- Version & release management: Keep a Changelog, `scripts/release.mjs` (`npm run release:*`), sidebar version label via Vite `__APP_VERSION__`, and the `release-manager` skill.
- AI context docs under `docs/ai/`; deep project map split into `.cursor/skills/ribo-project/` topic files.

### Included applications (verified at baseline)

| App | Route | What ships in 1.0.0 |
| --- | --- | --- |
| Dashboard | `/` | Multi-app shell entry; cards from nav items |
| Shorts — Ranking | `/shorts` | Vertical 9:16 ranking compilations (clips, titles, transitions, audio); FFmpeg export |
| Shorts — Image Motion | `/shorts` | Stills → pan motion, transitions, optional music; FFmpeg export |
| Screensaver | `/screensaver` | Long-form 16:9 ambient from image or looping clip; frames/adjustments; Fast VFR or Optimized CFR; multi-project IndexedDB |
| Thumbnail Studio | `/thumbnails` | Browser-only 16:9 YouTube thumbnails with resolution/duration badges; PNG/JPEG; no FFmpeg |
| Image Upscaler | `/upscale` | Exact Full HD / 2K / 4K / 8K; Lanczos3 standard; optional local Real-ESRGAN AI Lite |
| Audio Looper | `/looper` | Exact-length ambient beds from one or more tracks; Simple loop or Seamless crossfade; MP3/WAV/FLAC |

### Platform capabilities included

- Local-only workspace: Vue client + Express/FFmpeg server; no accounts or cloud project storage.
- Shared export job queue, notifications, cancel/download, and reload recovery for active renders.
- Cross-app transfers where implemented (e.g. Screensaver → Thumbnail / Image Motion).

### Legacy metadata (not official releases)

Root `package.json` previously listed **3.0.0** during development. That number was never published as an annotated Git tag (`v3.0.0`) or GitHub Release. It must not be treated as a prior official Ribo Studio release.

Full pre-baseline engineering notes remain in `docs/ai/CHANGELOG.md` and the Git commit history.
