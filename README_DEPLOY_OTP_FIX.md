# OTS OTP Worker Fix

Issue checked on 2026-09-10:

- `GET /health` returns OK.
- Invalid OTP email requests return immediately.
- A valid registered member email request reaches `/auth/send-otp` but times out before a response.

This points to the backend send path hanging after member lookup, most likely while calling Resend.

## What Changed

- `src/index.js` adds timeouts around Neon SQL calls.
- `src/index.js` adds a timeout around the Resend email API call.
- The frontend upload package also adds an OTP timeout so the user button resets instead of staying on `Sending...`.

## Deploy

Use the Cloudflare Worker project that already has the production secrets configured.

```powershell
npm install
wrangler deploy
```

Do not commit or upload secrets. Required secrets remain:

- `NEON_CONNECTION_STRING`
- `RESEND_API_KEY`
- `OTP_SECRET`
- `SESSION_SECRET`
- `FIREBASE_SERVICE_ACCOUNT_JSON`

