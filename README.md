# Shopify Help Page with OpenAI

This project gives you:

- A Node server for your Shopify help page and OpenAI bridge
- A proxied Chatbase help page route you can host on your own backend
- Optional live Shopify product lookup through the Storefront API
- Vector store search through `file_search`
- Optional web fallback through `web_search`
- Shopify theme files you can paste into a section and page template

## Files

- `help-page.html` - standalone iframe entrypoint for the proxied Chatbase help page
- `server.mjs` - the backend proxy for OpenAI and Chatbase help page routes
- `.env.example` - environment variables you need
- `.env.deploy.example` - deployment-ready environment template
- `sections/shopify-help-chat.liquid` - Shopify section
- `templates/page.help-chat.json` - Shopify page template
- `SHOPIFY_TOKEN_SETUP.md` - current Shopify token setup notes

## Setup

1. Copy `.env.example` to `.env`
2. Add your OpenAI API key
3. Add your vector store ID
4. Add your Shopify store domain, for example `your-store.myshopify.com`
5. Add a Shopify Storefront API access token
6. Set `SHOPIFY_STOREFRONT_ORIGIN` to your store domain
7. Optionally set `CHATBASE_HELP_URL` if you want to proxy a different Chatbase help page
7. Start the server with Node 18+:

```powershell
C:\Users\jason\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe server.mjs
```

If you want a more deployment-oriented starting point, use `.env.deploy.example` instead.

## Shopify use

For Shopify, keep the OpenAI call on your backend, not in theme code.

- Host `server.mjs` somewhere public
- Upload `sections/shopify-help-chat.liquid` to your theme `sections` folder
- Upload `templates/page.help-chat.json` to your theme `templates` folder
- In Shopify Admin, create a page and assign the `help-chat` template
- In the theme editor, open that page template and paste your backend route into the section setting named `Chatbase proxy URL`

## Chatbase help proxy

The server now includes a simple Chatbase help-page proxy so you can serve the Chatbase help UI through your own backend and hide the desktop recent-chats sidebar.

- Proxied help page route: `/chatbase-help`
- Proxied Chatbase assets: `/__cb/*`
- Proxied Chatbase help-page API calls: `/api/chat/{agentId}/*`

By default, the proxy uses:

```txt
https://www.chatbase.co/iQxwux6_Bjma9xxVgm8Nb/help
```

You can override that by setting:

```txt
CHATBASE_HELP_URL=https://www.chatbase.co/your-agent-id/help
```

If you prefer to embed the browser version manually, you can still use `help-page.html`.

## What the Shopify files do

- The section renders a full-page iframe of your proxied Chatbase help page
- The proxy URL and optional direct Chatbase URL are editable in the theme editor
- The page template loads only that section, making the help page clean and centered

## Shopify product data

The backend can pull live product data from Shopify before asking OpenAI to answer.

- It queries the Storefront API GraphQL endpoint at `https://{store}.myshopify.com/api/2026-01/graphql.json`
- It searches up to 5 matching products based on the shopper's latest message
- Product title, price, availability, variants, vendor, type, and product URL are added as live context
- OpenAI then combines that live catalog context with your vector store and optional web search

To enable this, create a Storefront API token in Shopify with product listing read access and set:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_STOREFRONT_ORIGIN`

More detail is in `SHOPIFY_TOKEN_SETUP.md`.

## Optional manual embed

```html
<script>
  window.HELP_API_URL = "https://your-backend.example.com/api/chat";
</script>
```

## Notes

- The page sends the whole conversation history to OpenAI on each request.
- The backend can also send live Shopify catalog results based on the user's latest message.
- The assistant can search your vector store automatically.
- If `ENABLE_WEB_SEARCH=true`, it can also use web search when needed.
- If Shopify credentials are not configured, the app still works with OpenAI plus your vector store.
- `SHOPIFY_STOREFRONT_ORIGIN` must match the exact storefront origin that loads the page, including `https://`.
- If you use both a `myshopify.com` domain and a custom storefront domain, set `SHOPIFY_STOREFRONT_ORIGIN` to a comma-separated list such as `https://store.example.com,https://your-store.myshopify.com`.
- If you use the Chatbase proxy route, your Shopify iframe should point to your backend domain, for example `https://shopify-help-chat.onrender.com/chatbase-help`.

## OpenAI docs used

- File search guide: https://platform.openai.com/docs/guides/tools-file-search/
- Tools guide: https://platform.openai.com/docs/guides/tools/file-search
- Retrieval guide: https://platform.openai.com/docs/guides/retrieval
- Shopify Storefront API reference: https://shopify.dev/docs/api/storefront/2025-01
- Shopify products query docs: https://shopify.dev/docs/api/storefront/2024-07/queries/products
- Shopify authentication docs: https://shopify.dev/docs/api/usage/authentication
- Shopify custom app token docs: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin
