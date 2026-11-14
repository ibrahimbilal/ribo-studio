# Audio Looper (deep)

Editor state is `useAudioLooperStore` (`client/src/apps/audio-looper/stores/audioLooper.ts`). Ranking and screensaver stores stay independent. Desktop layout matches the other editors: source column `320px` (project name and drop zone stay fixed; icon-only **Shuffle** and ghost-red **Delete all** sit above the scrolling track list), preview in the center with the export bar under it, settings column `360px` titled Settings (Duration, Loop, Output). Settings persist in `localStorage` key `vf-audio-looper-settings` (duration, mode, fades, volume, format, name, playlist crossfade, loudness). Uploaded files stay in memory for the session. There is no playlist library.

One interface covers every upload count. No files: the source column shows the drop zone, and the player, track list, loop plan, and loop controls stay hidden. One file: the existing custom player, trim, Simple (`-stream_loop`) or Seamless (equal-power cycle), fades, and volume. Two or more files (max 30, 100 MB each): reorder (same lifted-card drag as Shorts), per-track trim, shuffle from the source column, optional crossfade, and optional loudness. Crossfade and Match loudness use `ToggleSwitch`. Dropping back to one file restores Simple/Seamless and keeps duration, format, fades, and volume.

Import: MP3, WAV, FLAC, M4A, AAC, OGG, max 100 MB, confirmed with ffprobe. Target 60–43200 integer seconds (Screensaver presets 30m–12h, default 4h, or custom minutes).

**Source-Quality-First** (`shared/audioProcessingPlan.ts`, `server/src/audioProcessing.ts`, `renderAudioLooper.ts`):

- Prefer `STREAM_COPY` (`-c:a copy`) for Simple loop / compatible playlist concat when volume≈100%, no fades, no crossfade/loudnorm, matching codec/rate/channels, and destination accepts the codec.
- Different MP3 bitrates do **not** force re-encode for stream copy.
- Transforms (Seamless, crossfade, loudness, volume, fades, trim, channel/rate normalize) use lossless PCM intermediates then **at most one** final lossy encode.
- MP3 re-encode target = `max(user mp3Bitrate, snap(max source bitrate))`; unknown → max(user, 320).
- Playlist sample rate: preserve shared rate; mixed rates → highest source rate (not always 48 kHz).
- Job fields: `processingStrategy`, `processingLabel`, `lossyEncodeCount`.

**Channels** (`shared/audioLooperChannels.ts`): all mono → mono; all stereo or mixed mono+stereo → stereo (mono upmixed); matching multi-channel (>2) preserved for WAV/FLAC, downmixed to stereo for MP3 or mixed layouts. Export verification probes the finished file and fails if the channel count does not match. Client track labels use Web Audio channel counts when the waveform decodes; otherwise `POST /api/audio-looper/probe` (ffprobe). Never infer channels from the file extension.

Playlist timing lives in `shared/audioLooperPlaylist.ts`. Crossfade is off by default. When on, the default is 3s and the maximum is half the shorter side of every join, including last → first. Loudness matching is optional two-pass `loudnorm`.

Verify slack: `max(0.25s, min(1.5s, 1% of target))` (prefer stream duration over container padding). Stream-copy duration misses use packet-preserving recovery first (`STREAM_COPY_TRIM` on overshoot; corrected loop / expanded playlist concat on undershoot; max 3 attempts) and only then fall back to one high-quality re-encode from the original sources (`audioDurationRecovery.ts`).

**Send to Screensaver:** Available when tracks are loaded (not only after export). Uploads sources + settings via `POST /api/screensaver/audio/from-looper-plan` (recipe asset `origin: 'looper-plan'`). The modal uses a multi-select checkbox list (Select all with indeterminate state); one durable `audioAssetId` is attached to every selected Screensaver project — no per-project file copies and no re-encode. Projects that are rendering/queued are skipped so active job snapshots stay intact. Shared asset deletes only run when no remaining project references the id (and server retain counts still block in-flight renders). Finished-export `from-job` remains as a secondary adopt path. Screensaver mux (`screensaverAudioMux.ts`) honors the planner end-to-end: `STREAM_COPY` uses original packets (or packet-preserving playlist concat) with **no WAV intermediate** and `lossyEncodeCount=0`; volume/fades alone go **source→AAC once** at mux; complex Looper graphs (seamless / crossfade / loudnorm / trim) may build **one loop-period WAV**, then one AAC encode. Diagnostics: `streamCopy`, `decodeRequired`, `losslessEncodeCount`, `lossyEncodeCount`, plus separate `originalSourceBitrate` / `currentStreamBitrate` / `actualOutputBitrate`.
