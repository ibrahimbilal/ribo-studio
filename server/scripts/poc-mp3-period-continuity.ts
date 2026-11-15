/** Quick Path C: MP3 period + stream_loop copy continuity check. */
import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { ffmpegBinary } from '../src/binaries'
import {
  compareDecodedJoinContinuity,
  encodeStandardFullTimeline,
  streamCopyLoopPeriod,
} from '../src/encodeOnceLoopCopy'
import { ffmpegAudioPrefix } from '../src/audioProcessing'
import { spawnFfmpeg } from '../src/ffmpegUtil'
import { probeAudioDetails } from '../src/probe'
import { ensureStorage, outputsDir } from '../src/storage'

const execFileAsync = promisify(execFile)

async function synth(file: string, seconds: number, sampleRate: number, freq: number): Promise<void> {
  await execFileAsync(
    ffmpegBinary(),
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${freq}:sample_rate=${sampleRate}:duration=${seconds}`,
      '-ac',
      '2',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '256k',
      file,
    ],
    { windowsHide: true },
  )
}

async function main(): Promise<void> {
  await ensureStorage()
  const work = path.join(outputsDir, '..', 'poc-mp3-period')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const a = path.join(work, 'a.mp3')
  const b = path.join(work, 'b.mp3')
  await synth(a, 8, 44100, 440)
  await synth(b, 7.5, 48000, 554)
  const pa = await probeAudioDetails(a)
  const pb = await probeAudioDetails(b)
  const sources = [
    { path: a, sampleRate: pa.sampleRate, channels: pa.channels, duration: pa.duration },
    { path: b, sampleRate: pb.sampleRate, channels: pb.channels, duration: pb.duration },
  ]
  const period = pa.duration + pb.duration
  const target = 120
  const hooks = {
    cancelled: () => false,
    onProgress: () => undefined,
    registerKill: () => undefined,
  }
  const stdOut = path.join(work, 'std.m4a')
  await encodeStandardFullTimeline({
    sources,
    sampleRate: 48000,
    channels: 2,
    bitrateKbps: 256,
    targetSeconds: target,
    workDir: path.join(work, 'A'),
    outputPath: stdOut,
    hooks,
  })
  const filter = path.join(work, 'f.txt')
  await writeFile(
    filter,
    [
      `[0:a]atrim=0:${pa.duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a0]`,
      `[1:a]atrim=0:${pb.duration},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a1]`,
      '[a0][a1]concat=n=2:v=0:a=1[aout]',
    ].join(';\n'),
  )
  const periodMp3 = path.join(work, 'period.mp3')
  await spawnFfmpeg(
    [
      ...ffmpegAudioPrefix(),
      '-i',
      a,
      '-i',
      b,
      '-filter_complex_script',
      filter,
      '-map',
      '[aout]',
      '-c:a',
      'libmp3lame',
      '-b:a',
      '256k',
      '-ar',
      '48000',
      '-ac',
      '2',
      '-t',
      String(period + 0.02),
      periodMp3,
    ],
    period,
    hooks,
  )
  const loopOut = path.join(work, 'loop.mp3')
  await streamCopyLoopPeriod({
    periodPath: periodMp3,
    outputPath: loopOut,
    targetSeconds: target,
    hooks,
  })
  const periodMeta = await probeAudioDetails(periodMp3)
  const continuity = await compareDecodedJoinContinuity({
    encodeOncePath: loopOut,
    continuousPath: stdOut,
    periodSeconds: periodMeta.duration,
    sampleRate: 48000,
    workDir: path.join(work, 'cmp'),
  })
  console.log(
    JSON.stringify(
      {
        periodNatural: period,
        periodEncoded: periodMeta.duration,
        startTime: periodMeta.startTime,
        continuityOk: continuity.ok,
        reasons: continuity.reasons,
        joinRms: continuity.rmsDiff,
        baselineRms: continuity.baselineRmsDiff,
        ratio: continuity.joinVsBaselineRatio,
      },
      null,
      2,
    ),
  )
  process.exitCode = continuity.ok ? 0 : 2
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
