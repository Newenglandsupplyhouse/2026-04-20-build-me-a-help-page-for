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
const MAX_ITEMS = 3;
const CONTACT_URL = "https://newenglandsupplyhouse.com/pages/contact";

const HANDLE = /^[a-z0-9][a-z0-9-]{0,254}$/;
// Our own product pages only: the storefront, its myshopify twin, or a relative link.
const PRODUCT_LINK = /(?:https?:\/\/(?:www\.)?(?:newenglandsupplyhouse\.com|[a-z0-9-]+\.myshopify\.com)|(?:^|[\s(]))\/(?:collections\/[^/\s)]+\/)?products\/([a-z0-9][a-z0-9-]*)/gi;

// A real-time stock question. Deliberately narrower than "available": "is there one
// available for a Goodman furnace" asks whether we sell it, not whether it is on a shelf.
const STOCK_ASK = /\b(?:in[\s-]?stock|out[\s-]?of[\s-]?stock|real[\s-]?time|on[\s-]?hand|inventory|stock\s+(?:check|status|levels?|quote)|check\s+(?:the\s+)?stock|ready\s+to\s+ship|ship\s+(?:today|right\s+away|now)|(?:have|got)\s+(?:it|one|any|this|that|these|them)\s+(?:in|on)\s+(?:stock|hand)|availab\w*\s+(?:right\s+now|now|today|currently)|currently\s+availab\w*)\b/i;

export function isStockAsk(text) {
  return STOCK_ASK.test(String(text || ""));
}

export function productHandlesIn(text) {
  const handles = [];
  for (const match of String(text || "").matchAll(PRODUCT_LINK)) {
    const handle = match[1].toLowerCase();
    if (!handles.includes(handle)) handles.push(handle);
  }
  return handles.slice(0, MAX_ITEMS);
}

// Told to the model only on a turn where the customer asked about stock, so a typed
// "is it in stock right now?" gets pointed at the button instead of a made-up check.
export const STOCK_BUTTON_NOTE =
  "This chat shows a \"Check real-time stock\" button under any reply that links an in-stock product page. " +
  "The customer is asking about stock. Answer from the availability in the product results, link the product page, " +
  "and tell them they can tap \"Check real-time stock\" under your reply for a live confirmation before they order. " +
  "Never say you checked live stock yourself, and never name a supplier, distributor or vendor.";

// One Storefront round-trip for up to three handles.
async function lookupProducts(handles, env = process.env) {
  const storeDomain = env.SHOPIFY_STORE_DOMAIN;
  const token = env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  const apiVersion = env.SHOPIFY_API_VERSION || "2026-01";
  const wanted = handles.filter((h) => HANDLE.test(h)).slice(0, MAX_ITEMS);
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
  const products = (await lookupProducts(handles, env)).filter((p) => p.live && p.forSale && p.sku);
  if (!products.length) return null;
  return { items: products.map((p) => ({ handle: p.handle, title: p.title })) };
}

// ---- limits: separate from the chat's, since one tap reads a supplier's site ----
const ipTaps = new Map(); // ip -> [timestamps]
let day = { key: "", count: 0 };

export function stockCheckRejection(ip, env = process.env) {
  const perMinute = Number(env.STOCK_CHECK_PER_MIN) || 5;
  const dailyCap = env.STOCK_CHECK_DAILY_CAP !== undefined && env.STOCK_CHECK_DAILY_CAP !== ""
    ? Number(env.STOCK_CHECK_DAILY_CAP)
    : 300;
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  if (day.key !== today) day = { key: today, count: 0 };
  if (day.count >= dailyCap) return "Live stock checks are paused for today. Please contact us and we'll confirm availability for you.";
  const taps = (ipTaps.get(ip) || []).filter((t) => now - t < 60_000);
  if (taps.length >= perMinute) return "That's a lot of stock checks in a row — please wait a moment and try again.";
  taps.push(now);
  ipTaps.set(ip, taps);
  if (ipTaps.size > 5000) ipTaps.clear();
  day.count += 1;
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

// The customer-facing answer. Written here, never by the model, so it can only say what
// the reading said. Anything short of a positive reading of the right item is "couldn't
// confirm", never "in stock".
export function stockCheckMessage(rows) {
  const stamp = etTime(rows.map((r) => r.checkedAt).filter(Boolean).sort()[0]);
  const contact = `[contact us](${CONTACT_URL})`;

  if (rows.length === 1) {
    const [row] = rows;
    if (row.state === "in_stock") {
      return `✅ **In stock — confirmed.** I just checked ${link(row)} against our warehouse inventory control system (${stamp}), and it's available for your order.`;
    }
    if (row.state === "out_of_stock") {
      return `⚠️ I just checked ${link(row)} against our warehouse inventory control system (${stamp}), and it is **not in stock right now**. Please ${contact} and we'll get you a lead time or a matching part before you order.`;
    }
    return `I couldn't get a live confirmation for ${link(row)} from our warehouse inventory control system just now. Please tap the button again in a minute, or ${contact} and we'll confirm it for you.`;
  }

  const lines = rows.map((row) => {
    if (row.state === "in_stock") return `- ${link(row)}: ✅ **In stock — confirmed**`;
    if (row.state === "out_of_stock") return `- ${link(row)}: ⚠️ **Not in stock right now**`;
    return `- ${link(row)}: couldn't get a live confirmation — please try again in a minute`;
  });
  const allIn = rows.every((row) => row.state === "in_stock");
  return [
    `I checked our warehouse inventory control system just now (${stamp}):`,
    lines.join("\n"),
    allIn
      ? "They're available for your order."
      : `For anything not confirmed, please ${contact} and we'll get you a lead time or confirm it for you.`
  ].join("\n\n");
}

// handles -> { reply, rows }. rows carry the raw readings for the internal log only.
export async function runStockCheck(handles, env = process.env) {
  const products = await lookupProducts((Array.isArray(handles) ? handles : []).map((h) => String(h).toLowerCase()), env);
  if (!products.length) {
    return {
      reply: `I couldn't find that product to check. Please [contact us](${CONTACT_URL}) and we'll confirm availability for you.`,
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
    return { ...p, state, onHand: reading.onHand ?? null, supplier: reading.supplier || null, reason: reading.reason || null, checkedAt: reading.checkedAt || null, cached: !!reading.cached };
  });

  return { reply: stockCheckMessage(rows), rows };
}

// For the CRM log line (internal only): what each reading actually said.
export function stockCheckSummary(rows) {
  return "stock-check " + rows.map((r) =>
    `${r.sku || r.handle}=${r.state}${r.onHand != null ? `(${r.onHand})` : ""}${r.supplier ? ` ${r.supplier}` : ""}${r.reason ? ` [${r.reason}]` : ""}${r.cached ? " cached" : ""}`
  ).join(", ");
}
