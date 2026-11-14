/** Canonical YouTube channel IDs look like `UCxxxxxxxxxxxxxxxxxxxxxx` (24 chars after UC is common). */

const CHANNEL_ID_RE = /^UC[\w-]{20,24}$/

export function isYoutubeChannelId(value: unknown): value is string {
  return typeof value === 'string' && CHANNEL_ID_RE.test(value)
}

/** Extract a channel ID from a `/channel/UC…` URL path when present. */
export function youtubeChannelIdFromUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  try {
    const url = new URL(raw.trim())
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')
    if (host !== 'youtube.com') return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] === 'channel' && isYoutubeChannelId(parts[1])) return parts[1]
    return null
  } catch {
    return null
  }
}

/** Parse `"channelId":"UC…"` (and similar) from YouTube channel page HTML. */
export function youtubeChannelIdFromHtml(html: string): string | null {
  if (!html) return null
  const patterns = [
    /"channelId"\s*:\s*"(UC[\w-]{20,24})"/,
    /"externalId"\s*:\s*"(UC[\w-]{20,24})"/,
    /\/channel\/(UC[\w-]{20,24})/,
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1] && isYoutubeChannelId(match[1])) return match[1]
  }
  return null
}

export function sanitizeYoutubeChannelId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return isYoutubeChannelId(trimmed) ? trimmed : null
}
