// "Show product photos" for parts the store lists without a real photo (Jason 2026-11-06: customers can ask the
// parts finder for an image; it fetches that part's photos, shows them in the chat and saves them to the product
// page so nobody has to look again).
//
// Nothing here fetches anything on its own. A customer who asks for a picture gets a button under the reply; a tap
// queues ONE request for ONE product. A worker on the office PC (OneDrive\Claude-Jobs\neuco-photos\worker.mjs)
// polls this queue, loads that one part's page at the supplier through the account's own session, saves the photos
// to the Shopify product, and reports back here. The supplier's condition is that its catalog is never scraped, so
// requests are per part, capped per IP and per day, and a part that already has photos is answered from the store.
//
// The vendor stays server-side: it is never put in a reply, the model's context or the page. Every customer-facing
// line here is written by code, never by the model.
import { randomUUID, timingSafeEqual } from "node:crypto";
import { productHandlesIn } from "./stock-check.mjs";

const PHOTO_VENDORS = new Set(["NEUCO"]);
const CARD = /NESH-SPEC-CARD-V2|NESH-SPECTABLE-V1/; // our generated spec cards, not photos
const HANDLE = /^[a-z0-9][a-z0-9-]{0,254}$/;
const CONTACT_URL = "https://newenglandsupplyhouse.com/pages/contact";
const JOB_TTL_MS = 15 * 60e3;       // a request is forgotten after this
const WORK_TIMEOUT_MS = 3 * 60e3;   // a claimed request with no result by then is answered "couldn't"
const WORKER_ALIVE_MS = 90e3;       // the worker polls every few seconds; silent longer than this = offline

// A request to SEE the part, not a customer sending us their own photo.
const PHOTO_ASK = /\b(?:(?:photos?|pictures?|pics?|images?)\s+of\s+(?:it|this|that|the|these|them|your|a)\b|(?:see|show|send|view|have|got|get|post)\b[^.?!]{0,40}\b(?:photos?|pictures?|pics?|images?)\b|(?:photos?|pictures?|pics?|images?)\b[^.?!]{0,30}\b(?:available|on\s+file|of\s+(?:the\s+)?(?:part|item|product))|what\s+(?:does|do)\s+(?:it|this|that|they|the\s+\w+)\s+look\s+like)/i;

export function isPhotoAsk(text) {
  return PHOTO_ASK.test(String(text || ""));
}

export const PHOTO_BUTTON_NOTE =
  "The customer is asking to see a photo of a part. If your reply links the product page, tell them they can tap " +
  "\"Show product photos\" under your reply to see photos of that part. Never say you fetched, found or attached a photo " +
  "yourself, never describe what a photo shows, and never name a supplier, distributor or vendor.";

async function lookupProducts(handles, env = process.env) {
  const storeDomain = env.SHOPIFY_STORE_DOMAIN;
  const token = env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  const apiVersion = env.SHOPIFY_API_VERSION || "2026-01";
  const wanted = handles.map((h) => String(h).toLowerCase()).filter((h) => HANDLE.test(h)).slice(0, 3);
  if (!storeDomain || !token || !wanted.length) return [];
  const fields = "handle title vendor onlineStoreUrl images(first: 12) { nodes { url altText } }";
  const query = `query PhotoProducts(${wanted.map((_, i) => `$h${i}: String!`).join(", ")}) {
    ${wanted.map((_, i) => `p${i}: product(handle: $h${i}) { ${fields} }`).join("\n    ")}
  }`;
  const res = await fetch(`https://${storeDomain}/api/${apiVersion}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
    body: JSON.stringify({ query, variables: Object.fromEntries(wanted.map((h, i) => [`h${i}`, h])) }),
    signal: AbortSignal.timeout(8000)
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok || payload.errors?.length) throw new Error(payload?.errors?.[0]?.message || `Storefront lookup failed (${res.status})`);
  return wanted.map((_, i) => payload.data?.[`p${i}`]).filter(Boolean).map((p) => ({
    handle: p.handle,
    title: p.title,
    url: p.onlineStoreUrl || `https://newenglandsupplyhouse.com/products/${p.handle}`,
    eligible: PHOTO_VENDORS.has(String(p.vendor || "").trim().toUpperCase()),
    photos: (p.images?.nodes || []).filter((n) => n.url && !CARD.test(n.altText || "")).map((n) => n.url)
  }));
}

// The button: offered on a turn where the customer asked to see a part, for the eligible products this reply links
// (or, if it linked none, the previous reply's).
export async function photoOffer(conversation, reply, latestUserMessage, env = process.env) {
  if (!isPhotoAsk(latestUserMessage)) return null;
  let handles = productHandlesIn(reply);
  if (!handles.length) {
    const previous = [...conversation].reverse().find((m) => m && m.role === "assistant" && m.content);
    handles = productHandlesIn(previous?.content || "");
  }
  if (!handles.length) return null;
  const products = (await lookupProducts(handles, env)).filter((p) => p.eligible);
  if (!products.length) return null;
  return { items: products.map((p) => ({ handle: p.handle, title: p.title })) };
}

// ---- limits: each new request can mean one page load at the supplier ----
const ipTaps = new Map();
let day = { key: "", count: 0 };
export function photoRequestRejection(ip, env = process.env) {
  const perMinute = Number(env.PHOTO_REQUEST_PER_MIN) || 4;
  const now = Date.now();
  const taps = (ipTaps.get(ip) || []).filter((t) => now - t < 60_000);
  if (taps.length >= perMinute) return "That's a lot of photo requests in a row. Please wait a moment and try again.";
  taps.push(now);
  ipTaps.set(ip, taps);
  if (ipTaps.size > 5000) ipTaps.clear();
  return null;
}
function underDailyCap(env) {
  const cap = env.PHOTO_REQUEST_DAILY_CAP !== undefined && env.PHOTO_REQUEST_DAILY_CAP !== "" ? Number(env.PHOTO_REQUEST_DAILY_CAP) : 50;
  const today = new Date().toISOString().slice(0, 10);
  if (day.key !== today) day = { key: today, count: 0 };
  if (day.count >= cap) return false;
  day.count += 1;
  return true;
}

// ---- the queue (memory only: a request is minutes long; a restart just means "try again") ----
const jobs = new Map(); // id -> { id, handle, title, url, status, createdAt, claimedAt, images, note, sessionId, tool }
let workerSeenAt = 0;

function sweep() {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (now - j.createdAt > JOB_TTL_MS) jobs.delete(id);
    else if (j.status === "working" && now - j.claimedAt > WORK_TIMEOUT_MS) { j.status = "error"; j.note = "worker timed out"; }
  }
}

const link = (p) => `[${String(p.title).replace(/[[\]]/g, "")}](${p.url})`;
export function photoMessage(job) {
  const contact = `[contact us](${CONTACT_URL})`;
  if (job.status === "done") {
    return `Here ${job.images.length === 1 ? "is a photo" : "are photos"} of ${link(job)}. ${job.images.length === 1 ? "It's" : "They're"} on the product page now too.`;
  }
  if (job.status === "none") {
    return `We don't have a photo of ${link(job)} on file yet. The part number and specifications on the product page are exact; if you'd like a second check before you order, ${contact} and we'll confirm it's the right part.`;
  }
  return `I couldn't pull up photos of ${link(job)} just now. Please try again in a few minutes, or ${contact} and we'll send you one.`;
}

// handle -> { status, id?, reply?, images? }
export async function startPhotoRequest(handle, meta = {}, env = process.env) {
  sweep();
  const [p] = await lookupProducts([handle], env);
  if (!p || !p.eligible) return { status: "invalid" };
  if (p.photos.length) {
    const job = { ...p, status: "done", images: p.photos.slice(0, 6) };
    return { status: "done", reply: photoMessage(job), images: job.images, title: p.title };
  }
  for (const j of jobs.values()) {
    if (j.handle === p.handle && (j.status === "queued" || j.status === "working")) return { status: j.status, id: j.id };
  }
  if (Date.now() - workerSeenAt > WORKER_ALIVE_MS) {
    return { status: "error", reply: photoMessage({ ...p, status: "error" }), note: "worker offline" };
  }
  if (!underDailyCap(env)) return { status: "error", reply: photoMessage({ ...p, status: "error" }), note: "daily cap" };
  const job = { id: randomUUID(), handle: p.handle, title: p.title, url: p.url, status: "queued", createdAt: Date.now(), sessionId: meta.sessionId || "", tool: meta.tool || "" };
  jobs.set(job.id, job);
  return { status: "queued", id: job.id };
}

export function photoRequestStatus(id) {
  sweep();
  const j = jobs.get(String(id || ""));
  if (!j) return { status: "gone" };
  if (j.status === "queued" || j.status === "working") return { status: j.status };
  return { status: j.status, reply: photoMessage(j), images: j.images || [], title: j.title, handle: j.handle, note: j.note };
}

// ---- the worker's side (X-Photo-Key = env PHOTO_WORKER_KEY; anything else is a 404) ----
export function workerAuthorized(request, env = process.env) {
  const want = String(env.PHOTO_WORKER_KEY || "");
  const got = String(request.headers["x-photo-key"] || "");
  if (want.length < 24 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function claimPhotoJob() {
  workerSeenAt = Date.now();
  sweep();
  const next = [...jobs.values()].filter((j) => j.status === "queued").sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!next) return null;
  next.status = "working";
  next.claimedAt = Date.now();
  return { id: next.id, handle: next.handle };
}

const CDN = /^https:\/\/cdn\.shopify\.com\//;
export function finishPhotoJob(id, body) {
  workerSeenAt = Date.now();
  const j = jobs.get(String(id || ""));
  if (!j) return null;
  const status = ["done", "none", "error"].includes(body?.status) ? body.status : "error";
  // Only our own store's image addresses ever reach the customer.
  const images = (Array.isArray(body?.images) ? body.images : []).map(String).filter((u) => CDN.test(u)).slice(0, 6);
  j.status = status === "done" && !images.length ? "error" : status;
  j.images = images;
  j.note = String(body?.note || "").slice(0, 300);
  j.finishedAt = Date.now();
  return j;
}

export function photoSummary(j) {
  return `photo-request ${j.handle}=${j.status}${j.images?.length ? `(${j.images.length})` : ""}${j.note ? ` [${j.note}]` : ""}`;
}
