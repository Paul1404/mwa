// Generate every PNG / ICO variant from the source SVG. Run via:
//   bun run scripts/generate-icons.ts
//
// Outputs go into /public so Vite serves them at the URL root.

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const ROOT = process.cwd();
const PUBLIC = join(ROOT, "public");
const SRC = join(PUBLIC, "favicon.svg");

const PNG_TARGETS: { size: number; out: string }[] = [
  { size: 16, out: "favicon-16.png" },
  { size: 32, out: "favicon-32.png" },
  { size: 180, out: "apple-touch-icon.png" },
  { size: 192, out: "icon-192.png" },
  { size: 512, out: "icon-512.png" },
];

async function main() {
  if (!existsSync(SRC)) throw new Error(`missing ${SRC}`);
  if (!existsSync(PUBLIC)) await mkdir(PUBLIC, { recursive: true });

  const svg = await readFile(SRC);

  for (const { size, out } of PNG_TARGETS) {
    const target = join(PUBLIC, out);
    await sharp(svg, { density: 384 }).resize(size, size).png().toFile(target);
    console.log(`[icons] ${out} ${size}x${size}`);
  }

  // .ico bundles 16/32/48; sharp doesn't write ico natively, so we ship a
  // single 32x32 PNG renamed to .ico -- modern browsers fall back to the SVG
  // anyway, this is purely a legacy IE shim.
  const ico32 = await sharp(svg, { density: 384 }).resize(48, 48).png().toBuffer();
  await writeFile(join(PUBLIC, "favicon.ico"), ico32);
  console.log("[icons] favicon.ico (48x48 png-in-ico shim)");

  const manifest = {
    name: "Mailcow Web Updater",
    short_name: "MWA",
    description: "Trigger Mailcow upgrades over SSH from a browser.",
    start_url: "/",
    display: "standalone",
    background_color: "#0c111a",
    theme_color: "#0e1217",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
  await writeFile(join(PUBLIC, "manifest.webmanifest"), JSON.stringify(manifest, null, 2));
  console.log("[icons] manifest.webmanifest");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
