# Project Snapshot

## Current restore point

- Tag: `desktop-mobile-stable-chatbase-proxy`
- Intended use: return to the current known-good Shopify help page state

## Current state

- Shopify help page uses a Chatbase help page through the Render proxy.
- Mobile behavior is currently considered stable by the user.
- Desktop behavior includes:
  - page opens at the top more reliably
  - desktop `Start over` button positioned higher to avoid pulling the page down
  - footer branding rewritten to `Built by New England Supply House`

## Key files

- `sections/shopify-help-chat.liquid`
- `server.mjs`
- `help-page.html`

## What changed to reach this point

1. Replaced the original custom help-page chat flow with a Chatbase-based iframe flow.
2. Added a Render proxy for the Chatbase help page so we could control layout and branding.
3. Hid the recent chats sidebar and adjusted the help page to fit within the Shopify layout.
4. Added a `Start over` button above the chat area and made it reset the iframe through the proxy reset route.
5. Fixed major mobile issues:
   - prevented the entire Shopify page from moving around on phones
   - restored mobile chat scrolling
   - improved mobile landing heading sizing
6. Customized footer branding in the proxied Chatbase page:
   - replaced `Powered by Chatbase`
   - removed the Chatbase icon
   - changed the text to `Built by New England Supply House`
7. Improved desktop startup behavior:
   - attempts to keep the page opened at the top
   - raised the desktop `Start over` button higher on the page

## Earlier restore tags

- `mobile-scroll-resolved`
- `mobile-stable-branded-footer`
- `mobile-perfect-heading-sized`

## Notes

- If future desktop or mobile changes break the page, restore to the tag above first before attempting new layout changes.
- Be cautious with heading-centering changes in portrait mode because they previously interfered with scrolling behavior.
