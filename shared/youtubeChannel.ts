import {
  isYoutubeChannelId,
  sanitizeYoutubeChannelId,
  youtubeChannelIdFromHtml,
  youtubeChannelIdFromUrl,
} from './youtubeChannelId'

export { isYoutubeChannelId, sanitizeYoutubeChannelId, youtubeChannelIdFromHtml, youtubeChannelIdFromUrl } from './youtubeChannelId'

/**
 * Normalize user input for channel registration: URL, UC… id, or @handle.
 * Does not fetch metadata — only validates / rewrites to a lookup URL.
 */
export function normalizeYoutubeChannelInput(
  input: string,
): { ok: true; normalizedUrl: string; channelId: string | null; handle: string | null } | { ok: false; error: string } {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Enter a YouTube channel URL, ID, or @handle.' }
  if (trimmed.length > 600) return { ok: false, error: 'That input is too long.' }

  const asId = sanitizeYoutubeChannelId(trimmed)
  if (asId) {
    return {
      ok: true,
      normalizedUrl: `https://www.youtube.com/channel/${asId}`,
      channelId: asId,
      handle: null,
    }
  }

  const handleMatch = trimmed.match(/^@([\w.-]{1,64})$/)
  if (handleMatch?.[1]) {
    return {
      ok: true,
      normalizedUrl: `https://www.youtube.com/@${handleMatch[1]}`,
      channelId: null,
      handle: handleMatch[1],
    }
  }

  const page = parseYoutubeChannelPageUrl(trimmed)
  if (!page.ok) {
    // Allow video URLs through the existing lookup endpoint as well.
    if (/youtu\.?be|youtube\.com/i.test(trimmed)) {
      let withProtocol = trimmed
      if (!/^https?:\/\//i.test(withProtocol)) withProtocol = `https://${withProtocol}`
      try {
        const url = new URL(withProtocol)
        return { ok: true, normalizedUrl: url.toString(), channelId: youtubeChannelIdFromUrl(url.toString()), handle: null }
      } catch {
        return page
      }
    }
    return page
  }

  let handle: string | null = null
  try {
    const parts = new URL(page.normalizedUrl).pathname.split('/').filter(Boolean)
    if (parts[0]?.startsWith('@')) handle = parts[0].slice(1)
  } catch {
    handle = null
  }
  return { ok: true, normalizedUrl: page.normalizedUrl, channelId: page.channelId, handle }
}

export function youtubeHandleFromUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
    if (host !== 'youtube.com') return null
    const parts = parsed.pathname.split('/').filter(Boolean)
    if (parts[0]?.startsWith('@') && parts[0].length > 1) return parts[0].slice(1, 65)
    return null
  } catch {
    return null
  }
}

/** Parse a YouTube channel page URL (not a video watch link). */

export function parseYoutubeChannelPageUrl(
  input: string,
): { ok: true; normalizedUrl: string; channelId: string | null } | { ok: false; error: string } {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Paste a YouTube channel link first.' }
  if (trimmed.length > 600) return { ok: false, error: 'That link is too long.' }

  const asId = sanitizeYoutubeChannelId(trimmed)
  if (asId) {
    return { ok: true, normalizedUrl: `https://www.youtube.com/channel/${asId}`, channelId: asId }
  }
  const handleOnly = trimmed.match(/^@([\w.-]{1,64})$/)
  if (handleOnly?.[1]) {
    return { ok: true, normalizedUrl: `https://www.youtube.com/@${handleOnly[1]}`, channelId: null }
  }

  let withProtocol = trimmed
  if (!/^https?:\/\//i.test(withProtocol)) {
    if (/^(www\.|m\.|youtube\.com|youtu\.be)/i.test(withProtocol)) {
      withProtocol = `https://${withProtocol}`
    } else {
      return { ok: false, error: 'Enter a full link, including https://.' }
    }
  }

  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    return { ok: false, error: 'That link is not a valid URL.' }
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '')
  if (host !== 'youtube.com') {
    return { ok: false, error: 'Use a YouTube channel link (@handle, /channel/…, or /c/…).' }
  }

  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0]?.startsWith('@') && parts.length === 1) {
    return { ok: true, normalizedUrl: `https://www.youtube.com/${parts[0]}`, channelId: null }
  }
  if (parts[0] === 'channel' && isYoutubeChannelId(parts[1])) {
    return {
      ok: true,
      normalizedUrl: `https://www.youtube.com/channel/${parts[1]}`,
      channelId: parts[1],
    }
  }
  if (parts[0] === 'c' && /^[\w.-]+$/.test(parts[1] ?? '')) {
    return { ok: true, normalizedUrl: `https://www.youtube.com/c/${parts[1]}`, channelId: null }
  }
  if (parts[0] === 'user' && /^[\w.-]+$/.test(parts[1] ?? '')) {
    return { ok: true, normalizedUrl: `https://www.youtube.com/user/${parts[1]}`, channelId: null }
  }

  return { ok: false, error: 'Use a YouTube channel link (@handle, /channel/…, or /c/…), or a video link.' }
}

/** Prefer an explicit UC id from the URL, then fall back to HTML extraction helpers. */
export function resolveYoutubeChannelId(options: {
  url?: string | null
  html?: string | null
}): string | null {
  const fromUrl = youtubeChannelIdFromUrl(options.url ?? null)
  if (fromUrl) return fromUrl
  if (options.html) return youtubeChannelIdFromHtml(options.html)
  return null
}
