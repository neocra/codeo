# Remote access security — gateway phase 1

Scope: `apps/gateway` (`@codeo/gateway`), the service that lets the mobile app reach a developer's
runtime from outside the local network. This document is the threat model for that path and the
map between product spec §14 ("Remote connection architecture") and what the phase 1 skeleton does.

## 1. What the gateway is, and is not

```
 mobile app  ──TLS──▶  gateway  ◀──TLS (outbound)──  runtime (developer machine)
                        │
                        ├─ pairs devices with runtimes
                        ├─ issues / rotates / revokes device credentials
                        ├─ relays protocol frames, enforcing scopes
                        └─ audit log
```

- The gateway **never executes development work**. It does not hold a provider SDK, never touches a
  repository, and does not interpret command params: it checks `kind`, `command` and `id`, then pipes.
- The gateway **never stores repositories or session content**. The only session-related data it holds
  is a bounded in-memory ring of the last 2 000 runtime events per runtime, used for reconnection replay.
- Runtimes connect **outbound** (`GET /v1/runtimes/:id/connect`). No inbound port is opened on the
  developer's machine, nothing is exposed to the LAN, and the runtime keeps binding to loopback.
- All persistent state sits behind `GatewayStore` interfaces (`src/store.ts`). Phase 1 ships an in-memory
  implementation; PostgreSQL replaces it without touching the services.

## 2. Assets and adversaries

| Asset | Why it matters |
|---|---|
| Runtime secret | Lets a party impersonate a runtime: receive device requests, push fake events, start pairings. |
| Device credentials (access + refresh token) | Let a party act as the developer's phone: read sessions, send prompts, approve tool calls. |
| Pairing code | A live code lets a stranger pair their own phone to the runtime. |
| Gateway HMAC secret | Lets a party mint access tokens for any device of any runtime. |
| Relayed traffic | Session transcripts, repository paths, tool inputs: confidential by nature. |
| Audit log | Needed to detect and investigate abuse; must not itself leak secrets. |

Adversaries considered: a network attacker (public Wi-Fi, hostile proxy), a stranger guessing pairing
codes, a thief with the phone (unlocked or not), a leaked backup or log containing a refresh token, a
compromised gateway host (partially — see "not done"), and a device whose access was withdrawn but which
still holds unexpired tokens.

## 3. Spec §14 requirements → implementation

| Requirement | Phase 1 implementation | Where |
|---|---|---|
| **TLS everywhere** | `TLS_CERT`/`TLS_KEY` start Fastify over HTTPS (`serverFactory`). In production without in-process TLS the gateway logs a loud warning and expects a terminating reverse proxy; `PUBLIC_URL` must be `https://` in production and is what ends up in QR codes, so phones never dial plain `ws://`. | `config.ts`, `app.ts`, `main.ts` |
| **Device pairing** | Runtime (bearer-authenticated) calls `POST /v1/pairing/start` → 6-digit code + 128-bit nonce + QR payload `{v:1, gateway, code, runtimeId, nonce}`. The phone calls `POST /v1/pairing/complete`. Codes: 5-minute TTL, **single use** (atomic `consume`), unique among live codes, **rate limited per IP** (10 attempts / 5 min), and a code presented with a wrong nonce/runtimeId is burnt. The QR path binds the scan to one exact pairing via the nonce; manual entry relies on TTL + rate limit. | `pairing.ts`, `store.ts` (`PairingCodeStore.consume`), `routes.ts` |
| **Short-lived credentials** | Access tokens are HMAC-SHA256 signed (`v1.<claims>.<sig>`, `node:crypto`, constant-time compare, no external JWT lib and therefore no algorithm negotiation) and expire after 15 minutes by default. Claims: device, runtime, scopes, iat/exp, jti. | `tokens.ts` |
| **Token rotation** | Refresh tokens are opaque 256-bit random strings; only their sha256 is stored. `POST /v1/auth/refresh` retires the presented token (kept until expiry, flagged `rotatedAt`) and issues a new pair in the same *family*. | `auth.ts` (`refresh`) |
| **Replay protection** | Presenting a refresh token that was already rotated is treated as theft: the **whole device is revoked**, every refresh token of the device is deleted, an `auth.refresh.reuse` audit entry is written, and the still-valid access token is refused at the edge. Request ids on the relay are prefixed per connection so a response can only go back to the socket that asked. Events carry the runtime's monotonic `seq`; the relay drops duplicates and never delivers a seq twice to the same device. | `auth.ts`, `relay.ts` |
| **Device revocation** | `POST /v1/devices/:id/revoke` (runtime-authenticated, scoped to its own devices — foreign devices are "not found"). Revocation marks the record, drops refresh tokens, closes every live socket of the device (close code 4003) and is re-checked **on every relayed request**, so an unexpired access token stops working immediately. | `auth.ts` (`revokeDevice`), `relay.ts` |
| **Runtime identity verification** | Runtimes register once (`POST /v1/runtimes/register`) and receive a self-describing secret `<runtimeId>.<random>`; only its sha256 is stored, the secret is shown once. Every runtime action (pairing start, device listing, revocation, relay connect) requires it as `Authorization: Bearer`, and the relay rejects a runtime that presents a valid secret for a different `:id` (403). Devices are bound to one `runtimeId` in both the record and the token; a token for runtime A cannot be used on runtime B. The phone verifies the *gateway* through TLS; verifying the runtime end-to-end (key continuity) is future work — see §5. | `routes.ts`, `auth.ts`, `relay.ts` |
| **Connection recovery** | Both sides are heartbeat-pinged every 30 s and terminated when silent. Devices reconnect with `afterSeq`; the relay replays from its per-runtime ring (last 2 000 events). If the requested window was evicted, or the gateway restarted with an empty ring, the device gets an `error` frame starting with `replay-gap` and must re-query state (the `RuntimeClient` surfaces it as an `error` event). A reconnecting runtime receives a `hello` with the gateway's own `afterSeq` so it can backfill the ring. A newer runtime connection replaces the older one (close 4000). | `relay.ts`, `ring-buffer.ts` |
| **WebSocket streaming** | Standard runtime protocol (`@codeo/contracts`): device frames are validated as `ClientMessage`, runtime frames as `ServerMessage`; anything else is dropped. Max frame 4 MiB. Pings are answered by the gateway; a `hello` must arrive within 5 s. | `relay.ts` |
| **Command authorization with scopes** | Paired devices get `['read','session:write','approval:decide']`; `workspace:admin` is never granted remotely. For every request the relay looks up `commands[command].scope` and refuses with `FORBIDDEN` **before** the runtime sees anything when the device lacks it. Scopes come from the device record (source of truth) intersected with the token; narrowing a device's scopes takes effect on its next request. | `relay.ts`, `auth.ts` |
| **Audit logging** | Every registration, pairing start/complete (ok and refused), refresh (ok, expired, reuse), revocation, runtime connect/disconnect, device connect/disconnect, forwarded request (**command name only, never params**) and refusal is appended as `{id, at, actor, action, target, ok, detail}`. `detail` passes through `redactSecrets`. Actors are `runtime:<id>`, `device:<id>` or `ip:<addr>`. | `audit.ts`, `store.ts` |
| **Secrets never in logs or URLs** | Structured logging via `createLogger` (JSON lines, redaction built in); tokens/secrets are not placed in log payloads at all. Credentials are accepted only in `Authorization: Bearer` headers; `?token=` / `?access_token=` on the device upgrade is refused with 400 and audited. Pairing codes, runtime secrets and refresh tokens appear in a response body exactly once. Frames leaving towards phones pass through `redactSecrets` like the runtime's own server does. | everywhere |
| **Gateway stores no repositories** | By construction: no filesystem, git or provider dependency; `tsup` bundles only `@codeo/contracts` and `@codeo/shared-utils`. | `package.json`, `tsup.config.ts` |

## 4. Protocol between the gateway and a runtime

The runtime side (the "relay client", to be built in `apps/runtime`, phase 6) speaks the ordinary
runtime protocol over the outbound socket, playing the *server* role:

1. Runtime dials `wss://<gateway>/v1/runtimes/<runtimeId>/connect` with `Authorization: Bearer <runtimeSecret>`.
2. Gateway sends a standard `hello` (`client.kind = 'gateway'`, `afterSeq` = last buffered seq or -1).
   Its `token` field is a non-secret connection marker (`relay-session:<connId>`): authentication of the
   gateway happened through TLS, and the relay client must not treat that field as a credential.
3. Runtime answers `welcome` (RuntimeInfo, lastSeq, its full scope list) and replays events `> afterSeq`.
4. Device requests arrive as `request` frames with id `<deviceConnId>:<originalId>`; the runtime answers
   `response` with the same id. The relay client must run those commands with the scopes the gateway
   has already enforced — the runtime may additionally re-check scopes using the `gateway` client kind.
5. Events are pushed as `event` frames; the gateway buffers and fans them out.

## 5. Not done yet (explicitly out of phase 1)

- **PostgreSQL store.** `createMemoryStore()` loses everything on restart (registrations, pairings, refresh
  tokens, audit). Implement `GatewayStore` on Postgres; `PairingCodeStore.consume` and
  `RefreshTokenStore.markRotated` must be single-statement atomic updates. Rate limiters are per process.
- **Push notifications (APNs/FCM).** No device-token storage, no dispatch of approval requests while the
  app is backgrounded. Payloads must stay content-free (ids only) when added.
- **TLS termination guidance and pinning.** Production deployments should terminate TLS at a reverse
  proxy with HSTS and forward `X-Forwarded-For` (`TRUST_PROXY=true`); in-process TLS is for single-host
  setups. Certificate pinning in the mobile app and in the runtime relay client is not implemented.
- **Runtime relay client in `apps/runtime`.** The gateway side is complete; the runtime does not yet dial
  out. Until then nothing reaches a real runtime through the gateway.
- **Runtime identity end-to-end.** The phone trusts the gateway's statement of which runtime it talks
  to. The device `publicKey` accepted at pairing is stored but unused; a later phase should let the runtime
  sign its `welcome` with a key fingerprint shown during pairing, and let devices sign requests.
- **Biometric gating on mobile.** Approval decisions (`approval:decide`) should require Face ID / Touch ID
  on the phone before the request is sent. Server-side the scope exists; the client-side gate does not.
- **Account system.** `ownerAccountId` is a free-form identifier generated at registration. Multi-user
  authorization (who may register a runtime, who may list devices) waits for accounts.
- **Gateway HMAC secret rotation and multi-instance deployment.** One static `GATEWAY_SECRET`; no key ids,
  no shared rate-limit or relay state across instances (a device and its runtime must hit the same instance).
- **Request rate limiting per device** and per-connection in-flight caps on the relay.
- **Abuse monitoring.** Audit entries are stored but nothing alerts on them.

## 6. Operational notes

- Required env in production: `GATEWAY_SECRET` (≥ 32 chars), `PUBLIC_URL` (https). See `apps/gateway/.env.example`.
- Without `GATEWAY_SECRET` in development an ephemeral secret is generated and a warning logged: every
  restart (including `tsx watch` reloads) invalidates all access tokens.
- Close codes used by the relay: `4000` replaced by a newer runtime connection, `4001` hello timeout,
  `4003` unauthorized / revoked, `4004` runtime offline.
- Replay window: 2 000 events per runtime (`RELAY_RING_CAPACITY`). Clients that reconnect beyond it
  receive `replay-gap` and must refresh state through regular queries.
