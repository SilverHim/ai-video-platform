/** 按文件头识别格式并读取图片宽高 / 透明通道（不依赖第三方库） */

export interface Sniffed {
  mime: string;
  ext: string;
  kind: 'image' | 'video' | 'audio' | 'other';
  width?: number;
  height?: number;
  hasAlpha?: boolean;
}

const ascii = (b: Uint8Array, start: number, len: number) => String.fromCharCode(...b.subarray(start, start + len));

export function sniff(buf: Uint8Array): Sniffed {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // PNG
  if (buf.length >= 24 && buf[0] === 0x89 && ascii(buf, 1, 3) === 'PNG') {
    const width = dv.getUint32(16);
    const height = dv.getUint32(20);
    const colorType = buf[25];
    let hasAlpha = colorType === 4 || colorType === 6;
    if (!hasAlpha) hasAlpha = findPngChunk(buf, 'tRNS');
    return { mime: 'image/png', ext: 'png', kind: 'image', width, height, hasAlpha };
  }
  // JPEG
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    const dims = jpegSize(buf);
    return { mime: 'image/jpeg', ext: 'jpeg', kind: 'image', ...dims, hasAlpha: false };
  }
  // GIF
  if (buf.length >= 10 && ascii(buf, 0, 3) === 'GIF') {
    return { mime: 'image/gif', ext: 'gif', kind: 'image', width: dv.getUint16(6, true), height: dv.getUint16(8, true) };
  }
  // WebP
  if (buf.length >= 30 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp', kind: 'image', ...webpSize(buf, dv) };
  }
  // WAV
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 4) === 'WAVE') return { mime: 'audio/wav', ext: 'wav', kind: 'audio' };
  // BMP
  if (buf.length >= 26 && ascii(buf, 0, 2) === 'BM') {
    return { mime: 'image/bmp', ext: 'bmp', kind: 'image', width: dv.getInt32(18, true), height: Math.abs(dv.getInt32(22, true)) };
  }
  // TIFF
  if (buf.length >= 4 && (ascii(buf, 0, 4) === 'II*\0' || ascii(buf, 0, 4) === 'MM\0*')) return { mime: 'image/tiff', ext: 'tiff', kind: 'image' };
  // ISO BMFF：mp4 / mov / heic
  if (buf.length >= 12 && ascii(buf, 4, 4) === 'ftyp') {
    const brand = ascii(buf, 8, 4);
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) return { mime: brand.startsWith('mif') || brand.startsWith('msf') ? 'image/heif' : 'image/heic', ext: brand.startsWith('mif') || brand.startsWith('msf') ? 'heif' : 'heic', kind: 'image' };
    if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov', kind: 'video' };
    return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
  }
  // MP3
  if (buf.length >= 3 && (ascii(buf, 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0))) return { mime: 'audio/mpeg', ext: 'mp3', kind: 'audio' };
  // WebM
  if (buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return { mime: 'video/webm', ext: 'webm', kind: 'video' };
  return { mime: 'application/octet-stream', ext: 'bin', kind: 'other' };
}

function findPngChunk(buf: Uint8Array, type: string): boolean {
  let off = 8;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  while (off + 8 <= buf.length) {
    const len = dv.getUint32(off);
    const t = ascii(buf, off + 4, 4);
    if (t === type) return true;
    if (t === 'IDAT' || t === 'IEND') return false;
    off += 12 + len;
  }
  return false;
}

function jpegSize(buf: Uint8Array): { width?: number; height?: number } {
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = buf[off + 1]!;
    const len = (buf[off + 2]! << 8) | buf[off + 3]!;
    // SOF0–SOF15（排除 DHT C4、JPG C8、DAC CC）
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (buf[off + 5]! << 8) | buf[off + 6]!, width: (buf[off + 7]! << 8) | buf[off + 8]! };
    }
    off += 2 + len;
  }
  return {};
}

function webpSize(buf: Uint8Array, dv: DataView): { width?: number; height?: number; hasAlpha?: boolean } {
  const chunk = ascii(buf, 12, 4);
  if (chunk === 'VP8 ') return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff, hasAlpha: false };
  if (chunk === 'VP8L') {
    const b = dv.getUint32(21, true);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1, hasAlpha: Boolean((b >> 28) & 1) };
  }
  if (chunk === 'VP8X') {
    const w = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
    const h = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
    return { width: w, height: h, hasAlpha: Boolean(buf[20]! & 0x10) };
  }
  return {};
}
