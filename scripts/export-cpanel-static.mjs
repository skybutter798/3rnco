import { createHash } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const outputDirectory = process.argv[2];
const productionOrigin = process.argv[3] ?? "https://3rnco.com.my";

if (!outputDirectory) {
  throw new Error("Usage: node scripts/export-cpanel-static.mjs <output-directory> [origin]");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDirectory = path.join(root, "dist", "client");
const workerUrl = pathToFileURL(path.join(root, "dist", "server", "index.js"));
workerUrl.searchParams.set("export", `${process.pid}-${Date.now()}`);

await mkdir(outputDirectory, { recursive: true });
await cp(clientDirectory, outputDirectory, { recursive: true, force: true });

const { default: worker } = await import(workerUrl.href);
const response = await worker.fetch(
  new Request(`${productionOrigin}/`, {
    headers: { accept: "text/html", host: new URL(productionOrigin).host },
  }),
  {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  },
  {
    waitUntil() {},
    passThroughOnException() {},
  },
);

if (!response.ok) {
  throw new Error(`Static export failed with HTTP ${response.status}`);
}

const html = await response.text();
if (!html.includes("3R&amp;Co.") || !html.includes("/_next/static/")) {
  throw new Error("Static export did not contain the expected storefront markup and assets");
}

const assetPattern = /\/_next\/static\/[^\\\s"'<>?]+/g;
const assetPaths = [...new Set(html.match(assetPattern) ?? [])];
const assetVersions = new Map();

for (const assetPath of assetPaths) {
  const asset = await readFile(path.join(outputDirectory, assetPath.slice(1)));
  assetVersions.set(assetPath, createHash("sha256").update(asset).digest("hex").slice(0, 12));
}

const versionedHtml = html.replace(assetPattern, (assetPath) => `${assetPath}?v=${assetVersions.get(assetPath)}`);

await writeFile(path.join(outputDirectory, "index.html"), versionedHtml, "utf8");
console.log(`Exported ${versionedHtml.length} bytes to ${outputDirectory}`);
