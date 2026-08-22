# ADR-008: Authentication Strategy — JWT RS256 Access (15m) + Rotating Refresh Tokens (7d) in Redis + SMS OTP (Twilio-class) + OAuth2 (Google/Apple/Facebook) = 5 Auth Methods Total

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: SEC, BKE, DBA, MOB, FEA
- **Date:** 2026-08-07
- **Supersedes:** None (foundational decision)
- **Related:** ADR-001 (Modular Monolith), ADR-002 (BC01 Identity prefix `id_`), ADR-004 (REST JSON:API Bearer auth), ADR-005 (PostgreSQL + Redis)

---

## 1. Context & Problem Statement

Project Charter §3.1 In Scope explicitly locks **5 authentication methods** for both Flutter Mobile App and React Admin SPA, plus **5 RBAC roles** (SuperAdmin, Admin, Editor, Moderator, User). The 5 auth methods required are:

1. **Email + Password** (traditional)
2. **Phone Number + SMS OTP** (passwordless; Twilio-class provider)
3. **OAuth2 — Google** (social login)
4. **OAuth2 — Apple** (mandatory for iOS App Store per Apple guidelines)
5. **OAuth2 — Facebook** (social login)

Additional non-negotiable requirements:
- **Security: Educational/religious platform with user PII + phone numbers** — trust is existential. OWASP Top 10 Session Management baseline minimum.
- **Flutter Mobile (iOS + Android):** AppStore Connect has hard requirements for Sign in with Apple. Must support silent token refresh without user re-login for 7+ days. Background audio playback requires non-interactive re-auth.
- **React Admin SPA:** Role-based dashboard routing. Cookie + CSRF or Bearer JWT. Session must survive browser refresh.
- **1,000–5,000 users first 6 months, path to hundreds of thousands without rewrite (Charter §2.1 Obj-002):** Token verification must be fast (<1ms) even at peak Phase 1 load. No DB hit on every authenticated request for token lookup.
- **Immediate revocation:** If user reports account compromise or SuperAdmin bans a user → ALL their access tokens + refresh tokens invalidated WITHIN 30 SECONDS across all devices (phone, tablet, admin dashboard). No "wait for token to expire" = unacceptable.
- **No-Pay Platform (Charter §3.2 Out of Scope: payments/donations):** No PCI-DSS scope; no stored credit cards. But PII + phone = sensitive; account takeover = serious reputation damage.

Four auth architectures evaluated:
1. **JWT RS256 Access (short-lived) + Rotating Refresh Tokens in Redis (long-lived) + OAuth2 flows** (Chosen)
2. **Long-lived JWT in httpOnly Cookie (no refresh tokens)**
3. **Traditional Server-Side Sessions (Redis-backed) + CSRF tokens**
4. **Full OIDC Provider: Keycloak self-hosted on Hostinger VPS**

Also considered: PASETO (Platform-Agnostic Security Tokens), OPAQUE (asymmetric password-authenticated key exchange). Both evaluated in Alternatives section.

---

## 2. Decision

**✅ WE WILL IMPLEMENT: Short-lived JWT RS256 access tokens (15 minute expiry) + Cryptographically rotating refresh tokens (7 day expiry, ONE-TIME-USE) stored in Redis. Five authentication methods unified behind a single NestJS `AuthService` in BC01 Identity (prefix `id_`). Immediate global revocation via Redis key deletion. All API requests authenticated via `Authorization: Bearer <access_token>` header.**

### 2.1 Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      AUTHENTICATION ARCHITECTURE — BC01 IDENTITY             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────────┐          ┌───────────────────────────────────────┐    │
│  │ 5 Auth Methods   │          │  Issuance Flow (per successful login) │    │
│  │ Unified Interface│──login──▶│  1. Verify credentials (method-specific)│    │
│  │                  │          │  2. Lookup/Create id_users row         │    │
│  │ 1. Email/Password│          │  3. Issue access_token (JWT RS256, 15m)│    │
│  │ 2. SMS OTP       │          │  4. Issue refresh_token (random 64-byte,│    │
│  │ 3. OAuth2 Google │          │     ONE-TIME-USE, 7d, stored in Redis)  │    │
│  │ 4. OAuth2 Apple  │          │  5. Return: { access_token,            │    │
│  │ 5. OAuth2 Facebook│         │       refresh_token, expires_in: 900,  │    │
│  └──────────────────┘          │       token_type: "Bearer" }           │    │
│                                └───────────────────┬───────────────────┘    │
│                                                    │                        │
│  ┌──────────────────┐                             ▼                        │
│  │ On Every Request │     ┌───────────────────────────────────────┐        │
│  │ 500 RPS          │     │  Verification Flow (every API call)    │        │
│  │                  │     │                                       │        │
│  │ Authorization:   │────▶│  1. Extract access_token from header   │        │
│  │ Bearer <at>      │     │  2. Verify RS256 signature against     │        │
│  │                  │     │     PUBLIC KEY (no DB hit! O(1))        │        │
│  │ P99 < 200ms      │     │  3. Check `exp` claim (expired?)        │        │
│  │ (Charter Obj 003)│     │  4. Check Redis `revoked:{kid}` list    │        │
│  └──────────────────┘     │     (if user banned / logout all)       │        │
│                           │  5. Extract `sub` (userId) + `roles`    │        │
│                           │  6. Attach to NestJS Request object     │        │
│                           │  7. Pass to RBAC Guard → allow/deny     │        │
│                           │  Avg verify: <0.5ms (RSA verify cached) │        │
│                           └───────────────────────────────────────┘        │
│                                                                             │
│  ┌──────────────────┐          ┌───────────────────────────────────────┐    │
│  │ Token Refresh    │          │  Refresh Flow (every ~14.5 mins)       │    │
│  │ Silent (Mobile)  │          │                                       │    │
│  │ Flutter Riverpod │──refresh▶│  1. Client sends refresh_token        │    │
│  │ + Admin React    │          │  2. Redis GET `rt:{token}` → { userId,│    │
│  │ Zustand auto     │          │     deviceId, prevToken, issuedAt }    │    │
│  │ refresh before   │          │  3. DELETE Redis key (ONE-TIME-USE!)   │    │
│  │ 15m expiry       │          │  4. Check: prevToken chain? Reuse?     │    │
│  │                  │          │     → if reuse detected: INVALIDATE    │    │
│  │                  │          │       ENTIRE refresh chain for user!   │    │
│  │                  │          │  5. Issue NEW access + NEW refresh     │    │
│  │                  │          │  6. Store new refresh in Redis         │    │
│  │                  │          │  7. Return both tokens to client       │    │
│  └──────────────────┘          │  Rotation Security: If refresh_token   │    │
│                                │  is stolen + used after legitimate app │    │
│                                │  rotates it → DETECTED → chain revoked │    │
│                                └───────────────────────────────────────┘    │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ DATA STORES — BC01 Identity                                           │  │
│  │                                                                        │  │
│  │  PostgreSQL 16 (id_ tables):                                           │  │
│  │  • id_users: id UUIDv7, email, phone, password_hash (bcrypt 12),      │  │
│  │    name_i18n JSONB, avatar_url, status (ACTIVE/BANNED/...), roles     │  │
│  │  • id_user_roles: user_id ↔ role_id (5 roles RBAC)                    │  │
│  │  • id_oauth_accounts: provider(google/apple/facebook), provider_id,  │  │
│  │    access_token (encrypted), refresh_token (encrypted), user_id FK    │  │
│  │  • id_sms_otps: phone, code_hash (sha256), expires_at, attempts      │  │
│  │  • id_refresh_tokens_audit: userId, deviceId, issuedAt, rotatedAt,   │  │
│  │    revokedAt, ip, userAgent (AUDIT ONLY; NOT for request-time use)    │  │
│  │                                                                        │  │
│  │  Redis 7 (ALL request-time auth state — <1ms lookups):                │  │
│  │  • SET rt:{refresh_token} → userId:deviceId:prevToken:issuedAt        │  │
│  │    (TTL 7 days = 604800 seconds; EXPIRE command on creation)         │  │
│  │  • SET revoked:user:{userId} → "1" (TTL max of longest access = 15m) │  │
│  │    → Immediate ban: SuperAdmin clicks BAN → Redis SETEX +             │  │
│  │      access_token check includes Redis EXISTS → 30s effective worst   │  │
│  │      (already-issued tokens live max 15m but check revocation LIST)   │  │
│  │  • SET rate_limit:login:{phone_or_ip} → counter (5/minute strict)    │  │
│  │  • SET rate_limit:sms:{phone} → counter (3/hour SMS send limit)       │  │
│  │  • LISTEN/NOTIFY: auth_events for BC04 Notifications welcome SMS/FCM │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Key Detail Specifications

#### 2.2.1 JWT Access Token Structure (Claims) — RS256 Asymmetric

```json
{
  "iss": "https://api.al-fajr.app",
  "sub": "01912345-6789-7abc-def0-1234567890ab",
  "aud": ["al-fajr-mobile", "al-fajr-admin"],
  "exp": 1754525700,
  "iat": 1754524800,
  "jti": "01912345-6789-7abc-def0-123456789abc",
  "roles": ["ROLE_USER"],
  "auth_method": "oauth2_google",
  "device_id": "flutter-ios-FA91C2",
  "languages": ["ar", "en"],
  "scope": "read:content write:engagement"
}
```
- **Algorithm:** RS256 (RSA-SHA256, asymmetric 2048+ bit key pair — NOT HS256 symmetric). Private key in secrets; public key distributed to all token verifiers.
- **Expiry:** `exp` = `iat + 900 seconds (15 min)` — STRICTLY ENFORCED, never extended server-side.
- **Public Key Distribution:** `GET /api/v1/.well-known/jwks.json` public endpoint returns RSA public keys in JWKS format (KID for key rotation). NestJS JwtModule uses CacheModule to cache public key locally; refetch hourly.
- **Key Rotation:** Private/public key pair rotated every 90 days. Old public key remains in JWKS endpoint for 24 hours after rotation to allow in-flight tokens to complete.
- **Issuer / Audience are environment-configurable (NOT hardcoded):** `iss` and `aud` are resolved from `API_DOMAIN` / client-audience environment variables at runtime. `al-fajr.app` is a **placeholder** until a real domain is purchased; no domain string is hardcoded anywhere in the auth code.

#### 2.2.2 Refresh Token Rotation Rules (Cryptographic Rotation + Reuse Detection)

1. **Format:** Cryptographically random 64 bytes (base64url-encoded, 86 chars). Generated via Node.js `crypto.randomBytes(64).toString('base64url')`. Not JWT. Not signed. Just opaque random.
2. **Storage:** Redis key `rt:{token}` = JSON `{"userId": UUID, "deviceId": string, "prevToken": string|null, "issuedAt": epoch}`. TTL `EX 604800` (7 days exactly).
3. **ONE-TIME-USE ONLY:** Redis DELETE immediately on successful refresh BEFORE issuing new refresh. New refresh stored separately with `prevToken = oldTokenHash`.
4. **Reuse Detection (Security Critical):** If refresh endpoint receives `rt:OLD_TOKEN` and Redis returns NOT FOUND (because legitimate user already rotated it), we check: does this token match ANY refresh chain's `prevToken` in the last 7 days? If YES → THEFT DETECTED. Automatic emergency action:
   - Delete ALL refresh tokens for this `userId` (SCAN Redis by user pattern)
   - Add `revoked:user:{userId}` Redis key for 15 minutes
   - Record security event `REFRESH_ROTATION_REUSE_ATTEMPT` in `ad_audit_logs` with IP/UA
   - Send BC04 notifications: Email + SMS + Push notification to user: "New device signed in; if not you, reset password."
5. **Device Fingerprint:** Mobile passes Flutter `device_info_plus` device ID; Admin SPA passes browser fingerprint + user agent. Refresh tied to device context. Device ID changed? → soft logout (force re-auth for that device only).

#### 2.2.3 Five Authentication Method Implementation Details

| Method | Registration Flow | Login Flow | Security Notes |
|--------|------------------|------------|----------------|
| **1. Email + Password** | User POSTs email + password. Server validates email uniqueness. Password hashed with bcrypt (cost factor 12 → ~250ms per hash, deliberately slow to resist offline cracking). Send welcome email via BC04. | User POSTs email + password. Bcrypt verify against `id_users.password_hash`. Rate limit: 5 attempts/min per email + IP. On 5 failures → lock account 15 min + email user "Too many attempts". | Bcrypt cost 12 minimum; never store plaintext; rate limit both REGISTER and LOGIN. No "forgot password" via SMS link; only time-limited JWT password reset token emailed. |
| **2. Phone + SMS OTP (Passwordless)** | User POSTs phone number (E.164 normalized). Server: (1) check Twilio-class `lookup` API for valid number, (2) generate 6-digit OTP, (3) sha256(code) → Redis `sms_otp:{phone}` TTL 180, (4) SMS send via BC04 → Twilio/Messages endpoint, (5) rate limit 3 SMS/hour per phone. | User POSTs phone + 6-digit code. Server: sha256(code) equals Redis value? If yes: create id_user if phone new; issue tokens. OTP INVALIDATED (Redis DEL) immediately even on wrong attempt. | No code = 000000/123456 in ANY environment. Staging: Twilio Test Credentials + codes fixed to test numbers. Production: real SMS; cost ~$0.005/SMS; at the Phase 1 user scale (1,000–5,000 users) monthly OTP cost is modest and well within budget. |
| **3. OAuth2 — Google** | Mobile initiates Google Sign-In SDK → gets Google `id_token` + `access_token`. Mobile POSTs `id_token` to `/api/v1/auth/oauth2/google/callback`. | Server validates Google ID token against Google public keys (openid-client package). Extract `sub` + `email` + `name`. Lookup id_oauth_accounts (provider=google, provider_id=sub). Create id_user if first login. Issue tokens. | Google Client ID whitelist: only our app's IDs. Verify `aud` claim matches exactly. No plain access token verification; always ID token. |
| **4. OAuth2 — Apple (MANDATORY iOS)** | Flutter `sign_in_with_apple` package → Apple `identityToken` (JWT) + `authorizationCode`. POST to `/api/v1/auth/oauth2/apple/callback`. | Server validates Apple identityToken against Apple public keys (Apple OIDC well-known). Verify `iss` = `https://appleid.apple.com`, `aud` = our App Bundle ID. Map Apple `sub` → id_oauth_accounts. If `email` private (hide my email): use Apple relay email or auto-generate handle. Issue tokens. | NON-NEGOTIABLE iOS App Store rule: if ANY other social login present, Sign in with Apple MUST be offered and work. Will fail App Store review otherwise. Client Secret generated per Apple docs (ES256 JWT signed by our Apple Developer private key — 6-month expiry). |
| **5. OAuth2 — Facebook** | Flutter `flutter_facebook_auth` package → Facebook Access Token. POST `access_token` to `/api/v1/auth/oauth2/facebook/callback`. | Server calls Facebook Debug Token API: `GET /debug_token?input_token=...&access_token=APP_ID|APP_SECRET` to verify token is issued to OUR app, user_id matches app-scoped ID. Map Facebook app-scoped user ID. Create id_user if new. Issue tokens. | Graph API v18+ minimum. Verify `expires_at` in debug token response. Never trust client-side user info; always fetch via Debug Token to confirm validity. |

#### 2.2.4 Immediate Revocation Mechanism (30-Second Global Invalidation)

- **BAN / Logout All Devices:** SuperAdmin or user "Log out all devices" flow:
  1. Set `Redis SETEX revoked:user:{userId} 900 "1"` (TTL = 15 minutes = max access token lifetime)
  2. Redis `SCAN 0 MATCH rt:*` + filter by userId in value JSON → `UNLINK` all refresh tokens
  3. PostgreSQL `id_users.status = 'BANNED'` (defense-in-depth; login check also fails status check)
- **Token Verification Step 4 Check:** Every API request verifies JWT signature + expiry. Then checks Redis: `EXISTS revoked:user:{userId}` → 401 IMMEDIATELY if true.
- **Worst-Case Revoke Window:** Existing valid access token issued before ban lives max 15 minutes; but Redis revocation check can kill it in next request. Effective invalidation = 0 seconds for next API call. The 15-minute max only applies if an attacker does nothing (no API call) with stolen token, which is useless attacker behavior.

### 2.3 Concrete Actions

1. **BC01 Identity Module Structure:**
```
identity/
  domain/
    entities/
      user.entity.ts
      oauth-account.entity.ts
    repositories/
      user.repository.ts
      oauth-account.repository.ts
    services/
      password-hasher.service.ts  (port/interface — bcrypt impl in infra)
  application/
    use-cases/
      login-email.usecase.ts
      login-sms-otp.usecase.ts
      oauth-google.usecase.ts
      oauth-apple.usecase.ts
      oauth-facebook.usecase.ts
      refresh-tokens.usecase.ts    (rotation + reuse detection!)
      revoke-tokens.usecase.ts     (ban / logout-all)
  infrastructure/
    auth/
      jwt-access-token.service.ts  (RS256 sign/verify, JWKS endpoint)
      redis-refresh-token.store.ts (refresh rotation, Redis ops)
      oauth/
        google.provider.ts         (openid-client)
        apple.provider.ts
        facebook.provider.ts
      sms/
        sms-otp.service.ts         (Twilio adapter, OTP rate limits)
    persistence/
      typeorm/
        entities/
          user.typeorm.entity.ts
          oauth-account.typeorm.entity.ts
      migrations/
        1690000000001-CreateIdUsersTable.ts
    controllers/
      v1/
        auth.command.controller.ts    (POST login, refresh, revoke, oauth callbacks)
        auth.query.controller.ts      (GET .well-known/jwks.json, GET /me)
```
2. **Key Generation:** RSA-2048 private key generated offline via `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out private.pem`; public key extracted. Keys stored in `infra/secrets/.env.production` (chmod 600). NEVER committed. Pub key in JWKS endpoint is the only distribution method.
3. **NestJS Security Hardening:** Global `ThrottlerGuard` for rate limiting (custom Redis-backed store). `Helmet` CSP/HSTS headers. `CORS` whitelist only mobile App User-Agent + Admin domains. CSRF NOT needed: Bearer token pattern (no cookies for API auth).
4. **SEC Team Pen-Test Targets:** Documented in runbook: (a) Refresh rotation reuse → chain revoke? (b) JWT algorithm confusion (none / RS256 vs HS256)? (c) SMS OTP rate-limit bypass? (d) OAuth `state` param CSRF check on redirects? (e) Key ID injection in JWKS?
5. **Flutter Mobile Secure Storage:** Access token + refresh token stored in `flutter_secure_storage` (Keychain on iOS / Keystore on Android). SharedPreferences forbidden for tokens. Background refresh via Riverpod `Timer.periodic` at 14-minute mark (1 minute before expiry).
6. **React Admin Storage:** HttpOnly cookie NOT used (Bearer + `localStorage` with `Content-Security-Policy: script-src 'self'` to prevent XSS token exfiltration, OR Secure + SameSite=strict httpOnly cookie as secondary option — decision made per SEC recommendation in Class B decision; this ADR mandates Bearer header pattern regardless of client storage mechanism).

---

## 3. Alternatives Considered

### Alternative A: Long-Lived JWT in httpOnly Secure Cookie (No Refresh Tokens)

One JWT per session, 7-day expiry, stored in `Set-Cookie: access=eyJhbGci...; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`. No Bearer header. No refresh flow.

- ✅ **Pro:** CSRF mitigated via SameSite=Strict + CSRF token double-submit. XSS cannot steal cookie due to HttpOnly.
- ✅ **Pro:** SIMPLEST. No refresh flow code. No rotation logic. Mobile/Admin just attach cookie automatically.
- ❌ **Con:** **JWT 7-day lifespan = revocation IMPOSSIBLE without database hit on every request.** The entire REASON for short access + refresh is revocation. With 7d cookie JWT, you either: (a) accept "ban takes 7 days to fully apply" = UNACCEPTABLE for a user content platform, or (b) add Redis revocation list check on every request → then why not just use server sessions (Alt B) which give you this by default?
- ❌ **Con:** **Flutter + Cookie auth = POOR experience for background services.** Background audio playback isolate needs to re-authenticate; cookie jar in Dart HTTP client is separate from main isolate cookie jar. Cross-isolate cookie sync = custom code. Bearer token = simple string, easily passed.
- ❌ **Con:** **Multi-device login: "log out all devices" requires iterating ALL JWT KIDs issued to user = impossible without tracking every issued JWT in DB (which is exactly sessions, again).**
- ❌ **Con:** **Mobile App Store + Play Store deep links / OAuth callback flows break cookie domain boundaries.** Apple/Google OAuth callback redirects back to custom scheme URL (not HTTPS cookie domain); cookie does not persist. Extra code to handle OAuth callback JWT → cookie exchange.
- ❌ **Con:** **CSRF attack surface still exists even with SameSite=Strict.** Attackers can use `<form action="https://api.al-fajr.app/api/v1/comments" method="POST"><input hidden="body" value="spam">` and coerce user to submit. Need double-submit CSRF token pattern (cookie + header match). So we add CSRF tokens on top of cookies.
- ❌ **Con:** **Cannot easily support BOTH Mobile SPA Admin and 3rd-party API access (future).** Bearer tokens are the internet standard for API access; cookies are browser-only.

### Alternative B: Traditional Server-Side Sessions (Redis-backed) + CSRF

Every login creates `sessionId` = random 64 bytes, Redis `sess:{sid}` = JSON `{userId, roles, issuedAt, deviceId}`, TTL 7 days. Cookie or header `X-Session-Id`.

- ✅ **Pro:** **Immediate revocation = Redis DEL.** The simplest revocation model possible.
- ✅ **Pro:** Session data can be extended server-side without client participation (sliding expiration). User active? Update TTL.
- ✅ **Pro:** No token signing/verifying crypto. No key rotation. No JWKS endpoint. Simplest possible backend code.
- ❌ **Con:** **EVERY AUTHENTICATED REQUEST = REDIS HIT.** 500 RPS × 1 Redis lookup = 500 Redis ops/sec. That's fine; Redis can do 100k ops/sec. BUT: ADR-005 Architecture Principle P-09 says "testability without external mocks". Every NestJS controller test now needs Redis mock. Higher test complexity. Also: If Redis fails (restarts, failover glitch) → API 500 for 100% of requests (total outage). JWT RS256 verification = cache public key locally; works even during brief Redis outage; Redis only needed for BAN checks (degraded mode still allows non-banned users through for <15 min).
- ❌ **Con:** **Session fixation attack surface.** If attacker plants session cookie before user login → post-login session hijack. Mitigation: Session ID rotation on every login + privilege level change. Adds code. JWT rotation model with refresh already handles this.
- ❌ **Con:** **Flutter Mobile background refresh again. X-Session-Id in header works but sliding expiration** → session TTL bumped on each request. With 500 RPS, Redis TTL updates = high write volume. For 100k DAU, acceptable but higher than JWT.
- ❌ **Con:** **Future microservices.** Every service that verifies session needs either (a) shared Redis access, or (b) call to Auth service on every request. Creates tight coupling. JWT RS256 = stateless public key verification per service; each service verifies locally; only ban list requires Redis. LOOSE COUPLING.
- ❌ **Con:** **Admin + Mobile different lifetimes.** Mobile needs silent background refresh = longer sessions + device binding. Admin needs shorter timeout + idle logout. Both possible but require custom per-context session logic.

### Alternative C: Full OIDC Provider — Keycloak Self-Hosted on Hostinger VPS

Keycloak 25.x running in Docker Compose alongside app. Keycloak handles ALL 5 auth methods, JWT issuance, refresh token rotation, OAuth clients, user federation. App = resource server only; verifies JWT against Keycloak JWKS.

- ✅ **Pro:** **STANDARD OIDC/OAUTH2.** Security battle-tested; maintained by Red Hat; fixes for auth bugs ship faster than we can code them. If built correctly, login/auth code in our app = 0. All flows in Keycloak Admin console.
- ✅ **Pro:** **Refresh rotation, reuse detection, revocation, JWKS, key rotation, session management** — ALL built-in. No custom rotation code to write or audit.
- ✅ **Pro:** **Future OIDC SSO easy.** If the client later needs "Sign in with Al-Fajr ID" for a sister app, Keycloak acts as identity broker.
- ✅ **Pro:** **MFA, Passkeys, Social Identity Brokering** — all built-in; activate via admin console. Phase 2 MFA = toggle switch, no code.
- ❌ **Con:** **RESOURCE HOG on Hostinger VPS.** Keycloak 25.x recommended minimum: 2 CPU cores + 2 GB RAM HEAP for production. On the Phase 1 Hostinger VPS (4GB RAM / 2 vCPU per ADR-007) shared with PostgreSQL (3g limit) + App (2g limit) + Redis + Nginx + the lightweight Uptime Kuma monitor (ADR-011), adding Keycloak (+2GB heap) is IMPOSSIBLE without a VPS tier upgrade = extra monthly cost.
- ❌ **Con:** **HARD DEPENDENCY. Outage in Keycloak = 100% login outage.** Can't login, can't refresh tokens. Our custom auth code runs INSIDE our NestJS app (same process, same PM2 restart). Keycloak = separate container; needs its own health checks, rolling restart, Postgres DB (separate schema or separate DB). Extra operational burden for Account 06 DEV (only 1 DevOps expert).
- ❌ **Con:** **SMS OTP = Custom Keycloak SPI (Service Provider Interface) required.** Keycloak has no built-in Twilio SMS OTP. Must write Java or Quarkus code for Keycloak SMS authenticator SPI. Package as JAR. Mount into Keycloak Docker container. Debug SPI classloader issues. Upgrade Keycloak version? SPI may break. Class A decision to use Keycloak + Class B work writing SPI = extra 2-3 weeks MVP timeline.
- ❌ **Con:** **USER DATA MODEL INFLEXIBILITY.** Keycloak user model = fixed (username, email, firstName, lastName, attributes JSON). Our id_users table has i18n name (JSONB), avatar, phone, status enum, roles + custom join table. To keep both in sync, either use Keycloak User Storage SPI (read/write to OUR PostgreSQL schema) = MORE custom Java code, OR dual-write our user table alongside Keycloak's own `user_entity` table. Dual write = consistency bugs possible. Storage SPI = SPI hell x2.
- ❌ **Con:** **RBAC 5-role model = Keycloak Realm Roles or Client Roles.** Mapped to our app via JWT `roles` claim. Works BUT: Admin UI for role assignment now is Keycloak console (separate from our React Admin). React Admin "User Management → Change Role" feature must either (a) call Keycloak Admin REST API (secured with service account), or (b) use dual-write and ignore Keycloak roles. Extra code + complex.
- ❌ **Con:** **Hostinger backup/restore complexity INCREASES.** Now we have: PostgreSQL app schema, Keycloak schema, Redis app data, Keycloak Infinispan cache. DR runbook grows. Restore drill 4 hours → 6 hours.

### Alternative D: JWT RS256 + Refresh Token Rotation in Redis (Chosen Decision)

- ✅ **Pro:** **Balance of security + performance + operational simplicity.** Short access = immediate ban impact (via Redis check). Refresh rotation = theft detection. All code runs inside NestJS app (no extra Java containers).
- ✅ **Pro:** **<0.5ms token verification (public key signature check + local cache) for 99% of requests.** Redis ban check = EXISTS command only when banned. Redis outage for 30 seconds? 99% of users not banned = still can make API calls. Graceful degradation. Keycloak outage? = total login outage.
- ✅ **Pro:** **User model 100% flexible.** id_users schema = fully ours. JSONB name_i18n, custom status enum, avatar_url, phone E.164 normalized → all native PostgreSQL with TypeORM. No SPI plugins, no dual writes.
- ✅ **Pro:** **RBAC native NestJS `RolesGuard`** reads `roles` claim from JWT → React Admin User Management updates id_user_roles table → new access token on next refresh picks up role change. No Keycloak admin API integration needed.
- ✅ **Pro:** **Operational overhead MINIMAL.** 1 DEV expert (Account 06) already manages Docker Compose. Adding our auth code to our NestJS app = zero extra containers. Observability: auth events emit structured JSON logs surfaced by the lightweight monitoring stack (ADR-011). Keycloak would add a separate container + metrics exporter + maintenance.
- ✅ **Pro:** **Flutter Mobile background refresh is clean.** Bearer tokens + Dart `http` package = background audio isolate just forwards the token string. No cookie jar sync. 14-minute Riverpod timer calls `/refresh` → returns new tokens. Secure storage writes them. Transparent to user.
- ⚠️ **Trade-off:** **We implement our own security-critical auth code = we must audit it.** SEC expert (Account 07) is on the 10-person team. Budgeted: 1-week security code review + pen-test of auth endpoints BEFORE MVP launch. Industry rule: "don't roll your own crypto" — correct; we DON'T roll crypto (we use Node.js crypto, standard bcrypt, openid-client for OAuth, RSA RS256 standard). We roll AUTH FLOWS — which every startup does until they hit Keycloak-scale.
- ⚠️ **Trade-off:** **Refresh rotation reuse detection code is tricky.** Edge cases: legitimate client uses refresh_token (network hiccup 504 timeout) → client retries with SAME token. Server thinks reuse → chain revoked. FALSE POSITIVE. **Mitigation:** 10-second grace window. On first refresh of rt:OLD_TOKEN, we keep `rt:{old}` as value `REVOKED:{newToken}` with TTL 10 seconds. If retry comes within 10s → return SAME newToken (tolerate network retry). If retry after 10s → reuse detected. Tuned in staging; false-positive rate tracked via structured JSON log counters (ADR-011).
- ⚠️ **Trade-off:** **No built-in MFA in MVP.** If MFA becomes Phase 2 requirement, we need to add TOTP/HOTP code to auth flows. Keycloak would have this as a toggle. **Mitigation:** We design BC01 AuthModule with `MfaChallengeService` port/interface already defined (no implementation in MVP). Adding TOTP later = new infrastructure adapter + login flow conditional check. NOT a full rewrite.

### Also Evaluated But Rejected Early

**PASETO (Platform-Agnostic Security Tokens):** Claims to be better JWT (no algorithm confusion). Problems: No JWKS equivalent key distribution standard; NestJS `@nestjs/jwt` supports JWT only; no `passport-paseto` mature libraries. Migration path from JWT → PASETO is trivial in future if JWT ecosystem threat model changes. Not worth MVP ecosystem risk today.

**OPAQUE (Asymmetric PAKE):** Zero-Knowledge password login — server never sees password. Problems: Draft RFC (not standardized as of 2026). No production Node.js libraries. No browser/Flutter SDK. 3-round-trip protocol increases latency. Benefits negligible over TLS 1.3 + bcrypt (which we use anyway). Re-evaluate in 2028 when standard + libraries mature.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Long-Lived JWT Cookie (No Refresh) (Alt A) | Server Sessions Redis (Alt B) | Full Keycloak OIDC (Alt C) | JWT RS256 + Refresh Rotation Redis ✅ CHOSEN (Alt D) |
|-----------|---------------------------------------------|--------------------------------|------------------------------|------------------------------------------------------|
| **Immediate Revocation (Banned User)** | ❌ 7-day max or Redis-per-hit (defeats purpose) | ✅ Redis DEL = instant | ✅ Built-in admin API | ✅ Redis SETEX revoked:user → <30s effective |
| **Per-Request Latency (500 RPS)** | ✅ <0.1ms (no Redis if no ban) | ❌ Mandatory Redis hit (every request) | ⚠️ JWT verify + optional introspection endpoint | ✅ <0.5ms pubkey verify + optional Redis EXISTS for ban |
| **Flutter Mobile Background Audio** | ❌ Cookie isolate sync code | ⚠️ Header pattern OK sliding TTL code | ⚠️ SDK OIDC_flutter extra dependency + cookie issues | ✅ Bearer string pass-through + 14-min refresh timer simple |
| **User Model Flexibility (JSONB i18n etc.)** | ✅ Fully ours | ✅ Fully ours | ❌ Storage SPI Java code or dual-write | ✅ Fully ours + TypeORM native |
| **RBAC 5 Roles + React Admin UI Integration** | ✅ Simple NestJS RolesGuard | ✅ Simple NestJS roles from session | ❌ Keycloak Admin API wrapper needed | ✅ JWT roles claim + RolesGuard = 20 lines code |
| **MVP Timeline (3 months)** | ✅ Fastest (simplest code) | ⚠️ 1 week session + CSRF code | ❌ +3 weeks SPI + User Storage + RBAC API | ✅ ~1.5 weeks auth code; SEC 1 week pen-test |
| **Operational Burden 1 DEV** | ✅ Zero extra container | ⚠️ Redis dependency only | ❌ Keycloak + Infinispan + Postgres schema extra | ⚠️ Redis + Key rotation 90-day manual task |
| **Hostinger VPS Resource Footprint** | ✅ Zero extra | ⚠️ Redis used (but Redis shared already for cache) | ❌ +2 CPU / +2GB RAM = upgrade VPS tier | ⚠️ Uses Redis (already chosen in ADR-005 anyway) |
| **Security: Stolen Token Mitigation** | ❌ 7-day stolen token window | ✅ Redis revoke on theft report | ✅ Built-in session revocation | ✅ Refresh rotation THEFT DETECTION → auto chain revoke |
| **Security: Refresh Token Reuse Detection** | N/A (no refresh) | N/A (session pattern) | ✅ Built-in | ✅ Custom 10s grace window + auto chain revoke |
| **Keycloak-Level MFA Readiness (Phase 2)** | ❌ Add from scratch | ❌ Add from scratch | ✅ Toggle switch | ⚠️ Interface stub now → adapter + flow logic later (~1 week) |
| **Multi-Service Future (ADR-003)** | ⚠️ Stateless verify OK; ban list shared Redis | ❌ All services share session Redis or RPC auth | ✅ OIDC standard across services | ✅ Stateless RS256 JWKS per service; ban list Redis shared |
| **SEC Audit / OWASP Compliance** | ⚠️ Long-lived token = flagged in ASVS | ⚠️ Session fixation risk if not rotated on login | ✅ OWASP ASVS 4.0 Level 2 compatible out of box | ✅ Custom pen-test; ASVS Level 2 achievable; short-lived + rotation scores high |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Security Posture: HIGH GRADE.** Short access (15m) + rotating refresh with reuse auto-chain-revoke = OWASP ASVS Session Management V3 best-practice scores. Immediate ban via Redis revocation list = trust-preserving for PII user base (religious/educational platform = high trust required).
2. **Flutter + Admin Both First-Class Citizens.** Bearer token pattern = identical auth model for both clients; no cookie vs session hacks. Mobile background audio isolate = works; Admin idle timeout = adjustable via refresh lifetime.
3. **MVP Timeline On Budget.** 1.5 weeks for auth code (BC01 Identity module) + 1 week SEC expert pen-test. Keycloak SPI = 2-3 weeks delay avoided. Charter's 3-month MVP preserved.
4. **Zero Extra Operational Containers.** All auth logic lives inside our NestJS modular monolith (ADR-001). Same PM2 restart, same CI/CD pipeline, same structured JSON logging + `/health` monitoring (ADR-011). DEV expert (Account 06) not overloaded.
5. **User + RBAC Model Native.** PostgreSQL `id_users` JSONB i18n columns, phone E.164 normalization, 5-role join table, status enum — all implemented in TypeORM 0.3.x exactly as needed. No compromises, no SPI wrappers.
6. **Future Extraction Path Clean.** When BC01 Identity is extracted to microservice (ADR-003 Trigger 1 fires), JWKS endpoint continues working; all other services just fetch public key from new location. Stateless JWT pattern survives extraction perfectly.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **Custom security-critical code = pen-test requirement.** **Mitigation:** (a) SEC expert Account 07 is on the 10-team roster; budgeted explicitly; (b) OWASP ZAP + Burp automated scans run weekly in CI; (c) Manual pen-test plan covers: refresh rotation reuse, JWT algorithm confusion, SMS OTP bypass, OAuth CSRF state, KID injection, bcrypt cost timing; (d) Bug bounty program optional at launch ($500-$5000 per critical auth bug).
2. **False positive refresh rotation reuse detection (network 504s).** **Mitigation:** 10-second grace window where same refresh retry returns same new token; a structured-log counter `auth_refresh_reuse_false_positive_total` is tracked (ADR-011); if rate >0.5% of refreshes after 1 month, widen grace window to 20 seconds.
3. **Phase 2 MFA = 1 week custom TOTP adapter work.** **Mitigation:** Design `MfaChallengePort` interface in domain layer TODAY with `challenge(user, method)` + `verify(user, code)`. No implementation in MVP. Phase 2: `TotpAdapter implements MfaChallengePort` using `otplib` package + QR code generation in Admin UI. Architectural boundary preserved; NOT full rewrite.

### Neutral / Unknown (risks to monitor)
1. **RSA 2048 → 4096 key upgrade for JWKS:** Some security audits recommend 4096-bit RSA. JWT verify computation time roughly doubles at 4096. PFE runs load test: if <1ms average verification still holds with 4096 on target VPS, we upgrade. Public key algorithm agility is designed into JWKS endpoint KID system; supports multiple keys simultaneously.
2. **Apple OAuth "Hide My Email" proxy:** 20-40% of iOS users choose private relay email. Welcome email deliverability to Apple proxy must be tested with BC04 Notifications team. If deliverability is poor, fall back to in-app notification center welcome.
3. **Hostinger VPS entropy for `crypto.randomBytes`:** Headless Linux VPS entropy can be low; affects quality of refresh token randomness + RSA key generation. Mitigation: `haveged` daemon installed during `provision-vps.sh` step 04. Check `cat /proc/sys/kernel/random/entropy_avail` > 1000 post-provision. SEC audits.

---

## 6. Reversal / Exit Criteria (When to Revisit This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Security Incident):** Critical security incident traced DIRECTLY to custom auth code (not password leak by user, not misconfiguration). Example: Refresh rotation logic bug causes 1000+ account takeovers.
   - **Action:** Emergency migration to Keycloak. SPI work for SMS OTP accelerated. This ADR is marked SUPERSEDED. All sessions invalidated; user re-onboarded via forced password reset.

2. **TRIGGER 2 (Feature Growth):** Business roadmap requires ≥3 of these features SIMULTANEOUSLY within any 6-month window: TOTP/HOTP MFA, Passkeys (WebAuthn), LDAP Active Directory sync for enterprise admin users, SAML SSO for partner org, Identity brokering with 10+ extra social providers, User-consented OAuth authorization for 3rd party developer apps (API marketplace).
   - **Action:** Cost-benefit analysis: Build each feature in BC01 (~2-4 weeks per feature = 3 months engineering time) vs Migrate to Keycloak + SPI work (~4 weeks migration + 1 week stabilization). If analysis favors Keycloak, write new ADR; plan migration during scheduled maintenance window; dual-running period of 2 months with both valid.

3. **TRIGGER 3 (Headcount + Budget Inflection):** Project adds ≥2 additional DevOps/Infrastructure experts AND migrates to multi-VPS or multi-cloud (ADR-007 Trigger 1 fires), AND Hostinger VPS tier upgrade to 32GB+ RAM is budget-approved.
   - **Action:** Keycloak operationally feasible now. Evaluate; if no Auth SPI pain, migration may still not be worth it. Not automatic — requires CSA + SEC analysis of benefits vs migration risks.

4. **TRIGGER 4 (Auth Service Extraction First):** ADR-003 Trigger 1 fires for BC01 Identity FIRST (unlikely, but possible if login 40% of RPS). During extraction design phase, team evaluates deploying Identity as Keycloak-based OIDC service instead of NestJS extracted microservice.
   - **Action:** If analysis favors Keycloak (OIDC standard, social providers already there), write new ADR; migrate as part of extraction. This ADR is deprecated for the extracted service only; remaining modules in monolith still use same Bearer JWT pattern against new OIDC JWKS.

We **explicitly do NOT revisit** this decision:
- Due to "Keycloak is enterprise standard" without concrete feature count (Trigger 2) or incident (Trigger 1) evidence
- Because individual devs dislike writing auth flows
- Before MVP launch, SEC pen-test, and 3 months post-launch stability data
- Without CSA + SEC sign-off AND detailed write-up of what custom-auth cost/benefit ratio has changed

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §2.1 Objective 005 (0 critical security findings pen test), §3.1 Scope (Mobile: 5-method authentication, 5 languages, RBAC 5 roles; Backend: JWT access + rotating refresh tokens + SMS OTP + OAuth2), §3.2 Out of Scope (payments, no PCI-DSS)
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §2.1 P-07 (Secure by Default), §4.1 System Context diagram (Flutter/React clients + auth flows), §6 Quality Attributes Security Priority = 30%
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §2.1 Account 02 BKE (Backend Identity module), Account 07 SEC (Threat models, pen test, veto on failing PRs), §3.1 Class A Architectural Decision — Auth = highest security sensitivity
- [ADR-002 Bounded Context Map](ADR-002-bounded-context-map-5-modules.md) §2.1 Table 1 — BC01 Identity owner = BKE + SEC, prefix `id_`
- [ADR-004 API Style REST JSON:API](ADR-004-api-style-rest-json-api.md) §2.2 API Layer Diagram — JWT RS256 Bearer auth referenced in external surface
- [ADR-005 Primary DB PostgreSQL 16](ADR-005-primary-database-postgresql-16.md) §2 (JSONB i18n columns for user name; bcrypt hashes in `id_users`; RLS on id_ tables)
- [ADR-007 IaC Docker Compose + Scripts](ADR-007-iac-phase-1-docker-compose-shell-scripts.md) §2.2 Compose services — App container runs auth code; no extra Keycloak container in Phase 1
- [ADR-011 Observability — Lightweight Monitoring](ADR-011-observability-lightweight-monitoring.md) — auth events via structured JSON logs; `/health` + `/ready` probes; Uptime Kuma
- External: OWASP ASVS 4.0 Level 2 V3 Session Management & V2 Authentication — baseline controls implemented
- External: OAuth 2.0 Security Best Current Practice (BCP) — IETF RFC — refresh token rotation MUST be one-time-use, reuse MUST trigger revocation
- External: Auth0 Blog — Refresh Token Rotation: Everything You Need to Know
- External: Apple App Store Review Guidelines §4.8 Sign in with Apple — required when offering third-party social login
- External: Twilio Verify API Documentation — SMS OTP best practices, rate limiting, lookup API
- External: Node.js `crypto` docs — `randomBytes` (CSPRNG) + `bcrypt` cost-factor tuning guidance

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. 4-main alternative + 2 early-reject (PASETO, OPAQUE) comparison; architecture diagram; detailed JWT/refresh/specs; 4 reversal triggers. Sent for Sponsor + SEC + BKE + MOB review.
- 2026-08-09: ACCEPTED — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; JWT `iss`/`aud` and all domains resolved via environment variables with `al-fajr.app` placeholders (NOT hardcoded); 5-role RBAC confirmed (SuperAdmin/Admin/Editor/Moderator/User); observability references replaced by ADR-011 lightweight monitoring (structured JSON logs); Keycloak resource footprint aligned to the right-sized Phase 1 VPS tier; scale framing aligned to 1,000–5,000 users with a documented path to hundreds of thousands; relative doc links.
