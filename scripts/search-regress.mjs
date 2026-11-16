// Replay every logged Parts Finder / Lamp Finder question through the search in git HEAD and
// in the working copy, against the LIVE Storefront API, and list what changed.
//   cd scripts && node search-regress.mjs [limit=1000]
// Needs ../.env (SHOPIFY_* and CRM_CHATLOG_SECRET). Both versions are fed the same Shopify
// response for the same request, so Shopify's run-to-run ordering never shows up as a change:
// every difference listed is caused by the code. Read SOMETHING->NOTHING and TOP-1 CHANGED first.
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(fs.readFileSync(path.join(repo, ".env"), "utf8").split(/\r?\n/)
  .filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));
for (const k of ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_STOREFRONT_ACCESS_TOKEN", "SHOPIFY_API_VERSION"]) process.env[k] = env[k];
process.env.PORT = "0";
// Config history the server records at start-up goes to a throwaway folder, not the repo.
process.env.FINDER_DATA_DIR = fs.mkdtempSync(path.join(process.env.TEMP || process.env.TMPDIR || "/tmp", "finder-regress-"));

const realFetch = globalThis.fetch;
const logs = await (await realFetch(`https://nesh-crm.onrender.com/api/hooks/finder-chat-logs?secret=${encodeURIComponent(env.CRM_CHATLOG_SECRET)}&limit=${Number(process.argv[2]) || 1000}`)).json();

const cache = new Map();
globalThis.fetch = async (url, init) => {
  const key = `${url}|${init?.body || ""}`;
  if (!cache.has(key)) cache.set(key, (async () => { const r = await realFetch(url, init); return { ok: r.ok, status: r.status, body: await r.text() }; })());
  const c = await cache.get(key);
  return { ok: c.ok, status: c.status, json: async () => JSON.parse(c.body), text: async () => c.body };
};

// Written next to server.mjs so its own imports resolve; removed at the end.
const files = [];
const load = async (name, source) => {
  const file = path.join(repo, `.regress-${name}.mjs`);
  fs.writeFileSync(file, `${source}\nexport { getShopifyProductContext as __ctx };\n`);
  files.push(file);
  return (await import(pathToFileURL(file).href)).__ctx;
};
let oldCtx, newCtx;
try {
  oldCtx = await load("old", execSync("git show HEAD:server.mjs", { cwd: repo, encoding: "utf8", maxBuffer: 64 << 20 }));
  newCtx = await load("new", fs.readFileSync(path.join(repo, "server.mjs"), "utf8"));
} catch (e) { for (const f of files) fs.rmSync(f, { force: true }); throw e; }

const seen = new Set();
const questions = [];
for (const row of logs.rows || []) {
  const tool = row.tool === "lamp" ? "lamp" : "hvac";
  const key = `${tool}|${String(row.question || "").trim().toLowerCase()}`;
  if (!row.question?.trim() || seen.has(key)) continue;
  seen.add(key);
  questions.push([row.question, tool]);
}
const titles = (ctx) => ((ctx?.text || "").match(/^- .*?(?= \|)/gm) || []).map((t) => t.slice(2));
const out = [];
let next = 0;
const worker = async () => {
  while (next < questions.length) {
    const [q, tool] = questions[next++];
    const conv = [{ role: "user", content: q }];
    let a, b;
    try { a = titles(await oldCtx(conv, { tool })); } catch (e) { a = [`ERR ${e.message}`]; }
    try { b = titles(await newCtx(conv, { tool })); } catch (e) { b = [`ERR ${e.message}`]; }
    out.push({ q, tool, a, b });
  }
};
await Promise.all(Array.from({ length: 4 }, worker));

const diffs = out.filter((r) => JSON.stringify(r.a) !== JSON.stringify(r.b)).map((r) => ({
  kind: !r.a.length ? "nothing->something" : !r.b.length ? "SOMETHING->NOTHING" : r.a[0] !== r.b[0] ? "TOP-1 CHANGED" : "lower order/extra",
  ...r
}));
console.log(`questions ${out.length}: identical ${out.length - diffs.length}, different ${diffs.length}`);
const counts = {};
for (const d of diffs) counts[d.kind] = (counts[d.kind] || 0) + 1;
console.log(counts);
for (const d of diffs.sort((x, y) => x.kind.localeCompare(y.kind))) {
  console.log(`\n[${d.kind}] (${d.tool}) ${JSON.stringify(d.q).slice(0, 100)}\n  OLD: ${d.a.slice(0, 3).join(" ; ") || "(none)"}\n  NEW: ${d.b.slice(0, 3).join(" ; ") || "(none)"}`);
}
for (const f of files) fs.rmSync(f, { force: true });
process.exit(0);
