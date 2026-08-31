# Knot Kitchen — Security Notes

This document records the security posture of the Knot Kitchen POS
operator actions required for a hardened deployment.

## Required environment variables (production)

`pos-backend` refuses to start if these are missing or too short.

| Variable | Notes |
| --- | --- |
| `JWT_SECRET` | ≥ 32 chars, unpredictable |
| `REFRESH_TOKEN_SECRET` | ≥ 32 chars, distinct from `JWT_SECRET` |
| `CSD_JWT_SECRET` | ≥ 32 chars, signs the CSD panel session cookie |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | seeds the CSD super-admin on first boot; also honoured by `RESET_SUPERADMIN_PASSWORD=true` for one-time password reset |
| `MONGODB_URI` | Atlas SRV URI |
| `FRONTEND_URLS` | comma-separated allow-list of client origins |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` | only if payments are used |

Generate a secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Development conveniences (never active in production)

Set these ONLY in local dev / CI:

```bash
ALLOW_DEV_OTP=true
OTP_DEV_CODE=123456
ALLOW_DEMO_PRODUCT_ID=true
```

They enable the fixed dev OTP `123456` and auto-created demo Product IDs so
the local dev loop remains fast. Production ignores them.

## Cookie flags

- Access + refresh cookies are `HttpOnly` and `SameSite=lax` locally,
  `SameSite=none; Secure` in production (required for cross-origin PWA/APK).
- If `SameSite=None` is used without HTTPS the app auto-downgrades to
  `Lax` so the cookie is not silently dropped by the browser.

## CORS

- `pos-backend` uses an explicit allow-list. `origin: *` and wildcard
  `.vercel.app` are **never** accepted.
- Add every deployed frontend origin to `FRONTEND_URLS`. Subdomains of
  `BASE_DOMAIN` come in via `CORS_WILDCARD_DOMAINS` instead of an explicit
  list, so per-store storefronts don't need to be enumerated.

## Secrets rotation

If you deployed a previous version of Knot Kitchen (before this security
release) rotate **all** of the following before your first production deploy:

- `JWT_SECRET`, `REFRESH_TOKEN_SECRET` — the previous fallback values
  (`knotkitchen-secret-key-2024-pos-system`,
  `knotkitchen-refresh-secret-2024-pos-system`) are in the git history.
  (`ADMIN_JWT_SECRET` also needed rotating; that variable was retired with
  the admin-web / admin-api removal on 2026-08-30.)
- Any real `FAST2SMS_API_KEY` — the previous code shipped a hardcoded
  fallback key.
- Any admin `ADMIN_PASSWORD` still set to `admin123` or another default.

Existing user sessions are invalidated automatically when JWT secrets
change (tokens fail to verify) and again by the new session-jti binding
if a user's password is reset or admin revokes them.

## Rate limits (defaults — override via env)

- Storefront reads: 300 / minute per IP
- Storefront orders: 10 / 10 minutes per (IP × slug)
- Login: 10 / 15 minutes per (IP × productId)
- OTP send: 5 / 15 minutes per (IP × phone)
- OTP verify: 10 / 15 minutes per (IP × phone)
- Password reset: 5 / 15 minutes per IP
- Store lookup: 30 / 5 minutes per IP
- Media upload: 30 / minute per authenticated user
- Admin login: 10 / 15 minutes per (IP × email)
- Admin store OTP send: 5 / 15 minutes per (IP × phone)

The limiter is per-process; put it behind a shared cache (Redis) or an
edge WAF/rate-limit rule if you horizontally scale.

## Reverse proxy

Both apps call `app.set("trust proxy", 1)` — deploy them behind a single
trusted proxy (nginx, Cloudflare, Vercel) that terminates TLS and sets
`X-Forwarded-For`/`X-Forwarded-Proto`. Do NOT chain untrusted proxies in
front of them.

## What NOT to commit

`.env`, `*.log`, `uploads/`. Both `.gitignore` files exclude them; if you
find one in git history, rotate the secrets it contained.

## Reporting

Please file security issues privately to the maintainers rather than
opening a public GitHub issue.
