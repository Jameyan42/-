import test from "node:test";
import assert from "node:assert/strict";
import { imageGeometry, defaultImageSettings } from "./image-tools.js";
import { extractInvoiceFields } from "./ocr.js";
import { researchCsv } from "./research.js";
test("旋转后裁剪以新坐标计算，缩放保留比例", () => {
  const g = imageGeometry(1400, 920, {
    rotation: 90,
    crop: { left: 10, right: 10, top: 0, bottom: 0 },
  });
  assert.equal(g.rotatedWidth, 920);
  assert.equal(g.rotatedHeight, 1400);
  assert.equal(g.sx, 92);
  assert.equal(g.sw, 736);
  assert.equal(g.sh, 1400);
  assert.equal(imageGeometry(4000, 2000, defaultImageSettings()).width, 2200);
  assert.equal(imageGeometry(4000, 2000, defaultImageSettings()).height, 1100);
});
test("非法角度、尺寸及裁剪拒绝，设置对象互相独立", () => {
  assert.throws(() => imageGeometry(0, 100));
  assert.throws(() => imageGeometry(5000, 5000));
  assert.throws(() => imageGeometry(100, 100, { rotation: 45 }));
  assert.throws(() => imageGeometry(100, 100, { crop: { left: 41 } }));
  const a = defaultImageSettings(),
    b = defaultImageSettings();
  a.crop.left = 10;
  assert.equal(b.crop.left, 0);
});
test("合计本行优先，冲突的号码与金额留空", () => {
  assert.equal(
    extractInvoiceFields("价税合计 ¥268.50\n税额 10.00").amount,
    "268.50",
  );
  assert.equal(
    extractInvoiceFields("发票号码 12345678\n发票号码 87654321").invoice,
    "",
  );
  assert.equal(extractInvoiceFields("TOTAL 268.50\nTOTAL 300.00").amount, "");
  assert.equal(extractInvoiceFields("价税合计\n税额 10.00").amount, "");
});
test("可用性CSV明确为计划，无伪造结果", () => {
  const csv = researchCsv();
  assert.ok(csv.includes("非实际测试"));
  assert.ok(csv.includes("P06"));
  assert.ok(!csv.includes("独立完成"));
});
