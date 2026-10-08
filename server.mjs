import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicKey, verify as verifySignature } from "node:crypto";
import {
  loadConfig, saveConfig, checkLimits, overDailyCap, resolveTool, isTool, TOOLS,
  CONFIG_FIELDS, configVersion, listHistory, getHistory, restoreVersion, ensureBaseline
} from "./finder-config.mjs";

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
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "frame-ancestors *",
    "X-Frame-Options": "ALLOWALL"
  });
  response.end(html);
}

function buildChatbaseResetPage(nextUrl) {
  const safeNextUrl = String(nextUrl || "/chatbase-help");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Resetting chat</title>
  <style>
    html, body {
      margin: 0;
      min-height: 100%;
      background: #08080b;
      color: #f5f5f7;
      font-family: Arial, sans-serif;
    }

    body {
      display: grid;
      place-items: center;
    }

    .reset-status {
      font-size: 14px;
      color: #c7c9d1;
      letter-spacing: 0.01em;
    }
  </style>
</head>
<body>
  <div class="reset-status">Resetting chat…</div>
  <script>
    (() => {
      const nextUrl = ${JSON.stringify(safeNextUrl)};

      const clearCookies = () => {
        document.cookie.split(";").forEach((cookie) => {
          const eqIndex = cookie.indexOf("=");
          const name = (eqIndex > -1 ? cookie.slice(0, eqIndex) : cookie).trim();
          if (!name) {
            return;
          }

          document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
          document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=" + location.hostname;
        });
      };

      const clearIndexedDb = async () => {
        if (!("indexedDB" in window) || typeof indexedDB.databases !== "function") {
          return;
        }

        const databases = await indexedDB.databases();
        await Promise.all(databases.map((database) => {
          if (!database.name) {
            return Promise.resolve();
          }

          return new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(database.name);
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          });
        }));
      };

      const clearCaches = async () => {
        if (!("caches" in window)) {
          return;
        }

        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map((key) => caches.delete(key)));
      };

      const clearStorage = async () => {
        try { localStorage.clear(); } catch {}
        try { sessionStorage.clear(); } catch {}
        try { clearCookies(); } catch {}
        try { await clearIndexedDb(); } catch {}
        try { await clearCaches(); } catch {}
      };

      clearStorage().finally(() => {
        setTimeout(() => {
          location.replace(nextUrl);
        }, 40);
      });
    })();
  </script>
</body>
</html>`;
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
    const k = key.toLowerCase();
    if (["content-length", "content-encoding", "transfer-encoding", "connection",
         "x-frame-options", "content-security-policy", "content-security-policy-report-only"].includes(k)) {
      continue;
    }

    headers[key] = value;
  }

  // Explicitly allow embedding from any origin
  headers["content-security-policy"] = "frame-ancestors *";

  return headers;
}

function getInjectedChatbaseOverrides() {
  return `
    <style id="nesh-chatbase-sidebar-overrides">
      :root {
        --nesh-mobile-vh: 100dvh;
      }

      html,
      body {
        background: #08080b !important;
      }

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
        background: #08080b !important;
      }

      header.sticky button[data-slot="button"] {
        display: none !important;
      }

      footer a[href*="chatbase.co"] svg,
      footer a[target="_blank"][rel~="noopener"] svg {
        display: none !important;
      }

      footer a[href*="chatbase.co"] span,
      footer a[target="_blank"][rel~="noopener"] span.select-none.font-medium.text-xs.text-zinc-500\\/90 {
        font-size: 0 !important;
      }

      footer a[href*="chatbase.co"] span::after,
      footer a[target="_blank"][rel~="noopener"] span.select-none.font-medium.text-xs.text-zinc-500\\/90::after {
        content: "Built by Arcturus Consulting";
        font-size: 12px;
      }

      main > header + div {
        justify-content: flex-start !important;
        gap: 0 !important;
        min-height: calc(100dvh - 60px) !important;
        height: auto !important;
      }

      main > header + div > div {
        justify-content: flex-start !important;
        gap: 24px !important;
        min-height: calc(100dvh - 60px) !important;
        height: auto !important;
      }

      main > header + div > div > div {
        flex: 0 0 auto !important;
        justify-content: flex-start !important;
        padding-top: 24px !important;
        min-height: 0 !important;
      }

      main > header + div > div > div > div:first-child {
        flex: 0 0 auto !important;
        justify-content: flex-start !important;
      }

      main > header + div > div > div > div:first-child > div:first-child {
        display: none !important;
      }

      [data-has-messages="false"] {
        flex: 0 0 auto !important;
      }

        @media (max-width: 749px) {
          html,
          body,
          [data-slot="sidebar-wrapper"] {
            min-height: var(--nesh-mobile-vh) !important;
            height: var(--nesh-mobile-vh) !important;
            max-height: var(--nesh-mobile-vh) !important;
            overflow: hidden !important;
          }

          [data-slot="sidebar-wrapper"] > main {
            min-height: var(--nesh-mobile-vh) !important;
            height: var(--nesh-mobile-vh) !important;
            max-height: var(--nesh-mobile-vh) !important;
            overflow-x: hidden !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
            overscroll-behavior-y: contain !important;
            touch-action: pan-y !important;
          }

          main[data-theme="dark"] > header + div {
            touch-action: pan-y !important;
          }

        body,
        main[data-theme="dark"],
        main[data-theme="dark"] > header + div {
          background: #08080b !important;
        }

        main[data-theme="dark"] > header + div:has([data-has-messages="false"]) {
          display: block !important;
          min-height: auto !important;
          height: auto !important;
          padding-top: 8px !important;
        }

        main[data-theme="dark"] > header + div:has([data-has-messages="false"]) > div {
          display: block !important;
          min-height: auto !important;
          height: auto !important;
          flex: 0 0 auto !important;
          padding: 0 0 16px !important;
        }

        main[data-theme="dark"] > header + div:has([data-has-messages="false"]) > div > div {
          display: block !important;
          min-height: auto !important;
          height: auto !important;
          max-width: none !important;
          flex: 0 0 auto !important;
        }

        main[data-theme="dark"] > header + div:has([data-has-messages="false"]) > div > div > div:first-child {
          display: block !important;
          min-height: auto !important;
          height: auto !important;
          flex: 0 0 auto !important;
          padding-top: 8px !important;
        }

        main[data-theme="dark"] > header + div:has([data-has-messages="false"]) > div > div > div:first-child > div:first-child {
          display: none !important;
        }

        main[data-theme="dark"] > header + div:has([data-has-messages="false"]) > div > div > div:first-child h1 {
          margin-top: 0 !important;
          margin-bottom: 12px !important;
        }

        @media (max-width: 749px) and (orientation: portrait) {
          main[data-theme="dark"] > header + div:has([data-has-messages="false"]) > div > div > div:first-child h1 {
            font-size: 36px !important;
            line-height: 1.08 !important;
            letter-spacing: -0.03em !important;
          }
        }

        main[data-theme="dark"] > header + div:has([data-has-messages="false"]) [data-has-messages="false"] {
          min-height: auto !important;
          height: auto !important;
          flex: 0 0 auto !important;
        }

        main[data-theme="dark"] > header + div:has([data-has-messages="false"]) [data-has-messages="false"] > div:first-child {
          min-height: 0 !important;
          padding-top: 0 !important;
        }

        body.nesh-chatbase-input-active main > header + div,
        body.nesh-chatbase-input-active main > header + div > div {
          min-height: auto !important;
          height: auto !important;
        }

        body.nesh-chatbase-input-active main > header + div > div {
          gap: 12px !important;
        }

        body.nesh-chatbase-input-active main > header + div > div > div {
          padding-top: 8px !important;
        }

        body.nesh-chatbase-input-active main > header + div > div > div > div:first-child h1 {
          margin-top: 0 !important;
          margin-bottom: 12px !important;
        }

        body.nesh-chatbase-input-active [data-has-messages="false"] {
          flex: 0 0 auto !important;
        }
      }

    </style>
    <script id="nesh-chatbase-sidebar-script">
      (() => {
        const isMobileViewport = () => window.innerWidth <= 749;

        const updateMobileViewportHeight = () => {
          const viewportHeight = isMobileViewport()
            ? (window.visualViewport?.height || window.innerHeight)
            : window.innerHeight;
          const nextHeight = Math.round(viewportHeight);
          document.documentElement.style.setProperty('--nesh-mobile-vh', nextHeight + 'px');
        };

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

        const stabilizeLandingLayout = () => {
          const emptyState = document.querySelector('[data-has-messages="false"]');
          if (!emptyState) {
            return;
          }

          const scrollers = [
            document.scrollingElement,
            document.documentElement,
            document.body,
            document.querySelector('main')
          ].filter(Boolean);

          scrollers.forEach((element) => {
            try {
              element.scrollTop = 0;
            } catch {}
          });

          try {
            window.scrollTo(0, 0);
          } catch {}
        };

        const forceMobileLandingLayout = () => {
          if (!isMobileViewport()) {
            return;
          }

          const emptyState = document.querySelector('[data-has-messages="false"]');
          if (!emptyState) {
            return;
          }

          const column = emptyState.parentElement;
          const heroBlock = emptyState.previousElementSibling;
          const centeredStack = column?.parentElement;
          const stage = centeredStack?.parentElement;
          const heroHeading = heroBlock?.querySelector('h1');
          const heroSpacer = heroBlock?.firstElementChild;
          const messageRail = emptyState.querySelector(':scope > div:first-child');

          const applyStyles = (element, styles) => {
            if (!element) {
              return;
            }

            Object.entries(styles).forEach(([key, value]) => {
              try {
                element.style[key] = value;
              } catch {}
            });
          };

          applyStyles(stage, {
            height: 'auto',
            minHeight: '0',
            justifyContent: 'flex-start',
            gap: '0'
          });

          applyStyles(centeredStack, {
            flex: '0 0 auto',
            minHeight: '0',
            justifyContent: 'flex-start',
            gap: '12px'
          });

          applyStyles(column, {
            flex: '0 0 auto',
            minHeight: '0',
            justifyContent: 'flex-start'
          });

          applyStyles(heroBlock, {
            flex: '0 0 auto',
            minHeight: '0',
            justifyContent: 'flex-start',
            paddingTop: '8px'
          });

          applyStyles(emptyState, {
            flex: '0 0 auto',
            minHeight: '0'
          });

          applyStyles(messageRail, {
            minHeight: '0',
            paddingTop: '0'
          });

          applyStyles(document.documentElement, {
            background: '#08080b'
          });

          applyStyles(document.body, {
            background: '#08080b'
          });

          if (heroSpacer) {
            heroSpacer.style.display = 'none';
          }

          if (heroHeading) {
            heroHeading.style.marginTop = '0';
            heroHeading.style.marginBottom = '12px';
          }
        };

        const pullEmptyStateToTop = () => {
          const stage = document.querySelector('main > header + div');
          if (!stage) {
            return;
          }

          if (!isMobileViewport()) {
            stage.style.transform = '';
            stage.style.transformOrigin = '';
            try {
              window.parent?.postMessage({ type: 'nesh-chatbase-mobile-offset', shift: 0, active: false }, '*');
            } catch {}
            return;
          }

          const emptyState = document.querySelector('[data-has-messages="false"]');
          const heading = emptyState?.parentElement?.previousElementSibling?.querySelector('h1');
          const mobileHeader = document.querySelector('main > header');

          if (!emptyState || !heading) {
            stage.style.transform = '';
            stage.style.transformOrigin = '';
            try {
              window.parent?.postMessage({ type: 'nesh-chatbase-mobile-offset', shift: 0, active: false }, '*');
            } catch {}
            return;
          }

          const headingRect = heading.getBoundingClientRect();
          const headerRect = mobileHeader?.getBoundingClientRect();
          const desiredTop = Math.max(8, Math.ceil(headerRect?.bottom || 0) + 8);
          const shift = Math.max(0, Math.round(headingRect.top - desiredTop));

          stage.style.transformOrigin = 'top center';
          stage.style.transform = shift > 0 ? 'translateY(-' + shift + 'px)' : '';
          try {
            window.parent?.postMessage({
              type: 'nesh-chatbase-mobile-offset',
              shift,
              active: document.activeElement?.matches?.('textarea[data-slot="chatbot-input-box"]') || false
            }, '*');
          } catch {}
        };

        const centerLandingHeadingToInput = () => {
          // Intentionally inert (2026-07-05). This function was dead code from
          // birth: its ".group/input" closest() selector threw a SyntaxError
          // before any style was ever applied, so the approved page look never
          // included its overrides. When the selector was fixed (0d61b19) the
          // styles ran for the first time and set width:100%/max-width:none on
          // the landing column that also contains the chat input, stretching
          // the input to full page width. Chatbase's own md:max-w-lg /
          // lg:max-w-2xl classes are the intended sizing; keep this a no-op.
        };

        const syncInputFocusState = (active) => {
          if (!isMobileViewport()) {
            document.body.classList.remove('nesh-chatbase-input-active');
            return;
          }

          document.body.classList.toggle('nesh-chatbase-input-active', active);
        };

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => {
            updateMobileViewportHeight();
            hideSidebar();
            centerLandingHeadingToInput();
            stabilizeLandingLayout();
            forceMobileLandingLayout();
            pullEmptyStateToTop();
            setTimeout(centerLandingHeadingToInput, 120);
          }, { once: true });
        } else {
          updateMobileViewportHeight();
          hideSidebar();
          centerLandingHeadingToInput();
          stabilizeLandingLayout();
          forceMobileLandingLayout();
          pullEmptyStateToTop();
          setTimeout(centerLandingHeadingToInput, 120);
        }

        new MutationObserver(() => {
          hideSidebar();
          centerLandingHeadingToInput();
          stabilizeLandingLayout();
          forceMobileLandingLayout();
          pullEmptyStateToTop();
        }).observe(document.documentElement, {
          childList: true,
          subtree: true
        });

        document.addEventListener('focusin', (event) => {
          if (event.target && event.target.matches('textarea[data-slot="chatbot-input-box"]')) {
            syncInputFocusState(true);
            updateMobileViewportHeight();
            centerLandingHeadingToInput();
            forceMobileLandingLayout();
            pullEmptyStateToTop();
            setTimeout(stabilizeLandingLayout, 0);
            setTimeout(stabilizeLandingLayout, 120);
            setTimeout(stabilizeLandingLayout, 260);
            setTimeout(updateMobileViewportHeight, 0);
            setTimeout(updateMobileViewportHeight, 120);
            setTimeout(updateMobileViewportHeight, 260);
            setTimeout(centerLandingHeadingToInput, 0);
            setTimeout(centerLandingHeadingToInput, 120);
            setTimeout(centerLandingHeadingToInput, 260);
            setTimeout(forceMobileLandingLayout, 0);
            setTimeout(forceMobileLandingLayout, 120);
            setTimeout(forceMobileLandingLayout, 260);
            setTimeout(pullEmptyStateToTop, 0);
            setTimeout(pullEmptyStateToTop, 120);
            setTimeout(pullEmptyStateToTop, 260);
          }
        });

        document.addEventListener('focusout', (event) => {
          if (event.target && event.target.matches('textarea[data-slot="chatbot-input-box"]')) {
            syncInputFocusState(false);
            updateMobileViewportHeight();
            centerLandingHeadingToInput();
            forceMobileLandingLayout();
            setTimeout(stabilizeLandingLayout, 0);
            setTimeout(updateMobileViewportHeight, 0);
            setTimeout(centerLandingHeadingToInput, 0);
            setTimeout(forceMobileLandingLayout, 0);
            setTimeout(pullEmptyStateToTop, 0);
          }
        });

        window.visualViewport?.addEventListener('resize', () => {
          updateMobileViewportHeight();
          syncInputFocusState(document.activeElement?.matches?.('textarea[data-slot="chatbot-input-box"]'));
          centerLandingHeadingToInput();
          forceMobileLandingLayout();
          pullEmptyStateToTop();
          setTimeout(stabilizeLandingLayout, 0);
          setTimeout(stabilizeLandingLayout, 120);
          setTimeout(stabilizeLandingLayout, 260);
          setTimeout(updateMobileViewportHeight, 0);
          setTimeout(updateMobileViewportHeight, 120);
          setTimeout(updateMobileViewportHeight, 260);
          setTimeout(centerLandingHeadingToInput, 0);
          setTimeout(centerLandingHeadingToInput, 120);
          setTimeout(centerLandingHeadingToInput, 260);
          setTimeout(forceMobileLandingLayout, 0);
          setTimeout(forceMobileLandingLayout, 120);
          setTimeout(forceMobileLandingLayout, 260);
          setTimeout(pullEmptyStateToTop, 0);
          setTimeout(pullEmptyStateToTop, 120);
          setTimeout(pullEmptyStateToTop, 260);
        });

        window.addEventListener('resize', () => {
          updateMobileViewportHeight();
          syncInputFocusState(document.activeElement?.matches?.('textarea[data-slot="chatbot-input-box"]'));
          centerLandingHeadingToInput();
          forceMobileLandingLayout();
          pullEmptyStateToTop();
        });

        const ARCTURUS_URL = 'https://arcturus-consulting.com';
        const isAttributionLink = (a) =>
          !!a && (/chatbase\.co/i.test(a.getAttribute('href') || a.href || '') ||
            (!!(a.closest && a.closest('footer')) && /powered by chatbase|built by arcturus/i.test(a.textContent || '')));
        const fixFooterLink = () => {
          // Chatbase renders this footer client-side (React) and can re-render it,
          // so re-point every attribution link on each mutation.
          document.querySelectorAll('footer a, a[href*="chatbase.co"]').forEach((a) => {
            if (!isAttributionLink(a)) return;
            if (a.getAttribute('href') !== ARCTURUS_URL) a.setAttribute('href', ARCTURUS_URL);
            a.setAttribute('target', '_blank');
            // Keep rel containing "noopener" so the injected ::after label still matches.
            a.setAttribute('rel', 'noopener noreferrer');
          });
        };
        const startFooterFix = () => {
          fixFooterLink();
          // Observe documentElement — document.body may not exist yet during head parse.
          new MutationObserver(fixFooterLink).observe(document.documentElement, { childList: true, subtree: true });
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', startFooterFix, { once: true });
        } else {
          startFooterFix();
        }
        // Safety net: guarantee the destination even if React re-renders a stale
        // href in the moment between a mutation and the click.
        document.addEventListener('click', (event) => {
          const target = event.target;
          const link = target && target.closest ? target.closest('a') : null;
          if (link && isAttributionLink(link)) {
            event.preventDefault();
            window.open(ARCTURUS_URL, '_blank', 'noopener');
          }
        }, true);
      })();
    </script>
  `.trim();
}

function injectChatbaseOverrides(html) {
  const rewrittenHtml = html
    .replace(
      /<a href="https:\/\/chatbase\.co" target="_blank" class="flex items-center justify-center gap-1\.5" rel="noopener"><svg[\s\S]*?<\/svg><span class="select-none font-medium text-xs text-zinc-500\/90">Powered by Chatbase<\/span><\/a>/,
      '<a href="https://arcturus-consulting.com" target="_blank" class="flex items-center justify-center gap-1.5" rel="noopener"><span class="select-none font-medium text-xs text-zinc-500/90">Built by Arcturus Consulting</span></a>'
    )
    .replace(/Powered by Chatbase/g, "Built by Arcturus Consulting");

  const injection = getInjectedChatbaseOverrides();
  if (rewrittenHtml.includes("nesh-chatbase-sidebar-overrides")) {
    return rewrittenHtml;
  }

  if (rewrittenHtml.includes("</head>")) {
    return rewrittenHtml.replace("</head>", `${injection}</head>`);
  }

  return `${injection}${rewrittenHtml}`;
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
    headers["cache-control"] = "no-store, no-cache, must-revalidate, proxy-revalidate";
    headers["pragma"] = "no-cache";
    headers["expires"] = "0";
    delete headers.etag;
    delete headers.age;
    delete headers.vary;
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

// Minimum file_search relevance score for a document to be shown (loose floor;
// the token gate below does the real relevance work). Tunable via env.
const DOC_SCORE_MIN = Number(process.env.DOC_SCORE_MIN) || 0.4;

// Words that describe the ASK ("send me the spec sheet") rather than the product.
// A doc must match on a product/brand/model token, never on these — otherwise a
// thermostat "spec sheet" answers a request for a Reznor "spec sheet".
const DOC_REQUEST_WORDS = new Set([
  "manual", "manuals", "document", "documents", "documentation", "pdf", "pdfs",
  "datasheet", "datasheets", "data", "sheet", "sheets", "spec", "specs",
  "specification", "specifications", "submittal", "submittals", "instruction",
  "instructions", "install", "installation", "wiring", "diagram", "diagrams",
  "troubleshooting", "guide", "guides", "brochure", "catalog", "cut", "cutsheet",
  "schematic", "schematics", "drawing", "drawings", "literature"
]);
const DOC_STOPWORDS = new Set([
  "the", "for", "and", "you", "your", "have", "has", "had", "get", "got", "can",
  "could", "would", "will", "with", "from", "that", "this", "does", "did", "need",
  "want", "send", "give", "show", "find", "looking", "look", "about", "any",
  "some", "please", "hello", "there", "what", "which", "where", "when", "how",
  "are", "was", "were", "been", "being", "into", "onto", "its", "our", "their",
  "them", "they", "his", "her", "one", "unit", "part", "parts", "number", "model"
]);

// Pull the meaningful product/brand/model tokens out of a customer message —
// long words plus model codes like "UDX-200" (normalized to "udx200"). Used to
// require that a returned document actually references what the customer named.
function significantQueryTokens(query) {
  const text = String(query || "").toLowerCase();
  const tokens = new Set();
  for (const raw of text.split(/[^a-z0-9]+/)) {
    if (!raw || DOC_STOPWORDS.has(raw) || DOC_REQUEST_WORDS.has(raw)) continue;
    // Keep real words (4+ chars) or anything mixing letters and digits.
    if (raw.length >= 4 || /[a-z]/.test(raw) && /\d/.test(raw)) tokens.add(raw);
  }
  // Also capture separated model numbers ("udx 200" / "udx-200" -> "udx200").
  for (const m of text.matchAll(/[a-z]{2,}[-\s]?\d{2,}[a-z0-9]*|\d{2,}[-\s]?[a-z]{2,}/g)) {
    tokens.add(m[0].replace(/[-\s]+/g, ""));
  }
  return [...tokens];
}

// Generic HVAC/plumbing category words. These describe WHAT a part is, not WHICH
// product — so on their own they must not qualify a different brand's document
// ("air handler" shouldn't pull a Honeywell doc for a Nordyne request). A brand
// or model token, when present, always wins over these.
const GENERIC_TERMS = new Set([
  "motor", "blower", "fan", "pump", "valve", "handler", "furnace", "boiler",
  "heater", "water", "air", "coil", "filter", "thermostat", "aquastat", "relay",
  "transformer", "capacitor", "igniter", "ignitor", "sensor", "control",
  "controls", "board", "kit", "gas", "oil", "heat", "cool", "cooling", "heating",
  "burner", "nozzle", "gasket", "bearing", "belt", "pulley", "damper", "actuator",
  "zone", "switch", "limit", "pressure", "flame", "spark", "electrode", "element",
  "anode", "thermocouple", "thermopile", "condenser", "evaporator", "compressor",
  "refrigerant", "duct", "ductwork", "vent", "flue", "draft", "inducer", "exhaust",
  "intake", "wheel", "housing", "mount", "bracket", "panel", "cover", "door",
  "plumbing", "radiator", "baseboard", "register", "grille", "diffuser", "handling"
]);

// Does this document actually reference the product the customer named? Checked
// against the filename (brand-coded, e.g. REZNORINST / HNYWLLINST) and the text
// snippet. When the customer named a brand/model (a non-generic token), require a
// match on THAT — a generic category word alone won't pass a cross-brand doc. If
// only generic terms were given (no brand), fall back to matching any of them.
function documentMatchesQuery(doc, tokens) {
  if (!tokens.length) return true;
  const hay = `${doc.filename || ""} ${doc.snippet || ""}`.toLowerCase();
  const squished = hay.replace(/[^a-z0-9]+/g, "");
  const has = (t) => hay.includes(t) || squished.includes(t);
  const strong = tokens.filter((t) => !GENERIC_TERMS.has(t));
  return (strong.length ? strong : tokens).some(has);
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

async function searchDocumentsForQuery(query, vectorStoreId, apiKey, model, effort = "low") {
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
      // This call runs *after* the main one on doc requests, so its latency lands on top
      // of the reply the customer is already waiting for. It only has to run the retrieval
      // — relevance filtering happens in code below — so it needs no deliberation.
      reasoning: { effort },
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

// Conversational filler that carries no product signal. Tokens containing a digit
// (model/part numbers) are never filtered. Without this, a politely-phrased question
// like "do you have a replacement lamp for an Epson Home Cinema 8350" used to send
// its first 8 words — all filler — to Shopify search and find nothing.
const SEARCH_STOPWORDS = new Set([
  "do", "you", "have", "a", "an", "the", "for", "my", "i", "im", "need", "needs",
  "looking", "some", "any", "of", "to", "can", "could", "would", "please", "me",
  "is", "it", "its", "that", "this", "on", "in", "with", "and", "or", "what",
  "whats", "does", "did", "was", "help", "find", "buy", "sell", "stock", "carry",
  "hi", "hello", "hey", "thanks", "there", "your", "we", "us", "get", "am",
  "wondering", "if", "know", "tell", "about", "just", "also", "still", "think",
]);

// Shopify search syntax a person might type on purpose ("tag:HK42FZ004", "sku:308660").
// Only a field name glued to its value passes through untouched. Any other colon is
// ordinary punctuation: customers copy labels ("Model: GMH80803BNBB", "Part #: 0130F00506",
// "Projector: Runco Reflection VX-1000Ci"). Every message with a colon used to go to
// Shopify verbatim as one query, which matched nothing, and the finder told a customer we
// don't carry a Runco lamp that was in stock at $235 (2026-09-11).
const SHOPIFY_FIELD_QUERY = /(?:^|\s)-?(?:title|tag|tag_not|sku|vendor|product_type|handle|variants\.sku):\S/i;

// A part or model number: letters and digits together ("VX-1000Ci", "0130F00506"), or a
// long number ("151-1026-00"). Shorter bare numbers ("2", "8124", a ZIP code) stay
// ordinary terms.
function isPartCodeTerm(term) {
  const raw = String(term || "");
  const t = raw.replace(/[^A-Za-z0-9]/g, "");
  // Spec wording, not a part: "3-Phase", "2-stage", or a capitalised word glued to a
  // number by a paste that lost its spaces ("460VAmperage").
  if (raw.split("-").some((seg) => SPEC_WORD.test(seg)) || /[A-Z][a-z]{3,}/.test(raw)) return false;
  return (/\d/.test(t) && /[A-Za-z]/.test(t) && t.length >= 4) || /^\d{6,}$/.test(t);
}
const SPEC_WORD = /^(phase|stage|speed|pack|wire|pole|ton|way|inch|volt|watt|amp|frame|piece|port|row|year)s?$/i;

// Packaging suffixes. Resideo / Honeywell Home catalog numbers end in "/U" (other makers
// use a letter or two the same way): the box and Resideo's site say Q3400A1024/U, the
// supplier feed and our listing say Q3400A1024. Shopify never matches one to the other, so
// the finder and the site search told a customer we didn't carry a part with 69 in stock
// (SKU 2405, 2026-10-08). Fractions ("3/4", "UPS50-40/4") end in a digit and never match.
const PACKAGING_SUFFIX = /^(.*\d.*)\/([A-Za-z]{1,2})$/;
function withoutPackagingSuffix(term) {
  const match = PACKAGING_SUFFIX.exec(String(term || ""));
  return match && isPartCodeTerm(term) && isPartCodeTerm(match[1]) ? match[1] : term;
}

const SEARCH_MAX_TERMS = 8;

function buildShopifySearchQuery(userText) {
  const compact = userText.trim().replace(/\s+/g, " ");
  if (!compact) {
    return "";
  }

  if (SHOPIFY_FIELD_QUERY.test(compact)) {
    return compact;
  }

  const seen = new Set();
  const words = compact
    .replace(/:/g, " ")
    .split(" ")
    .map((w) => w.replace(/[?!.,;:]+$/, ""))
    // Bare punctuation ("#", "—") and prices ("$235") are never in a product title.
    .filter((w) => /[a-z0-9]/i.test(w) && !/^\$\d/.test(w))
    // Each word once: a pasted label repeats the brand ("Runco ... Runco ... Runco").
    .filter((w) => {
      const key = w.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const meaningful = words.filter(
    (w) => /\d/.test(w) || !SEARCH_STOPWORDS.has(w.toLowerCase().replace(/[^a-z']/g, ""))
  );
  const pool = meaningful.length ? meaningful : words;
  if (pool.length <= SEARCH_MAX_TERMS) return pool.join(" ");
  // Too many words: keep every part number, fill the rest in the order typed. Cutting at
  // the first eight words dropped the number from "my furnace stopped working last night
  // and the tech said I need 0130F00506", which is the one word that names the part.
  const codes = new Set(pool.filter(isPartCodeTerm).slice(0, SEARCH_MAX_TERMS));
  const others = new Set(pool.filter((w) => !codes.has(w)).slice(0, SEARCH_MAX_TERMS - codes.size));
  return pool.filter((w) => codes.has(w) || others.has(w)).join(" ");
}

// Shopify's Storefront products(query:) ANDs every term and does not reliably stem,
// so ONE extra or plural word zeroes out an otherwise perfect match: "vent rite vents"
// returns nothing while "vent rite" returns 8, "taco circulator pumps" returns 1 while
// "pump" returns 5. That silently turned ordinary phrasing into "we don't carry it".
// So when a search comes back empty we retry progressively narrower, dropping the
// least-identifying words first and always keeping part numbers.
const SHOPIFY_SEARCH_ATTEMPTS = 5;
// Plus up to this many single-part-number searches once the ladder runs out.
const SHOPIFY_CODE_ATTEMPTS = 2;

// Narrowing one word at a time never reaches the useful end of a long question: a
// six-term query would stop at three terms and still find nothing. Step down fast
// instead — drop one, then halve, then the best two, then the single most
// identifying term — so even a chatty sentence gets tried as its core terms.
function searchAttemptSizes(termCount) {
  const sizes = [];
  for (const size of [termCount - 1, Math.ceil(termCount / 2), 2, 1]) {
    if (size >= 1 && size < termCount && !sizes.includes(size)) sizes.push(size);
  }
  return sizes;
}

// Words that describe the ASK rather than the product. They survive the stopword
// filter (a customer really did type them) but they are never in a product title, so
// they must not be what a narrowed retry hangs on to.
const SEARCH_ASK_WORDS = new Set([
  "part", "parts", "number", "numbers", "model", "models", "replacement",
  "replacements", "spare", "spares", "item", "items", "product", "products",
  "unit", "units", "piece", "pieces", "equivalent", "compatible", "version",
  // What the customer wants DONE, and when. None of these appear in a product
  // title, but they are ordinary words, so without this they outrank the category
  // word they sit next to: "can you hold a vent rite 1 for pickup tomorrow" kept
  // "hold"/"pickup"/"tomorrow" and dropped "vent", and found nothing.
  "hold", "holds", "reserve", "reserved", "pickup", "pick", "order", "orders",
  "ordering", "buy", "purchase", "quote", "price", "prices", "pricing", "cost",
  "ship", "shipped", "shipping", "deliver", "delivery", "today", "tomorrow",
  "tonight", "available", "availability", "cheapest", "cheap"
]);

// How identifying is this term? Part codes and model numbers are what actually pin
// down a product; category words ("valve", "vent", "relay") and ask-words are the
// first to go.
function searchTermWeight(term) {
  const t = term.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (/[a-z]/.test(t) && /\d/.test(t)) return 4; // part code: B1370F, UDX200
  if (/^\d+$/.test(t)) return 3;                  // model number: 8124
  if (SEARCH_ASK_WORDS.has(t)) return 0;
  // Match the singular too, so "vents"/"pumps" are treated as the category words they are.
  if (GENERIC_TERMS.has(t) || GENERIC_TERMS.has(t.replace(/s$/, ""))) return 1;
  return 2;                                       // brand or other distinctive word
}

// The part the customer is asking FOR, as distinct from the equipment it goes in.
// "I need a thermocouple for my Honeywell gas valve" names one product (thermocouple)
// and one piece of context (a Honeywell gas valve). Shopify search and the title
// re-ranker treated every word alike, and the context words ARE titles we sell, so
// four gas valves outscored the part and the in-stock Honeywell thermocouple was never
// shown. Recognise the ordinary ways a customer says what they want and take the words
// up to the first "for / on / in / with ..." as the product. No match -> empty, and
// every caller behaves exactly as before.
const PRODUCT_CLAUSE = /\b(?:need(?:s|ed)?|want(?:s|ed)?|looking\s+for|searching\s+for|order(?:ing)?|buy(?:ing)?|purchas(?:e|ing)|find|replac(?:e|ing)|get|do\s+you\s+(?:have|carry|sell|stock)|you\s+(?:have|carry|sell|stock)|got)\s+(?:a|an|the|some|any|new|another|one|replacement|spare)?\s*(.+?)(?=\s+(?:for|on|in|with|to|that|which|from|off)\b|[,.?!;]|$)/i;

function productClauseWords(userText) {
  const match = String(userText || "").match(PRODUCT_CLAUSE);
  if (!match) return [];
  return match[1].toLowerCase().split(/[^a-z0-9]+/)
    .filter((w) => w && !SEARCH_STOPWORDS.has(w) && !SEARCH_ASK_WORDS.has(w));
}

// Does this title name the product the customer asked for? Plural-tolerant both ways.
function titleNamesProduct(title, productWords) {
  const tokens = new Set(String(title || "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  return productWords.some((w) => tokens.has(w) || tokens.has(w.replace(/s$/, "")) || tokens.has(w + "s"));
}

function buildShopifySearchCandidates(userText) {
  const primary = buildShopifySearchQuery(userText);
  if (!primary || primary.includes(":")) {
    return primary ? [primary] : []; // raw Shopify query syntax passes through untouched
  }

  const terms = primary.split(" ").filter(Boolean);
  const candidates = [primary];
  // Least-identifying terms drop off first; Array.sort is stable, so equally weighted
  // words keep the order the customer typed them in. The product word gets two extra
  // points so it is the LAST thing to be dropped (category words like "thermocouple" score 1
  // and brands 2, so a single point only tied): "for my honeywell gas valve i need a
  // thermocouple" used to narrow all the way down to "honeywell".
  const productWords = new Set(productClauseWords(userText));
  const weight = (term) => searchTermWeight(term) + (productWords.has(term.toLowerCase().replace(/[^a-z0-9]/g, "")) ? 2 : 0);
  const ranked = [...terms].sort((a, b) => weight(b) - weight(a));

  for (const keep of searchAttemptSizes(terms.length)) {
    const kept = new Set(ranked.slice(0, keep));
    const narrowed = terms.filter((term) => kept.has(term)).join(" ");
    if (narrowed && !candidates.includes(narrowed)) candidates.push(narrowed);
  }

  // Then each part number on its own. The ladder narrows to the single best-weighted
  // term, so a customer who gives two or three numbers ("VX-1000Ci, 151-1026-00,
  // RUPA-004910") was only matched if that one was in the catalog. These run only when
  // every search above came back empty.
  const codes = terms.filter(isPartCodeTerm);
  for (const term of codes) {
    if (!candidates.includes(term)) candidates.push(term);
  }
  const capped = candidates.slice(0, SHOPIFY_SEARCH_ATTEMPTS + SHOPIFY_CODE_ATTEMPTS);

  // Each rung that carries a packaging suffix ("Q3400A1024/U") is retried without it right
  // after, before any narrower rung: the customer's own wording still goes first, so a
  // listing that names the suffixed number keeps matching it.
  const out = [];
  for (const candidate of capped) {
    out.push(candidate);
    const bare = candidate.split(" ").map(withoutPackagingSuffix).join(" ");
    if (bare !== candidate && !capped.includes(bare) && !out.includes(bare)) out.push(bare);
  }

  // Last, the words without the numbers. A number we don't list - very often the
  // customer's UNIT model, which no part names - rides along on every rung above, so
  // "replacement fan motor for Goodman outdoor ac unit VSX130361EH" found nothing at all,
  // when the words alone find the Goodman outdoor fan motors we do sell. Only when the
  // words still name a kind of part plus something else: a brand alone ("honeywell") or
  // filler ("serial", "cross reference") would hand the model a list of unrelated products.
  if (codes.length) {
    const words = terms.filter((term) => !isPartCodeTerm(term) && searchTermWeight(term) > 0);
    const namesAPart = words.some((term) => searchTermWeight(term) === 1);
    const query = words.join(" ");
    if (words.length >= 2 && namesAPart && !out.includes(query)) out.push(query);
  }
  return out;
}

// How many catalog candidates to ASK Shopify for, and how many to actually put in
// front of the model. Shopify's RELEVANCE sort does not weight a bare model number,
// so "vent rite 1" ranked the 31/33/35/57/77 vents above the Vent-Rite 1 we stock —
// with a first:5 window the one product the customer asked for fell off the end and
// the finder told them we might not carry it. Fetch wide, then re-rank in code.
const SHOPIFY_SEARCH_CANDIDATES = 20;
const SHOPIFY_CONTEXT_PRODUCTS = 8;
// How many of the site search's top results join the candidate pool (see siteSearch).
const SITE_SEARCH_RESULTS = 10;

// Which site-search results a finder may use. Each finder only gets its own kind of
// listing: "replacement board" handed the HVAC finder Smart Board projector lamps. Every
// projector listing says so in its title ("Replacement Projector Lamp", "Projector Air
// Filter", "Projector Bulb", "TV Lamp"); HVAC titles never do, and words like "lamp" or
// "bulb" can't decide it ("Air Purifier UV Lamp" and "Bulb Well" are HVAC parts). And when
// the customer typed a part number, only listings that name it: "PowerLite 1980WU" brought
// in the 1985WU filter, a neighbouring model.
const PROJECTOR_LISTING = /\bprojector\b|\btv lamp\b/i;
function siteResultFits(product, tool, codes) {
  const projector = PROJECTOR_LISTING.test(String(product.title || ""));
  if ((tool === "lamp") !== projector) return false;
  if (!codes.length) return true;
  const fields = [product.title, ...(product.tags || []), ...(product.variants?.nodes || []).map((v) => v.sku)]
    .map((s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return codes.some((code) => fields.some((field) => containsCode(field, code)));
}

// The parts of a customer's message that identify WHICH product: bare model numbers
// ("vent rite 1" -> "1"), alphanumeric part codes ("B1370F", "UDX-200" -> "udx200"),
// and ordinary words minus the conversational filler.
function productQueryTokens(userText) {
  const text = String(userText || "").toLowerCase();
  const words = text.split(/[^a-z0-9]+/).filter(Boolean);
  const codes = new Set(words.filter((w) => /[a-z]/.test(w) && /\d/.test(w)));
  // "udx-200" / "udx 200" split into two tokens above; keep the joined form too.
  for (const match of text.matchAll(/[a-z]{2,}[-\s]?\d{2,}[a-z0-9]*/g)) {
    codes.add(match[0].replace(/[-\s]+/g, ""));
  }
  return {
    numbers: words.filter((w) => /^\d+$/.test(w)),
    codes: [...codes],
    words: words.filter((w) => /^[a-z]{3,}$/.test(w) && !SEARCH_STOPWORDS.has(w)),
    product: productClauseWords(userText)
  };
}

// Big enough that naming the asked-for part beats any count of context-word hits
// (each worth 3), small enough that an exact part code (100+) still wins outright.
const PRODUCT_WORD_BONUS = 25;

// Cross-reference part numbers live in product TAGS. 737 of 8,466 active Metropac
// listings (8.7%) carry OEM / alternate numbers there that appear nowhere in the title -
// the ICM Controls ICM282B is tagged HK42FZ004/008/011/016/034, the Carrier boards it
// replaces. Shopify search matches those tags, which is how such a product reaches the
// candidate list at all; but the model was never shown them, so it hedged a listed
// replacement into a "closest match". Keep the part-number-looking tags and drop the
// noise: wattage/voltage ("200W", "24V"), import and date markers, the stock-sync state
// tags, plain category words, anything with a space (a part number never has one - the
// lamp/filter cross-sell tag "Home Cinema 8350-FILTER" does), and anything already in the title.
function crossReferenceTags(product) {
  const titleUp = String(product.title || "").toUpperCase();
  return (product.tags || []).filter((t) =>
    t.length >= 4 && /[0-9]/.test(t) && /[A-Za-z-]/.test(t) && !t.includes(" ") &&
    !/^[0-9.]+ ?(w|v|va|hp|a|amp|k|kw)$/i.test(t) &&
    !/^import-/i.test(t) && !/^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$/.test(t) &&
    !/^(oos-|supplier-|core-|nesh-|gyt-|mm-)/i.test(t) &&
    !titleUp.includes(t.toUpperCase())
  ).slice(0, 12);
}

// A part code that matches a cross-reference tag counts almost like a title match. Kept
// below the 100/120 a title match scores, so a product that IS the part still beats a
// product listed as its replacement.
const CROSS_REFERENCE_CODE_SCORE = 80;

// Does `code` appear in `squished` (lower-case, punctuation removed) as itself, not as the
// front of a longer number? "tw10" is in "emptw100" - a different projector - and scored
// the EMP-TW100 filter as if it were the EMP-TW10 lamp. A trailing letter is still a
// match ("ms524" in "ms524a" is the variant's own neighbour, settled by the exact-token
// bonus); a trailing digit, or a leading one before a numeric code, never is.
function containsCode(squished, code) {
  if (!code) return false;
  for (let at = squished.indexOf(code); at >= 0; at = squished.indexOf(code, at + 1)) {
    const after = squished[at + code.length] || "";
    const before = squished[at - 1] || "";
    if (/\d/.test(after)) continue;
    if (/^\d/.test(code) && /\d/.test(before)) continue;
    return true;
  }
  return false;
}

function scoreProductForQuery(product, tokens) {
  const title = String(product.title || "").toLowerCase();
  const titleTokens = new Set(title.split(/[^a-z0-9]+/).filter(Boolean));
  const squishedTitle = title.replace(/[^a-z0-9]+/g, "");

  const wordHits = tokens.words.filter((w) => titleTokens.has(w)).length;
  let score = wordHits * 3;

  // "thermocouple for my honeywell gas valve": the gas valves match three words, the
  // thermocouple matches two - and the thermocouple is what they asked for.
  if (tokens.product.length && titleNamesProduct(title, tokens.product)) score += PRODUCT_WORD_BONUS;

  // Exact whole-token beats substring. Both used to score 100, so "benq ms524" tied
  // the MS524 listing with the MS524A one and Shopify's own order broke the tie the
  // wrong way - the finder recommended the neighbouring model's lamp. Substring still
  // scores high because it is what catches "udx-200" in a "UDX200" title.
  for (const code of tokens.codes) {
    if (titleTokens.has(code)) score += 120;
    else if (containsCode(squishedTitle, code)) score += 100;
  }
  if (tokens.codes.length) {
    const refs = crossReferenceTags(product).map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""));
    for (const code of tokens.codes) {
      if (refs.some((r) => containsCode(r, code))) { score += CROSS_REFERENCE_CODE_SCORE; break; }
    }
  }

  // A bare number is the strongest signal available when it IS the model ("1"), and
  // pure noise when it is a quantity ("I need 2 gas valves"). Only trust it on a
  // product that already matched a word from the message, so the number breaks ties
  // inside the right family instead of dragging in an unrelated "1/2 inch" listing.
  // Matched as a whole token, so "1" never matches the "31" vent.
  if (wordHits > 0 || !tokens.words.length) {
    for (const number of tokens.numbers) {
      if (titleTokens.has(number)) score += 100;
    }
  }

  return score;
}

// Re-rank Shopify's candidates by how well each title matches what the customer
// actually named, keeping Shopify's own order as the tiebreak so an ordinary query
// with nothing to match on comes back exactly as it does today.
function rankProductsForQuery(products, userText, limit) {
  const tokens = productQueryTokens(userText);
  return products
    .map((product, index) => ({ product, index, score: scoreProductForQuery(product, tokens) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, limit)
    .map((entry) => entry.product);
}

// Lamp finder, overheating: a projector that runs hot or shuts itself off most often
// needs its air filter cleaned or replaced, and the filter costs a fraction of the lamp.
// The customer names the PROJECTOR, and a filter's title rarely does ("Epson V13H134A41
// Replacement Projector Air Filter"), so the ordinary search for "epson powerlite 1980wu"
// returns only the lamp and the finder could name the filter's part number but never
// show its price or link. When a lamp-finder message describes heat or asks about a
// filter, search "<model code> filter" as well, keep only air filters whose listing
// names that code, and quote the listing text that names it - the fitment line sits
// ~1,250 characters into the description, far past the 220 the main block shows.
const LAMP_HEAT_SYMPTOM = /\b(?:over-?heat\w*|too hot|runs? hot|running hot|gets? hot|getting hot|heat(?:ing)? up|temp(?:erature)?s?\b|thermal|shut(?:s|ting)?\s*(?:it\s*self\s*)?(?:off|down)|turn(?:s|ing)?\s+(?:it\s*self\s+)?off|power(?:s|ing)?\s+(?:it\s*self\s+)?(?:off|down)|keeps?\s+(?:shutting|turning|powering)|fans?\s+(?:is\s+|are\s+)?(?:loud|noisy|roaring)|(?:loud|noisy)\s+fans?)/i;
const LAMP_FILTER_WORD = /\bfilters?\b/i;
const FILTER_SEARCH_MAX_TERMS = 3;
const FILTER_CONTEXT_MAX = 3;

function wantsLampFilterSearch(conversation) {
  const text = getLatestUserMessage(conversation);
  return LAMP_HEAT_SYMPTOM.test(text) || LAMP_FILTER_WORD.test(text);
}

// Model codes the customer has given anywhere in the conversation, newest first:
// "1980WU" and "8350" count, "20 minutes" and "3rd floor" do not.
function lampModelTerms(conversation) {
  const terms = [];
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (message?.role !== "user" || !message.content) continue;
    const { codes, numbers } = productQueryTokens(message.content);
    for (const term of [...codes, ...numbers.filter((n) => n.length >= 3)]) {
      if (/^\d+(?:st|nd|rd|th|am|pm|min|mins|hr|hrs|k|p|hz|w|v)$/.test(term)) continue;
      if (!terms.includes(term)) terms.push(term);
    }
  }
  return terms.slice(0, FILTER_SEARCH_MAX_TERMS);
}

function listingExcerpt(text, term) {
  const flat = String(text || "").replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(term);
  if (at < 0) return "";
  return flat.slice(Math.max(0, at - 140), at + term.length + 120).trim();
}

async function lampFilterContext(conversation, runSearch) {
  const terms = lampModelTerms(conversation);
  if (!terms.length) return "";
  const found = new Map();
  for (const term of terms) {
    let results = [];
    try { results = await runSearch(`${term} filter`); } catch { results = []; }
    for (const product of results) {
      if (!/filter/i.test(product.productType || "")) continue;
      const titleHas = String(product.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "").includes(term);
      const excerpt = listingExcerpt(product.description, term);
      if (!titleHas && !excerpt) continue;
      const key = product.handle || product.id;
      if (!found.has(key)) found.set(key, { product, excerpt });
    }
    if (found.size) break;
  }
  if (!found.size) {
    return `AIR FILTER SEARCH for "${terms.join(", ")}": no air filter in our catalog names this projector.`;
  }
  const lines = [`AIR FILTER SEARCH for "${terms.join(", ")}" - air filters in our catalog whose listing names this projector:`];
  for (const { product, excerpt } of [...found.values()].slice(0, FILTER_CONTEXT_MAX)) {
    const price = product.priceRange?.minVariantPrice;
    lines.push([
      `- ${product.title}`,
      product.productType ? `type: ${product.productType}` : "",
      `availability: ${product.availableForSale ? "available" : "unavailable"}`,
      price ? `price: ${price.amount} ${price.currencyCode}` : "price unavailable",
      product.onlineStoreUrl ? `url: ${product.onlineStoreUrl}` : "",
      excerpt ? `listing says: "...${excerpt}..."` : ""
    ].filter(Boolean).join(" | "));
  }
  return lines.join("\n");
}

async function getShopifyProductContext(conversation, options = {}) {
  const tool = options.tool || "hvac";
  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN;
  const storefrontToken = process.env.SHOPIFY_STOREFRONT_ACCESS_TOKEN;
  const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-01";

  if (!storeDomain || !storefrontToken) {
    return null;
  }

  const latestUserMessage = getLatestUserMessage(conversation);
  const searchCandidates = buildShopifySearchCandidates(latestUserMessage);
  const searchQuery = searchCandidates[0];
  if (!searchQuery) {
    return null;
  }

  const endpoint = `https://${storeDomain}/api/${apiVersion}/graphql.json`;
  const productFields = `
          id
          title
          handle
          productType
          tags
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
          }`;
  const graphQLQuery = `
    query HelpPageProducts($query: String!) {
      products(first: ${SHOPIFY_SEARCH_CANDIDATES}, query: $query, sortKey: RELEVANCE) {
        nodes {${productFields}
        }
      }
    }
  `;
  const siteSearchQuery = `
    query HelpPageSiteSearch($query: String!) {
      search(query: $query, first: ${SITE_SEARCH_RESULTS}, types: [PRODUCT], unavailableProducts: LAST) {
        nodes {
          ... on Product {${productFields}
          }
        }
      }
    }
  `;

  const storefront = async (query, term) => {
    const shopifyResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": storefrontToken
      },
      body: JSON.stringify({
        query,
        variables: {
          query: term
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

    return payload?.data || {};
  };
  const runSearch = async (term) => (await storefront(graphQLQuery, term))?.products?.nodes || [];

  // The site's own search (the engine behind the storefront search box) ranks an exact
  // model match first; products(query:) does not. "EW300N" matches 117 Hitachi listings,
  // and products(query:) put ten other models ahead of the three EW300N lamps, so the
  // first page came back full, the search stopped, and the finder told the customer we
  // had no lamp for it (2026-09-09; EH-TW7400 the same). Its top results join the pool for
  // the re-ranker, which only lets them win on a better title match. Started now, so it
  // runs alongside the first search instead of adding a wait; a failure costs nothing.
  const siteSearch = storefront(siteSearchQuery, searchCandidates[0])
    .then((data) => (data?.search?.nodes || []).filter((node) => node && node.handle))
    .catch(() => []);

  // A rung that came back non-empty used to end the search - wrong when it is non-empty
  // with the WRONG products. "thermocouple for my honeywell gas valve" matched four gas
  // valves (their descriptions mention thermocouples) and stopped, so the model never saw
  // the in-stock Honeywell thermocouple one rung down. Now, when the customer named the
  // part they want, keep descending until at least one title names it (or the ladder runs
  // out), pooling every rung's results for the re-ranker. A query with no recognisable
  // product clause, or whose first rung already names the part, stops exactly where it
  // did before, so the common case is still one ~0.2s round-trip.
  const productWords = productClauseWords(latestUserMessage);
  const pool = new Map();
  const usedQueries = [];
  let namedTheProduct = false;
  for (const candidate of searchCandidates) {
    const results = await runSearch(candidate);
    usedQueries.push(candidate);
    for (const product of results) {
      const key = product.handle || product.id;
      if (!pool.has(key)) pool.set(key, product);
      if (!namedTheProduct && productWords.length && titleNamesProduct(product.title, productWords)) namedTheProduct = true;
    }
    if (pool.size && (!productWords.length || namedTheProduct)) break;
  }
  const askedCodes = productQueryTokens(latestUserMessage).codes;
  for (const product of await siteSearch) {
    if (!pool.has(product.handle) && siteResultFits(product, tool, askedCodes)) pool.set(product.handle, product);
  }
  const matched = [...pool.values()];
  const usedQuery = usedQueries.join(" / ");

  const products = rankProductsForQuery(matched, latestUserMessage, SHOPIFY_CONTEXT_PRODUCTS);
  // Lamp finder only: the air-filter lookup rides alongside the ordinary results. The HVAC
  // finder never reaches this, so its context is byte-for-byte what it was.
  const filterBlock = tool === "lamp" && wantsLampFilterSearch(conversation)
    ? await lampFilterContext(conversation, runSearch)
    : "";
  if (!products.length) {
    return {
      source: "shopify",
      searchQuery,
      handles: [],
      text: [`Live Shopify product search for "${latestUserMessage}" returned no matches.`, filterBlock].filter(Boolean).join("\n\n")
    };
  }

  const lines = [
    `Live Shopify product search results for "${latestUserMessage}" using query "${usedQuery}":`
  ];
  // Say so when a match came from dropping a packaging suffix, or the model hedges the
  // exact part into a "closest match" because the title lacks the "/U".
  for (const asked of new Set(latestUserMessage.split(/\s+/).map((w) => w.replace(/[?!.,;:]+$/, "")))) {
    const bare = withoutPackagingSuffix(asked);
    if (bare === asked || !usedQueries.some((q) => q.split(" ").includes(bare))) continue;
    lines.push(/\/u$/i.test(asked)
      ? `Note: "${asked}" was searched as "${bare}". "/U" is the manufacturer's packaging code, so a listing for ${bare} IS the part the customer asked for.`
      : `Note: "${asked}" was searched as "${bare}" (without the "${asked.slice(bare.length)}" ending). Name the exact number the listing shows.`);
  }

  for (const product of products) {
    const crossRefs = crossReferenceTags(product);
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
        // Supplier/vendor is confidential — never expose it to customers (vendor != brand).
        product.productType ? `type: ${product.productType}` : "",
        crossRefs.length ? `cross-reference: ${crossRefs.join(", ")}` : "",
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
    searchQuery: usedQuery,
    // What the model was shown, recorded with the chat so a reply that offered nothing
    // can be told apart: search found nothing, or search found it and the reply didn't use it.
    handles: products.map((p) => p.handle).filter(Boolean),
    text: [lines.join("\n"), filterBlock].filter(Boolean).join("\n\n")
  };
}

// Reasoning effort for both OpenAI calls. Kept deliberately narrow: an unknown value
// from /admin (or a typo in the env) would make every request 400, so anything not on
// the allow-list falls back to "low" rather than reaching the API.
const REASONING_EFFORTS = ["minimal", "low", "medium", "high"];

function resolveReasoningEffort(config) {
  const raw = String(
    config?.reasoningEffort || process.env.OPENAI_REASONING_EFFORT || "low"
  ).trim().toLowerCase();
  return REASONING_EFFORTS.includes(raw) ? raw : "low";
}

// Read an OpenAI Responses API SSE stream, handing prose deltas to onDelta the moment
// they arrive and returning the SAME completed payload the buffered call returns — so
// every downstream consumer (summarizeTools, extractResponseText) is untouched.
async function consumeResponseStream(openAIResponse, onDelta) {
  const reader = openAIResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let streamedText = "";
  let finalPayload = null;
  let streamError = "";

  const handleFrame = (frame) => {
    const dataLines = [];
    for (const rawLine of frame.split("\n")) {
      const line = rawLine.replace(/\r$/, "");
      if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    if (!raw || raw === "[DONE]") return;

    let event;
    try {
      event = JSON.parse(raw);
    } catch {
      return; // an unparseable frame isn't worth killing a live reply over
    }

    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      streamedText += event.delta;
      onDelta(event.delta);
      return;
    }
    if (event.type === "response.completed" || event.type === "response.incomplete") {
      finalPayload = event.response || null;
      return;
    }
    if (event.type === "response.failed") {
      streamError = event.response?.error?.message || "OpenAI request failed.";
      return;
    }
    if (event.type === "error") {
      streamError = event.message || event.error?.message || "OpenAI stream error.";
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split;
    while ((split = buffer.indexOf("\n\n")) !== -1) {
      handleFrame(buffer.slice(0, split));
      buffer = buffer.slice(split + 2);
    }
  }
  if (buffer.trim()) handleFrame(buffer);

  if (streamError) throw new Error(streamError);

  // A stream that ends without response.completed still delivered prose the customer
  // has already read on screen — keep it rather than erroring out on a visible reply.
  return finalPayload || { output_text: streamedText, output: [] };
}

// options.onDelta — when supplied the upstream call streams, and each prose delta is
// handed over as it lands. options.signal aborts the completion if the customer leaves.
async function createOpenAIResponse(conversation, cfg = null, options = {}) {
  const onDelta = typeof options.onDelta === "function" ? options.onDelta : null;
  const signal = options.signal || undefined;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in .env.");
  }

  const config = cfg || loadConfig();
  const model = config.model || process.env.OPENAI_MODEL || "gpt-5-mini";
  const reasoningEffort = resolveReasoningEffort(config);
  const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
  const enableWebSearch = !!config.enableWebSearch;

  const tools = [];

  // The model is deliberately NOT given the document tool. When it could search
  // the library it narrated loosely-related PDFs ("I found the guide…") on plain
  // parts queries, and its prose about which docs exist fought the code's gate —
  // producing replies that claimed to have (or not have) a manual that didn't
  // match what was actually attached. Documents are now handled in exactly one
  // place: the handler runs a gated library search (searchDocumentsForQuery) only
  // when the customer explicitly asks, and appends the matches. The model just
  // finds the part. (vectorStoreId is still used by that handler-side search.)

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
      },
      // customer photo attachments (nameplate shots etc.) ride along as vision inputs
      ...(message.role === "user" && Array.isArray(message.images)
        ? message.images.slice(0, 3)
            .filter((u) => typeof u === "string" && u.startsWith("data:image/"))
            .map((u) => ({ type: "input_image", image_url: u }))
        : [])
    ]
  }));

  const shopifyContext = await getShopifyProductContext(conversation, { tool: options.tool });
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
    signal,
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
      // Streaming changes WHEN the words arrive, not what they are: the completed
      // payload is reassembled below and every gate downstream still runs on it.
      ...(onDelta ? { stream: true } : {}),
      // Finding a part in our own catalog is a lookup, not a puzzle. Left at the model's
      // default effort this call burned ~832 of 986 output tokens on hidden reasoning and
      // took ~13s; "low" answers the same question in ~5s. Tunable in /admin if replies
      // ever start missing nuance — raise to "medium" before changing anything else.
      reasoning: { effort: reasoningEffort },
      // Agent behavior is managed in /admin (persisted in finder-config.json); the default is
      // the Chatbase "Base Instructions" export adapted for these native tools.
      instructions: config.instructions
    })
  });

  if (!openAIResponse.ok) {
    let message = "OpenAI request failed.";
    try {
      message = (await openAIResponse.json())?.error?.message || message;
    } catch {
      // non-JSON upstream error body; the generic message stands
    }
    throw new Error(message);
  }

  const payload = onDelta
    ? await consumeResponseStream(openAIResponse, onDelta)
    : await openAIResponse.json();

  return {
    payload,
    usedSources: shopifyContext?.text ? ["shopify"] : [],
    // null = the catalog search didn't run (no store credentials, or nothing to search on)
    catalog: shopifyContext ? { query: shopifyContext.searchQuery || "", handles: shopifyContext.handles || [] } : null
  };
}

// Fire-and-forget: record a completed Parts Finder Q&A turn in the NESH CRM (chat_logs).
// Never blocks or affects the customer's reply; silently no-ops if CRM_CHATLOG_SECRET is unset.
function logChatToCrm(conversation, reply, usedTools, documents, sessionId, tool = "hvac", catalog = null) {
  const secret = process.env.CRM_CHATLOG_SECRET;
  if (!secret) return;
  const url = process.env.CRM_CHATLOG_URL || "https://nesh-crm.onrender.com/api/hooks/finder-chat";
  const lastUser = [...conversation].reverse().find((m) => m && m.role === "user");
  if (!lastUser || !reply) return;
  const photoNote = Array.isArray(lastUser.images) && lastUser.images.length ? "[📷 photo attached] " : "";
  const payload = {
    session_id: sessionId || "",
    source: "parts-finder",
    // Which finder answered. Without this the CRM cannot tell an HVAC conversation from
    // a projector-lamp one — they were byte-identical in the log until 2026-08-23.
    tool: tool || "hvac",
    question: (photoNote + String(lastUser.content || "")).slice(0, 8000),
    answer: String(reply).slice(0, 20000),
    used_tools: usedTools || "",
    documents: (Array.isArray(documents) ? documents : [])
      .map((d) => ({ filename: d.filename || d.title || "", url: d.url || d.document_url || d.file_url || "" }))
      .slice(0, 20),
    // What the store search handed the model this turn (feeds the CRM's weekly gap report).
    // Left out when the search didn't run, so the CRM can tell "found nothing" from "not recorded".
    ...(catalog ? { catalog_query: String(catalog.query || "").slice(0, 300), catalog_handles: catalog.handles.slice(0, 20) } : {}),
  };
  fetch(`${url}?secret=${encodeURIComponent(secret)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {}); // best-effort; a CRM hiccup must never break the finder
}

// ---------- Parts Finder admin: config-rendered page + management API ----------
const escapeHtmlServer = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Fill finder.html's __CFG_*__ tokens from the persisted config. `tool` is echoed
// into the page so the client posts it back on every /api/chat call.
function renderFinderPage(template, cfg, tool = "hvac") {
  const chipsHtml = (Array.isArray(cfg.chips) ? cfg.chips : [])
    .filter((c) => c && c.label && c.q)
    .map((c) => `<button type="button" data-q="${escapeHtmlServer(c.q)}">${escapeHtmlServer(c.label)}<span>${escapeHtmlServer(c.sub || "")}</span></button>`)
    .join("\n        ");
  return template
    .replace("__CFG_HEADING__", escapeHtmlServer(cfg.welcomeHeading))
    .replace("__CFG_WELCOME__", escapeHtmlServer(cfg.welcomeText))
    .replace("__CFG_PLACEHOLDER__", escapeHtmlServer(cfg.placeholder))
    .replace("__CFG_CHIPS__", chipsHtml)
    .replace(/__CFG_TOOL__/g, escapeHtmlServer(tool))
    // The <title> is what the browser tab, a bookmark and a share preview show.
    // It was a hardcoded HVAC string, so /lamp-finder announced itself as the HVAC tool.
    .replace("__CFG_TITLE__", escapeHtmlServer(
      tool === "lamp" ? "Projector Lamp Finder" : "HVAC Parts & Diagnostic Assistant"));
}

// Admin gate (HTTP Basic, username blank). Locked in the cloud until ADMIN_PASSWORD is set;
// open on local runs for convenience (same convention as nesh-crm).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
function adminAuthed(request) {
  if (!ADMIN_PASSWORD) return !process.env.RENDER;
  const h = request.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  const dec = Buffer.from(h.slice(6), "base64").toString();
  return dec.slice(dec.indexOf(":") + 1) === ADMIN_PASSWORD;
}

// IW Scheduler (Jason's ops app) manages both finders from its Ask tab. It signs each
// admin request with a P-256 key it generated for itself; only the PUBLIC half lives
// here, in IWS_PUBLIC_JWK (published at <iws>/api/finder/key). So no password is shared,
// and a leaked env var can't be used to write anything.
// Each token is bound to one method + path, lives about a minute, and is accepted once.
// It reaches the config, version-history, restore and chat-log routes, nothing else —
// not the knowledge-base uploads or deletes.
const IWS_ROUTES = /^\/admin\/api\/(config|config\/history|config\/history\/[\w-]+|config\/restore|logs)$/;
const IWS_CLOCK_SKEW_S = 30;
let iwsPublicKey = null;
if (process.env.IWS_PUBLIC_JWK) {
  try {
    iwsPublicKey = createPublicKey({ key: JSON.parse(process.env.IWS_PUBLIC_JWK), format: "jwk" });
  } catch (error) {
    console.error(`IWS_PUBLIC_JWK is set but unreadable, so IW Scheduler can't reach the admin API: ${error.message}`);
  }
}
const iwsSeenTokens = new Map();   // jti -> exp (seconds); a replayed token is refused

function iwsAuthed(request, requestUrl) {
  if (!iwsPublicKey) return false;
  const h = request.headers.authorization || "";
  if (!h.startsWith("IWS ")) return false;
  const parts = h.slice(4).trim().split(".");
  if (parts.length !== 3) return false;
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch {
    return false;
  }
  if (header?.alg !== "ES256") return false;
  const signed = verifySignature(
    "sha256",
    Buffer.from(`${parts[0]}.${parts[1]}`),
    { key: iwsPublicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(parts[2], "base64url")
  );
  if (!signed) return false;
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== "finder-admin") return false;
  if (typeof claims.exp !== "number" || claims.exp + IWS_CLOCK_SKEW_S < now || claims.exp > now + 300) return false;
  if (claims.m !== request.method || claims.p !== requestUrl.pathname + requestUrl.search) return false;
  if (!IWS_ROUTES.test(requestUrl.pathname)) return false;
  if (typeof claims.jti !== "string" || claims.jti.length < 16 || iwsSeenTokens.has(claims.jti)) return false;
  for (const [jti, exp] of iwsSeenTokens) if (exp + IWS_CLOCK_SKEW_S < now) iwsSeenTokens.delete(jti);
  iwsSeenTokens.set(claims.jti, claims.exp);
  return true;
}

async function openAiAdmin(pathname, options = {}) {
  const res = await fetch(`https://api.openai.com${pathname}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      ...(options.headers || {})
    }
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload?.error?.message || `OpenAI ${res.status}`);
  return payload;
}

// List knowledge-base files. Membership comes from the vector store (paginated); names/sizes
// come from ONE bulk /v1/files listing joined locally — avoids per-file lookups that trip
// OpenAI rate limits on large stores.
async function listKbFiles() {
  const vsId = process.env.OPENAI_VECTOR_STORE_ID;
  const entries = [];
  let after = "";
  let more = false;
  for (let page = 0; page < 60; page++) {
    const list = await openAiAdmin(`/v1/vector_stores/${vsId}/files?limit=100${after ? `&after=${after}` : ""}`);
    const data = Array.isArray(list?.data) ? list.data : [];
    entries.push(...data);
    more = !!list?.has_more;
    if (!more || !data.length) break;
    after = data[data.length - 1].id;
  }
  const metaById = new Map();
  const bulk = await openAiAdmin(`/v1/files?limit=10000`);
  for (const f of (Array.isArray(bulk?.data) ? bulk.data : [])) {
    metaById.set(f.id, { filename: f.filename || f.id, bytes: f.bytes || 0 });
  }
  const files = entries.map((e) => {
    const meta = metaById.get(e.id) || { filename: e.id, bytes: e.usage_bytes || 0 };
    return { id: e.id, filename: meta.filename, bytes: meta.bytes, status: e.status || "unknown" };
  });
  files.sort((a, b) => a.filename.localeCompare(b.filename));
  return { files, totalBytes: files.reduce((n, f) => n + (f.bytes || 0), 0), hasMore: more };
}

async function readJsonBody(request, maxBytes = 80 * 1048576) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > maxBytes) throw new Error("Request body too large.");
  }
  return JSON.parse(raw || "{}");
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

  // ── BOT PROBE ───────────────────────────────────────────────────────────────
  // Returns a 1x1 GIF and logs the caller's IP + user agent. It exists to identify
  // the headless-Chrome crawler that is ~51% of GA4 sessions and 0% of revenue.
  // It is referenced ONLY from the honeypot storefront page /pages/d29vZC1jaG, a
  // URL measured at 54/54 crawler sessions and zero human visitors — so no real
  // customer's address is recorded here. Nothing else links to it.
  // REMOVE THIS once the crawler is identified: see project_direct_traffic_bot.
  if (request.method === "GET" && requestUrl.pathname === "/bot-probe") {
    const ip = (request.headers["x-forwarded-for"] || "").split(",")[0].trim()
      || request.socket?.remoteAddress || "";
    console.log("[nesh-botprobe] " + JSON.stringify({
      t: new Date().toISOString(),
      ip,
      ua: request.headers["user-agent"] || "",
      ref: request.headers.referer || request.headers.referrer || "",
      lang: request.headers["accept-language"] || "",
      enc: request.headers["accept-encoding"] || "",
      acc: request.headers.accept || "",
      via: request.headers.via || "",
      chUa: request.headers["sec-ch-ua"] || "",
      chPlat: request.headers["sec-ch-ua-platform"] || "",
      chMobile: request.headers["sec-ch-ua-mobile"] || "",
      fetchSite: request.headers["sec-fetch-site"] || "",
      tag: requestUrl.searchParams.get("t") || ""
    }));
    // 1x1 transparent GIF, never cached so every visit is logged
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    response.writeHead(200, {
      "Content-Type": "image/gif",
      "Content-Length": gif.length,
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Access-Control-Allow-Origin": "*"
    });
    response.end(gif);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/") {
    const html = await readFile(path.join(__dirname, "help-page.html"), "utf8");
    sendHtml(response, 200, html, origin);
    return;
  }

  // Both finder tools render the same page shell; the config decides the wording
  // and the `tool` field decides which brain answers. /finder stays the HVAC tool
  // so every existing storefront link and bookmark is untouched.
  const finderRoute = requestUrl.pathname.match(/^\/(finder|lamp-finder)\/?$/);
  if (request.method === "GET" && finderRoute) {
    const tool = finderRoute[1] === "lamp-finder" ? "lamp" : "hvac";
    try {
      const template = await readFile(path.join(__dirname, "finder.html"), "utf8");
      sendHtml(response, 200, renderFinderPage(template, loadConfig(tool), tool), origin);
    } catch (error) {
      sendJson(response, 500, { error: `Failed to load finder page: ${error.message}` }, origin);
    }
    return;
  }

  // /chatbase-help is the retired Chatbase-proxy URL, but it is still what the live theme
  // iframes: the stored page settings point here, and both help-chat sections hard-code a
  // "Start over" bounce through /chatbase-help/reset (the desktop section fires it on every
  // page load, not just on click). While these 404'd, the storefront help page rendered the
  // JSON error inside a full-viewport iframe — a white screen. Serve the first-party HVAC
  // finder here so every old theme copy, bookmark, and embed works without a theme re-upload.
  if (request.method === "GET" && (requestUrl.pathname === "/chatbase-help" || requestUrl.pathname === "/chatbase-help/")) {
    try {
      const template = await readFile(path.join(__dirname, "finder.html"), "utf8");
      sendHtml(response, 200, renderFinderPage(template, loadConfig("hvac"), "hvac"), origin);
    } catch (error) {
      sendJson(response, 500, { error: `Failed to load finder page: ${error.message}` }, origin);
    }
    return;
  }

  // Anything deeper — the theme's /chatbase-help/reset?next=… bounce and any other old
  // proxy subpath — redirects to a fresh finder load. The finder keeps its chat in memory
  // only, so a plain reload IS the reset; the cache-buster guarantees the iframe
  // re-navigates. `next` is deliberately ignored: honouring it would be an open redirect,
  // and every value the theme ever sent pointed back at this same origin anyway.
  if (request.method === "GET" && requestUrl.pathname.startsWith("/chatbase-help/")) {
    response.writeHead(302, { "Location": `/finder?reset=${Date.now()}`, "Cache-Control": "no-store" });
    response.end();
    return;
  }

  // Short, clean mobile link for Claude Tools: /t/<TOOLS_TOKEN> — no query string, no special
  // chars, so it survives copy/paste, messaging apps, and Add-to-Home-Screen intact.
  const shortTools = requestUrl.pathname.match(/^\/t\/([A-Za-z0-9]+)\/?$/);
  if (request.method === "GET" && shortTools) {
    if (process.env.TOOLS_TOKEN && shortTools[1] === process.env.TOOLS_TOKEN) {
      try {
        const html = await readFile(path.join(__dirname, "tools.html"), "utf8");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(html);
      } catch (error) {
        sendJson(response, 500, { error: error.message }, origin);
      }
    } else {
      response.writeHead(404, { "Content-Type": "text/plain" });
      response.end("Not found");
    }
    return;
  }

  // Public home-screen icon for the mobile Claude Tools page (not sensitive; ungated so
  // iOS/Android can always fetch it for the home-screen shortcut).
  if (request.method === "GET" && requestUrl.pathname === "/tools-icon.png") {
    try {
      const png = await readFile(path.join(__dirname, "tools-icon.png"));
      response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" });
      response.end(png);
    } catch (error) {
      sendJson(response, 404, { error: "icon not found" }, origin);
    }
    return;
  }

  // ---------- Admin panel (HTTP Basic; see adminAuthed) ----------
  if (requestUrl.pathname === "/admin" || requestUrl.pathname.startsWith("/admin/")) {
    // The Claude Tools launcher (/admin/tools) also accepts a URL token (?k=TOOLS_TOKEN) so it
    // opens on a phone with NO Basic-auth dialog — many mobile/in-app browsers show a blank
    // dark page instead of the password prompt. Everything else stays password-only.
    const isToolsGet = request.method === "GET"
      && (requestUrl.pathname === "/admin/tools" || requestUrl.pathname === "/admin/tools/");
    const tokenOk = !!process.env.TOOLS_TOKEN && requestUrl.searchParams.get("k") === process.env.TOOLS_TOKEN;
    if (!(adminAuthed(request) || iwsAuthed(request, requestUrl) || (isToolsGet && tokenOk))) {
      response.writeHead(401, { "WWW-Authenticate": 'Basic realm="Parts Finder Admin"' });
      response.end("Authentication required");
      return;
    }

    if (request.method === "GET" && (requestUrl.pathname === "/admin" || requestUrl.pathname === "/admin/")) {
      try {
        const html = await readFile(path.join(__dirname, "admin.html"), "utf8");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(html);
      } catch (error) {
        sendJson(response, 500, { error: error.message }, origin);
      }
      return;
    }

    // Mobile launcher: the "Claude Tools" page, gated by the admin password (it shows the
    // CRM/admin passwords). Open on a phone → Add to Home Screen for an app icon.
    if (request.method === "GET" && (requestUrl.pathname === "/admin/tools" || requestUrl.pathname === "/admin/tools/")) {
      try {
        const html = await readFile(path.join(__dirname, "tools.html"), "utf8");
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end(html);
      } catch (error) {
        sendJson(response, 500, { error: error.message }, origin);
      }
      return;
    }

    // ?tool=lamp manages the Projector Lamp Finder's config; no query string
    // keeps the existing HVAC behaviour byte-for-byte.
    if (requestUrl.pathname === "/admin/api/config" || requestUrl.pathname.startsWith("/admin/api/config/")) {
      const rawTool = requestUrl.searchParams.get("tool");
      // resolveTool fails open to hvac, which is right for /api/chat but wrong here:
      // a typo like ?tool=lamps would silently merge a lamp edit into the live HVAC
      // config, with the panel reporting success. Reject instead.
      if (rawTool !== null && !isTool(rawTool)) {
        sendJson(response, 400, { error: `Unknown tool "${rawTool}". Expected one of: ${TOOLS.join(", ")}.` }, origin);
        return;
      }
      const cfgTool = resolveTool(rawTool);
      // _tool lets the panel assert it read/wrote the profile it meant to, and _version is
      // the fingerprint it sends back on save. Neither is in CONFIG_FIELDS, so neither can
      // ever be persisted into a config file.
      const stamp = (cfg) => ({ ...cfg, _tool: cfgTool, _version: configVersion(cfgTool) });
      // A save or restore made on top of a version the sender never saw is refused, so
      // two editors (the panel and an API call) can't silently undo each other.
      const staleBase = (body) => body._baseVersion && body._baseVersion !== configVersion(cfgTool);
      const STALE = "The finder was changed after you loaded it. Reload to see the newer version, then make your change again.";
      // "admin" only when the panel says so, "iws" only on a request IW Scheduler signed;
      // every other writer is recorded as the API.
      const viaIws = (request.headers.authorization || "").startsWith("IWS ");
      const metaFrom = (body) => ({
        source: body._source === "admin" ? "admin" : viaIws ? "iws" : "api",
        note: body._note
      });

      if (requestUrl.pathname === "/admin/api/config") {
        if (request.method === "GET") {
          sendJson(response, 200, stamp(loadConfig(cfgTool)), origin);
          return;
        }
        if (request.method === "PUT") {
          try {
            const body = await readJsonBody(request, 1048576);
            if (staleBase(body)) {
              sendJson(response, 409, { error: STALE, _version: configVersion(cfgTool) }, origin);
              return;
            }
            const partial = {};
            for (const k of CONFIG_FIELDS) if (body[k] !== undefined) partial[k] = body[k];
            sendJson(response, 200, stamp(saveConfig(partial, cfgTool, metaFrom(body))), origin);
          } catch (error) {
            sendJson(response, 400, { error: error.message }, origin);
          }
          return;
        }
      }

      // Version history: every save, newest first, without the config bodies.
      if (requestUrl.pathname === "/admin/api/config/history" && request.method === "GET") {
        sendJson(response, 200, { tool: cfgTool, _version: configVersion(cfgTool), versions: listHistory(cfgTool) }, origin);
        return;
      }

      // One version in full, plus the one saved before it, so the panel can show exactly
      // what that save changed.
      const versionMatch = requestUrl.pathname.match(/^\/admin\/api\/config\/history\/([\w-]+)$/);
      if (versionMatch && request.method === "GET") {
        const entry = getHistory(cfgTool, versionMatch[1]);
        if (!entry) {
          sendJson(response, 404, { error: "No such version." }, origin);
          return;
        }
        const ids = listHistory(cfgTool).map((v) => v.id);
        const prevId = ids[ids.indexOf(entry.id) + 1];
        sendJson(response, 200, { entry, previous: prevId ? getHistory(cfgTool, prevId) : null }, origin);
        return;
      }

      if (requestUrl.pathname === "/admin/api/config/restore" && request.method === "POST") {
        try {
          const body = await readJsonBody(request);
          if (staleBase(body)) {
            sendJson(response, 409, { error: STALE, _version: configVersion(cfgTool) }, origin);
            return;
          }
          const before = configVersion(cfgTool);
          const saved = restoreVersion(cfgTool, String(body.id || ""), metaFrom(body));
          sendJson(response, 200, { ...stamp(saved), _restored: configVersion(cfgTool) !== before }, origin);
        } catch (error) {
          sendJson(response, 400, { error: error.message }, origin);
        }
        return;
      }
    }

    // Activity/Analytics data: proxy the CRM's secret-gated chat-log read so the
    // browser never holds the shared secret.
    if (requestUrl.pathname === "/admin/api/logs" && request.method === "GET") {
      try {
        const secret = process.env.CRM_CHATLOG_SECRET;
        if (!secret) throw new Error("CRM_CHATLOG_SECRET not configured.");
        const base = (process.env.CRM_CHATLOG_URL || "https://nesh-crm.onrender.com/api/hooks/finder-chat")
          .replace("/finder-chat", "/finder-chat-logs");
        const qs = new URLSearchParams({ secret, limit: requestUrl.searchParams.get("limit") || "300" });
        if (requestUrl.searchParams.get("day")) qs.set("day", requestUrl.searchParams.get("day"));
        const res = await fetch(`${base}?${qs}`);
        if (!res.ok) throw new Error(`CRM responded ${res.status}`);
        sendJson(response, 200, await res.json(), origin);
      } catch (error) {
        sendJson(response, 502, { error: error.message }, origin);
      }
      return;
    }

    if (requestUrl.pathname === "/admin/api/kb" && request.method === "GET") {
      try {
        sendJson(response, 200, await listKbFiles(), origin);
      } catch (error) {
        sendJson(response, 500, { error: error.message }, origin);
      }
      return;
    }

    if (requestUrl.pathname === "/admin/api/kb" && request.method === "POST") {
      try {
        const { filename, base64 } = await readJsonBody(request);
        if (!filename || !base64) throw new Error("filename and base64 are required.");
        const bytes = Buffer.from(base64, "base64");
        const form = new FormData();
        form.append("purpose", "assistants");
        form.append("file", new Blob([bytes]), filename);
        const uploaded = await openAiAdmin("/v1/files", { method: "POST", body: form });
        await openAiAdmin(`/v1/vector_stores/${process.env.OPENAI_VECTOR_STORE_ID}/files`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_id: uploaded.id })
        });
        sendJson(response, 200, { ok: true, fileId: uploaded.id }, origin);
      } catch (error) {
        sendJson(response, 500, { error: error.message }, origin);
      }
      return;
    }

    const kbDelete = requestUrl.pathname.match(/^\/admin\/api\/kb\/([\w-]+)$/);
    if (kbDelete && request.method === "DELETE") {
      try {
        const fileId = kbDelete[1];
        await openAiAdmin(`/v1/vector_stores/${process.env.OPENAI_VECTOR_STORE_ID}/files/${fileId}`, { method: "DELETE" });
        try { await openAiAdmin(`/v1/files/${fileId}`, { method: "DELETE" }); } catch { /* already detached */ }
        sendJson(response, 200, { ok: true }, origin);
      } catch (error) {
        sendJson(response, 500, { error: error.message }, origin);
      }
      return;
    }

    sendJson(response, 404, { error: "Not found." }, origin);
    return;
  }

  // Third-party Chatbase proxying (/__cb/ assets, /api/chat/ trailing-slash) removed
  // 2026-07-19: everything now runs on the first-party OpenAI engine (/finder + /api/chat).
  // /chatbase-help itself is served above as a first-party alias of /finder — live themes
  // still iframe it. The buildChatbase*/proxyChatbaseRequest/injectChatbaseOverrides
  // helpers above are unused dead code and can be pruned in a follow-up.

  if (request.method === "POST" && requestUrl.pathname === "/api/chat") {
    // Declared outside the try so the catch below knows whether headers already went
    // out — once the stream is open a failure has to be reported as an SSE event, not
    // as a 500 the browser will never parse.
    let sseOpen = false;
    const sse = (event, data) => {
      if (!sseOpen || response.writableEnded || response.destroyed) return;
      response.write("event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n");
    };

    let tool = "hvac";
    try {
      // The body carries the tool, but it is read after the rate-limit check below,
      // which needs a config first. Peek at the query string so /api/chat?tool=lamp
      // also works; the body value (read below) is authoritative.
      tool = resolveTool(requestUrl.searchParams.get("tool"));
      let cfg = loadConfig(tool);

      // Abuse protection: per-IP per-minute + global daily caps (this page has been bot-scraped).
      const ip = (request.headers["x-forwarded-for"] || "").split(",")[0].trim()
        || request.socket.remoteAddress || "unknown";
      const rejection = checkLimits(ip, cfg, tool);
      if (rejection) {
        sendJson(response, rejection.status, { error: rejection.message }, origin);
        return;
      }

      let rawBody = "";
      for await (const chunk of request) {
        rawBody += chunk;
        if (rawBody.length > 20 * 1048576) { // photos ride in the body; cap at 20MB
          sendJson(response, 413, { error: "Message too large — please attach smaller photos." }, origin);
          return;
        }
      }

      const parsed = JSON.parse(rawBody || "{}");
      const conversation = Array.isArray(parsed.conversation) ? parsed.conversation : [];

      if (!conversation.length) {
        sendJson(response, 400, { error: "Conversation is required." }, origin);
        return;
      }

      // The body is authoritative for which tool is answering. When it disagrees with the
      // query string the rate-limit gate above ran against the wrong config, so re-check
      // the daily cap for the tool that will actually answer — otherwise a hand-rolled
      // POST could name hvac in the URL and lamp in the body to slip past a lamp pause.
      if (parsed.tool) {
        const fromBody = resolveTool(parsed.tool);
        if (fromBody !== tool) {
          tool = fromBody;
          cfg = loadConfig(tool);
          if (overDailyCap(cfg, tool)) {
            sendJson(response, 429, { error: "The parts finder has reached its daily usage limit. Please try again tomorrow or contact us directly." }, origin);
            return;
          }
        }
      }

      // Streaming is opt-in per request so the buffered JSON contract still works for
      // anything that hasn't been updated: same {reply, usedTools, documents} shape.
      const wantsStream = parsed.stream === true
        || /text\/event-stream/i.test(String(request.headers.accept || ""));

      // The document library is HVAC literature only — there are no projector-lamp
      // manuals in it. Running it for the lamp tool could only attach an unrelated
      // HVAC PDF, so it stays off there and the lamp prompt says so plainly.
      const wantsDocuments = tool !== "lamp" && isDocumentRequest(conversation);

      // Documents are surfaced ONLY here — the model has no document tool, so it
      // never narrates PDFs and can't contradict what we actually attach. We hit
      // the library only when the customer explicitly asked for a manual/spec/etc.,
      // then keep only files that clear the relevance floor AND genuinely reference
      // the product they named (drops embedding-similar noise — a thermostat spec
      // for a Reznor ask, another brand's manual for one we don't stock).
      const docQuery = getLatestUserMessage(conversation);
      // A concrete model/part number (a 3+ digit run, or letters touching digits
      // like "UDX-200" / "L4029E1011") means the ask is specific enough that an
      // empty result is a real "we don't have it" — vs. a vague "any manuals?"
      // where the model is still gathering the model number and a not-found note
      // would be premature.
      const namedSpecificModel = /\d{3,}|[a-z]\d|\d[a-z]/i.test(docQuery);
      // WHICH documents to attach is decided entirely from the customer's message
      // (isDocumentRequest / documentMatchesQuery), never from the model's reply — so
      // this lookup has no reason to wait for the model. Started here it overlaps the
      // main call instead of stacking a second round-trip on top of it, which is what
      // made document requests roughly twice as slow as ordinary part lookups.
      const documentsPromise = wantsDocuments
        ? searchDocumentsForQuery(
            docQuery,
            process.env.OPENAI_VECTOR_STORE_ID,
            process.env.OPENAI_API_KEY,
            process.env.OPENAI_MODEL || "gpt-5-mini",
            resolveReasoningEffort(cfg)
          ).catch(() => [])
        : Promise.resolve([]);

      // Nothing is written to the socket until the headers below, so rate-limit and
      // validation rejections above still answer with ordinary JSON.
      const abort = new AbortController();
      if (wantsStream) {
        response.writeHead(200, {
          "Access-Control-Allow-Origin": origin,
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
          // Render's proxy buffers responses by default; without this the deltas
          // arrive in one lump at the end and streaming buys the customer nothing.
          "X-Accel-Buffering": "no"
        });
        sseOpen = true;
        response.write(": open\n\n");
        // Customer closed the tab — stop paying for a completion nobody will read.
        request.on("close", () => {
          if (!response.writableEnded) abort.abort();
        });
      }

      // cfg carries the prompt, wording and model settings; tool is passed as well so the
      // catalog search can add the lamp finder's air-filter lookup.
      const openAIResponse = await createOpenAIResponse(conversation, cfg, wantsStream
        ? { onDelta: (text) => sse("delta", { text }), signal: abort.signal, tool }
        : { tool });
      const usedSources = [
        ...openAIResponse.usedSources,
        summarizeTools(openAIResponse.payload.output)
      ].filter(Boolean).join(" and ");
      const replyText = extractResponseText(openAIResponse.payload);

      const shownDocuments = wantsDocuments
        ? (await documentsPromise)
            .filter((doc) => (doc.score || 0) >= DOC_SCORE_MIN)
            .filter((doc) => documentMatchesQuery(doc, significantQueryTokens(docQuery)))
            .slice(0, 3)
        : [];

      const base = replyText || "No response text returned.";
      // The code owns all document messaging (the model has no doc tool): list the
      // real matches, or — only when they named a specific model that we still
      // couldn't match — say plainly we don't have it. Otherwise the model's own
      // "what's the model number?" ask stands on its own.
      let finalReply = base;
      if (wantsDocuments && shownDocuments.length) {
        finalReply = `${base}\n\n${formatDocumentList(shownDocuments)}`.trim();
      } else if (wantsDocuments && namedSpecificModel) {
        finalReply = `${base}\n\nI'm not finding a document on file that matches that exact model — double-check the model number and I'll take another look.`.trim();
      }

      const result = {
        reply: finalReply,
        usedTools: usedSources ? `Used ${usedSources.replace(/^Used /, "")}` : "",
        documents: shownDocuments
      };

      if (wantsStream) {
        // The document block is code-owned and appended after the prose, so it was
        // never part of the streamed text — the client re-renders from this reply,
        // which is byte-identical to what the buffered endpoint would have returned.
        sse("done", result);
        response.end();
      } else {
        sendJson(response, 200, result, origin);
      }
      // admin test-mode sessions (TEST- prefix, via /finder?test=1) are not logged to the CRM
      if (!String(parsed.sessionId || "").startsWith("TEST-")) {
        logChatToCrm(conversation, finalReply, usedSources, shownDocuments, parsed.sessionId, tool, openAIResponse.catalog);
      }
      return;
    } catch (error) {
      // Aborted because the customer navigated away — nothing left to answer.
      if (error?.name === "AbortError") {
        if (!response.writableEnded) response.end();
        return;
      }
      if (sseOpen) {
        sse("error", { error: error.message });
        if (!response.writableEnded) response.end();
      } else {
        sendJson(response, 500, { error: error.message }, origin);
      }
      return;
    }
  }

  // (removed 2026-07-19) /api/chat/ trailing-slash Chatbase chat-API proxy — the
  // first-party /api/chat engine above (exact match) is unaffected.

  sendJson(response, 404, { error: "Not found." }, origin);
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Help page server running at http://localhost:${port}`);
  for (const tool of TOOLS) {
    try {
      if (ensureBaseline(tool)) console.log(`config history: recorded the live ${tool} config as its starting point`);
    } catch (error) {
      console.error(`config history: couldn't record the ${tool} starting point: ${error.message}`);
    }
  }
});
