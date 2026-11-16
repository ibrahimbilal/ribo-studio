import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clientQueuePosition,
  evaluateExportCandidate,
  exportAllNotificationMessage,
  planExportAll,
  uniqueDownloadFilenames,
  type ExportAllCandidate,
} from './exportAllPlan'

function candidate(partial: Partial<ExportAllCandidate> & { id: string; name: string }): ExportAllCandidate {
  return {
    mediaKind: 'image',
    serverId: 'media-1',
    sourceMissing: false,
    uploadReady: true,
    renderStatus: 'draft',
    mode: 'static',
    renderingMode: 'optimized-cfr',
    durationSeconds: 3600,
    audioMode: 'none',
    audioAvailable: false,
    audioBusy: false,
    frameMissing: false,
    subscribeAnimation: { enabled: false } as ExportAllCandidate['subscribeAnimation'],
    duplicateExport: false,
    alreadyQueuedInClient: false,
    ...partial,
  }
}

describe('exportAllPlan', () => {
  it('marks an empty list as having no eligible projects', () => {
    const plan = planExportAll([])
    assert.equal(plan.eligible.length, 0)
    assert.equal(plan.skipped.length, 0)
  })

  it('accepts a valid idle project', () => {
    const decision = evaluateExportCandidate(candidate({ id: 'a', name: 'A' }))
    assert.equal(decision.kind, 'eligible')
  })

  it('skips projects that are already exporting or queued', () => {
    assert.equal(
      evaluateExportCandidate(candidate({ id: 'a', name: 'A', renderStatus: 'rendering' })).kind,
      'skipped',
    )
    assert.equal(
      evaluateExportCandidate(candidate({ id: 'b', name: 'B', alreadyQueuedInClient: true })).kind,
      'skipped',
    )
  })

  it('skips invalid and incomplete projects', () => {
    assert.equal(
      evaluateExportCandidate(candidate({ id: 'a', name: 'A', mediaKind: null })).kind,
      'skipped',
    )
    assert.equal(
      evaluateExportCandidate(candidate({ id: 'b', name: 'B', sourceMissing: true })).kind,
      'skipped',
    )
    assert.equal(
      evaluateExportCandidate(candidate({ id: 'c', name: 'C', serverId: null })).kind,
      'skipped',
    )
    assert.equal(
      evaluateExportCandidate(
        candidate({ id: 'd', name: 'D', audioMode: 'upload', audioAvailable: false }),
      ).kind,
      'skipped',
    )
    assert.equal(
      evaluateExportCandidate(candidate({ id: 'e', name: 'E', duplicateExport: true })).kind,
      'skipped',
    )
  })

  it('plans a batch with an idle queue and respects capacity', () => {
    const plan = planExportAll(
      [
        candidate({ id: 'a', name: 'A' }),
        candidate({ id: 'b', name: 'B', renderStatus: 'queued' }),
        candidate({ id: 'c', name: 'C' }),
      ],
      { remainingQueueSlots: 2 },
    )
    assert.deepEqual(
      plan.eligible.map((item) => item.id),
      ['a', 'c'],
    )
    assert.equal(plan.skipped[0]?.reason, 'already-exporting')
  })

  it('marks later projects queue-full when slots are exhausted', () => {
    const plan = planExportAll(
      [candidate({ id: 'a', name: 'A' }), candidate({ id: 'b', name: 'B' }), candidate({ id: 'c', name: 'C' })],
      { remainingQueueSlots: 1 },
    )
    assert.equal(plan.eligible.length, 1)
    assert.equal(plan.skipped.filter((item) => item.reason === 'queue-full').length, 2)
  })

  it('prefers shorter projects when queue capacity is limited', () => {
    const plan = planExportAll(
      [
        candidate({ id: 'long', name: 'Long', durationSeconds: 4 * 3600 }),
        candidate({ id: 'short', name: 'Short', durationSeconds: 30 * 60 }),
        candidate({ id: 'mid', name: 'Mid', durationSeconds: 2 * 3600 }),
      ],
      { remainingQueueSlots: 1 },
    )
    assert.deepEqual(
      plan.eligible.map((item) => item.id),
      ['short'],
    )
    assert.equal(plan.skipped.filter((item) => item.reason === 'queue-full').length, 2)
  })

  it('prevents download filename collisions within a batch', () => {
    assert.deepEqual(uniqueDownloadFilenames(['Sunset', 'Sunset', 'Night']), [
      'Sunset.mp4',
      'Sunset (2).mp4',
      'Night.mp4',
    ])
  })

  it('orders eligible projects from shortest to longest duration', () => {
    const plan = planExportAll([
      candidate({ id: 'c', name: 'C', durationSeconds: 4 * 3600 }),
      candidate({ id: 'a', name: 'A', durationSeconds: 30 * 60 }),
      candidate({ id: 'b', name: 'B', durationSeconds: 2 * 3600 }),
      candidate({ id: 'a2', name: 'A2', durationSeconds: 30 * 60 }),
    ])
    assert.deepEqual(
      plan.eligible.map((item) => item.id),
      ['a', 'a2', 'b', 'c'],
    )
  })

  it('summarizes export-all notifications', () => {
    assert.deepEqual(exportAllNotificationMessage({ submitted: 6, started: 0, queued: 6, skipped: 0 }), {
      text: '6 projects added to the queue.',
      tone: 'success',
    })
    assert.deepEqual(exportAllNotificationMessage({ submitted: 6, started: 1, queued: 5, skipped: 0 }), {
      text: '1 project started rendering. 5 projects added to the queue.',
      tone: 'success',
    })
    assert.deepEqual(exportAllNotificationMessage({ submitted: 4, started: 0, queued: 4, skipped: 2 }), {
      text: '4 projects queued. 2 skipped because they are already exporting or invalid.',
      tone: 'info',
    })
  })

  it('computes client queue positions for waiting jobs', () => {
    const jobs = [
      { projectId: 'a', phase: 'rendering' },
      { projectId: 'b', phase: 'idle' },
      { projectId: 'c', phase: 'queued' },
      { projectId: 'd', phase: 'idle' },
    ]
    assert.equal(clientQueuePosition('a', jobs), null)
    assert.equal(clientQueuePosition('b', jobs), 1)
    assert.equal(clientQueuePosition('c', jobs), 2)
    assert.equal(clientQueuePosition('d', jobs), 3)
  })
})
