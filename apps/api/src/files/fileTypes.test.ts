import assert from "node:assert/strict";
import test from "node:test";
import { detectFileType, isTextLikeFile } from "./fileTypes.js";

test("detects common text and code formats", () => {
  assert.equal(detectFileType("notes.md", "text/markdown").strategy, "text");
  assert.equal(detectFileType("app.ts", "").category, "code");
  assert.equal(detectFileType("invite.ics", "text/calendar").category, "calendar");
  assert.equal(isTextLikeFile("message.eml", "message/rfc822"), true);
});

test("routes office formats intentionally", () => {
  assert.equal(detectFileType("brief.pdf", "application/pdf").strategy, "openai_file");
  assert.equal(detectFileType("proposal.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document").strategy, "openai_file");
  assert.equal(detectFileType("deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation").strategy, "openai_file");
  assert.equal(detectFileType("workbook.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").strategy, "code_interpreter");
  assert.equal(detectFileType("sheet.numbers", "application/octet-stream").strategy, "code_interpreter");
  assert.equal(detectFileType("doc.pages", "application/octet-stream").strategy, "code_interpreter");
});

test("uses MIME to disambiguate webm media", () => {
  assert.equal(detectFileType("clip.webm", "video/webm").category, "video");
  assert.equal(detectFileType("recording.webm", "audio/webm").category, "audio");
});

test("routes uncommon images, archives, and unknown binaries to sandbox", () => {
  assert.equal(detectFileType("photo.heic", "image/heic").strategy, "code_interpreter");
  assert.equal(detectFileType("scan.tiff", "image/tiff").strategy, "code_interpreter");
  assert.equal(detectFileType("bundle.zip", "application/zip").category, "archive");
  assert.equal(detectFileType("mystery.bin", "application/octet-stream").strategy, "best_effort");
});

test("routes email, ebook, audio, and video formats", () => {
  assert.equal(detectFileType("mail.msg", "application/vnd.ms-outlook").category, "email");
  assert.equal(detectFileType("book.epub", "application/epub+zip").category, "ebook");
  assert.equal(detectFileType("audio.mp3", "audio/mpeg").strategy, "transcription");
  assert.equal(detectFileType("movie.mov", "video/quicktime").strategy, "video");
});
