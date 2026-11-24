import { describe, expect, it } from 'vitest'
import { bulkRenameNames } from './bulkProjectNames'

describe('bulkRenameNames', () => {
  it('returns a single trimmed name for one project', () => {
    expect(bulkRenameNames('  Vacation  ', 1)).toEqual(['Vacation'])
  })

  it('adds counts for multiple projects', () => {
    expect(bulkRenameNames('Batch', 3)).toEqual(['Batch (1)', 'Batch (2)', 'Batch (3)'])
  })

  it('respects max length with suffix', () => {
    const long = 'x'.repeat(80)
    const names = bulkRenameNames(long, 2)
    expect(names[0]!.length).toBeLessThanOrEqual(80)
    expect(names[1]!.endsWith('(2)')).toBe(true)
  })
})