import { AudioLines, ImagePlay, ListVideo, MonitorPlay } from '@lucide/vue'
import type { Component } from 'vue'
import { useGlobalSettingsStore } from '../stores/globalSettings'
import { usePlatformStore } from '../stores/platform'

export type RenderAppId = 'ranking' | 'screensaver' | 'audio-looper' | 'image-motion'

const APP_LABELS: Record<RenderAppId, string> = {
  ranking: 'Shorts',
  screensaver: 'Screensaver',
  'audio-looper': 'Audio Looper',
  'image-motion': 'Image Motion Shorts',
}

export const RENDER_APP_ROUTES: Record<RenderAppId, string> = {
  ranking: '/shorts',
  screensaver: '/screensaver',
  'audio-looper': '/looper',
  'image-motion': '/shorts',
}

const APP_ICONS: Record<RenderAppId, Component> = {
  ranking: ListVideo,
  screensaver: MonitorPlay,
  'audio-looper': AudioLines,
  'image-motion': ImagePlay,
}

export function renderAppLabel(app: RenderAppId): string {
  return APP_LABELS[app]
}

export function renderAppIcon(app: RenderAppId): Component {
  return APP_ICONS[app]
}

function notificationPrefs() {
  try {
    const settings = useGlobalSettingsStore()
    return {
      inApp: settings.general.exportCompletionNotifications && settings.exportPrefs.notifyOnComplete,
      desktop: settings.general.desktopNotifications && settings.exportPrefs.notifyOnComplete,
    }
  } catch {
    return { inApp: true, desktop: false }
  }
}

function maybeDesktopNotify(title: string, body: string): void {
  const prefs = notificationPrefs()
  if (!prefs.desktop) return
  if (typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(title, { body })
  } catch {
    // Ignore Notification constructor failures.
  }
}

export function notifyRenderReady(
  app: RenderAppId,
  projectName: string,
  downloadUrl: string,
  filename: string,
  trackId?: string,
  projectId?: string | null,
): void {
  const platform = usePlatformStore()
  const name = projectName.trim() || 'Untitled project'
  const route = RENDER_APP_ROUTES[app]
  const prefs = notificationPrefs()

  maybeDesktopNotify(`${APP_LABELS[app]} export ready`, name)

  if (!prefs.inApp) {
    if (trackId) platform.removeActiveRenderJob(trackId)
    return
  }

  if (trackId && platform.promoteActiveRenderJobToReady(trackId, { downloadUrl, filename })) {
    return
  }

  platform.addRenderReadyNotification({
    app,
    projectName: name,
    route,
    downloadUrl,
    filename,
    projectId,
  })
}

/** Failed and cancelled Screensaver renders stay in the panel so Open can restore that project. */
export function notifyRenderOutcome(
  app: RenderAppId,
  projectName: string,
  outcome: 'failed' | 'cancelled',
  trackId: string,
  projectId?: string | null,
  error?: string | null,
): void {
  if (app !== 'screensaver' || !projectId) return
  const platform = usePlatformStore()
  const prefs = notificationPrefs()
  maybeDesktopNotify(
    outcome === 'failed' ? 'Screensaver export failed' : 'Screensaver export cancelled',
    projectName.trim() || 'Untitled project',
  )
  if (!prefs.inApp) {
    platform.removeActiveRenderJob(trackId)
    return
  }
  platform.addRenderOutcomeNotification({
    id: trackId,
    app,
    projectName,
    route: RENDER_APP_ROUTES[app],
    projectId,
    outcome,
    error,
  })
}
