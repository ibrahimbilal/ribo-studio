/** Helpers for shared Screensaver audio-asset references across projects. */

export type AudioAssetRefProject = {
  id: string
  audioAssetId?: string | null
  audioMode?: string | null
}

/** Count how many projects still point at this server audio asset. */
export function countProjectsReferencingAudioAsset(
  projects: readonly AudioAssetRefProject[],
  assetId: string | null | undefined,
  options: { exceptProjectId?: string | null } = {},
): number {
  if (!assetId) return 0
  let count = 0
  for (const project of projects) {
    if (options.exceptProjectId && project.id === options.exceptProjectId) continue
    if (project.audioAssetId === assetId) count += 1
  }
  return count
}

/** True when it is safe to delete the server asset (no other project still references it). */
export function canDeleteAudioAsset(
  projects: readonly AudioAssetRefProject[],
  assetId: string | null | undefined,
  options: { exceptProjectId?: string | null } = {},
): boolean {
  if (!assetId) return false
  return countProjectsReferencingAudioAsset(projects, assetId, options) === 0
}

export function projectHasBackgroundAudio(project: {
  audioMode?: string | null
  audioFileName?: string | null
  audioAssetId?: string | null
}): boolean {
  return (
    project.audioMode === 'upload' ||
    Boolean(project.audioFileName) ||
    Boolean(project.audioAssetId)
  )
}

export type AssignAudioAssetResult = {
  ok: string[]
  failed: { id: string; name: string; reason: string }[]
  skipped: { id: string; name: string; reason: string }[]
}
