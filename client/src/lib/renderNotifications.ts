import { AudioLines, ImagePlay, ListVideo, MonitorPlay } from '@lucide/vue'
import type { Component } from 'vue'
import type { AppLanguage } from '@shared/globalSettings'
import { translate, type MessageKey } from '../i18n'
import { useGlobalSettingsStore } from '../stores/globalSettings'
import { usePlatformStore } from '../stores/platform'

export type RenderAppId = 'ranking' | 'screensaver' | 'audio-looper' | 'image-motion'

const RENDER_APP_LABEL_KEYS: Record<RenderAppId, MessageKey> = {
  ranking: 'nav.shorts',
  screensaver: 'nav.screensaver',
  'audio-looper': 'nav.looper',
  'image-motion': 'settingsExtra.renderAppImageMotion',
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

function renderLanguage(): AppLanguage {
  try {
    return useGlobalSettingsStore().general.language
  } catch {
    return 'en'
  }
}

export function renderAppLabel(app: RenderAppId, language: AppLanguage = renderLanguage()): string {
  return translate(language, RENDER_APP_LABEL_KEYS[app])
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
  const language = renderLanguage()
  const name = projectName.trim() || translate(language, 'common.untitledProject')
  const route = RENDER_APP_ROUTES[app]
  const prefs = notificationPrefs()

  maybeDesktopNotify(
    translate(language, 'settingsExtra.exportReadyTitle', { app: renderAppLabel(app, language) }),
    name,
  )

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
  const language = renderLanguage()
  const prefs = notificationPrefs()
  const untitled = translate(language, 'common.untitledProject')
  maybeDesktopNotify(
    outcome === 'failed'
      ? translate(language, 'settingsExtra.screensaverExportFailed')
      : translate(language, 'settingsExtra.screensaverExportCancelled'),
    projectName.trim() || untitled,
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