// Every product link in a finder reply must open a real product page.
//
// The model writes each URL itself, retyping the handle from the product results, and it
// sometimes gets one wrong. In the chat log (2026-10-07 to 11-25) it dropped "-rod" from the
// Q3400A1024 listing (3 chats), dropped "epson-" from the Home Cinema 8350 lamp (3 chats),
// dropped "-home" from two Q313A thermopiles, linked a "tlp-x200-lamp" that has never existed,
// and on 2026-11-25 built a link for an Armstrong R36447B006 we have never listed, read off a
// screenshot of another site's page. Each of those was a 404 for the customer.
//
// This runs on the finished reply. A link to a product the search handed the model is kept.
// Any other is looked up; one that does not exist is pointed at the listing it was plainly
// meant to be (same part number, nearly the same words), or taken out.

// Our product pages: the storefront, its myshopify twin, or a relative "/products/..." link.
// A path on another site ("nwfsupply.com/collections/x/products/y") is not ours: the "/" there
// follows a letter, which the relative form refuses.
const STORE_LINK = /(?:https?:\/\/(?:www\.)?(?:newenglandsupplyhouse\.com|[a-z0-9-]+\.myshopify\.com)|(?<![\w/.:%-])(?=\/))(?:\/collections\/[a-z0-9][a-z0-9-]*)?\/products\/([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])(?:[?#][^\s)\]<>"'`]*)?/gi;
const HANDLE = /^[a-z0-9][a-z0-9-]{0,254}$/;
const MAX_LOOKUPS = 12;
const MAX_SEARCHES = 6;
const MIN_LIKENESS = 0.75;

export const REMOVED_LINK_NOTE =
  "I couldn't confirm a product page on our site for that, so I left the link out. Send me the part number printed on your part and I'll check what we carry.";

export function storeLinksIn(text) {
  return [...String(text || "").matchAll(STORE_LINK)].map((m) => ({ url: m[0], handle: m[1].toLowerCase(), index: m.index }));
}

const words = (handle) => handle.split("-").filter(Boolean);
const isCode = (word) => /\d/.test(word);

// The real handle a broken one was meant to be: every part number in it must be a whole word
// of the candidate, and the two must share at least MIN_LIKENESS of their words. A tie is no
// answer. A handle with no part number in it is never repaired; its words say too little.
export function closestHandle(bad, candidates) {
  const badWords = new Set(words(bad));
  const codes = [...badWords].filter(isCode);
  if (!codes.length) return null;
  const scored = [];
  for (const candidate of new Set(candidates)) {
    if (!candidate || candidate === bad) continue;
    const own = new Set(words(candidate));
    if (!codes.every((code) => own.has(code))) continue;
    const shared = [...badWords].filter((w) => own.has(w)).length;
    const likeness = shared / new Set([...badWords, ...own]).size;
    if (likeness >= MIN_LIKENESS) scored.push({ candidate, likeness });
  }
  scored.sort((a, b) => b.likeness - a.likeness);
  if (!scored.length || (scored[1] && scored[1].likeness === scored[0].likeness)) return null;
  return scored[0].candidate;
}

// Take a link out of the reply: "[label](url)" keeps its label; a line that is only a label
// and the link ("Product page: url") goes; anywhere else the address alone goes.
function removeLink(text, url) {
  const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = text.replace(new RegExp(`\\[([^\\]]*)\\]\\(\\s*${escaped}\\s*\\)`, "g"), "$1");
  out = out.replace(new RegExp(`^[ \\t]*(?:[-*•][ \\t]*)?(?:[A-Za-z][\\w '’-]{0,40}:[ \\t]*)?<?${escaped}>?[ \\t.]*(?:\\r?\\n|$)`, "gm"), "");
  out = out.replace(new RegExp(`[ \\t]*[(<]?${escaped}[)>]?`, "g"), "");
  return out;
}

const tidy = (text) => text
  .replace(/[ \t]+\n/g, "\n")
  .replace(/\n{3,}/g, "\n\n")
  .replace(/[ \t]{2,}/g, " ")
  .replace(/[ \t]+([.,;:!?])/g, "$1")
  .trim();

// lookup(handles) -> Set of the handles that are live products. If it fails, the reply is
// returned unchanged: a lookup outage must not strip good links out of every answer.
// search(term) -> handles of live products for a part number; used only for a dead link
// that none of the known listings repairs (its right listing may not be in this turn's results).
export async function gateProductLinks(reply, { trusted = [], lookup, search } = {}) {
  const text = String(reply || "");
  const links = storeLinksIn(text);
  const result = { reply: text, repaired: [], removed: [] };
  if (!links.length) return result;

  const known = new Set(trusted.map((h) => String(h || "").toLowerCase()).filter(Boolean));
  const unknown = [...new Set(links.map((l) => l.handle))].filter((h) => !known.has(h));
  if (!unknown.length) return result;

  const checkable = unknown.filter((h) => HANDLE.test(h)).slice(0, MAX_LOOKUPS);
  let live;
  try {
    live = await lookup(checkable);
  } catch {
    return { ...result, lookupFailed: true };
  }
  const dead = unknown.filter((h) => checkable.includes(h) && !live.has(h));
  if (!dead.length) return result;

  const real = [...known, ...live];
  let out = text;
  let searches = 0;
  for (const handle of dead) {
    let to = closestHandle(handle, real);
    const codes = words(handle).filter(isCode).sort((a, b) => b.length - a.length);
    if (!to && search && codes.length && searches < MAX_SEARCHES) {
      searches += 1;
      to = closestHandle(handle, await search(codes[0]).catch(() => []));
    }
    for (const link of links.filter((l) => l.handle === handle)) {
      if (to) {
        out = out.split(link.url).join(link.url.replace(new RegExp(`/products/${handle}(?![a-z0-9-])`, "i"), `/products/${to}`));
      } else {
        out = removeLink(out, link.url);
      }
    }
    if (to) result.repaired.push({ from: handle, to });
    else result.removed.push(handle);
  }
  out = tidy(out);
  if (result.removed.length) out = out ? `${out}\n\n${REMOVED_LINK_NOTE}` : REMOVED_LINK_NOTE;
  result.reply = out;
  return result;
}

async function storefront(query, variables, env) {
  const storeDomain = env.SHOPIFY_STORE_DOMAIN;
  const token = env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  const apiVersion = env.SHOPIFY_API_VERSION || "2026-01";
  if (!storeDomain || !token) throw new Error("storefront not configured");
  const res = await fetch(`https://${storeDomain}/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(6000)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.errors?.length) throw new Error(payload?.errors?.[0]?.message || `Storefront lookup failed (${res.status})`);
  return payload.data || {};
}

// Handles of live products the store's own search returns for a part number.
export async function storefrontSearchHandles(term, env = process.env) {
  const data = await storefront(`query LinkGateSearch($q: String!) {
    search(query: $q, first: 10, types: [PRODUCT]) { nodes { ... on Product { handle } } }
  }`, { q: String(term || "").slice(0, 60) }, env);
  return (data.search?.nodes || []).map((n) => n?.handle).filter(Boolean);
}

// Which of these handles are live products, read from the Storefront API (the same channel the
// finder's search reads, so a handle it returned is never called dead here).
export async function storefrontLiveHandles(handles, env = process.env) {
  const wanted = handles.filter((h) => HANDLE.test(h));
  if (!wanted.length) return new Set();
  const query = `query LinkGate(${wanted.map((_, i) => `$h${i}: String!`).join(", ")}) {
    ${wanted.map((_, i) => `p${i}: product(handle: $h${i}) { handle }`).join("\n    ")}
  }`;
  const data = await storefront(query, Object.fromEntries(wanted.map((h, i) => [`h${i}`, h])), env);
  const live = new Set();
  wanted.forEach((h, i) => {
    if (data[`p${i}`]?.handle) live.add(h);
  });
  return live;
}
