import { readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const web = fileURLToPath(new URL("..", import.meta.url));
const staticRoot = path.join(web, ".next/static");
const files = (await readdir(staticRoot, { recursive: true })).filter((file) =>
  /\.(js|css|woff2?)$/.test(file),
);
const buildId = (
  await readFile(path.join(web, ".next/BUILD_ID"), "utf8")
).trim();
const publicAssets = (
  await Promise.all(["visual-novel", "fonts"].map(async (folder) =>
    (await readdir(path.join(web, "public", folder)))
      .filter((file) => /\.(?:jpe?g|png|webp|woff2?)$/i.test(file))
      .map((file) => `/${folder}/${file}`),
  ))
).flat();
const assets = [
  "/",
  "/play",
  "/icon.svg",
  "/manifest.webmanifest",
  ...publicAssets,
  ...files.map((file) => "/_next/static/" + file.replaceAll("\\", "/")),
];
const version = createHash("sha256")
  .update(buildId + assets.join("\n"))
  .digest("hex")
  .slice(0, 16);
const template = await readFile(
  new URL("../service-worker.template.js", import.meta.url),
  "utf8",
);
await writeFile(
  path.join(web, "public/sw.js"),
  template
    .replace("__CACHE_NAME__", JSON.stringify(`vsm-shell-${version}`))
    .replace("__ASSETS__", JSON.stringify(assets)),
  "utf8",
);
console.log(`Offline shell: ${assets.length} assets, ${version}`);
