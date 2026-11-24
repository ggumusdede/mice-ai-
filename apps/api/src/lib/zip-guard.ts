// XLSX zip-bomb guard (security review G-18, residual risk 1). exceljs/JSZip inflates the whole archive in memory; a 20 MB
// upload (public supplier link, finance bank statement, offer / invoice file) could expand to gigabytes. Before exceljs sees
// the file we walk the zip central directory ourselves (dependency-free) and enforce:
//  - entry count ≤ maxEntries,
//  - no ZIP64 / encryption / unknown compression method,
//  - the REAL inflated size (declared sizes are attacker-controlled): every entry is inflated with zlib's
//    `maxOutputLength` capped at the remaining budget, so at most maxUncompressedBytes is ever produced,
//  - compression ratio (per large entry and for the whole archive) ≤ maxRatio.
// Overlapping-entry bombs (many central-directory records pointing at the same data) are covered by the shared budget.
import { inflateRawSync } from 'node:zlib';
import { AppError } from '../errors.js';

export interface ZipLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
  maxRatio: number;
}

/** Defaults: 2000 entries, 30 MB inflated, ratio 100 (env XLSX_MAX_ENTRIES / XLSX_MAX_UNCOMPRESSED_MB / XLSX_MAX_RATIO). */
export function zipLimitsFromEnv(env: Record<string, string | undefined> = process.env): ZipLimits {
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    maxEntries: num(env.XLSX_MAX_ENTRIES, 2000),
    maxUncompressedBytes: Math.round(num(env.XLSX_MAX_UNCOMPRESSED_MB, 30) * 1024 * 1024),
    maxRatio: num(env.XLSX_MAX_RATIO, 100),
  };
}

/** Ratio is only judged for entries above this size: tiny XML parts legitimately compress very well. */
const RATIO_MIN_BYTES = 1024 * 1024;

const reject = (reason: string) => new AppError(400, 'UNSAFE_ARCHIVE', `Excel dosyası reddedildi: ${reason}`);

export interface ZipInspection { entries: number; uncompressedBytes: number; compressedBytes: number }

export function assertSafeZip(buf: Buffer, limits: ZipLimits = zipLimitsFromEnv()): ZipInspection {
  if (buf.length < 22 || buf.readUInt32LE(0) !== 0x04034b50) throw reject('geçerli bir xlsx (zip) değil');
  // End Of Central Directory: last 22 bytes + up to 64 KB comment
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw reject('zip dizini bulunamadı');
  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw reject('ZIP64 desteklenmiyor');
  if (total > limits.maxEntries) throw reject(`çok fazla dosya (${total} > ${limits.maxEntries})`);
  if (cdOffset + cdSize > eocd) throw reject('bozuk zip dizini');

  let p = cdOffset;
  let inflatedTotal = 0;
  let compressedTotal = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw reject('bozuk zip dizini');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw reject('şifreli zip');
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) throw reject('ZIP64 desteklenmiyor');
    // cheap pre-check on the declared size; the real size is measured below
    if (inflatedTotal + usize > limits.maxUncompressedBytes) throw reject('açılmış boyut sınırı aşıldı');
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) throw reject('bozuk zip girdisi');
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + csize > buf.length) throw reject('bozuk zip girdisi');
    const data = buf.subarray(dataStart, dataStart + csize);
    const budget = limits.maxUncompressedBytes - inflatedTotal;
    let real: number;
    if (method === 0) real = csize;
    else if (method === 8) {
      try {
        real = inflateRawSync(data, { maxOutputLength: Math.max(1, budget) }).length;
      } catch (e) {
        if ((e as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|buffer/i.test(String((e as Error).message))) {
          throw reject('açılmış boyut sınırı aşıldı');
        }
        throw reject('bozuk sıkıştırılmış veri');
      }
    } else throw reject(`desteklenmeyen sıkıştırma (${method})`);
    if (real > budget) throw reject('açılmış boyut sınırı aşıldı');
    if (real >= RATIO_MIN_BYTES && real / Math.max(1, csize) > limits.maxRatio) throw reject('sıkıştırma oranı şüpheli (zip bombası)');
    inflatedTotal += real;
    compressedTotal += csize;
  }
  if (inflatedTotal >= RATIO_MIN_BYTES && inflatedTotal / Math.max(1, compressedTotal) > limits.maxRatio) {
    throw reject('sıkıştırma oranı şüpheli (zip bombası)');
  }
  return { entries: total, uncompressedBytes: inflatedTotal, compressedBytes: compressedTotal };
}
