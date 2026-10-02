# Account sign-in handoff

Sign-in runs in the server's top-level `/signin` page rather than the game frame. Casual guest ownership and match recovery credentials are separate and are never included in a sign-in URL. The default provider list is email only. Google, GitHub, Apple, Discord, and Microsoft buttons appear only when explicitly included in the server's configured provider allowlist; enabling a button does not configure or enable its Supabase provider.

The server exposes `registerSignIn(app, { identityConfig, verifyAuth, clock?, providers? })`. Configuration contains only the public Supabase URL and publishable key. Missing identity configuration or verification disables the page and handoff endpoints. Production verification uses the existing identity adapter's signature, expiry, account and Auth-server checks. Browser session identity is never accepted as server authorization by itself.

## Client contract

1. `POST /identity/handoffs` with an empty body or `{}` creates `{ handoffId, pollSecret, completionSecret, expiresAt }`. Each ID or secret is 32 random bytes encoded as 43 base64url characters. Keep `pollSecret` in the game's memory.
2. Open `/signin#handoff=<handoffId>&complete=<completionSecret>`. The fragment is cleared immediately and the ephemeral binding is kept in guarded, first-party session storage before any social redirect. The fragment is not an HTTP request query and the page has `Referrer-Policy: no-referrer`.
3. Sign-in uses the official, installed Supabase JS **2.117.2** UMD bundle with its MIT license included inline. There is no CDN script. Email submission calls `signInWithOtp`; the entered code calls `verifyOtp` with `type: 'email'`. Both require an explicit user action. Configured social buttons use PKCE and redirect back to `location.origin + '/signin'`. The Supabase client persists its own session in guarded first-party session storage. Social sign-in is disabled when that storage cannot retain the handoff binding across navigation; email can use the in-memory fallback.
4. The sign-in page sends `POST /identity/handoffs/complete` with `{ handoffId, completionSecret }` and the fresh access token in the `Authorization: Bearer …` header. The server verifies it before storing the access token in memory and returns `{ returnCode }`. The return code is 16 random bytes, encoded as 22 base64url characters, and is shown in a copyable field. Refresh tokens are never sent to the broker or game.
5. The game sends `POST /identity/handoffs/consume` with `{ handoffId, pollSecret, returnCode? }`. Pending sign-in returns HTTP 202 `{ pending: true }`. Completed sign-in returns HTTP 200 `{ authorization: 'Bearer <JWT>', accountId }` once and destroys the entry. Supplying a manual return code requires an exact constant-time hashed match; a wrong code never consumes the entry. Automatic polling can omit the return code.

A popup blocked by the browser should leave a visible link that opens the same fragment URL in a new tab, plus a return-code input in the game. Do not send tokens with `postMessage`, put them in URLs, or rely on `window.opener`. The game receives only the access token and verified account ID through the one-time consume response.

Handoffs expire strictly at 300,000 milliseconds after creation, including during a yielding verification request. The broker keeps at most 1,000 entries, hashes all retained completion/poll/return secrets, purges expired entries on creation, and never persists tokens to a database. Duplicate completion and duplicate/racing consumption are rejected. Restart or a failed/expired handoff requires a new sign-in attempt and does not modify an account or casual seat. Every response uses `Cache-Control: no-store`; the sign-in page also uses nonce-based CSP, `frame-ancestors 'none'`, and `X-Frame-Options: DENY`.

## Operator setup and verification limits

The email template must expose the OTP code for this code-entry flow. The server `/signin` origin must be configured in Supabase's redirect allowlist before social PKCE callbacks or email links can work. Each social provider also needs its own credentials and redirect configuration. These operator actions belong to the later launch configuration task. No live provider settings were changed and no real email was sent during implementation tests.

### Follow-up live configuration correction

The user chose GitHub sign-in instead of configuring SMTP. Set
`MULTIPLAYER_SIGNIN_PROVIDERS=github` for a GitHub-only page (the default remains
email). The strict comma-separated allowlist accepts only the providers already
supported by the page and fails invalid configuration before database startup.
No email is sent in this flow. GitHub OAuth uses the same private PKCE handoff.

GitHub OAuth app homepage:
`https://game-server-production-5449.up.railway.app/index.html`

GitHub OAuth app callback:
`https://inxedkdsggcqmeexgyur.supabase.co/auth/v1/callback`

Keep wildcard matching and Device Flow disabled. Put the app Client ID/secret
directly into the verified project's GitHub provider configuration; do not keep
the secret in source, screenshots, command logs or chat. The user configured
the provider; its public settings endpoint subsequently reported GitHub enabled.
The existing exact production `/signin` redirect must remain allowed. Live
end-to-end GitHub authorization and handoff verification remain pending.

The email instructions below are an optional alternative, not a launch
requirement for the selected GitHub flow. Public email delivery requires custom
SMTP; Supabase's default sender is limited to project-team addresses.

On 2026-10-02 the authorized email check delivered a magic link pointing to `http://localhost:3000` rather than a code. The application already sends `emailRedirectTo: location.origin + '/signin'`; its code entry uses `verifyOtp` with `type: 'email'`. Correct the project's dashboard configuration rather than rewriting a received link or treating the callback authorization code as an email OTP:

1. Verify project `inxedkdsggcqmeexgyur` (Chess-Eternal-Blitz).
2. Authentication → URL Configuration: set Site URL to `https://game-server-production-5449.up.railway.app`; preserve existing legitimate entries and add the exact redirect `https://game-server-production-5449.up.railway.app/signin`. Do not add wildcards.
3. Authentication → Email Templates: use [email-code-template.html](email-code-template.html) for Magic Link and Confirm signup, exposing `{{ .Token }}` for existing and first-time email users. A suitable subject is “Your Chess Eternal sign-in code”. Preserve unrelated reset/invite/email-change templates and provider settings.
4. Start a new handoff from the hosted game, request a fresh email, enter its numeric code within the game's five-minute handoff window, and verify the game receives its one-time completion. Do not log the code, callback URL, return code or session tokens.

The connector exposes project details but no Auth configuration write tool in this session. The user supplied a screenshot of the corrected production Site URL and exact /signin redirect entry. Code-template configuration and live verification remain pending. Current Supabase [passwordless email docs](https://supabase.com/docs/guides/auth/auth-email-passwordless) describe using `{{ .Token }}` in place of the default confirmation link; [redirect docs](https://supabase.com/docs/guides/auth/redirect-urls) require `emailRedirectTo` to match an allowed URL.

Tests cover secret separation, public-ID rejection, wrong/manual secrets, exact expiry, bounded capacity, verification authority and redaction, restart, duplicate/racing completion and consume, disabled identity, HTTP responses and anti-framing headers. They fetch the actual locally bundled sign-in HTML, verify its SDK license/version and script syntax, and execute its application script against provider/DOM stubs to verify explicit email submission, OTP verification, fragment clearing and access-token-only completion. They do not establish a live email delivery, social-provider redirect, or real browser OAuth session.
