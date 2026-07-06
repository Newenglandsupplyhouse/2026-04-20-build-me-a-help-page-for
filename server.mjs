import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, saveConfig, checkLimits } from "./finder-config.mjs";

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

async function createOpenAIResponse(conversation, cfg = null) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY in .env.");
  }

  const config = cfg || loadConfig();
  const model = config.model || process.env.OPENAI_MODEL || "gpt-5-mini";
  const vectorStoreId = process.env.OPENAI_VECTOR_STORE_ID;
  const enableWebSearch = !!config.enableWebSearch;

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
      },
      // customer photo attachments (nameplate shots etc.) ride along as vision inputs
      ...(message.role === "user" && Array.isArray(message.images)
        ? message.images.slice(0, 3)
            .filter((u) => typeof u === "string" && u.startsWith("data:image/"))
            .map((u) => ({ type: "input_image", image_url: u }))
        : [])
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
      // Agent behavior is managed in /admin (persisted in finder-config.json); the default is
      // the Chatbase "Base Instructions" export adapted for these native tools.
      instructions: config.instructions
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

// Fire-and-forget: record a completed Parts Finder Q&A turn in the NESH CRM (chat_logs).
// Never blocks or affects the customer's reply; silently no-ops if CRM_CHATLOG_SECRET is unset.
function logChatToCrm(conversation, reply, usedTools, documents, sessionId) {
  const secret = process.env.CRM_CHATLOG_SECRET;
  if (!secret) return;
  const url = process.env.CRM_CHATLOG_URL || "https://nesh-crm.onrender.com/api/hooks/finder-chat";
  const lastUser = [...conversation].reverse().find((m) => m && m.role === "user");
  if (!lastUser || !reply) return;
  const photoNote = Array.isArray(lastUser.images) && lastUser.images.length ? "[📷 photo attached] " : "";
  const payload = {
    session_id: sessionId || "",
    source: "parts-finder",
    question: (photoNote + String(lastUser.content || "")).slice(0, 8000),
    answer: String(reply).slice(0, 20000),
    used_tools: usedTools || "",
    documents: (Array.isArray(documents) ? documents : [])
      .map((d) => ({ filename: d.filename || d.title || "", url: d.url || d.document_url || d.file_url || "" }))
      .slice(0, 20),
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

// Fill finder.html's __CFG_*__ tokens from the persisted config.
function renderFinderPage(template, cfg) {
  const chipsHtml = (Array.isArray(cfg.chips) ? cfg.chips : [])
    .filter((c) => c && c.label && c.q)
    .map((c) => `<button type="button" data-q="${escapeHtmlServer(c.q)}">${escapeHtmlServer(c.label)}<span>${escapeHtmlServer(c.sub || "")}</span></button>`)
    .join("\n        ");
  return template
    .replace("__CFG_HEADING__", escapeHtmlServer(cfg.welcomeHeading))
    .replace("__CFG_WELCOME__", escapeHtmlServer(cfg.welcomeText))
    .replace("__CFG_PLACEHOLDER__", escapeHtmlServer(cfg.placeholder))
    .replace("__CFG_CHIPS__", chipsHtml);
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

  if (request.method === "GET" && requestUrl.pathname === "/") {
    const html = await readFile(path.join(__dirname, "help-page.html"), "utf8");
    sendHtml(response, 200, html, origin);
    return;
  }

  if (request.method === "GET" && (requestUrl.pathname === "/finder" || requestUrl.pathname === "/finder/")) {
    try {
      const template = await readFile(path.join(__dirname, "finder.html"), "utf8");
      sendHtml(response, 200, renderFinderPage(template, loadConfig()), origin);
    } catch (error) {
      sendJson(response, 500, { error: `Failed to load finder page: ${error.message}` }, origin);
    }
    return;
  }

  // ---------- Admin panel (HTTP Basic; see adminAuthed) ----------
  if (requestUrl.pathname === "/admin" || requestUrl.pathname.startsWith("/admin/")) {
    if (!adminAuthed(request)) {
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

    if (requestUrl.pathname === "/admin/api/config") {
      if (request.method === "GET") {
        sendJson(response, 200, loadConfig(), origin);
        return;
      }
      if (request.method === "PUT") {
        try {
          const body = await readJsonBody(request, 1048576);
          const allowed = ["instructions", "model", "enableWebSearch", "welcomeHeading", "welcomeText",
            "placeholder", "chips", "rateLimitPerMin", "dailyCap"];
          const partial = {};
          for (const k of allowed) if (body[k] !== undefined) partial[k] = body[k];
          sendJson(response, 200, saveConfig(partial), origin);
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

  if (request.method === "GET" && requestUrl.pathname === "/chatbase-help/reset") {
    const nextUrl = requestUrl.searchParams.get("next") || "/chatbase-help";
    sendHtml(response, 200, buildChatbaseResetPage(nextUrl), origin);
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
      const cfg = loadConfig();

      // Abuse protection: per-IP per-minute + global daily caps (this page has been bot-scraped).
      const ip = (request.headers["x-forwarded-for"] || "").split(",")[0].trim()
        || request.socket.remoteAddress || "unknown";
      const rejection = checkLimits(ip, cfg);
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

      const openAIResponse = await createOpenAIResponse(conversation, cfg);
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
      // admin test-mode sessions (TEST- prefix, via /finder?test=1) are not logged to the CRM
      if (!String(parsed.sessionId || "").startsWith("TEST-")) {
        logChatToCrm(conversation, finalReply, usedSources, documents, parsed.sessionId);
      }
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
