export const defaultImageSettings = () => ({
  rotation: 0,
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
});
export function imageGeometry(
  width,
  height,
  settings = defaultImageSettings(),
  maxEdge = 2200,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 16000000
  )
    throw new Error("图片尺寸无效或超过 1600 万像素");
  const { rotation = 0, crop = {} } = settings;
  if (![0, 90, 180, 270].includes(rotation))
    throw new Error("仅支持 90 度倍数旋转");
  const margins = { left: 0, top: 0, right: 0, bottom: 0, ...crop };
  if (
    Object.values(margins).some((x) => !Number.isFinite(x) || x < 0 || x > 40)
  )
    throw new Error("裁剪边界应在 0～40% 之间");
  if (!Number.isFinite(maxEdge) || maxEdge < 1) throw new Error("预览尺寸无效");
  const rotatedWidth = rotation % 180 ? height : width,
    rotatedHeight = rotation % 180 ? width : height;
  const sx = Math.round((rotatedWidth * margins.left) / 100),
    sy = Math.round((rotatedHeight * margins.top) / 100);
  const sw =
      rotatedWidth - sx - Math.round((rotatedWidth * margins.right) / 100),
    sh =
      rotatedHeight - sy - Math.round((rotatedHeight * margins.bottom) / 100);
  if (sw < 1 || sh < 1) throw new Error("裁剪区域过小");
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  return {
    rotation,
    rotatedWidth,
    rotatedHeight,
    sx,
    sy,
    sw,
    sh,
    width: Math.max(1, Math.round(sw * scale)),
    height: Math.max(1, Math.round(sh * scale)),
  };
}
export async function renderInvoiceImage(
  file,
  settings = defaultImageSettings(),
  maxEdge = 2200,
) {
  const bitmap = await createImageBitmap(file);
  try {
    return renderInvoiceBitmap(bitmap, settings, maxEdge);
  } finally {
    bitmap.close();
  }
}
export function renderInvoiceBitmap(
  bitmap,
  settings = defaultImageSettings(),
  maxEdge = 2200,
) {
  let rotated;
  try {
    const g = imageGeometry(bitmap.width, bitmap.height, settings, maxEdge);
    rotated = document.createElement("canvas");
    rotated.width = g.rotatedWidth;
    rotated.height = g.rotatedHeight;
    const ctx = rotated.getContext("2d");
    if (!ctx) throw new Error("当前浏览器不支持图片处理");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rotated.width, rotated.height);
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate((g.rotation * Math.PI) / 180);
    ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
    const output = document.createElement("canvas");
    output.width = g.width;
    output.height = g.height;
    const target = output.getContext("2d");
    if (!target) throw new Error("无法生成裁剪预览");
    target.drawImage(rotated, g.sx, g.sy, g.sw, g.sh, 0, 0, g.width, g.height);
    return output;
  } finally {
    if (rotated) {
      rotated.width = 1;
      rotated.height = 1;
    }
  }
}
