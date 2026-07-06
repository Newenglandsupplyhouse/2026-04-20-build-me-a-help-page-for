# Chatbase agent export — "New England Supply House" (iQxwux6_Bjma9xxVgm8Nb)
Exported 2026-07-06 via the live dashboard, ahead of Chatbase cancellation.
Full system prompt in `system-prompt.md` (5,762 chars, preset "Base Instructions", model GPT-5).

## Chat interface (Deploy → Chat Widget)
- **Initial message:** "Hi, I am your parts finder assistant.  Just tell me what you need and the information you have about it and I'll do my best to help you find it.  You can also ask to see any technical documents related to an item."
- **Message placeholder:** "Example: Do you have Goodman 0130F00506 Furnace Pressure Switch?"
- Voice Mode: off. No suggested-message chips configured (our finder.html chips are custom/new).

## AI Actions (6 enabled)
1. **search_knowledge_base** — Custom action (server) → the bridge → OpenAI vector store.
   When-to-use (1,170 chars, captured): "Use this action whenever the user asks for factual information that may be contained in our product manuals, technical documentation, installation guides, user guides, specifications, or knowledge base. Pass the user's exact question as the query parameter. Use the returned answer_context and results to answer the user clearly, accurately, and concisely. Base the response on the retrieved information, and do not invent details that are not supported by the action results. If the action returns no relevant information, tell the user you could not find that information in the documentation. When the action returns documents or results with source_url, document_url, file_url, download_url, or bridge_url, treat those as verified links from our backend. If relevant links are returned, include 1-3 of them in the final answer. Do not say you cannot provide a verified link when the action response contains one of those URL fields. Prefer sourc…[tail truncated: preference order of URL fields]"
   → REPLACED by native file_search in /api/chat (direct, no bridge).
2. **Product_Research_Request** — Custom form ("onboarding_form", 718-char instructions: show a name/email form at chat start, thank the user, then answer). ⚠️ Required client-side code that was never added to the embed → almost certainly NEVER fired for customers. Contacts tab = 0 items (confirms). Optional future feature, not a migration blocker.
3. **Get_Cart** — Shopify integration. "Call this tool when asked about the cart, including the items in the cart, the total price, the quantity of items." ⚠️ Chat runs in a proxied iframe on another domain → no store session/cookies → likely never functioned in production. NOT ported (optional future).
4. **Get_Orders** — Shopify integration. "If the user ask about orders, use this tool. Summarize the tool's result in your response, ensuring no images are included within the text response." Same iframe/session caveat as Get_Cart. NOT ported (optional future: order-status lookup needs Admin API + customer verification).
5. **Get_Products** — Shopify integration (retrieve and display products). → REPLACED by live Storefront GraphQL product search in /api/chat (getShopifyProductContext).
6. **search_for_product_manuals_when_they_are_not_in_vector_store** — Web search. "Use when the user asks for a topic or question which you don't know the answer to, or topics that you have outdated information about." → REPLACED by web_search tool in /api/chat; manufacturer-only restriction enforced via system prompt.

## Data sources (the 20 MB "Limit exceeded")
- **5,529 links crawled from https://newenglandsupplyhouse.com/sitemap.xml — that's the ENTIRE corpus.** No files, no text snippets, no Q&A, no Notion.
- → ZERO knowledge loss on cancellation: store data is served LIVE from Shopify (fresher + complete vs a capped stale crawl); the HVAC manuals live in Jason's own OpenAI vector store (never were in Chatbase).

## Contacts
- 0 items. Nothing to export.

## Not captured / accepted losses
- Historical Activity chat logs (old conversations) — view/export manually from Activity before cancelling if wanted; go-forward logging already runs via the CRM.
- Chatbase Analytics history (counts/topics) — snapshot manually if wanted.
