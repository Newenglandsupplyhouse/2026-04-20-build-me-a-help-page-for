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
