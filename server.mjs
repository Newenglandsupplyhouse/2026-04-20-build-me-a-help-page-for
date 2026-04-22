import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_CHATBASE_HELP_URL = "https://www.chatbase.co/iQxwux6_Bjma9xxVgm8Nb/help";

function loadEnvFile() {
  const envPath = path.join(__dirname, ".env");

  return readFile(envPath, "utf8")
    .then((contents) => {
      for (const rawLine of contents.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
          continue;
        }

        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
          continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

        if (!(key in process.env)) {
          process.env[key] = value;
        }
      }
    })
    .catch(() => {
      return undefined;
    });
}

function sendJson(response, statusCode, payload, origin = "*") {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function sendHtml(response, statusCode, html, origin = "*") {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Origin": origin,
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(html);
}

function getChatbaseHelpBaseUrl() {
  try {
    return new URL(process.env.CHATBASE_HELP_URL || DEFAULT_CHATBASE_HELP_URL);
  } catch {
    return new URL(DEFAULT_CHATBASE_HELP_URL);
  }
}

function buildChatbaseHelpTarget(requestUrl) {
  const baseUrl = getChatbaseHelpBaseUrl();
  const suffix = requestUrl.pathname === "/chatbase-help"
    ? ""
    : requestUrl.pathname.slice("/chatbase-help".length);
  const upstreamPath = `${baseUrl.pathname.replace(/\/$/, "")}${suffix}` || "/";
  return new URL(`${upstreamPath}${requestUrl.search}`, baseUrl.origin);
}

function buildChatbaseAssetTarget(requestUrl) {
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, getChatbaseHelpBaseUrl().origin);
}

function buildChatbaseApiTarget(requestUrl) {
  return new URL(`${requestUrl.pathname}${requestUrl.search}`, getChatbaseHelpBaseUrl().origin);
}

function getProxyRequestHeaders(request, targetUrl) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value == null) {
      continue;
    }

    const lowerKey = key.toLowerCase();
    if (["host", "content-length", "connection"].includes(lowerKey)) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }

  headers.set("host", targetUrl.host);
  headers.set("origin", targetUrl.origin);
  headers.set("referer", targetUrl.origin);

  return headers;
}

function getProxyResponseHeaders(upstreamResponse) {
  const headers = {};

  for (const [key, value] of upstreamResponse.headers.entries()) {
    if (["content-length", "content-encoding", "transfer-encoding", "connection"].includes(key.toLowerCase())) {
      continue;
    }

    headers[key] = value;
  }

  return headers;
}

function getInjectedChatbaseOverrides() {
  return `
    <style id="nesh-chatbase-sidebar-overrides">
      /* nesh-chatbase-reset-v2 */
      [data-slot="sidebar-wrapper"] {
        --sidebar-width: 0px !important;
        --sidebar-width-icon: 0px !important;
      }

      [data-slot="sidebar-wrapper"] > [data-slot="sidebar"],
      [data-slot="sidebar-gap"],
      [data-slot="sidebar-container"] {
        display: none !important;
        width: 0 !important;
        min-width: 0 !important;
      }

      [data-slot="sidebar-wrapper"] > main {
        border-left: 0 !important;
      }

      header.sticky button[data-slot="button"] {
        display: none !important;
      }

      .nesh-chatbase-reset-row {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        margin: 0 0 10px;
      }

      .nesh-chatbase-reset {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        justify-content: center;
        min-height: 38px;
        padding: 0 14px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 999px;
        background: rgba(24, 24, 27, 0.92);
        color: #f5f5f7;
        font-size: 13px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: pointer;
        transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
      }

      .nesh-chatbase-reset:hover {
        background: rgba(39, 39, 42, 0.98);
        border-color: rgba(255, 255, 255, 0.24);
        transform: translateY(-1px);
      }

      .nesh-chatbase-reset:focus-visible {
        outline: 2px solid rgba(255, 255, 255, 0.45);
        outline-offset: 2px;
      }

      .nesh-chatbase-reset svg {
        width: 15px;
        height: 15px;
        flex: 0 0 auto;
      }

    </style>
    <script id="nesh-chatbase-sidebar-script">
      (() => {
        const hideSidebar = () => {
          document.querySelectorAll('[data-slot="sidebar"], [data-slot="sidebar-gap"], [data-slot="sidebar-container"]').forEach((element) => {
            element.style.display = 'none';
            element.style.width = '0';
            element.style.minWidth = '0';
          });

          document.querySelectorAll('[data-slot="sidebar-wrapper"]').forEach((element) => {
            element.style.setProperty('--sidebar-width', '0px');
            element.style.setProperty('--sidebar-width-icon', '0px');
          });

          document.querySelectorAll('header.sticky button[data-slot="button"]').forEach((element) => {
            element.style.display = 'none';
          });
        };

        const resetChat = () => {
          const newChatButton = [...document.querySelectorAll('button')].find((element) => {
            return (element.textContent || '').trim().toLowerCase() === 'new chat';
          });

          if (newChatButton) {
            newChatButton.click();
            return;
          }

          window.location.href = window.location.pathname + window.location.search;
        };

        const addResetButton = () => {
          const inputBox = document.querySelector('[data-slot="chatbot-input-box"]');
          const inputShell = inputBox?.parentElement;
          if (!inputBox || !inputShell || inputShell.querySelector('.nesh-chatbase-reset-row')) {
            return;
          }

          const row = document.createElement('div');
          row.className = 'nesh-chatbase-reset-row';

          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'nesh-chatbase-reset';
          button.setAttribute('aria-label', 'Start a new chat');
          button.setAttribute('title', 'Start over');
          button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 4v7h-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Start over</span>';
          button.addEventListener('click', resetChat);
          row.appendChild(button);
          inputShell.insertBefore(row, inputBox);
        };

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            hideSidebar();
            addResetButton();
          }, { once: true });
        } else {
          hideSidebar();
          addResetButton();
        }

        new MutationObserver(() => {
          hideSidebar();
          addResetButton();
        }).observe(document.documentElement, {
          childList: true,
          subtree: true
        });
      })();
    </script>
  `.trim();
}

function injectChatbaseOverrides(html) {
  const injection = getInjectedChatbaseOverrides();
  if (html.includes("nesh-chatbase-sidebar-overrides")) {
    return html;
  }

  if (html.includes("</head>")) {
    return html.replace("</head>", `${injection}</head>`);
  }

  return `${injection}${html}`;
}

async function proxyChatbaseRequest(request, response, targetUrl, options = {}) {
  const upstreamResponse = await fetch(targetUrl, {
    method: request.method,
    headers: getProxyRequestHeaders(request, targetUrl),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request,
    duplex: request.method === "GET" || request.method === "HEAD" ? undefined : "half",
    redirect: "manual"
  });

  const headers = getProxyResponseHeaders(upstreamResponse);
  const contentType = upstreamResponse.headers.get("content-type") || "";

  if (options.injectHtml && contentType.includes("text/html")) {
    const html = injectChatbaseOverrides(await upstreamResponse.text());
    headers["content-type"] = "text/html; charset=utf-8";
    response.writeHead(upstreamResponse.status, headers);
    response.end(html);
    return;
  }

  const body = Buffer.from(await upstreamResponse.arrayBuffer());
  response.writeHead(upstreamResponse.status, headers);
  response.end(body);
}

function normalizeAllowedOrigin(origin) {
  const trimmed = (origin || "").trim();
  if (!trimmed) {
    return "";
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, "");
  }

  return `https://${trimmed.replace(/\/$/, "")}`;
}

function getAllowedOrigin(requestOrigin) {
  const configuredOrigins = (process.env.SHOPIFY_STOREFRONT_ORIGIN || "")
    .split(",")
    .map(normalizeAllowedOrigin)
    .filter(Boolean);

  if (!configuredOrigins.length) {
    return "*";
  }

  const normalizedRequestOrigin = normalizeAllowedOrigin(requestOrigin);
  if (normalizedRequestOrigin && configuredOrigins.includes(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  return configuredOrigins[0];
}

function summarizeTools(output = []) {
  const used = [];

  for (const item of output) {
    if (item.type === "file_search_call") {
      used.push("vector store");
    }
    if (item.type === "web_search_call") {
      used.push("web search");
    }
  }

  if (!used.length) {
    return "";
  }

  return "Used " + [...new Set(used)].join(" and ");
}

function extractResponseText(payload) {
  if (payload?.output_text) {
    return payload.output_text;
  }

  const parts = [];

  for (const item of payload?.output || []) {
    if (item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (contentItem.type === "output_text" && contentItem.text) {
        parts.push(contentItem.text);
      }
    }
  }

  return parts.join("\n\n").trim();
}

function extractFileSearchDocuments(payload) {
  const documents = [];

  for (const item of payload?.output || []) {
    if (item.type !== "file_search_call" || !Array.isArray(item.results)) {
      continue;
    }

    for (const result of item.results) {
      documents.push({
        fileId: result.file_id || "",
        filename: result.filename || "Document",
        url: result.attributes?.source_url || "",
        score: result.score || 0,
        snippet: (result.text || "").slice(0, 280).trim()
      });
    }
  }

  return documents
    .filter((document) => document.url || document.fileId)
    .filter((document, index, array) => (
      array.findIndex((other) => other.fileId === document.fileId || (other.url && other.url === document.url)) === index
    ));
}

function formatDocumentList(documents) {
  if (!documents.length) {
    return "";
  }

  const lines = documents.slice(0, 5).map((document, index) => (
    `${index + 1}. ${document.filename}${document.url ? ` - ${document.url}` : ""}`
  ));

  return `Available documents:\n${lines.join("\n")}`;
}

function isDocumentRequest(conversation) {
  const latestUserMessage = getLatestUserMessage(conversation);
  return /manual|manuals|document|documents|pdf|pdfs|datasheet|data sheet|spec|specs|submittal|instruction|instructions|wiring|troubleshooting/i.test(latestUserMessage);
}

async function searchDocumentsForQuery(query, vectorStoreId, apiKey, model) {
  if (!query || !vectorStoreId) {
    return [];
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Find uploaded manuals, PDFs, spec sheets, and technical documents related to: ${query}`
            }
          ]
        }
      ],
      tools: [
        {
          type: "file_search",
          vector_store_ids: [vectorStoreId],
          max_num_results: 8
        }
      ],
      include: ["file_search_call.results"]
    })
  });

  const payload = await response.json();
  if (!response.ok) {
    return [];
  }

  return extractFileSearchDocuments(payload);
}

function getLatestUserMessage(conversation) {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index]?.role === "user" && conversation[index]?.content) {
      return conversation[index].content;
    }
  }

  return "";
}

function buildShopifySearchQuery(userText) {
  const compact = userText.trim().replace(/\s+/g, " ");
  if (!compact) {
    return "";
  }

  if (compact.includes(":")) {
    return compact;
  }

  return compact
    .split(" ")
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
}

async function getShopifyProductContext(conversation) {
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const storefrontToken = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";

  if (!storeDomain || !storefrontToken) {
    return null;
  }

  const latestUserMessage = getLatestUserMessage(conversation);
  const searchQuery = buildShopifySearchQuery(latestUserMessage);
  if (!searchQuery) {
    return null;
  }

  const endpoint = `https://${storeDomain}/api/${apiVersion}/graphql.json`;
  const graphQLQuery = `
    query HelpPageProducts($query: String!) {
      products(first: 5, query: $query, sortKey: RELEVANCE) {
        nodes {
          id
          title
          handle
          vendor
          productType
          availableForSale
          description
          onlineStoreUrl
          featuredImage {
            url
            altText
          }
          priceRange {
            minVariantPrice {
              amount
              currencyCode
            }
          }
          variants(first: 3) {
            nodes {
              title
              availableForSale
              sku
              price {
                amount
                currencyCode
              }
            }
          }
        }
      }
    }
  `;

  const shopifyResponse = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": storefrontToken
    },
    body: JSON.stringify({
      query: graphQLQuery,
      variables: {
        query: searchQuery
      }
    })
  });

  const payload = await shopifyResponse.json();

  if (!shopifyResponse.ok) {
    throw new Error(payload?.errors?.[0]?.message || "Shopify Storefront API request failed.");
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message || "Shopify Storefront API returned an error.");
  }

  const products = payload?.data?.products?.nodes || [];
  if (!products.length) {
    return {
      source: "shopify",
      searchQuery,
      text: `Live Shopify product search for "${latestUserMessage}" returned no matches.`
    };
  }

  const lines = [
    `Live Shopify product search results for "${latestUserMessage}" using query "${searchQuery}":`
  ];

  for (const product of products) {
    const minPrice = product.priceRange?.minVariantPrice;
    const priceText = minPrice
      ? `${minPrice.amount} ${minPrice.currencyCode}`
      : "price unavailable";
    const variantSummary = (product.variants?.nodes || [])
      .map((variant) => `${variant.title} (${variant.availableForSale ? "in stock" : "out of stock"}${variant.price ? `, ${variant.price.amount} ${variant.price.currencyCode}` : ""})`)
      .join("; ");

    lines.push(
      [
        `- ${product.title}`,
        product.vendor ? `vendor: ${product.vendor}` : "",
        product.productType ? `type: ${product.productType}` : "",
        `availability: ${product.availableForSale ? "available" : "unavailable"}`,
        `price: ${priceText}`,
        product.handle ? `handle: ${product.handle}` : "",
        product.onlineStoreUrl ? `url: ${product.onlineStoreUrl}` : "",
        product.description ? `description: ${product.description.slice(0, 220)}` : "",
        variantSummary ? `variants: ${variantSummary}` : ""
      ].filter(Boolean).join(" | ")
    );
  }

  return {
    source: "shopify",
    searchQuery,
    text: lines.join("\n")
  };
}

async function createOpenAIResponse(conversation) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in .env.");
  }

  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
  const enableWebSearch = (process.env.ENABLE_WEB_SEARCH || "true").toLowerCase() !== "false";

  const tools = [];

  if (vectorStoreId) {
    tools.push({
      type: "file_search",
      vector_store_ids: [vectorStoreId],
      max_num_results: 5
    });
  }

  if (enableWebSearch) {
    tools.push({
      type: "web_search"
    });
  }

  const input = conversation.map((message) => ({
    role: message.role,
    content: [
      {
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: message.content
      }
    ]
  }));

  const shopifyContext = await getShopifyProductContext(conversation);
  if (shopifyContext?.text) {
    input.unshift({
      role: "system",
      content: [
        {
          type: "input_text",
          text: shopifyContext.text
        }
      ]
    });
  }

  const openAIResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      store: false,
      input,
      tools,
      include: ["file_search_call.results"],
      instructions: "You are a shopping assistant for a Shopify store. Answer with clear, concise help for shoppers. Use live Shopify product data when provided for catalog facts like title, price, availability, variants, and product URLs. Use the vector store for store knowledge like policies, sizing, FAQs, and curated product guidance. Use web search only when it genuinely helps. If any source is missing, say what you do and do not know. Do not invent product facts."
    })
  });

  const payload = await openAIResponse.json();

  if (!openAIResponse.ok) {
    const message = payload?.error?.message || "OpenAI request failed.";
    throw new Error(message);
  }

  return {
    payload,
    usedSources: shopifyContext?.text ? ["shopify"] : []
  };
}

await loadEnvFile();

const server = createServer(async (request, response) => {
  const origin = getAllowedOrigin(request.headers.origin);
  const requestUrl = new URL(request.url || "/", "http://localhost");

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
    });
    response.end();
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/") {
    const html = await readFile(path.join(__dirname, "help-page.html"), "utf8");
    sendHtml(response, 200, html, origin);
    return;
  }

  if (requestUrl.pathname === "/chatbase-help" || requestUrl.pathname.startsWith("/chatbase-help/")) {
    try {
      await proxyChatbaseRequest(request, response, buildChatbaseHelpTarget(requestUrl), {
        injectHtml: true
      });
      return;
    } catch (error) {
      sendJson(response, 502, { error: `Chatbase help proxy failed: ${error.message}` }, origin);
      return;
    }
  }

  if (requestUrl.pathname.startsWith("/__cb/")) {
    try {
      await proxyChatbaseRequest(request, response, buildChatbaseAssetTarget(requestUrl));
      return;
    } catch (error) {
      sendJson(response, 502, { error: `Chatbase asset proxy failed: ${error.message}` }, origin);
      return;
    }
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/chat") {
    try {
      let rawBody = "";
      for await (const chunk of request) {
        rawBody += chunk;
      }

      const parsed = JSON.parse(rawBody || "{}");
      const conversation = Array.isArray(parsed.conversation) ? parsed.conversation : [];

      if (!conversation.length) {
        sendJson(response, 400, { error: "Conversation is required." }, origin);
        return;
      }

      const openAIResponse = await createOpenAIResponse(conversation);
      const usedSources = [
        ...openAIResponse.usedSources,
        summarizeTools(openAIResponse.payload.output)
      ].filter(Boolean).join(" and ");
      const replyText = extractResponseText(openAIResponse.payload);
      let documents = extractFileSearchDocuments(openAIResponse.payload);
      if (!documents.length && isDocumentRequest(conversation)) {
        documents = await searchDocumentsForQuery(
          getLatestUserMessage(conversation),
          process.env.OPENAI_VECTOR_STORE_ID,
          process.env.OPENAI_API_KEY,
          process.env.OPENAI_MODEL || "gpt-5-mini"
        );
      }
      const documentList = formatDocumentList(documents);
      const finalReply = documents.length
        ? `${replyText || "I found matching documents."}\n\n${documentList}`.trim()
        : (replyText || "No response text returned.");

      sendJson(response, 200, {
        reply: finalReply,
        usedTools: usedSources ? `Used ${usedSources.replace(/^Used /, "")}` : "",
        documents
      }, origin);
      return;
    } catch (error) {
      sendJson(response, 500, { error: error.message }, origin);
      return;
    }
  }

  if (requestUrl.pathname.startsWith("/api/chat/")) {
    try {
      await proxyChatbaseRequest(request, response, buildChatbaseApiTarget(requestUrl));
      return;
    } catch (error) {
      sendJson(response, 502, { error: `Chatbase API proxy failed: ${error.message}` }, origin);
      return;
    }
  }

  sendJson(response, 404, { error: "Not found." }, origin);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Help page server running at http://localhost:${port}`);
});
