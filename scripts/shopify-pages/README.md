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
