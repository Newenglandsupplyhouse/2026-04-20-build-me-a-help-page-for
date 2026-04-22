# Shopify GitHub Auto-Deploy

This repo now includes a GitHub Actions workflow that can push theme files to Shopify automatically when theme files change on `main`.

## What it deploys

The workflow deploys only standard Shopify theme folders:

- `sections/`
- `templates/`
- `snippets/`
- `layout/`
- `assets/`
- `config/`
- `locales/`

It does **not** deploy backend files like `server.mjs`, docs, logs, or local scratch files.

## GitHub secrets to add

In GitHub:

`Settings` -> `Secrets and variables` -> `Actions` -> `New repository secret`

Add these secrets:

### `SHOPIFY_CLI_THEME_TOKEN`

Theme Access password used by Shopify CLI CI/CD.

### `SHOPIFY_THEME_ID`

The numeric Shopify theme ID to update.

Example:

```txt
172345678901
```

### `SHOPIFY_STORE`

Your store's `.myshopify.com` domain.

Example:

```txt
hgwaiq-dh.myshopify.com
```

## Recommended usage

- Point this at an unpublished theme first
- Confirm changes look right
- Then either publish that theme or switch the secret to a different theme ID later

## How it runs

The workflow runs automatically on pushes to `main` when files under the theme folders change.

## Official references

- [Shopify CLI](https://shopify.dev/docs/api/shopify-cli)
- [theme push](https://shopify.dev/docs/api/shopify-cli/theme/theme-push)
- [Shopify CLI for themes](https://shopify.dev/docs/storefronts/themes/tools/cli)
