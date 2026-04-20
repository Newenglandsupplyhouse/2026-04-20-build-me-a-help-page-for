# Shopify Token Setup

This guide reflects Shopify's current setup as of April 20, 2026.

## What changed

As of January 1, 2026, Shopify no longer lets you create new legacy custom apps the old way in Shopify admin.

That means your Storefront API token will usually come from one of these current paths:

1. A headless storefront setup using Shopify's Headless channel
2. A newer app flow where a developer generates the token for the storefront

## What this help page needs

For this project, the backend needs:

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION`

It uses the token against:

`https://your-store.myshopify.com/api/2026-01/graphql.json`

with this header:

`X-Shopify-Storefront-Access-Token: your_token`

## Easiest current path

If you want the fastest route for this help page, use Shopify's headless/storefront setup so you can get a Storefront API token meant for storefront queries.

Official references:

- [Shopify API authentication](https://shopify.dev/docs/api/usage/authentication)
- [Bring your own headless stack](https://shopify.dev/docs/storefronts/headless/bring-your-own-stack/index)

## If you're setting this up in Shopify admin

Look for the headless/storefront access setup in your Shopify admin and install the Headless channel if your store does not already have it.

The important outcome is that you obtain a valid Storefront API token with product listing read access.

## What scope/access you need

For product search through the Storefront API, Shopify's docs indicate product listing read access is required.

Relevant official references:

- [Storefront API products query](https://shopify.dev/docs/api/storefront/2024-07/queries/products)
- [Shopify API authentication](https://shopify.dev/docs/api/usage/authentication)

## After you have the token

Fill in [\.env.deploy.example](C:/Users/jason/Documents/Codex/2026-04-20-build-me-a-help-page-for/.env.deploy.example) like this:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-5-mini
OPENAI_VECTOR_STORE_ID=vs_...
ENABLE_WEB_SEARCH=true
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_STOREFRONT_ACCESS_TOKEN=your_real_storefront_token
SHOPIFY_API_VERSION=2026-01
SHOPIFY_STOREFRONT_ORIGIN=https://your-store.myshopify.com
PORT=3000
```

Then copy it to `.env` next to `server.mjs`.

## Start the server

```powershell
C:\Users\jason\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe server.mjs
```

## Important note

Do not paste the OpenAI API key or Shopify Storefront token into Shopify theme code.

Keep both on the backend only.
