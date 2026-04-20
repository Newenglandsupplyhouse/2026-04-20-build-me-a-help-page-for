# Shopify Help Page with OpenAI

This project gives you:

- A white help page with a centered prompt and text box
- A browser chat UI that sends the full conversation to a backend
- A small Node server that calls the OpenAI Responses API
- Optional live Shopify product lookup through the Storefront API
- Vector store search through `file_search`
- Optional web fallback through `web_search`
- Shopify theme files you can paste into a section and page template

## Files

- `help-page.html` - the storefront page
- `server.mjs` - the backend proxy for OpenAI
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
- In the theme editor, open that page template and paste your backend URL into the section setting named `Backend API URL`

If you prefer to embed the browser version manually, you can still use `help-page.html`.

## What the Shopify files do

- The section renders the all-white centered help page directly in your theme
- The heading, intro text, placeholder text, and backend URL are editable in the theme editor
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

## OpenAI docs used

- File search guide: https://platform.openai.com/docs/guides/tools-file-search/
- Tools guide: https://platform.openai.com/docs/guides/tools/file-search
- Retrieval guide: https://platform.openai.com/docs/guides/retrieval
- Shopify Storefront API reference: https://shopify.dev/docs/api/storefront/2025-01
- Shopify products query docs: https://shopify.dev/docs/api/storefront/2024-07/queries/products
- Shopify authentication docs: https://shopify.dev/docs/api/usage/authentication
- Shopify custom app token docs: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/generate-app-access-tokens-admin
