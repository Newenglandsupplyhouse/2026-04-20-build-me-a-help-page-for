// Offline checks for the stock-check answer: the count a pickup customer sees, the
// real-time note, and the cases that must never claim a number. Run from scripts/:
// node stock-check-test.mjs
import assert from "node:assert/strict";
import { stockCheckMessage, stockCheckSummary, unitsAvailable, REAL_TIME_NOTE } from "../stock-check.mjs";

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
  assert.ok(msg.endsWith(REAL_TIME_NOTE), msg);
  assert.ok(!/metropac|jasper|jtx/i.test(msg), "supplier name leaked");
  ok("single item shows the live count and the real-time note");
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
  ok("no count without a reading of one");
}

// 5. Out of stock: no count, the note (so they know calling gets the same answer), then contact.
{
  const msg = stockCheckMessage([row({ state: "out_of_stock", onHand: 0 })]);
  assert.ok(msg.includes("**not in stock right now**"), msg);
  assert.ok(msg.includes(REAL_TIME_NOTE), msg);
  assert.ok(msg.indexOf(REAL_TIME_NOTE) < msg.indexOf("[contact us]"), "note comes before the contact line");
  assert.ok(!/\d+ available/.test(msg));
  ok("out of stock carries the note, never a count");
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
  ok("unknown reading has no note and no claim");
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
  assert.ok(msg.includes("[contact us]"), msg);
  ok("multi-item list with counts, one note, contact line");
}

// 9. Three items all in, one of them a lamp: "confirmed" for the lamp, "available for your order" tail.
{
  const rows = [row(), row({ sku: "ELPLP97-A", title: "Epson ELPLP97 Lamp", onHand: null, supplier: "jtx" })];
  const msg = stockCheckMessage(rows);
  assert.ok(msg.includes("Epson ELPLP97 Lamp](https://newenglandsupplyhouse.com/products/amtrol-700-30-air-vent): ✅ **In stock — confirmed**"), msg);
  assert.ok(msg.endsWith(`${REAL_TIME_NOTE} They're available for your order.`), msg);
  ok("all in stock, lamp without a count");
}

// 10. All unknown: no note at all.
{
  const rows = [row({ state: "unknown", onHand: null }), row({ sku: "2", state: "unknown", onHand: null })];
  const msg = stockCheckMessage(rows);
  assert.ok(!msg.includes(REAL_TIME_NOTE), msg);
  ok("nothing read, nothing noted");
}

// 11. The CRM log line keeps the raw supplier reading and the pack size.
{
  const line = stockCheckSummary([row({ onHand: 49, perUnit: 10 }), row({ sku: "119", onHand: 3 })]);
  assert.ok(line.includes("91=in_stock(49/10) metropac"), line);
  assert.ok(line.includes("119=in_stock(3) metropac"), line);
  ok("summary line shows raw count and pack size");
}

console.log(`\n${n} checks passed`);
