# OTS Auth Worker

Cloudflare Worker backend for professional member login.

It supports:
- Google Sign-In token verification on the backend.
- Backend-generated email OTP.
- OTP expiry, resend cooldown, hourly rate limit, one-time use, and max attempts.
- Member lookup against the existing Neon `members` table.
- Privacy-safe client error reporting for the web app and Android APK.
- Firebase Cloud Messaging push notifications for Android slot updates.

## Required setup

1. Create a Cloudflare Worker.
2. Copy `wrangler.toml.example` to `wrangler.toml`.
3. Fill these non-secret vars:
   - `NEON_SQL_URL`
   - `GOOGLE_CLIENT_ID`
   - `EMAIL_FROM`
   - `ALLOWED_ORIGINS`
4. Add secrets:

```powershell
wrangler secret put NEON_CONNECTION_STRING
wrangler secret put RESEND_API_KEY
wrangler secret put OTP_SECRET
wrangler secret put SESSION_SECRET
wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
```

5. Deploy:

```powershell
wrangler deploy
```

6. In `index.html`, set:

```js
const AUTH_API_BASE = 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev';
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com';
const PUSH_API_BASE = 'https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev';
```

`AUTH_API_BASE` must be set for member OTP login. OTPs are generated, stored as hashes, rate-limited, emailed, and verified by this Worker.

## Endpoints

- `POST /auth/google`
- `POST /auth/send-otp`
- `POST /auth/verify-otp`
- `POST /auth/register-email`
- `POST /sql`
- `POST /client-error`
- `POST /push/register`
- `POST /push/register-admin`
- `POST /push/admin-queue`
- `POST /push/booking-status`
- `POST /push/test`
- `GET /health`

## Notes

Firebase Cloud Messaging is free for normal push notification use. To send notifications from the Worker, create a Firebase service account key and store the full JSON as the `FIREBASE_SERVICE_ACCOUNT_JSON` secret.

Google Sign-In is free for normal use. Cloudflare Workers and Resend both have free tiers, but high traffic or high email volume can create usage-based cost later.
