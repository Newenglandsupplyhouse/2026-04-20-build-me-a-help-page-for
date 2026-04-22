# Project Notes

## What this project is

This is a Shopify help/chat page that:

- can proxy a Chatbase help page through your own backend
- can hide the Chatbase desktop recent-chats sidebar through injected overrides
- sends custom chat requests to OpenAI through `/api/chat`
- uses OpenAI Responses API
- searches an OpenAI vector store with `file_search`
- optionally uses `web_search`
- can also pull live Shopify product data through the Storefront API

## Main files

- `help-page.html` - standalone browser version
- `server.mjs` - backend server
- `sections/shopify-help-chat.liquid` - Shopify section
- `templates/page.help-chat.json` - Shopify page template
- `templates/page.help-chat.liquid` - fallback template for themes that reject JSON templates
- `.env.example` - example env file
- `.env.deploy.example` - deployment env template
- `SHOPIFY_TOKEN_SETUP.md` - Shopify token notes
- `README.md` - overall setup guide
- `package.json` - deploy/start config for Node hosts

## Local run command

```powershell
C:\Users\jason\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe server.mjs
```

## Local API endpoint

```txt
http://localhost:3000/api/chat
```

## Shopify setup

1. Upload `sections/shopify-help-chat.liquid` to the theme `sections` folder.
2. Upload `templates/page.help-chat.json` to the theme `templates` folder.
3. Create a page in Shopify.
4. Assign the `page.help-chat` template to that page.
5. In `Online Store` -> `Themes` -> `Customize`, open that page.
6. Click the `Shopify Help Chat` section.
7. Set `Chatbase proxy URL` to your deployed backend route, for example `https://shopify-help-chat.onrender.com/chatbase-help`.

## Deployment recommendation

Recommended host: Render

- Create a Render Web Service from a GitHub repo containing this folder
- Start command: `npm start`
- After deploy, use:

```txt
https://your-app.onrender.com/chatbase-help
```

as the Shopify `Chatbase proxy URL`

## Environment variables needed

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_VECTOR_STORE_ID`
- `ENABLE_WEB_SEARCH`
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_STOREFRONT_ORIGIN`
- `CHATBASE_HELP_URL`
- `PORT`

## CORS note

The deployed backend must return `Access-Control-Allow-Origin` matching the exact storefront origin that loads the Shopify page.

- Include `https://` in `SHOPIFY_STOREFRONT_ORIGIN`
- If the store can be visited on more than one domain, use a comma-separated list
- Example: `https://www.yourstore.com,https://your-store.myshopify.com`

## Security reminder

The OpenAI API key and Shopify Storefront token were pasted into this chat during setup. Rotate both before public deployment, then update `.env` and your deployment environment variables.
