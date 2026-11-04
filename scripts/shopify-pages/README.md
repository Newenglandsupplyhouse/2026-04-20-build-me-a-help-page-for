# Shopify page scripts (2026-10-18)

One-off scripts used to put photos and order buttons on the catalytic converter pages. They call the
Shopify Admin GraphQL API for hgwaiq-dh.myshopify.com and expect credentials to be supplied by the
environment (the Claude Code session proxy injected them; locally, add an `X-Shopify-Access-Token` header in `shopify_upload.gql`).

- `shopify_upload.py`: staged upload, `fileCreate`, `productCreateMedia` helpers. Running it directly re-uploads the Before/After composites to the three rebuild listings.
- `included_card.py`: renders the "What's included" cards from `product-photos/`.
- `page_photos.py`: adds the Before/After hero (with a representative-photo disclaimer) and the brand card to pages. Pass handles for a dry run, nothing for all. Skips pages that already carry `data-nesh-photo`.
- `order_cta.py`: replaces "Get your quote" / "Request a Fitment Check" on chipper pages with "Order your rebuild" buttons that deep-link to the brand product variant, and applies the photos. Skips pages that already carry `data-nesh-cta`.
- `program_cta.py`: rewrites the quote section of `/pages/wood-chipper-catalytic-converter-program` into brand order cards and adds order links under each brand in the machine list.
- `models.json`: brand product handles, variant IDs and card image URLs the scripts link to.

`all_pages.json` (page bodies, not committed) is produced by querying `pages(query:"handle:*catalytic-converter-rebuild* OR handle:*doc-rebuild*")` and tagging each page `kind: chipper|industrial` and `brand`. Only `kind == chipper` pages were edited; the 64 DOC pages and the industrial hub were left as text.

## Cat buyback offer (2026-11-04)

`buyback_offer.mjs` (Node, no deps) added the "Getting rid of your chipper cat? We'll buy it" section to the
program page (right after the "deleting or gutting" section) and a "Going with a new OEM converter instead?"
blurb to the three brand rebuild product descriptions. Offer: text or email a photo of a wood chipper cat and
NESH replies with an offer price; wood chipper converters only. Both edits are page/product `body_html`, not
theme files. Idempotent (`data-nesh-buyback` marker). Credentials come from the nesh-crm Render env vars via
`~/.render-api-key.txt`. `node buyback_offer.mjs pull <dir>` then `dry`/`apply`.

Note: `sections/nesh-catalytic-converter-landing.liquid` in this repo still carries the old $1,350 gas price and
$7,650 savings; the live theme section has $1,550 / $7,450, and the program page itself uses the default page
template with its own body. A theme push would not change the program page but would put the stale section
back on the live theme.

## Scrap cat page (2026-11-04)

`scrap_cat_page.mjs` creates and maintains the Google-indexable buyback page at
`/pages/scrap-wood-chipper-catalytic-converters` (page id 133187928286, default page template, all content in
`body_html`, SEO title/description in the `global.title_tag` / `global.description_tag` metafields). It also adds a
link to that page inside the `#nesh-buy-cat` section of the program page and after the buyback blurb on the
Bandit/Morbark/Vermeer rebuild products (marker `data-nesh-scrap-link`). Run `buyback_offer.mjs` first on a fresh
store; the links anchor on what it inserts.

```
node scripts/shopify-pages/scrap_cat_page.mjs pull <dir>    # back up current page/program/products JSON
node scripts/shopify-pages/scrap_cat_page.mjs dry <dir>     # show what would change
node scripts/shopify-pages/scrap_cat_page.mjs apply <dir>   # create/update page + metafields + links
```

To change the page copy, edit `PAGE_HTML` / `FAQ` in the script and re-run `pull` then `apply`. Shopify
re-serializes the stored body (whitespace only), so the unchanged check compares with whitespace collapsed.
