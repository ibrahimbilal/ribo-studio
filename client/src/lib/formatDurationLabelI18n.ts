import type { MessageKey, MessageParams } from '../i18n'

type Translate = (key: MessageKey, params?: MessageParams) => string

/** Localized duration label for UI (mirrors shared `formatDurationLabel` wording). */
export function formatDurationLabelI18n(seconds: number, t: Translate): string {
  const whole = Math.max(0, Math.round(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = whole % 60
  if (h > 0 && m > 0) return t('common.duration.hoursMinutes', { h, m })
  if (h > 0) return t(h === 1 ? 'common.duration.hourOne' : 'common.duration.hourMany', { h })
  if (m > 0 && s > 0) return t('common.duration.minutesSeconds', { m, s })
  if (m > 0) return t(m === 1 ? 'common.duration.minuteOne' : 'common.duration.minuteMany', { m })
  return t(s === 1 ? 'common.duration.secondOne' : 'common.duration.secondMany', { s })
}
