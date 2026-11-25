const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n += 1) {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

export type StoredZipEntry = {
  name: string
  data: Uint8Array
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i += 1) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (~crc) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const year = Math.max(1980, date.getFullYear())
  const day = (year - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

function u16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true)
}

function u32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true)
}

/** Stored (uncompressed) ZIP for already-compressed assets (PNG, JPEG, WebP, MP4). */
export function buildStoredZipBlob(entries: StoredZipEntry[]): Blob {
  if (!entries.length) throw new Error('ZIP needs at least one entry.')
  const chunks: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  const now = new Date()
  const { time, date } = dosDateTime(now)

  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    if (name.length > 60000) throw new Error('A ZIP entry name is too long.')
    const crc = crc32(entry.data)
    const size = entry.data.length

    const local = new Uint8Array(30 + name.length)
    const localView = new DataView(local.buffer, local.byteOffset, local.byteLength)
    u32(localView, 0, 0x04034b50)
    u16(localView, 4, 20)
    u16(localView, 6, 0x0800)
    u16(localView, 8, 0)
    u16(localView, 10, time)
    u16(localView, 12, date)
    u32(localView, 14, crc)
    u32(localView, 18, size)
    u32(localView, 22, size)
    u16(localView, 26, name.length)
    u16(localView, 28, 0)
    local.set(name, 30)
    chunks.push(local, entry.data)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer, central.byteOffset, central.byteLength)
    u32(centralView, 0, 0x02014b50)
    u16(centralView, 4, 20)
    u16(centralView, 6, 20)
    u16(centralView, 8, 0x0800)
    u16(centralView, 10, 0)
    u16(centralView, 12, time)
    u16(centralView, 14, date)
    u32(centralView, 16, crc)
    u32(centralView, 20, size)
    u32(centralView, 24, size)
    u16(centralView, 28, name.length)
    u16(centralView, 30, 0)
    u16(centralView, 32, 0)
    u16(centralView, 34, 0)
    u16(centralView, 36, 0)
    u32(centralView, 38, 0)
    u32(centralView, 42, offset)
    central.set(name, 46)
    centrals.push(central)

    offset += local.length + size
  }

  const centralOffset = offset
  let centralSize = 0
  for (const part of centrals) {
    chunks.push(part)
    centralSize += part.length
  }

  const eocd = new Uint8Array(22)
  const eocdView = new DataView(eocd.buffer)
  u32(eocdView, 0, 0x06054b50)
  u16(eocdView, 4, 0)
  u16(eocdView, 6, 0)
  u16(eocdView, 8, entries.length)
  u16(eocdView, 10, entries.length)
  u32(eocdView, 12, centralSize)
  u32(eocdView, 16, centralOffset)
  u16(eocdView, 20, 0)
  chunks.push(eocd)

  return new Blob(chunks as BlobPart[], { type: 'application/zip' })
}