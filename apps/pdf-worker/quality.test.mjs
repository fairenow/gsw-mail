import test from "node:test";
import assert from "node:assert/strict";
import { inspectPdfPages, extractWordBoxPages } from "./quality.mjs";

const page = (words, width = 612, height = 792) => ({ width, height, words: words.map(([text,xMin,yMin,xMax,yMax]) => ({ text,xMin,yMin,xMax,yMax })) });

test("rejects leaked worker paths in PDF, not just warning", () => {
  const result = inspectPdfPages([page([["file:///tmp/gsw-isolated-pdf-abc/page.html",40,750,550,765]])]);
  assert.equal(result.reject, true);
  assert.ok(result.issues.some((issue) => issue.code === "internal_path"));
});
test("underfilled cover and final page are actionable warnings", () => {
  const first = page(Array.from({length: 30}, (_,i) => ["Text",40,100+i*2,100,110+i*2]));
  const last = page(Array.from({length: 25}, (_,i) => ["Details",40,40+i*3,100,50+i*3]));
  const result = inspectPdfPages([first,last]);
  assert.equal(result.reject,false);
  assert.ok(result.issues.some((issue) => issue.code === "underfilled_cover"));
  assert.ok(result.issues.some((issue) => issue.code === "sparse_final_page"));
});
test("flags unsafe text margins", () => {
  const result = inspectPdfPages([page([["NearEdge",3,5,130,18]])]);
  assert.ok(result.issues.some((issue) => issue.code === "text_near_edge"));
});
test("extracts bounding boxes from pdftotext XML", () => {
  const xml = '<doc><page width="612" height="792"><flow><block><line><word xMin="20" yMin="25" xMax="50" yMax="36">Hello</word></line></block></flow></page></doc>';
  const pages = extractWordBoxPages(xml);
  assert.equal(pages.length,1);
  assert.equal(pages[0].words[0].text,"Hello");
  assert.equal(pages[0].words[0].xMin,20);
});
