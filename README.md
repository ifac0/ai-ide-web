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
