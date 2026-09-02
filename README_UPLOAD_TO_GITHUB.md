# OTS GitHub Pages Upload Package

Generated: 2026-09-02

Upload the contents of this folder directly into the GitHub repository root.
Do not upload this folder as a nested folder.

## Upload These Root Files

- `index.html`
- `admin.html`
- `join.html`
- `audition-admin.html`
- `manifest.json`
- `manifest-admin.json`
- `sw.js`
- `ots-icon-192.png`
- `ots-icon-512.png`
- `ots-apple-touch-icon.png`
- `ots-brand-mark.png`
- `ots-login-logo.png`
- `gcc-logo.png`
- `chennai-smart-city.png`

## Upload This Folder

- `assets/`

The `assets/` folder should contain:

- `assets/ots-brand-mark.png`
- `assets/ots-login-logo.png`
- `assets/gcc-logo.png`
- `assets/chennai-smart-city.png`
- `assets/ots-icon-192.png`
- `assets/ots-icon-512.png`
- `assets/ots-apple-touch-icon.png`

## Do Not Upload

- `src/`
- `tools/`
- `cloudflare-worker/`
- `mobile-wrapper-legacy/`
- `node_modules/`
- `.env` files
- API keys, Neon credentials, Resend keys, Firebase service account JSON, OTP/session secrets

## Important Production Note

The new Join Portal and Audition Admin are currently static frontend files.
In this package they store applicant details and uploads in the browser on the same device.
That is useful for visual/demo testing, but it is not enough for real public production collection.

Before real applicants use this publicly, add backend storage:

- Neon table for onboarding applications
- Cloudflare R2 or another file storage service for videos/images/PDFs
- Worker routes for submit/review/final select
- Secure server-side admin authentication for `audition-admin.html`

Current dev audition admin login in the frontend:

- Username: `audition`
- Password: `otsaudition2026`

This is not secure for real production because it is inside frontend code.
