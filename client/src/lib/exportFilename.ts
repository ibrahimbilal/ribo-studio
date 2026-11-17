import {
  DEFAULT_FILENAME_PATTERN,
  applyOverwriteProtection,
  expandFilenamePattern,
  type FilenamePatternContext,
} from '@shared/globalSettings'
import { useGlobalSettingsStore } from '../stores/globalSettings'

const usedNames = new Set<string>()

export function buildExportDownloadName(
  ctx: FilenamePatternContext,
  explicitName?: string | null,
): string {
  if (explicitName && explicitName.trim()) {
    const cleaned = expandFilenamePattern(`{projectName}.{extension}`, {
      ...ctx,
      projectName: explicitName.replace(/\.[^.]+$/, ''),
      extension: ctx.extension,
    })
    return maybeProtect(cleaned)
  }
  let pattern = DEFAULT_FILENAME_PATTERN
  try {
    pattern = useGlobalSettingsStore().exportPrefs.filenamePattern || DEFAULT_FILENAME_PATTERN
  } catch {
    // Pinia may be unavailable in isolated tests.
  }
  return maybeProtect(expandFilenamePattern(pattern, ctx))
}

function maybeProtect(filename: string): string {
  let prevent = true
  try {
    prevent = useGlobalSettingsStore().exportPrefs.preventOverwrite
  } catch {
    prevent = true
  }
  const next = prevent ? applyOverwriteProtection(filename, usedNames) : filename
  usedNames.add(next.toLowerCase())
  return next
}

export function rememberExportDownloadName(filename: string): void {
  usedNames.add(filename.toLowerCase())
}
