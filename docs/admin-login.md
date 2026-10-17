# Single administrator login

Entry: `https://mcxiaoshan.ccwu.cc/admin/`. The only account is `admin`; registration and public password-reset endpoints do not exist.

## First-time activation

1. Open `/admin/setup/` in your own browser. Set and save a password with at least 16 characters. The page derives a salted password hash and generates a random signing key locally; it never sends the password or configuration to this website.
2. In Cloudflare, open **Workers & Pages → astro-blog-starter-template → Settings → Variables and Secrets**.
3. Add a **Secret** named `ADMIN_AUTH`. Paste the complete generated JSON, then save and deploy it to the production Worker. Do not use a public `PUBLIC_` variable or a build-time-only variable.
4. Open `/admin/login/`. Sign in as `admin` using the password you selected. The setup page will stop being available once a valid configuration is present.

Missing or invalid secrets and missing/unavailable rate limiting fail closed. There is no default password and no remotely claimable first-admin endpoint. No login can succeed until the production secret is configured.

## Password changes and account recovery

On your own machine, run `node scripts/create-admin-config.mjs` with Node 22+. Password entry is hidden and no password file is written. Save the resulting JSON in the same Cloudflare `ADMIN_AUTH` secret and deploy. This works even if the previous password is lost, provided you control the Cloudflare Worker. Replacing the configuration invalidates every previous session. Do not commit the output or paste it into chat.

## Authentication behavior

- PBKDF2-HMAC-SHA-256 uses a random 128-bit salt and 100,000 iterations, the Workerd maximum. Enforce a long unique password; a password-manager-generated password is recommended. The signing key has 256 bits of randomness.
- Signed, origin-bound sessions expire after eight hours. Cookie: `__Host-admin_session`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`, with no `Domain` attribute.
- Login and logout are same-origin HTTPS POST operations. Unauthenticated requests never render the protected page. Logout clears this browser's cookie; stateless tokens copied before logout remain valid until expiry or configuration rotation.
- Cloudflare's rate limiting binding allows five login attempts per minute per IP per Cloudflare location. It is approximate and is not a global account lockout. If the binding fails, login is refused.
- All administrator responses use no-store caching, no-index headers, a script nonce, frame protection and no-referrer policy. Dynamic administrator routes run before static assets.
- No database is needed for this first single-account version. The protected page currently shows login status only; guestbook management has not been implemented.

## Runtime compatibility

Keep `disable_nodejs_process_v2` alongside `nodejs_compat`. Astro 5 detects the newer full Node `process` object as a Node server and selects a streaming response that Workerd serializes as `[object Object]`. The flag preserves the existing Cloudflare web-stream path; the built-Worker test checks the actual HTML response.

## Validation

Run `npm run check`, `node --test tests/*.test.mjs`, and `node --test tests/admin-worker.integration.mjs` after building. Integration tests exercise the built Worker in Workerd with disposable test-only credentials, not the live account.
