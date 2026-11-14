/**
 * Measure Source-Quality-First audio export metrics (wall time, size, bitrate, encode count).
 * Reports only measured values — run via `npm run bench:audio-processing`.
 */
import { execFile } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { defaultAudioLooperSettings } from '../../shared/audioLooper'
import { ffmpegBinary } from '../src/binaries'
import { probeAudioDetails } from '../src/probe'
import { renderAudioLooper } from '../src/renderAudioLooper'
import { ensureStorage, jobsDir, outputsDir } from '../src/storage'

const execFileAsync = promisify(execFile)

async function synthMp3(file: string, seconds: number, kbps: number): Promise<void> {
  await execFileAsync(ffmpegBinary(), [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:sample_rate=44100:duration=${seconds}`,
    '-ac',
    '2',
    '-c:a',
    'libmp3lame',
    '-b:a',
    `${kbps}k`,
    file,
  ])
}

async function main(): Promise<void> {
  await ensureStorage()
  const work = path.join(outputsDir, '..', 'bench-audio-processing')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const mp3 = path.join(work, 'src-320.mp3')
  await synthMp3(mp3, 3, 320)
  const info = await probeAudioDetails(mp3)

  const cases = [
    { id: 'stream-copy-loop', format: 'mp3' as const, volume: 100, fades: 0 },
    { id: 'reencode-volume', format: 'mp3' as const, volume: 80, fades: 0 },
  ]

  const rows: string[] = [
    '# Audio processing bench (measured)',
    '',
    '| Case | Wall ms | Bytes | Bitrate bps | Strategy | lossyEncodeCount | Channels | Duration err s |',
    '| --- | ---: | ---: | ---: | --- | ---: | ---: | ---: |',
  ]

  for (const item of cases) {
    const id = `bench-${item.id}`
    const started = Date.now()
    const result = await renderAudioLooper(
      {
        id,
        sourcePath: mp3,
        sourceDuration: info.duration,
        sourceSampleRate: info.sampleRate,
        sourceChannels: info.channels,
        sourceCodec: info.codec,
        sourceBitrate: info.bitrate,
        settings: {
          ...defaultAudioLooperSettings(),
          targetDurationSeconds: 12,
          format: item.format,
          mp3Bitrate: 192,
          volumePercent: item.volume,
          fadeInSeconds: item.fades,
          fadeOutSeconds: item.fades,
          filename: item.id,
        },
      },
      {
        cancelled: () => false,
        onProgress: () => undefined,
        onStatus: () => undefined,
        registerKill: () => undefined,
      },
    )
    const wall = Date.now() - started
    const out = await probeAudioDetails(result.outputPath)
    const bytes = (await stat(result.outputPath)).size
    rows.push(
      `| ${item.id} | ${wall} | ${bytes} | ${out.bitrate || 0} | ${result.processingStrategy} | ${result.lossyEncodeCount} | ${out.channels} | ${(out.duration - 12).toFixed(3)} |`,
    )
    await rm(result.outputPath, { force: true }).catch(() => undefined)
    await rm(path.join(jobsDir, id), { recursive: true, force: true }).catch(() => undefined)
  }

  const report = `${rows.join('\n')}\n`
  const outPath = path.join(work, 'bench-report.md')
  await writeFile(outPath, report, 'utf8')
  console.log(report)
  console.log(`Wrote ${outPath}`)
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
