// Offline test: fake Storefront API that matches the way Shopify does (whole words, ANDed;
// a dashed number is indexed by its pieces and by its squeezed form).
import fs from "node:fs";
const src = process.argv[2];
const tmp = src.replace(/server\.mjs$/, `.search-test-${process.pid}.mjs`);
fs.writeFileSync(tmp, fs.readFileSync(src, "utf8") + "\nexport { getShopifyProductContext as __ctx, codeFormatVariants as __variants };\n");
const P = (title, sku, extra = {}) => ({ id: title, title, handle: title.toLowerCase().replace(/[^a-z0-9]+/g, "-"), tags: extra.tags || [], availableForSale: true,
  description: extra.description || "", onlineStoreUrl: "https://newenglandsupplyhouse.com/products/x", priceRange: { minVariantPrice: { amount: "10.0", currencyCode: "USD" } },
  variants: { nodes: [{ title: "Default", availableForSale: true, sku, price: { amount: "10.0", currencyCode: "USD" } }] } });
const CATALOG = [
  P("Honeywell TB6575A1000 Fan Coil Thermostat", "118060"),
  P("York S1-026-34637-000 Vent Motor Assembly, 230V 3350 RPM", "S1-026-34637-000"),
  P("York S1-031-02985-000 Control Board", "S1-031-02985-000"),
  P("ASCO 8210G095 Solenoid Valve, 3/4\", 24V", "8210G095"),
  P("Honeywell Q3400A1024 Pilot Burner Igniter Flame Rod Assembly", "2405"),
  P("Honeywell Q3400A1016 Ignitor Flame Rod Assembly", "2406"),
  P("Honeywell 395466 Test Lead Kit, SV9500", "395466"),
  P("Rheem 62-102635-81 Integrated Gas Furnace Control Board", "62-102635-81"),
  P("InFocus SP-LAMP-024 Replacement Projector Lamp", "SP-LAMP-024"),
  P("Epson ELPLP43 Replacement Projector Lamp for MovieMate 72", "ELPLP43"),
  P("York S1-5952759 Blower Motor, 1 HP 230V", "S1-5952759", { description: "Programmed blower motor for the XN/ZE048 motor platform." }),
  P("Goodman 0131F00041S Blower Motor, 1/3 HP", "0131F00041S"),
  P("Trane MOT18960 Blower Motor, 1/8 HP", "MOT18960"),
  P("Nordyne 626602 Limit Switch", "626602"),
  P("Weil Mclain 382-200-750 Maintenance Kit, GV90+", "382-200-750"),
  P("Rheem SP20305A Water Heater Gas Valve GG40T06AVG01", "SP20305A"),
];
const index = (p) => { const toks = new Set(); for (const f of [p.title, p.variants.nodes[0].sku, ...p.tags, p.description]) for (const w of String(f).toLowerCase().split(/\s+/)) { const c = w.replace(/^[^a-z0-9]+|[^a-z0-9+]+$/g, ""); if (!c) continue; toks.add(c.replace(/[^a-z0-9]/g, "")); for (const piece of c.split(/[^a-z0-9]+/)) if (piece) toks.add(piece); } return toks; };
const IDX = CATALOG.map((p) => [p, index(p)]);
const search = (q) => { const terms = String(q).toLowerCase().split(/\s+/).filter(Boolean); return IDX.filter(([, toks]) => terms.every((t) => { if (t.endsWith("*")) { const pre = t.slice(0, -1).replace(/[^a-z0-9]/g, ""); return [...toks].some((k) => k.startsWith(pre)); } return t.split(/[^a-z0-9]+/).filter(Boolean).every((piece) => toks.has(piece)); })).map(([p]) => p); };
globalThis.fetch = async (url, init) => { const { query, variables } = JSON.parse(init.body); const nodes = search(variables.query); return { ok: true, json: async () => ({ data: query.includes("HelpPageSiteSearch") ? { search: { nodes } } : { products: { nodes } } }) }; };
process.env.SHOPIFY_STORE_DOMAIN = "fake.example"; process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN = "x"; process.env.PORT = "0";
const mod = await import(tmp);
const CASES = [
  ["TB6575A 1000", "hvac", "tb6575a1000"],
  ["do you have a honeywell TB6575A 1000 thermostat", "hvac", "tb6575a1000"],
  ["S1-02634637000", "hvac", "s1-026-34637-000"],
  ["02634637000", "hvac", "s1-026-34637-000"],
  ["Part #S1-02634637000", "hvac", "s1-026-34637-000"],
  ["026 34637 000", "hvac", "s1-026-34637-000"],
  ["03102985000", "hvac", "s1-031-02985-000"],
  ["821OG095", "hvac", "8210g095"],
  ["GG40TO6AVG01", "hvac", "gg40t06avg01"],
  ["Q3400A-1024", "hvac", "q3400a1024"],
  ["Q3400A 1024", "hvac", "q3400a1024"],
  ["62-102635-81", "hvac", "62-102635-81"],
  ["626602R", "hvac", "626602"],
  ["gv90+", "hvac", "gv90"],
  ["ze048 ventor motor", "hvac", "s1-5952759"],
  // must NOT show anything
  ["024 36873 207", "hvac", null],
  ["S1-02435806000", "hvac", null],
  ["SV9500M 2682", "hvac", null],
  ["Q3400A 1040", "hvac", null],
  ["JA1M146NS", "hvac", null],
  ["ELPLP 72", "hvac", null],
  // unit model + kind of part: keep parts of that kind, with the warning note
  ["blower motor for YP9C060B12MP12CA", "hvac", "blower motor", "no listing names"],
  ["Goodman 0131F00041S 240 volt", "hvac", "0131f00041s"],
  ["I need 2 Nordyne 626602", "hvac", "626602"],
  ["HONQ3400A1024", "hvac", "q3400a1024"],
  ["Q3400A1024/U", "hvac", "q3400a1024"],
  ["blower motor", "hvac", "blower motor"],
  ["Model: TB6575A1000", "hvac", "tb6575a1000"],
  ["0131F00041S and MOT18960", "hvac", "0131f00041s"],
  // lamp finder unchanged
  ["SP-LAMP-024", "lamp", "sp-lamp-024"],
];
let fail = 0;
for (const [msg, tool, want, mustSay] of CASES) {
  const ctx = await mod.__ctx([{ role: "user", content: msg }], { tool });
  const titles = (ctx.text.match(/^- .*?(?= \|)/gm) || []).map((t) => t.slice(2));
  const ok = want === null ? titles.length === 0 : titles.length > 0 && titles[0].toLowerCase().includes(want) && (!mustSay || ctx.text.toLowerCase().includes(mustSay));
  if (!ok) fail += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  [${tool}] ${msg.padEnd(48)} -> ${titles.length ? titles.slice(0, 2).join(" ; ") + (titles.length > 2 ? ` (+${titles.length - 2})` : "") : "(nothing shown)"}`);
}
console.log(fail ? `${fail} FAILED` : "ALL PASS");
fs.unlinkSync(tmp); process.exit(fail ? 1 : 0);
