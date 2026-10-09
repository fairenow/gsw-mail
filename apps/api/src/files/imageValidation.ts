import { inflateSync } from "node:zlib";

export type VerifiedImage = { bytes: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp"; extension: "png" | "jpg" | "webp"; width: number; height: number };
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
function invalid(reason: string): never { throw new Error(`Invalid generated image: ${reason}`); }
function dimensions(width: number, height: number) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_PIXELS) invalid("dimensions out of range");
}
const pngSignature = Buffer.from([137,80,78,71,13,10,26,10]);
function verifyPng(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 57 || !bytes.subarray(0,8).equals(pngSignature)) invalid("PNG signature");
  let offset = 8, width = 0, height = 0, seenIHDR = false, seenIDAT = false, ended = false;
  const idat: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > MAX_BYTES || offset + length + 12 > bytes.length) invalid("truncated PNG chunk");
    const type = bytes.toString("ascii", offset+4, offset+8);
    const payload = bytes.subarray(offset+8, offset+8+length);
    if (!seenIHDR && (type !== "IHDR" || length !== 13)) invalid("missing PNG header");
    if (type === "IHDR") {
      if (seenIHDR || length !== 13) invalid("duplicate PNG header");
      seenIHDR = true; width = payload.readUInt32BE(0); height = payload.readUInt32BE(4); dimensions(width, height);
      if (payload[10] !== 0 || payload[11] !== 0 || payload[12] > 1) invalid("unsupported PNG header");
    } else if (type === "IDAT") { seenIDAT = true; idat.push(payload); }
    else if (type === "IEND") { if (length !== 0) invalid("PNG trailer"); ended = true; offset += length+12; break; }
    offset += length + 12;
  }
  if (!seenIHDR || !seenIDAT || !ended || offset !== bytes.length) invalid("incomplete PNG");
  // Confirm that compressed image data is decodable. PNG filters and checksums are
  // validated by the inflater; this does not replace a full pixel-level image decoder.
  try { if (!inflateSync(Buffer.concat(idat), { maxOutputLength: MAX_BYTES * 4 }).length) invalid("empty PNG pixels"); }
  catch { invalid("undecodable PNG pixels"); }
  return {width,height};
}
function verifyJpeg(bytes: Buffer): {width:number;height:number} {
  if (bytes.length < 16 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) invalid("JPEG markers");
  let offset=2,width=0,height=0,foundSOS=false;
  while (offset + 4 <= bytes.length-2) {
    if (bytes[offset] !== 255) invalid("JPEG segment boundary");
    while (bytes[offset] === 255) offset++;
    const marker=bytes[offset++];
    if (marker === 0xda) { foundSOS=true; break; }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x00) invalid("unexpected JPEG marker");
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset+2 > bytes.length-2) invalid("truncated JPEG segment");
    const length=bytes.readUInt16BE(offset);
    if (length < 2 || offset+length > bytes.length-2) invalid("truncated JPEG segment");
    if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)) {
      if (length < 7) invalid("JPEG frame");
      height=bytes.readUInt16BE(offset+3); width=bytes.readUInt16BE(offset+5);
    }
    offset+=length;
  }
  dimensions(width,height);
  if (!foundSOS) invalid("missing JPEG scan");
  return {width,height};
}
function verifyWebp(bytes: Buffer): {width:number;height:number} {
  if (bytes.length < 30 || bytes.toString("ascii",0,4)!=="RIFF" || bytes.toString("ascii",8,12)!=="WEBP" || bytes.readUInt32LE(4)+8!==bytes.length) invalid("WebP container");
  const type=bytes.toString("ascii",12,16), chunkSize=bytes.readUInt32LE(16);
  if (chunkSize+20 > bytes.length) invalid("truncated WebP image");
  let width=0,height=0;
  if(type==="VP8X" && chunkSize>=10) {
    width=1+bytes.readUIntLE(24,3);height=1+bytes.readUIntLE(27,3);
  } else if(type==="VP8L" && chunkSize>=5 && bytes[20]===0x2f) {
    const bits=bytes.readUInt32LE(21);
    width=(bits&0x3fff)+1;height=((bits>>>14)&0x3fff)+1;
  } else if(type==="VP8 " && chunkSize>=10 && bytes[23]===0x9d && bytes[24]===0x01 && bytes[25]===0x2a) {
    width=bytes.readUInt16LE(26)&0x3fff;height=bytes.readUInt16LE(28)&0x3fff;
  } else invalid("unsupported WebP frame");
  dimensions(width,height);return {width,height};
}
export function verifyGeneratedImage(bytes: Buffer): VerifiedImage {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16 || bytes.length > MAX_BYTES) invalid("file size");
  if(bytes.subarray(0,8).equals(pngSignature)) return {bytes,mimeType:"image/png",extension:"png",...verifyPng(bytes)};
  if(bytes[0]===255 && bytes[1]===216) return {bytes,mimeType:"image/jpeg",extension:"jpg",...verifyJpeg(bytes)};
  if(bytes.toString("ascii",0,4)==="RIFF") return {bytes,mimeType:"image/webp",extension:"webp",...verifyWebp(bytes)};
  invalid("unknown file format");
}
