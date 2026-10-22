import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = resolve(import.meta.dirname, ".."),
  target = resolve(root, "public/ocr");
await mkdir(target, { recursive: true });
const files = [
  ["tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["tesseract.js/dist/worker.min.js.LICENSE.txt", "worker-LICENSE.txt"],
  ...["lstm", "simd-lstm", "relaxedsimd-lstm"].map((x) => [
    `tesseract.js-core/tesseract-core-${x}.wasm.js`,
    `tesseract-core-${x}.wasm.js`,
  ]),
  ...["chi_sim", "eng"].map((x) => [
    `@tesseract.js-data/${x}/4.0.0_best_int/${x}.traineddata.gz`,
    `${x}.traineddata.gz`,
  ]),
];
for (const name of ["Apache-2.0.txt", "tessdata-Apache-2.0.txt"])
  await copyFile(resolve(root, "docs/licenses", name), resolve(target, name));
const manifest = [];
for (const [from, name] of files) {
  const path = resolve(root, "node_modules", from);
  await copyFile(path, resolve(target, name));
  const data = await readFile(path);
  manifest.push({
    name,
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
const packages = [];
for (const name of [
  "tesseract.js",
  "tesseract.js-core",
  "@tesseract.js-data/chi_sim",
  "@tesseract.js-data/eng",
]) {
  const p = JSON.parse(
    await readFile(resolve(root, "node_modules", name, "package.json"), "utf8"),
  );
  packages.push({
    name,
    version: p.version,
    license: p.license,
    repository: p.repository,
  });
}
await writeFile(
  resolve(target, "manifest.json"),
  JSON.stringify({ packages, files: manifest }, null, 2),
);
await writeFile(
  resolve(target, "NOTICE.txt"),
  "Qingbao browser OCR dependencies\n" +
    packages
      .map(
        (p) =>
          `${p.name} ${p.version} — ${p.license}\n${typeof p.repository === "string" ? p.repository : p.repository?.url || ""}`,
      )
      .join("\n\n") +
    "\nAssets copied from npm packages verified by package-lock.json integrity. Original projects retain their copyrights. Language npm package metadata reports MIT; upstream tessdata language files carry Apache-2.0 (see tessdata-Apache-2.0.txt). Worker dependency notices are preserved in worker-LICENSE.txt.\n",
);
console.log(
  `Prepared ${manifest.length} same-origin OCR assets (${(manifest.reduce((s, x) => s + x.bytes, 0) / 1024 / 1024).toFixed(1)} MB)`,
);
