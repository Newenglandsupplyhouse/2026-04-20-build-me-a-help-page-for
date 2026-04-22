import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      const documents = extractFileSearchDocuments(openAIResponse.payload);

      sendJson(response, 200, {
        reply: replyText || "No response text returned.",
        usedTools: usedSources ? `Used ${usedSources.replace(/^Used /, "")}` : "",
        documents
      }, origin);
      return;
    } catch (error) {
      sendJson(response, 500, { error: error.message }, origin);
      return;
    }
  }

  sendJson(response, 404, { error: "Not found." }, origin);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Help page server running at http://localhost:${port}`);
});
