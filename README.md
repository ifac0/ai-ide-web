# AI IDE Web

## Requirements

- Node.js 20+

## Development

```bash
npm install
npm start
```

## Quality gates

```bash
npm run format
npm run lint:eslint
npm test -- --runInBand
npm run build:prod
npm run e2e
```

## Production notes

- Set CSP and security headers at the CDN/server layer (see `docs/SECURITY_HEADERS.md`).

## Production (Docker)

```bash
docker build -t ai-ide-web .
docker run --rm -p 8080:80 ai-ide-web
```

Open `http://localhost:8080`.

## Deploy (Cloudflare Pages)

This repo includes `public/_headers` and `public/_redirects` for Cloudflare Pages.

```bash
npm run deploy:pages
```
