/**
 * Detect Screensaver projects that reference a registered YouTube channel.
 * Removal from the registry must not rewrite project channel data.
 */

import * as idb from './idb'

export interface ChannelProjectRef {
  projectId: string
  projectName: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export async function findProjectsReferencingChannel(channelId: string): Promise<ChannelProjectRef[]> {
  const refs: ChannelProjectRef[] = []
  try {
    const entries = await idb.readScreensaverEntries()
    for (const entry of entries) {
      if (!entry.key.startsWith('project:')) continue
      if (!isRecord(entry.value)) continue
      const subscribe = entry.value.subscribeAnimation
      if (!isRecord(subscribe)) continue
      if (subscribe.channelId !== channelId) continue
      const id = typeof entry.value.id === 'string' ? entry.value.id : entry.key.slice('project:'.length)
      const name = typeof entry.value.name === 'string' ? entry.value.name : 'Untitled'
      refs.push({ projectId: id, projectName: name })
    }
  } catch {
    // IndexedDB may be unavailable.
  }
  return refs
}
