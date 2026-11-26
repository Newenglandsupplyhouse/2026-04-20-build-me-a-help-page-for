// Offline checks for link-gate.mjs, built from real finder replies whose links were 404s
// (chat log 2026-10-07 .. 11-25). Run from scripts/: node link-gate-test.mjs
import assert from "node:assert/strict";
import { gateProductLinks, storeLinksIn, closestHandle, REMOVED_LINK_NOTE } from "../link-gate.mjs";
import { withoutAttachmentWords, photoSearchText, photoContextNote, photoLogNote, PHOTO_ONLY_TEXT } from "../photo-reader.mjs";

const SITE = "https://newenglandsupplyhouse.com/products/";
const lookupFrom = (live) => async (handles) => new Set(handles.filter((h) => live.includes(h)));
let n = 0;
const ok = (name) => { n += 1; console.log(`ok ${n} - ${name}`); };

// 1. Armstrong R36447B006, 2026-11-25: read off a screenshot, never listed. Taken out, note added.
{
  const reply = `Yes — that screenshot shows the Armstrong Air Pilot Assembly, model R36447B006 (SKU R36447B006). The page in your photo lists the price as $121.66 each.\n\nProduct page: ${SITE}pilot-assembly-r36447b006`;
  const r = await gateProductLinks(reply, { trusted: ["honeywell-idp-photo-w-plug-in-detector"], lookup: lookupFrom([]) });
  assert.deepEqual(r.removed, ["pilot-assembly-r36447b006"]);
  assert.ok(!r.reply.includes("/products/"));
  assert.ok(!r.reply.includes("Product page:"));
  assert.ok(r.reply.endsWith(REMOVED_LINK_NOTE));
  ok("invented R36447B006 link removed with its label line");
}

// 2. Q3400A1024, 2026-10-08: "-rod" dropped. Pointed at the real listing.
{
  const real = "resideo-honeywell-home-q3400a1024-pilot-burner-igniter-flame-rod-assembly";
  const reply = `Honeywell Q3400A1024 — $103.43\nProduct page: ${SITE}resideo-honeywell-home-q3400a1024-pilot-burner-igniter-flame-assembly`;
  const r = await gateProductLinks(reply, { trusted: [real], lookup: lookupFrom([real]) });
  assert.deepEqual(r.repaired, [{ from: "resideo-honeywell-home-q3400a1024-pilot-burner-igniter-flame-assembly", to: real }]);
  assert.ok(r.reply.includes(`${SITE}${real}`));
  assert.ok(!r.reply.includes(REMOVED_LINK_NOTE));
  ok("Q3400A1024 missing -rod repaired");
}

// 3. Epson 8350 lamp: "epson-" dropped; two real listings share the words, the closer one wins.
{
  const a = "epson-home-cinema-8350-replacement-projector-lamp-with-original-osram-bulb-and-housing";
  const b = "epson-powerlite-home-cinema-8350-replacement-projector-lamp-with-original-osram-bulb-and-housing";
  assert.equal(closestHandle("home-cinema-8350-replacement-projector-lamp-with-original-osram-bulb-and-housing", [b, a, "home-cinema-8350-lamp"]), a);
  ok("Epson 8350 missing prefix repaired to the closest listing");
}

// 4. Q313A1188: "-home" dropped; the number must match exactly (not Q313A1055).
{
  const real = ["resideo-honeywell-home-q313a1188-thermopile-generator", "resideo-honeywell-home-q313a1055-thermopile-generator"];
  assert.equal(closestHandle("resideo-honeywell-q313a1188-thermopile-generator", real), real[0]);
  assert.equal(closestHandle("resideo-honeywell-q313a1055-thermopile-generator", real), real[1]);
  ok("Q313A thermopiles repaired by exact number");
}

// 5. Toshiba TLP-X200: no listing has the word "x200" (wx200 / x2000 are other projectors). Removed.
{
  const pool = ["tlp-wx200-lamp-a", "tlp-x2000u-lamp-a", "tlp-x2000-lamp"];
  assert.equal(closestHandle("tlp-x200-lamp", pool), null);
  const r = await gateProductLinks(`Lamp for TLP-X200 — In stock: Yes\n- Product page: ${SITE}tlp-x200-lamp\nPlease confirm the part number.`, { trusted: pool, lookup: lookupFrom([]) });
  assert.deepEqual(r.removed, ["tlp-x200-lamp"]);
  assert.ok(r.reply.includes("Please confirm the part number."));
  ok("TLP-X200 not repaired to a different projector's lamp");
}

// 6. Links to products the search returned are never looked up; real ones not in the list are kept.
{
  let asked = null;
  const r = await gateProductLinks(`See ${SITE}goodman-0131m00002psp-furnace-inducer-motor and ${SITE}beckett-af35.`, {
    trusted: ["goodman-0131m00002psp-furnace-inducer-motor"],
    lookup: async (h) => { asked = h; return new Set(h); }
  });
  assert.deepEqual(asked, ["beckett-af35"]);
  assert.equal(r.reply, `See ${SITE}goodman-0131m00002psp-furnace-inducer-motor and ${SITE}beckett-af35.`);
  ok("trusted links skip the lookup, live links kept untouched");
}

// 7. Markdown link keeps its label; other sites' /products/ paths are not ours.
{
  const reply = `Try the [Pilot Assembly](${SITE}pilot-assembly-r36447b006) — or see ([nwfsupply.com](https://nwfsupply.com/collections/johnson-controls/products/36j24-206-york-luxaire-coleman-gas-valve)).`;
  assert.deepEqual(storeLinksIn(reply).map((l) => l.handle), ["pilot-assembly-r36447b006"]);
  const r = await gateProductLinks(reply, { lookup: lookupFrom([]) });
  assert.ok(r.reply.startsWith("Try the Pilot Assembly — or see"));
  assert.ok(r.reply.includes("nwfsupply.com/collections/johnson-controls/products/36j24-206"));
  ok("markdown label kept, other sites ignored");
}

// 8. A lookup outage leaves the reply alone.
{
  const reply = `Product page: ${SITE}something-q3400a1024`;
  const r = await gateProductLinks(reply, { lookup: async () => { throw new Error("down"); } });
  assert.equal(r.reply, reply);
  assert.equal(r.lookupFailed, true);
  ok("lookup failure fails open");
}

// 9. Relative links, query strings and a sentence-final full stop.
{
  const r = await gateProductLinks(`Order it here: /products/fake-abc123?variant=1. Thanks!`, { lookup: lookupFrom([]) });
  assert.ok(!r.reply.includes("/products/"));
  assert.ok(r.reply.includes("Thanks!"));
  assert.deepEqual(storeLinksIn(`${SITE}beckett-af35.`).map((l) => l.url), [`${SITE}beckett-af35`]);
  ok("relative link with query removed; trailing full stop not part of the URL");
}

// 10. Photo turns: the default photo text searches nothing; the photo's words are searched instead.
{
  assert.equal(withoutAttachmentWords(PHOTO_ONLY_TEXT), "");
  assert.equal(withoutAttachmentWords("It is this one"), "");
  assert.equal(withoutAttachmentWords("here's a picture of the blower motor"), "a of the blower motor");
  const read = { ok: true, brand: "Goodman", partType: "inducer motor", numbers: ["0131M00002P", "119276-00"], webPage: false, site: "" };
  assert.equal(photoSearchText(PHOTO_ONLY_TEXT, read), "Goodman inducer motor 0131M00002P 119276-00");
  assert.equal(photoSearchText(PHOTO_ONLY_TEXT, { ok: false, brand: "", partType: "", numbers: [], webPage: false, site: "" }), "");
  assert.equal(photoLogNote(read), "[photo reads: Goodman inducer motor 0131M00002P 119276-00] ");
  const shot = { ok: true, brand: "Armstrong Air", partType: "pilot assembly", numbers: ["R36447B006"], webPage: true, site: "" };
  assert.match(photoContextNote(shot), /NOT one of our listings/);
  assert.match(photoLogNote(shot), /screenshot of a web page/);
  ok("photo search text, model note and log note");
}

console.log(`\nall ${n} passed`);
