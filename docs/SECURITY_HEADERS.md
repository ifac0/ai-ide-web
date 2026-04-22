# Security headers

This app ships a baseline CSP via `src/index.html` for local development.
For production, the following headers should be set at the CDN/server layer.

## Required

- `Content-Security-Policy` (must include `frame-ancestors` as an HTTP header)
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

## Recommended CSP (baseline)

Use this as a starting point and tighten it based on your deployment needs:

```
default-src 'self';
base-uri 'self';
object-src 'none';
frame-ancestors 'none';
img-src 'self' data: blob:;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src 'self' https://fonts.gstatic.com data:;
script-src 'self' 'unsafe-eval';
worker-src 'self' blob: data:;
connect-src 'self';
manifest-src 'self';
```

## Notes

- `frame-ancestors` is ignored when delivered via a `<meta http-equiv>` tag. It must be an HTTP header.
- Monaco requires `worker-src` and may require `script-src 'unsafe-eval'` depending on build configuration.
