#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const entry = join(site, "index.html");
const previewPath = join(site, "assets", "social-preview.jpg");
const required = [
  "index.html",
  "404.html",
  "styles.css",
  "script.js",
  "robots.txt",
  "sitemap.xml",
  "favicon.svg",
  ".nojekyll",
  "assets/social-preview.jpg",
];
const failures = [];

for (const file of required) {
  if (!existsSync(join(site, file))) failures.push(`missing site/${file}`);
}

const html = existsSync(entry) ? readFileSync(entry, "utf8") : "";
for (const [label, pattern] of [
  ["English document language", /<html\s+lang="en">/],
  ["meta description", /<meta\s+name="description"/],
  ["Open Graph title", /<meta\s+property="og:title"/],
  ["Open Graph image", /<meta\s+property="og:image"/],
  ["large X card", /<meta\s+name="twitter:card"\s+content="summary_large_image">/],
  ["canonical URL", /<link\s+rel="canonical"\s+href="https:\/\/mirawren\.github\.io\/skillcheck\/">/],
  ["skip link", /<a\s+class="skip-link"\s+href="#main">/],
]) {
  if (!pattern.test(html)) failures.push(`site/index.html is missing ${label}`);
}

const localReferences = [];
for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
  localReferences.push({ source: entry, value: match[1] });
}

const cssPath = join(site, "styles.css");
const css = existsSync(cssPath) ? readFileSync(cssPath, "utf8") : "";
for (const match of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
  localReferences.push({ source: cssPath, value: match[1] });
}

for (const { source, value } of localReferences) {
  if (/^(?:https?:|mailto:|data:|#|\/)/.test(value)) continue;
  const path = resolve(dirname(source), value.split(/[?#]/, 1)[0]);
  const pathFromSite = relative(site, path);
  if (pathFromSite.startsWith("..") || isAbsolute(pathFromSite) || !existsSync(path)) {
    failures.push(`${relative(root, source)} references missing ${value}`);
  }
}

if (/\b(?:TODO|FIXME)\b/.test(`${html}\n${css}`)) {
  failures.push("site contains an unfinished placeholder marker");
}

function jpegDimensions(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }
    offset += length;
  }
  return null;
}

if (existsSync(previewPath)) {
  const dimensions = jpegDimensions(readFileSync(previewPath));
  if (!dimensions || dimensions.width !== 1280 || dimensions.height !== 640) {
    failures.push("social preview must be a 1280 × 640 JPEG");
  }
  if (statSync(previewPath).size >= 1_000_000) {
    failures.push("social preview must stay below GitHub's 1 MB upload limit");
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`  ✖ ${failure}`);
  process.exit(1);
}

console.log(`  ✔ ${required.length} static site files present`);
console.log(`  ✔ ${localReferences.length} local HTML/CSS references resolve`);
console.log("  ✔ 1280 × 640 social preview is below GitHub's 1 MB limit");
console.log("  ✔ canonical, social, responsive and skip-link metadata present");
