// Real-time stock check for the parts finders' "Check real-time stock" button.
//
// Nothing here runs unless the customer taps the button: the finder never checks
// supplier stock on its own. A tap sends the product handles the reply linked; this
// module looks each one up again in the store (never trusting the browser), asks the
// cart-automation service to read the supplier's live stock, and writes the answer
// itself. The model never writes a stock claim, and the customer never hears which
// supplier was read — only "our warehouse inventory control system".

// Products whose stock the cart service can read live (Shopify vendor field). The
// vendor stays server-side: it is never put in a reply, the model's context or the page.
const LIVE_STOCK_VENDORS = new Set(["METROPAC", "JTX", "PLI"]);
// Per tap: the most the cart service reads in one call. SCAN_LIMIT is how many product
// links a reply is read for before the ones with no live read are dropped, so a listing
// from another source never uses up a slot (Jason, 2026-11-26: a reply listed six valves
// and the button covered two of them).
const MAX_ITEMS = 5;
const SCAN_LIMIT = 10;
// No contact or call-us line in any stock answer (Jason, 2026-11-26): an out-of-stock
// reading asks for an email for a back-in-stock alert instead.

const HANDLE = /^[a-z0-9][a-z0-9-]{0,254}$/;
// Our own product pages only: the storefront, its myshopify twin, or a relative link.
const PRODUCT_LINK = /(?:https?:\/\/(?:www\.)?(?:newenglandsupplyhouse\.com|[a-z0-9-]+\.myshopify\.com)|(?:^|[\s(]))\/(?:collections\/[^/\s)]+\/)?products\/([a-z0-9][a-z0-9-]*)/gi;

// A real-time stock question. Deliberately narrower than "available": "is there one
// available for a Goodman furnace" asks whether we sell it, not whether it is on a shelf.
const STOCK_ASK = /\b(?:in[\s-]?stock|out[\s-]?of[\s-]?stock|real[\s-]?time|on[\s-]?hand|inventory|stock\s+(?:check|status|levels?|quote)|check\s+(?:the\s+)?stock|ready\s+to\s+ship|ship\s+(?:today|right\s+away|now)|(?:have|got)\s+(?:it|one|any|this|that|these|them)\s+(?:in|on)\s+(?:stock|hand)|availab\w*\s+(?:right\s+now|now|today|currently)|currently\s+availab\w*)\b/i;

export function isStockAsk(text) {
  return STOCK_ASK.test(String(text || ""));
}

export function productHandlesIn(text, limit = SCAN_LIMIT) {
  const handles = [];
  for (const match of String(text || "").matchAll(PRODUCT_LINK)) {
    const handle = match[1].toLowerCase();
    if (!handles.includes(handle)) handles.push(handle);
  }
  return handles.slice(0, limit);
}

// Told to the model only on a turn where the customer asked about stock, so a typed
// "is it in stock right now?" gets pointed at the button instead of a made-up check.
export const STOCK_BUTTON_NOTE =
  "This chat shows a \"Check real-time stock\" button under any reply that links an in-stock product page. " +
  "The customer is asking about stock. Answer from the availability in the product results, link the product page, " +
  "and tell them they can tap \"Check real-time stock\" under your reply for a live confirmation before they order. " +
  "Never say you checked live stock yourself, and never name a supplier, distributor or vendor.";

// One Storefront round-trip for up to `limit` handles.
async function lookupProducts(handles, env = process.env, limit = MAX_ITEMS) {
  const storeDomain = env.SHOPIFY_STORE_DOMAIN;
  const token = env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  const apiVersion = env.SHOPIFY_API_VERSION || "2026-01";
  const wanted = handles.filter((h) => HANDLE.test(h)).slice(0, limit);
  if (!storeDomain || !token || !wanted.length) return [];

  const fields = `handle title vendor availableForSale onlineStoreUrl
    variants(first: 10) { nodes { sku availableForSale } }`;
  const query = `query StockCheckProducts(${wanted.map((_, i) => `$h${i}: String!`).join(", ")}) {
    ${wanted.map((_, i) => `p${i}: product(handle: $h${i}) { ${fields} }`).join("\n    ")}
  }`;
  const variables = Object.fromEntries(wanted.map((h, i) => [`h${i}`, h]));

  const res = await fetch(`https://${storeDomain}/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8000)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.errors?.length) {
    throw new Error(payload?.errors?.[0]?.message || `Storefront lookup failed (${res.status})`);
  }

  return wanted.map((_, i) => payload.data?.[`p${i}`]).filter(Boolean).map((p) => {
    const variants = p.variants?.nodes || [];
    const variant = variants.find((v) => v.availableForSale && v.sku) || variants.find((v) => v.sku) || null;
    return {
      handle: p.handle,
      title: p.title,
      url: p.onlineStoreUrl || `https://newenglandsupplyhouse.com/products/${p.handle}`,
      forSale: !!p.availableForSale,
      sku: variant?.sku || "",
      live: LIVE_STOCK_VENDORS.has(String(p.vendor || "").trim().toUpperCase())
    };
  });
}

// The items a tap may check: listings we sell right now whose supplier stock can be read
// live, and only then the cap — so a listing with no live read never costs a slot.
export function offerItemsFrom(products) {
  return (products || [])
    .filter((p) => p && p.live && p.forSale && p.sku)
    .slice(0, MAX_ITEMS)
    .map((p) => ({ handle: p.handle, title: p.title }));
}

// Which products a reply should offer the button for: the ones it links, or — when the
// customer asked about stock and this reply linked nothing — the ones the previous reply
// linked. Only listings we sell right now and whose supplier stock can be read live.
export async function stockCheckOffer(conversation, reply, latestUserMessage, env = process.env) {
  let handles = productHandlesIn(reply);
  if (!handles.length && isStockAsk(latestUserMessage)) {
    const previous = [...conversation].reverse().find((m) => m && m.role === "assistant" && m.content);
    handles = productHandlesIn(previous?.content || "");
  }
  if (!handles.length) return null;
  const items = offerItemsFrom(await lookupProducts(handles, env, SCAN_LIMIT));
  return items.length ? { items } : null;
}

// ---- limits: separate from the chat's, since one tap reads a supplier's site ----
const ipTaps = new Map(); // ip -> [timestamps]
let day = { key: "", count: 0 };

// The day's cap counts items read, not taps, so it stays under the cart service's own
// daily read budget however many items a tap picks.
export function stockCheckRejection(ip, items = 1, env = process.env) {
  const perMinute = Number(env.STOCK_CHECK_PER_MIN) || 5;
  const dailyCap = env.STOCK_CHECK_DAILY_CAP !== undefined && env.STOCK_CHECK_DAILY_CAP !== ""
    ? Number(env.STOCK_CHECK_DAILY_CAP)
    : 300;
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (day.key !== today) day = { key: today, count: 0 };
  const reads = Math.max(1, Math.min(MAX_ITEMS, Number(items) || 1));
  if (day.count + reads > dailyCap) return "Live stock checks are paused for today. Please try again tomorrow.";
  const taps = (ipTaps.get(ip) || []).filter((t) => now - t < 60_000);
  if (taps.length >= perMinute) return "That's a lot of stock checks in a row — please wait a moment and try again.";
  taps.push(now);
  ipTaps.set(ip, taps);
  if (ipTaps.size > 5000) ipTaps.clear();
  day.count += reads;
  return null;
}

// ---- the check itself ----

async function askCartService(items, env) {
  const url = env.STOCK_CHECK_URL;
  const key = env.STOCK_CHECK_KEY;
  if (!url || !key) throw new Error("stock check is not configured");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Stock-Key": key },
    body: JSON.stringify({ items }),
    // Covers a supplier re-login (the service gives up on that after ~20 s) plus the reads.
    signal: AbortSignal.timeout(Number(env.STOCK_CHECK_TIMEOUT_MS) || 40000)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !Array.isArray(payload.results)) throw new Error(`stock service answered ${res.status}`);
  return payload.results;
}

function etTime(iso) {
  const at = iso ? new Date(iso) : new Date();
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }).format(at) + " ET";
}

const link = (p) => `[${String(p.title).replace(/[[\]]/g, "")}](${p.url})`;
const count = (n) => n.toLocaleString("en-US");

// Shown with every real reading so a customer about to drive over for a pickup knows a
// phone call would get the same answer. Never shown on a reading we could not get.
export const REAL_TIME_NOTE = "This is real-time inventory — the same information you'd get if you called us.";

// The order-first line every page carries, for a customer about to drive over. Only on an
// item confirmed in stock from the HVAC warehouse: lamps ship from their supplier and never
// get it (the same vendor rule as the note under Add to cart on product pages).
export const PICKUP_LINE = "**Local pickup in Foxboro:** order online first and we'll notify you when it's ready. We're a warehouse, not a walk-in store.";
const forPickup = (row) => row.state === "in_stock" && row.supplier === "metropac";
const pickupFor = (rows) => (rows.some(forPickup) ? `\n\n${PICKUP_LINE}` : "");

// An out-of-stock reading asks for an email for a back-in-stock alert. The CRM's sweep
// (nesh-crm back-in-stock.mjs) enrolls the email from the chat log, pinning the product
// by the out_of_stock SKUs in this check's log line. Keep "back in stock" in the wording:
// the sweep's sold-out text gate also looks for it.
export function alertAsk(outCount, single = false) {
  const what = single ? "it's" : outCount > 1 ? "the out-of-stock items are" : "the out-of-stock item is";
  const when = single || outCount === 1 ? "it's back in stock" : "they're back in stock";
  return `Want a heads-up when ${what} back? Reply here with your email address and we'll send one email as soon as ${when} — nothing ordered, no charge.`;
}
export const ALERT_ASK = alertAsk(1, true);

// How many of a listing the supplier can fill right now. onHand is in supplier units; a
// pack listing takes perUnit of them for each one we sell. A lamp read has no count (the
// supplier only says in or out), so this is null and the answer says "confirmed".
export function unitsAvailable(row) {
  if (row.state !== "in_stock" || typeof row.onHand !== "number" || !Number.isFinite(row.onHand)) return null;
  const perUnit = Number(row.perUnit) > 1 ? Math.floor(Number(row.perUnit)) : 1;
  const units = Math.floor(row.onHand / perUnit);
  return units >= 1 ? units : null;
}

// The customer-facing answer. Written here, never by the model, so it can only say what
// the reading said. Anything short of a positive reading of the right item is "couldn't
// confirm", never "in stock". A positive reading with a count says the count.
export function stockCheckMessage(rows) {
  const stamp = etTime(rows.map((r) => r.checkedAt).filter(Boolean).sort()[0]);
  const outCount = rows.filter((row) => row.state === "out_of_stock").length;
  const wasRead = (row) => row.state === "in_stock" || row.state === "out_of_stock";

  if (rows.length === 1) {
    const [row] = rows;
    const units = unitsAvailable(row);
    if (row.state === "in_stock" && units != null) {
      return `✅ **In stock — ${count(units)} available right now.** I just checked ${link(row)} against our warehouse inventory control system (${stamp}). ${REAL_TIME_NOTE}${pickupFor([row])}`;
    }
    if (row.state === "in_stock") {
      return `✅ **In stock — confirmed.** I just checked ${link(row)} against our warehouse inventory control system (${stamp}), and it's available for your order. ${REAL_TIME_NOTE}${pickupFor([row])}`;
    }
    if (row.state === "out_of_stock") {
      return `⚠️ I just checked ${link(row)} against our warehouse inventory control system (${stamp}), and it is **not in stock right now**. ${REAL_TIME_NOTE}\n\n${ALERT_ASK}`;
    }
    return `I couldn't get a live confirmation for ${link(row)} from our warehouse inventory control system just now. Please tap the button again in a minute.`;
  }

  const lines = rows.map((row) => {
    const units = unitsAvailable(row);
    if (row.state === "in_stock") {
      return `- ${link(row)}: ✅ **In stock — ${units != null ? `${count(units)} available right now` : "confirmed"}**`;
    }
    if (row.state === "out_of_stock") return `- ${link(row)}: ⚠️ **Not in stock right now**`;
    return `- ${link(row)}: couldn't get a live confirmation — please try again in a minute`;
  });
  const allIn = rows.every((row) => row.state === "in_stock");
  const anyUnknown = rows.some((row) => row.state === "unknown");
  const tail = allIn
    ? "They're available for your order."
    : anyUnknown ? "For anything I couldn't confirm, tap the button again in a minute." : "";
  return [
    `I checked our warehouse inventory control system just now (${stamp}):`,
    lines.join("\n"),
    [rows.some(wasRead) ? REAL_TIME_NOTE : "", tail].filter(Boolean).join(" "),
    outCount ? alertAsk(outCount) : ""
  ].filter(Boolean).join("\n\n") + pickupFor(rows);
}

// handles -> { reply, rows }. rows carry the raw readings for the internal log only.
export async function runStockCheck(handles, env = process.env) {
  const products = await lookupProducts((Array.isArray(handles) ? handles : []).map((h) => String(h).toLowerCase()), env);
  if (!products.length) {
    return {
      reply: "I couldn't find that product to check just now. Please try the check again in a minute.",
      rows: []
    };
  }

  const toAsk = products.filter((p) => p.live && p.forSale && p.sku);
  let readings = [];
  if (toAsk.length) {
    try {
      readings = await askCartService(toAsk.map((p) => ({ sku: p.sku, quantity: 1 })), env);
    } catch (error) {
      readings = toAsk.map((p) => ({ sku: p.sku, state: "unknown", reason: `service: ${error.message}` }));
    }
  }

  const rows = products.map((p) => {
    // Not for sale in our store right now: nothing to confirm, whatever a supplier holds.
    if (!p.forSale) return { ...p, state: "out_of_stock", reason: "not_for_sale_on_store" };
    if (!p.live || !p.sku) return { ...p, state: "unknown", reason: "no_live_source" };
    const reading = readings.find((r) => String(r.sku || "").toUpperCase() === p.sku.toUpperCase()) || {};
    const state = ["in_stock", "out_of_stock"].includes(reading.state) ? reading.state : "unknown";
    // We ask for quantity 1, so the service's "need" is the supplier units behind one of ours.
    const perUnit = Number(reading.need) >= 1 ? Number(reading.need) : 1;
    return {
      ...p, state, perUnit,
      onHand: typeof reading.onHand === "number" ? reading.onHand : null,
      supplier: reading.supplier || null,
      reason: reading.reason || null,
      checkedAt: reading.checkedAt || null,
      cached: !!reading.cached
    };
  });

  return { reply: stockCheckMessage(rows), rows };
}

// For the CRM log line (internal only): what each reading actually said.
export function stockCheckSummary(rows) {
  return "stock-check " + rows.map((r) =>
    `${r.sku || r.handle}=${r.state}${r.onHand != null ? `(${r.onHand}${r.perUnit > 1 ? `/${r.perUnit}` : ""})` : ""}${r.supplier ? ` ${r.supplier}` : ""}${r.reason ? ` [${r.reason}]` : ""}${r.cached ? " cached" : ""}`
  ).join(", ");
}
