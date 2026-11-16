// Offline checks for link-reader.mjs (run from scripts/): which links are read, which
// addresses are refused, and what is taken from a product page. One live check at the end
// reads a page that serves servers (skipped with --offline).
import http from "node:http";
import { linksIn, isPublicAddress, readProductPage, readCustomerLinks } from "../link-reader.mjs";

let fail = 0;
const check = (ok, label, got) => { if (!ok) fail += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `  -> ${JSON.stringify(got)}`}`); };

// Which links count
const hrefs = (t) => linksIn(t).map((u) => u.href);
check(hrefs("https://newenglandsupplyhouse.com/products/x").length === 0, "own store link is not fetched");
check(hrefs("see https://www.repairclinic.com/PartDetail/4962053.").join() === "https://www.repairclinic.com/PartDetail/4962053", "trailing period dropped", hrefs("see https://www.repairclinic.com/PartDetail/4962053."));
check(hrefs("www.grainger.com/product/X-3UC35").join() === "https://www.grainger.com/product/X-3UC35", "www. link without scheme");
check(hrefs("a https://a.com/1 b https://b.com/2 c https://c.com/3").length === 2, "at most two links per message");
check(hrefs("vent rite no1").length === 0, "no link, nothing to fetch");

// Addresses the server must never be pointed at
for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "224.0.0.1"]) {
  check(!isPublicAddress(ip), `refuses ${ip}`);
}
for (const ip of ["8.8.8.8", "104.18.2.3", "2606:4700::1111"]) check(isPublicAddress(ip), `allows ${ip}`);

// A local server: a link to it (by name or by address) must not be read
const server = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<title>Secret admin page</title>"); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
for (const url of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`, "http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://localtest.me/", "http://127.0.0.1.nip.io/"]) {
  const got = await readCustomerLinks(url, { apiKey: "" });
  check(got.length === 0, `does not read ${url}`, got);
}
server.close();

// What is taken from a page
const ld = `<html><head><title>Taco 007-F5 Cast Iron Circulator Pump, 115V - PexUniverse</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"007 Circulator Pump, 1\/25 HP, 115V","mpn":"007-F5","sku":"007-F5","brand":{"@type":"Brand","name":"Taco"}}</script></head></html>`;
const p1 = readProductPage(ld, "www.pexuniverse.com");
check(p1?.partNumber === "007-F5" && p1?.name === "007 Circulator Pump, 1/25 HP, 115V" && p1?.brand === "Taco", "JSON-LD product: name, mpn, brand", p1);
const graph = `<title>x</title><script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":["Product"],"name":"Hot Surface Igniter","model":"Q3400A1024","sku":"3UC35"}]}</script>`;
const p2 = readProductPage(graph, "www.grainger.com");
check(p2?.partNumber === "Q3400A1024", "product inside @graph; model, not the site's item number", p2);
const titleOnly = readProductPage("<title>Honeywell Q3400A1024 Igniter | Acme Supply</title>", "www.acmesupply.com");
check(titleOnly?.name === "Honeywell Q3400A1024 Igniter" && titleOnly?.partNumber === "", "title only, site name removed", titleOnly);
for (const t of ["Just a moment...", "Access Denied", "Page Not Found", "404 - Not Found", "Whoops, we couldn't find that.", "Attention Required! | Cloudflare"]) {
  check(readProductPage(`<title>${t}</title>`, "x.com") === null, `block/dead page ignored: ${t}`);
}
check(readProductPage("<title>Honeywell 4040 Valve</title>", "x.com")?.name === "Honeywell 4040 Valve", "a 404-like number inside a product title is fine");

if (!process.argv.includes("--offline")) {
  const live = await readCustomerLinks("https://www.pexuniverse.com/taco-007-f5-circulator-pump", { apiKey: "" });
  check(live[0]?.partNumber === "007-F5" && live[0]?.source === "page", "LIVE: reads a page that serves servers", live);
}
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
