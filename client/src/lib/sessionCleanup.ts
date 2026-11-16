import { clearSessionEditorProjects } from './idb'
import { ensureServerUploadCleanupOnClose } from './serverUploadCleanup'

let bootCleanupStarted = false

/** Clears Screensaver/Thumbnail IndexedDB leftovers from a previous visit, then installs tab-close server purge. */
export async function prepareSessionCleanup(): Promise<void> {
  if (bootCleanupStarted) return
  bootCleanupStarted = true
  try {
    await clearSessionEditorProjects()
  } catch {
    // Ignore storage failures; editors still start empty in memory.
  }
  ensureServerUploadCleanupOnClose()
}
