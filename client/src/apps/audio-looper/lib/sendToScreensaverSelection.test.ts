import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  deselectAllProjectIds,
  isIdentityTrackOrder,
  playlistOrdersForProjects,
  selectAllCheckboxState,
  selectAllProjectIds,
  sendButtonLabel,
  toggleProjectSelection,
  transferNotificationMessage,
} from './sendToScreensaverSelection'

describe('sendToScreensaverSelection', () => {
  it('toggles one project in and out of the selection', () => {
    assert.deepEqual(toggleProjectSelection([], 'a'), ['a'])
    assert.deepEqual(toggleProjectSelection(['a'], 'b'), ['a', 'b'])
    assert.deepEqual(toggleProjectSelection(['a', 'b'], 'a'), ['b'])
  })

  it('supports select all and deselect all', () => {
    assert.deepEqual(selectAllProjectIds(['a', 'b', 'c']), ['a', 'b', 'c'])
    assert.deepEqual(deselectAllProjectIds(), [])
  })

  it('reports checked, unchecked, and indeterminate Select All states', () => {
    assert.equal(selectAllCheckboxState(0, 3), 'unchecked')
    assert.equal(selectAllCheckboxState(3, 3), 'checked')
    assert.equal(selectAllCheckboxState(1, 3), 'indeterminate')
    assert.equal(selectAllCheckboxState(0, 0), 'unchecked')
  })

  it('builds dynamic send button labels', () => {
    assert.equal(sendButtonLabel(0, false), 'Send')
    assert.equal(sendButtonLabel(1, false), 'Send to 1 project')
    assert.equal(sendButtonLabel(3, false), 'Send to 3 projects')
    assert.equal(sendButtonLabel(10, false), 'Send to 10 projects')
    assert.equal(sendButtonLabel(3, true), 'Sending…')
  })

  it('keeps a shared playlist order for every project', () => {
    assert.deepEqual(playlistOrdersForProjects(3, 4, 'shared'), [
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
      [0, 1, 2],
    ])
    assert.equal(isIdentityTrackOrder([0, 1, 2]), true)
    assert.equal(isIdentityTrackOrder([1, 0, 2]), false)
  })

  it('gives unique playlist orders a stable first order and shuffled later ones', () => {
    const orders = playlistOrdersForProjects(3, 3, 'unique')
    assert.equal(orders.length, 3)
    assert.deepEqual(orders[0], [0, 1, 2])
    for (const order of orders) {
      assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2])
    }
    assert.deepEqual(playlistOrdersForProjects(1, 3, 'unique'), [[0], [0], [0]])
    assert.deepEqual(playlistOrdersForProjects(4, 1, 'unique'), [[0, 1, 2, 3]])
  })

  it('summarizes full and partial transfer notifications', () => {
    assert.deepEqual(
      transferNotificationMessage({ ok: ['a', 'b', 'c', 'd', 'e'], failed: [], skipped: [] }),
      { text: 'Audio successfully sent to 5 Screensaver projects.', tone: 'success' },
    )
    assert.deepEqual(
      transferNotificationMessage({
        ok: ['a', 'b', 'c', 'd'],
        failed: [{ id: 'e', name: 'E', reason: 'missing' }],
        skipped: [],
      }),
      { text: 'Audio sent to 4 projects. 1 project could not be updated.', tone: 'info' },
    )
  })
})
