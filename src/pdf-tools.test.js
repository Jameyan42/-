import test from "node:test";
import assert from "node:assert/strict";
import { isPdf, validatePdfPage, pdfSourceName } from "./pdf-tools.js";

test("PDF页码仅接受1到20整数，避免空值、负数和无限页", () => {
  for (const n of [1, 2, 20]) assert.equal(validatePdfPage(n), n);
  for (const n of [0, -1, 1.5, 21, NaN, Infinity, "2", null])
    assert.throws(() => validatePdfPage(n), /页码/);
});
test("PDF来源保留所选页且不超过票面来源字段上限，图片来源兼容", () => {
  assert.equal(isPdf({ type: "application/pdf" }), true);
  assert.equal(isPdf({ type: "image/png" }), false);
  assert.equal(
    pdfSourceName({ type: "application/pdf", name: "样票.pdf" }, 2),
    "样票.pdf（PDF第2页）",
  );
  assert.ok(
    pdfSourceName({ type: "application/pdf", name: "长".repeat(200) }, 20)
      .length <= 120,
  );
  assert.equal(
    pdfSourceName({ type: "image/png", name: "样票.png" }),
    "样票.png",
  );
});
