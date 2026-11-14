import { sha256Hex } from '@shared/subscribeAnimationCacheKey'
import { isAllowedYoutubeAvatarUrl, isYoutubeAvatarDataUrl } from '@shared/youtubeAvatar'

const hashCache = new Map<string, string>()

async function hashBlob(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  return sha256Hex(buffer)
}

export async function resolveSubscribeAvatarContentHash(
  avatarUrl: string | null | undefined,
): Promise<string | null> {
  const url = avatarUrl?.trim() || null
  if (!url) return null
  const cached = hashCache.get(url)
  if (cached) return cached

  try {
    let blob: Blob | null = null
    if (isYoutubeAvatarDataUrl(url)) {
      const response = await fetch(url)
      blob = await response.blob()
    } else if (isAllowedYoutubeAvatarUrl(url)) {
      const response = await fetch(`/api/youtube-channel-avatar?url=${encodeURIComponent(url)}`)
      if (!response.ok) return null
      blob = await response.blob()
    } else {
      return null
    }
    if (!blob || blob.size < 32) return null
    const hash = await hashBlob(blob)
    hashCache.set(url, hash)
    return hash
  } catch {
    return null
  }
}

export function rememberAvatarContentHash(avatarUrl: string, hash: string): void {
  hashCache.set(avatarUrl.trim(), hash)
}
