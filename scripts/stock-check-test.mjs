// Offline checks for the stock-check answer: the count a pickup customer sees, the
// real-time note, and the cases that must never claim a number. Run from scripts/:
// node stock-check-test.mjs
import assert from "node:assert/strict";
import {
  stockCheckMessage, stockCheckSummary, unitsAvailable, productHandlesIn, offerItemsFrom, stockCheckRejection,
  REAL_TIME_NOTE, PICKUP_LINE, ALERT_ASK
} from "../stock-check.mjs";

// No reply may offer a call or a contact page (Jason, 2026-11-26). The real-time note
// itself says "if you called us", so it is taken out before looking.
const offersContact = (msg) => /contact|\bcall\b|phone/i.test(msg.split(REAL_TIME_NOTE).join(""));

let n = 0;
const ok = (name) => { n += 1; console.log(`ok ${n} - ${name}`); };
const at = "2026-11-26T15:42:00.000Z"; // 10:42 AM ET
const row = (over = {}) => ({
  handle: "amtrol-700-30-air-vent", title: "Amtrol 700-30 Air Vent",
  url: `https://newenglandsupplyhouse.com/products/${over.handle || "amtrol-700-30-air-vent"}`,
  sku: "91", state: "in_stock", onHand: 49, perUnit: 1, supplier: "metropac", checkedAt: at, ...over
});

// 1. A plain HVAC item: the supplier's count, the time, the note.
{
  const msg = stockCheckMessage([row()]);
  assert.ok(msg.startsWith("✅ **In stock — 49 available right now.**"), msg);
  assert.ok(msg.includes("(10:42 AM ET)"), msg);
  assert.ok(msg.includes(REAL_TIME_NOTE), msg);
  assert.ok(msg.endsWith(`${REAL_TIME_NOTE}\n\n${PICKUP_LINE}`), msg);
  assert.ok(!/metropac|jasper|jtx/i.test(msg), "supplier name leaked");
  ok("single item shows the live count, the real-time note, then the order-first pickup line");
}

// 2. Exactly one left still reads as a count, and big counts get a thousands separator.
{
  assert.ok(stockCheckMessage([row({ onHand: 1 })]).startsWith("✅ **In stock — 1 available right now.**"));
  assert.ok(stockCheckMessage([row({ onHand: 1250 })]).startsWith("✅ **In stock — 1,250 available right now.**"));
  ok("count formatting");
}

// 3. A pack listing: 49 supplier units at 10 per pack is 4 packs, not 49.
{
  assert.equal(unitsAvailable(row({ onHand: 49, perUnit: 10 })), 4);
  assert.ok(stockCheckMessage([row({ onHand: 49, perUnit: 10 })]).startsWith("✅ **In stock — 4 available right now.**"));
  ok("pack size divides the supplier count");
}

// 4. A lamp read has no count (the supplier only says in or out): "confirmed", still noted.
{
  const lamp = row({ handle: "elplp97-a", title: "Epson ELPLP97 Lamp", sku: "ELPLP97-A", onHand: null, supplier: "jtx" });
  assert.equal(unitsAvailable(lamp), null);
  const msg = stockCheckMessage([lamp]);
  assert.ok(msg.startsWith("✅ **In stock — confirmed.**"), msg);
  assert.ok(!/\d+ available/.test(msg), "invented a count");
  assert.ok(msg.endsWith(REAL_TIME_NOTE), msg);
  assert.ok(!msg.includes(PICKUP_LINE), "a lamp ships from the supplier; no pickup line");
  ok("no count without a reading of one, and no pickup line on a lamp");
}

// 5. Out of stock: no count, the note (so they know calling gets the same answer), then contact.
{
  const msg = stockCheckMessage([row({ state: "out_of_stock", onHand: 0 })]);
  assert.ok(msg.includes("**not in stock right now**"), msg);
  assert.ok(msg.includes(REAL_TIME_NOTE), msg);
  assert.ok(!offersContact(msg), msg);
  assert.ok(msg.endsWith(`${REAL_TIME_NOTE}\n\n${ALERT_ASK}`), msg);
  assert.ok(ALERT_ASK.includes("back in stock"), "the CRM sweep's text gate looks for this phrase");
  assert.ok(!/\d+ available/.test(msg));
  assert.ok(!msg.includes(PICKUP_LINE), "nothing to pick up");
  ok("out of stock: note, then the email ask for a stock alert; no count, no pickup line, no contact");
}

// 6. Not enough on hand for a pack reads as out of stock from the service; we never show the partial count.
{
  const msg = stockCheckMessage([row({ state: "out_of_stock", onHand: 5, perUnit: 10 })]);
  assert.ok(msg.includes("**not in stock right now**"), msg);
  assert.ok(!msg.includes("5"), msg);
  ok("partial pack count stays internal");
}

// 7. Couldn't read: no note, because nothing real-time was learned.
{
  const msg = stockCheckMessage([row({ state: "unknown", onHand: null, reason: "busy", checkedAt: null })]);
  assert.ok(msg.startsWith("I couldn't get a live confirmation"), msg);
  assert.ok(!msg.includes(REAL_TIME_NOTE), msg);
  assert.ok(!/in stock/i.test(msg));
  assert.ok(!offersContact(msg), msg);
  assert.ok(!msg.includes("email"), "no alert ask on a failed read");
  ok("unknown reading has no note, no claim, no contact, no email ask");
}

// 8. Three items: counts per line, one note for the lot, contact line when any is short.
{
  const rows = [
    row(),
    row({ handle: "barnes-jones-122a-steam-radiator-trap", title: "Barnes & Jones 122A Steam Radiator Trap", sku: "119", onHand: 3 }),
    row({ handle: "x", title: "Something Out", sku: "1", state: "out_of_stock", onHand: 0 })
  ];
  const msg = stockCheckMessage(rows);
  assert.ok(msg.includes("- [Amtrol 700-30 Air Vent](https://newenglandsupplyhouse.com/products/amtrol-700-30-air-vent): ✅ **In stock — 49 available right now**"), msg);
  assert.ok(msg.includes("Steam Radiator Trap](https://newenglandsupplyhouse.com/products/barnes-jones-122a-steam-radiator-trap): ✅ **In stock — 3 available right now**"), msg);
  assert.ok(msg.includes("- [Something Out](https://newenglandsupplyhouse.com/products/x): ⚠️ **Not in stock right now**"), msg);
  assert.equal(msg.split(REAL_TIME_NOTE).length, 2, "note exactly once");
  assert.ok(!offersContact(msg), msg);
  assert.ok(msg.includes("\n\nWant a heads-up when the out-of-stock item is back? Reply here with your email address and we'll send one email as soon as it's back in stock — nothing ordered, no charge.\n\n"), msg);
  assert.ok(msg.endsWith(`\n\n${PICKUP_LINE}`), msg);
  assert.equal(msg.split(PICKUP_LINE).length, 2, "pickup line exactly once");
  ok("multi-item list with counts, one note, email ask for the out-of-stock item, pickup line last");
}

// 8b. Two out of stock and one unreadable: plural email ask, retry line, no pickup line.
{
  const rows = [
    row({ sku: "1", title: "Out One", handle: "out-one", state: "out_of_stock", onHand: 0 }),
    row({ sku: "2", title: "Out Two", handle: "out-two", state: "out_of_stock", onHand: 0 }),
    row({ sku: "3", title: "Unknown Three", handle: "unknown-three", state: "unknown", onHand: null, reason: "busy", checkedAt: null })
  ];
  const msg = stockCheckMessage(rows);
  assert.ok(msg.includes(`${REAL_TIME_NOTE} For anything I couldn't confirm, tap the button again in a minute.`), msg);
  assert.ok(msg.endsWith("Want a heads-up when the out-of-stock items are back? Reply here with your email address and we'll send one email as soon as they're back in stock — nothing ordered, no charge."), msg);
  assert.ok(!offersContact(msg), msg);
  assert.ok(!msg.includes(PICKUP_LINE), msg);
  ok("two out + one unknown: plural email ask last, retry line, no pickup line, no contact");
}

// 9. Three items all in, one of them a lamp: "confirmed" for the lamp, "available for your order" tail.
{
  const rows = [row(), row({ sku: "ELPLP97-A", title: "Epson ELPLP97 Lamp", onHand: null, supplier: "jtx" })];
  const msg = stockCheckMessage(rows);
  assert.ok(msg.includes("Epson ELPLP97 Lamp](https://newenglandsupplyhouse.com/products/amtrol-700-30-air-vent): ✅ **In stock — confirmed**"), msg);
  assert.ok(msg.endsWith(`${REAL_TIME_NOTE} They're available for your order.\n\n${PICKUP_LINE}`), msg);
  ok("all in stock, lamp without a count, pickup line for the HVAC item");
}

// 9b. Lamps only: confirmed, noted, but no pickup line (they ship from the supplier).
{
  const rows = [
    row({ sku: "ELPLP97-A", title: "Epson ELPLP97 Lamp", onHand: null, supplier: "jtx" }),
    row({ sku: "ELPLP96", title: "Epson ELPLP96 Lamp", onHand: null, supplier: "jtx" })
  ];
  const msg = stockCheckMessage(rows);
  assert.ok(msg.endsWith(`${REAL_TIME_NOTE} They're available for your order.`), msg);
  assert.ok(!msg.includes(PICKUP_LINE), msg);
  ok("lamps only: no pickup line");
}

// 10. All unknown: no note at all.
{
  const rows = [row({ state: "unknown", onHand: null }), row({ sku: "2", state: "unknown", onHand: null })];
  const msg = stockCheckMessage(rows);
  assert.ok(!msg.includes(REAL_TIME_NOTE), msg);
  assert.ok(!msg.includes(PICKUP_LINE), msg);
  ok("nothing read, nothing noted");
}

// 11. The CRM log line keeps the raw supplier reading and the pack size.
{
  const line = stockCheckSummary([row({ onHand: 49, perUnit: 10 }), row({ sku: "119", onHand: 3 })]);
  assert.ok(line.includes("91=in_stock(49/10) metropac"), line);
  assert.ok(line.includes("119=in_stock(3) metropac"), line);
  ok("summary line shows raw count and pack size");
}

// 12. A reply is read for up to ten product links, in order, without repeats.
{
  const reply = Array.from({ length: 12 }, (_, i) => `- Item ${i}: https://newenglandsupplyhouse.com/products/item-${i}`).join("\n")
    + "\nAgain: https://newenglandsupplyhouse.com/products/item-0";
  const handles = productHandlesIn(reply);
  assert.equal(handles.length, 10);
  assert.equal(handles[0], "item-0");
  assert.equal(handles[9], "item-9");
  ok("a reply is read for up to ten product links");
}

// 13. The offer filters first and caps second: a listing with no live read costs no slot.
{
  const live = (i) => ({ handle: `live-${i}`, title: `Live ${i}`, live: true, forSale: true, sku: `L${i}` });
  const products = [
    { handle: "other-source", title: "Other Source Valve", live: false, forSale: true, sku: "X1" },
    live(1), live(2),
    { handle: "sold-out", title: "Sold Out", live: true, forSale: false, sku: "S1" },
    live(3), live(4), live(5), live(6)
  ];
  const items = offerItemsFrom(products);
  assert.deepEqual(items.map((i) => i.handle), ["live-1", "live-2", "live-3", "live-4", "live-5"]);
  assert.deepEqual(items[0], { handle: "live-1", title: "Live 1" });
  assert.equal(offerItemsFrom([products[0], products[3]]).length, 0);
  ok("offer = live-readable and for sale first, then capped at five");
}

// 14. The day's cap counts items read, not taps; the cap message offers no contact.
{
  const env = { STOCK_CHECK_PER_MIN: "50", STOCK_CHECK_DAILY_CAP: "7" };
  assert.equal(stockCheckRejection("ip-a", 5, env), null);
  assert.equal(stockCheckRejection("ip-b", 2, env), null);
  const rejected = stockCheckRejection("ip-c", 1, env) || "";
  assert.match(rejected, /paused for today/);
  assert.ok(!/contact|\bcall\b/i.test(rejected), rejected);
  ok("daily cap counts items; the cap message offers no contact");
}

console.log(`\n${n} checks passed`);
