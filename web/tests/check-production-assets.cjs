// Run against an actual production/container URL, or the export directory during build.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

async function checkProductionAssets(target) {
  const remote = /^https?:\/\//.test(target);
  const read = async (url, type) => {
    if (!remote) return fs.readFile(path.join(target, url === "/" ? "index.html" : url.replace(/^\//, "")));
    const response = await fetch(new URL(url, target));
    assert.equal(response.status, 200, `${url}: HTTP ${response.status}`);
    if (type) assert.match(response.headers.get("content-type") || "", type, url);
    return Buffer.from(await response.arrayBuffer());
  };
  const html = (await read("/", /text\/html/)).toString();
  const references = [...new Set([...html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)].map(m => m[1]))];
  const styles = references.filter(url => url.endsWith(".css"));
  const scripts = references.filter(url => url.endsWith(".js"));
  assert(styles.length && scripts.length, "Export must reference CSS and JS");
  const css = [];
  for (const url of references) {
    const data = await read(url, url.endsWith(".css") ? /text\/css/ : url.endsWith(".js") ? /(?:javascript|ecmascript)/ : undefined);
    assert(data.length > 0, `${url}: empty asset`);
    if (url.endsWith(".css")) {
      css.push(data.toString());
      console.log(url, data.length, crypto.createHash("sha256").update(data).digest("hex"));
    }
  }
  const combined = css.join("\n");
  assert(combined.length > 20000, "Production stylesheet is suspiciously small");
  assert(!/@(?:tailwind|apply)\b/.test(combined), "Unprocessed Tailwind/PostCSS directives");
  for (const selector of [".flex{", ".btn{", ".absolute{", "[data-theme=upscayl]"])
    assert(combined.includes(selector), `Missing generated layout/theme rule: ${selector}`);
  const fonts = [...new Set([...combined.matchAll(/url\(["']?([^)'"\s]*\/_next\/static\/[^)'"\s]+)["']?\)/g)].map(m => m[1]))];
  for (const url of fonts) await read(url);
  console.log(`Production assets OK: ${styles.length} CSS, ${scripts.length} JS, ${fonts.length} font/media URLs`);
}

if (require.main === module) {
  if (!process.argv[2]) throw new Error("Usage: node web/tests/check-production-assets.cjs <production URL | export directory>");
  checkProductionAssets(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { checkProductionAssets };
