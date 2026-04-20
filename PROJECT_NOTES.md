# Project Notes

## What this project is

This is a Shopify help/chat page that:

- shows a white page with centered prompt text
- lets shoppers type questions
- sends the full conversation to a backend
- uses OpenAI Responses API
- searches an OpenAI vector store with `file_search`
- optionally uses `web_search`
- can also pull live Shopify product data through the Storefront API

## Main files

- `help-page.html` - standalone browser version
- `server.mjs` - backend server
- `sections/shopify-help-chat.liquid` - Shopify section
- `templates/page.help-chat.json` - Shopify page template
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
7. Set `Backend API URL` to your deployed backend URL.

## Deployment recommendation

Recommended host: Render

- Create a Render Web Service from a GitHub repo containing this folder
- Start command: `npm start`
- After deploy, use:

```txt
https://your-app.onrender.com/api/chat
```

as the Shopify `Backend API URL`

## Environment variables needed

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_VECTOR_STORE_ID`
- `ENABLE_WEB_SEARCH`
- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_STOREFRONT_ORIGIN`
- `PORT`

## Security reminder

The OpenAI API key and Shopify Storefront token were pasted into this chat during setup. Rotate both before public deployment, then update `.env` and your deployment environment variables.
