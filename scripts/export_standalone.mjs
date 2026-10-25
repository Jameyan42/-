import { build } from "vite";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
await mkdir(resolve(root, "deliverables"), { recursive: true });
// Build each entry independently: shared UI/code in the regular multipage build
// must not turn the previously standalone R001 file into a broken relative import.
for (const [entry, target] of [
  ["index.html", "轻报演示.html"],
  ["r001.html", "r001-住宿审核.html"],
  ["r002.html", "r002-发票查重.html"],
  ["r003.html", "r003-合同付款.html"],
]) {
  const result = await build({
    configFile: false,
    root,
    base: "./",
    logLevel: "warn",
    build: {
      write: false,
      cssCodeSplit: false,
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: resolve(root, entry),
        output: { inlineDynamicImports: true },
      },
    },
  });
  const outputs = Array.isArray(result)
    ? result.flatMap((r) => r.output)
    : result.output;
  const assets = new Map(outputs.map((o) => [o.fileName, o]));
  const source = assets.get(entry);
  if (!source || source.type !== "asset")
    throw Error("Missing HTML entry: " + entry);
  let html = String(source.source);
  html = html.replace(
    /<script[^>]+src="([^"]+)"[^>]*><\/script>/g,
    (_, url) => {
      const js = assets.get(url.replace(/^\.\//, ""));
      if (
        !js ||
        js.type !== "chunk" ||
        js.imports.length ||
        js.dynamicImports.length
      )
        throw Error("Standalone page has an unresolved JS dependency: " + url);
      return (
        '<script type="module">' +
        js.code.replaceAll("</script", "<\\/script") +
        "</script>"
      );
    },
  );
  html = html.replace(/<link[^>]+href="([^"]+\.css)"[^>]*>/g, (_, url) => {
    const css = assets.get(url.replace(/^\.\//, ""));
    if (!css || css.type !== "asset") throw Error("Missing style: " + url);
    return "<style>" + String(css.source) + "</style>";
  });
  if (/<script[^>]+src=|<link[^>]+rel="modulepreload"/.test(html))
    throw Error("Unresolved standalone entry resources");
  await writeFile(resolve(root, "deliverables", target), html);
  console.log("Created deliverables/" + target);
}
