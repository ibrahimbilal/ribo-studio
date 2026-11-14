import {
  isYoutubeChannelId,
  youtubeChannelIdFromHtml,
  youtubeChannelIdFromUrl,
} from './youtubeChannelId'

export { isYoutubeChannelId, sanitizeYoutubeChannelId, youtubeChannelIdFromHtml, youtubeChannelIdFromUrl } from './youtubeChannelId'

/** Parse a YouTube channel page URL (not a video watch link). */

export function parseYoutubeChannelPageUrl(
  input: string,
): { ok: true; normalizedUrl: string; channelId: string | null } | { ok: false; error: string } {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Paste a YouTube channel link first.' }
  if (trimmed.length > 600) return { ok: false, error: 'That link is too long.' }

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
