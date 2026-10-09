import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { verifyGeneratedImage } from "./imageValidation.js";

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const frame = Buffer.concat([Buffer.from(type),data]);
  let crc = 0xffffffff;
  for(const byte of frame) { crc ^= byte; for(let i=0;i<8;i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const checksum=Buffer.alloc(4);checksum.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,frame,checksum]);
}
function png() {
  const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk("IHDR",header),pngChunk("IDAT",deflateSync(Buffer.from([0,255,0,0,255]))),pngChunk("IEND",Buffer.alloc(0))]);
}
test("valid PNG dimensions and verified MIME", () => {
  const output=verifyGeneratedImage(png());
  assert.equal(output.width,1);assert.equal(output.height,1);assert.equal(output.mimeType,"image/png");assert.equal(output.extension,"png");
});
test("rejects empty and unknown data", () => {
  assert.throws(()=>verifyGeneratedImage(Buffer.alloc(0)),/file size/);
  assert.throws(()=>verifyGeneratedImage(Buffer.alloc(30)),/unknown file format/);
});
test("rejects truncated and corrupt PNG data", () => {
  const source=png();
  assert.throws(()=>verifyGeneratedImage(source.subarray(0,-6)),/truncated PNG|incomplete PNG/);
  const invalid=Buffer.from(source); invalid.fill(0,invalid.indexOf(Buffer.from("IDAT"))+4,invalid.indexOf(Buffer.from("IEND"))-8);
  assert.throws(()=>verifyGeneratedImage(invalid),/PNG checksum|undecodable PNG/);
});
test("rejects a PNG with impossible dimensions", () => {
  const source=png();const altered=Buffer.from(source);altered.writeUInt32BE(50000,16);
  assert.throws(()=>verifyGeneratedImage(altered),/dimensions out of range/);
});
test("rejects a truncated JPEG or malformed WebP", () => {
  assert.throws(()=>verifyGeneratedImage(Buffer.from([255,216,...new Array(20).fill(0)])),/JPEG markers/);
  assert.throws(()=>verifyGeneratedImage(Buffer.from("RIFF1234WEBPVP8 1234123412341234")),/WebP container/);
});
test("rejects oversized output before allocation-heavy decoding", () => {
  assert.throws(()=>verifyGeneratedImage(Buffer.alloc(20*1024*1024+1)),/file size/);
});
