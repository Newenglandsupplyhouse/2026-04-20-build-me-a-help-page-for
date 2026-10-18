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

## 2026-10-18 note: theme ID and sync state

- The live theme is **NESH Live - White PDP + Collections (2026-08-20)**, ID `158241915102`. Until 2026-10-18 the `SHOPIFY_THEME_ID` secret pointed at the unpublished "ROLLBACK 2026-08-20 - slate (pre-white)" theme (`153234800862`), so pushes from this repo never reached the live store.
- Before the secret was corrected, `sections/shopify-help-chat*.liquid` and `templates/page.help-chat.liquid` were copied byte-for-byte from the live theme (last edited there 2026-08-21), so the first push is a no-op for them. `templates/page.help-chat*.json` were moved to `theme-archive/` because the live theme uses the `.liquid` template and Shopify will not accept a `.json` and `.liquid` template with the same name.
- From now on, edit theme files here, not in the Shopify code editor, or the next push will overwrite the editor change.
