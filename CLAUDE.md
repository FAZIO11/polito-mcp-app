# polito-mcp — CLAUDE.md

> This repo is a fork of the original `polito-mcp` server. It is being migrated
> from the official `@modelcontextprotocol/sdk` to the **mcp-use** framework
> (https://docs.mcp-use.com) to gain widget/UI support inside Claude and ChatGPT.
> This file documents the **current (post-migration) state**, not the upstream.

## Git commit style

Never add `Co-Authored-By` trailers to commits. Do not mention Claude or Anthropic
in commit messages.

---

## What this is

Unofficial MCP server that wraps the Politecnico di Torino student API
(`https://app.didattica.polito.it/api`) so MCP-aware AI clients (Claude Desktop,
Claude.ai, ChatGPT, Cursor, Windsurf) can read a student's profile, grades,
lectures, deadlines, messages, exams, bookings, campus rooms, jobs, and more via
natural language — and (Phase 2) render that data as interactive widgets.

**Owner:** Fazil Abdul Sathar
**Repo:** https://github.com/FAZIO11/polito-mcp-app
**Working branch:** `migrate/mcp-use`
**Status:** Phase 1 (mcp-use transport + 45 tools) complete & verified with real
PoliTO credentials. Phase 2 (5 React widgets) built & verified in dev + a clean
production build; the actual in-client render is verified by the owner in the
inspector. Cloud deploy (mcp-use/Manufact) still pending — see caveats below.

---

## Migration overview (mcp-use)

The migration is two phases. **Architecture that does NOT change:** `auth/`,
`db/`, `polito/client.ts`, `polito/types.ts`, the `http/` routes, and the
`withPoliTo()` / `clientForUser()` / `ToolAuthError` logic in
`mcp/auth-context.ts`. Only the MCP transport, tool registration syntax, and app
composition changed.

### Phase 1 — DONE (transport + tools)
- `mcp/server.ts` — builds `new MCPServer(...)` and a `/mcp` Hono middleware that
  resolves auth and stashes it on the request context.
- `mcp/tools.ts` — all **45 tools** registered with `server.tool({...}, cb)` and
  the mcp-use response helpers.
- `mcp/auth-context.ts` — `getPolitoAuthExtra(ctx)` reads auth off the context;
  everything else unchanged.
- `http/context.ts` — added the `politoAuth` context variable + `PolitoSessionAuth`.
- `app.ts` / `index.ts` — compose all routes onto `server.app`; `createApp` is async.
- `zod` upgraded **3 → 4** in `apps/server` (mcp-use peer-depends on zod 4).

### Phase 2 — DONE (widgets)
- `app.ts` now calls `await server.getHandler()` (mounts MCP + vite widget dev
  server in dev / prebuilt bundles in prod + inspector).
- 5 React widgets under `apps/server/resources/<name>/widget.tsx`, each a default-
  exported component using `useWidget()` (guarding `isPending`) and a shared
  `resources/_lib/kit.tsx` (a `_lib/` folder has no `widget.tsx`, so widget
  discovery ignores it). Widgets: `grades-table`, `today-lectures`,
  `deadline-calendar`, `job-board`, `free-rooms-grid`.
- Their tools (`get_grades`, `list_today_lectures`, `list_deadlines`,
  `list_job_offers`, `find_free_classrooms`) carry a `widget` config and return
  `widget({ props, output: text(summary) })`. **`props` is the widget data
  (structuredContent); `output` is the concise text the LLM sees.** Note: if
  `output` carries its own `structuredContent` it overrides `props`, so keep
  `output` a `text()`. When the caller isn't authenticated the tools still fall
  back to the `/connect` text via `handleError` (no widget).
- Build deps (devDependencies): `react`, `react-dom`, `vite`,
  `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss`. Widgets may use
  Tailwind v4 classes; the kit uses theme-aware inline styles + the host
  `theme`/`locale` from `useWidget()`.

To add another widget: create `resources/<name>/widget.tsx` (default export,
`useWidget<Props>()`, check `isPending`), add `widget: { name: '<name>', … }` to
the tool, and return `widget({ props, output })`. The folder name MUST equal the
tool's `widget.name`.

---

## How mcp-use is wired in (important, non-obvious)

mcp-use@1.28.0; `@mcp-use/inspector`; `@mcp-use/cli` (cloud deploy).

- **`new MCPServer(config)` returns a Hono proxy.** `server.use/get/route(...)`
  proxy to the underlying `server.app` (a Hono instance). The constructor only
  installs a request logger + CORS; the `/mcp`, `/inspector`, and widget routes
  are mounted later by `server.getHandler()` / `server.listen()`. **Register
  custom routes/middleware BEFORE that mount** for correct precedence.

- **Auth into tools (the key seam).** mcp-use has its own OAuth (`config.oauth`)
  — we do **NOT** use it; the project keeps its own OAuth AS. Instead, the tool
  callback's 2nd arg `ctx` is `Object.create(<live /mcp Hono request context>)`,
  so `ctx.get('politoAuth')` returns whatever the `/mcp` middleware did
  `c.set('politoAuth', ...)`. The middleware resolves the user (JWT → MCP session
  → 30-day IP mapping), creates the pending session row, and sets:
  ```ts
  { userId, username, clientId, sessionId } // PolitoSessionAuth
  ```
  Tools read it via `getPolitoAuthExtra(ctx)`, which throws
  `ToolAuthError('not_authenticated', sessionId)` when `userId` is null.

- **MCP session id** comes from the `mcp-session-id` request header (mcp-use owns
  generation). The middleware calls `createPendingSession(sessionId)` so the
  `/connect?s=<id>` login link tools hand out passes `isValidSession`.

- **Response helpers** (from `mcp-use/server`): `text`, `object` (Record → flat
  structuredContent), `array` (wraps as `{ data: [...] }`), `error` (sets
  isError), and Phase-2 `widget`. `tools.ts` uses a small `json(value)` helper
  that dispatches object vs array at runtime, plus `handleError()` for the auth /
  PoliTO / network error mapping.

- **Phase-1-only shortcut:** `app.ts` calls the internal `server.mountMcp()` (TS-
  private, via cast) to mount only `/mcp` and skip the vite widget dev server we
  don't need yet. **Swap for `await server.getHandler()` in Phase 2.**

- **No `instructions` option:** mcp-use has no server-level `instructions` field,
  so the old advisory hint string was dropped.

---

## Repo layout

```
polito-mcp/
├── apps/server/                # the only runtime app (npm workspace)
│   ├── src/
│   │   ├── index.ts            # entry: await createApp() → @hono/node-server, SIGINT/SIGTERM
│   │   ├── app.ts              # composes routes on server.app; mounts /mcp (+ inspector)
│   │   ├── config.ts           # zod-validated env (singleton, cached)
│   │   ├── logger.ts           # pino + password-redaction allowlist
│   │   ├── auth/               # OAuth 2.1 AS — UNCHANGED by migration
│   │   │   ├── server.ts       #   /authorize /token /register /revoke + discovery
│   │   │   ├── password.ts     #   PasswordStrategy → PoliTO /auth/login
│   │   │   ├── login-username.ts, strategy.ts, jwt.ts, pkce.ts, errors.ts
│   │   ├── db/                 # SQLite (better-sqlite3) — UNCHANGED
│   │   │   ├── sqlite.ts, users.ts, oauth.ts, sessions.ts
│   │   ├── crypto/keys.ts      # AES-256-GCM per-user HKDF token encryption
│   │   ├── http/               # Hono routes — UNCHANGED
│   │   │   ├── login-page.ts, account.ts, connect.ts, rate-limit.ts, context.ts
│   │   ├── mcp/                # ← migrated to mcp-use
│   │   │   ├── server.ts       #   MCPServer + /mcp auth middleware
│   │   │   ├── tools.ts        #   all 45 server.tool() registrations
│   │   │   └── auth-context.ts #   getPolitoAuthExtra(ctx), withPoliTo, ToolAuthError
│   │   ├── polito/             # PolitoClient + types — UNCHANGED
│   │   │   ├── client.ts, types.ts
│   │   └── observability/sentry.ts
│   ├── resources/              # (Phase 2) React widgets: <name>/widget.tsx
│   └── tests/                  # vitest: oauth-flow, pkce, crypto, rate-limit, redaction, ...
├── infra/fly.toml              # Fly.io deploy config
├── Dockerfile                  # Fly.io runtime image
├── Dockerfile.manufact         # mcp-use / Manufact cloud image (clones from GitHub main)
└── .github/workflows/          # ci.yml (vitest+tsc)  — Fly deploy.yml removed
```

### Request flow (authenticated tool call)
```
MCP client → POST /mcp (Bearer JWT or mcp-session-id)
  → /mcp auth middleware: resolve user → c.set('politoAuth', {...})
  → mcp-use transport → tool callback (ctx = request context)
  → getPolitoAuthExtra(ctx) → withPoliTo(userId, fn)   # decrypts bearer
  → PolitoClient.method() → https://app.didattica.polito.it/api/...
  → json(data) / array(data) / text(...) back to the client
```

### Onboarding flow (not yet connected)
```
Tool call with no linked account
  → ToolAuthError('not_authenticated', sessionId)
  → tool returns text: open  PUBLIC_ORIGIN/connect?s=<mcp-session-id>
User opens link → login page → POST /connect (PoliTO /auth/login)
  → encrypt + store bearer → linkSessionToUser(sessionId) + IP mapping (30d)
  → next tool call from same session/IP is auto-authenticated
```

### OAuth 2.1 AS flow (clients that do real OAuth)
```
POST /register (RFC 7591) → GET /authorize (login page)
  → POST /authorize (creds → PoliTO) → 302 with auth code
  → POST /token (PKCE S256) → our JWT access token (30-day)
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ENC_MASTER_KEY` | ✅ | 64 hex chars (32 bytes). HKDF master for per-user token encryption. |
| `JWT_SECRET` | ✅ | 64 hex chars (32 bytes). Signs our OAuth access tokens. |
| `POLITO_BASE_URL` | ✅ | `https://app.didattica.polito.it/api` (prod) · `.../mock/api` (dev). |
| `PUBLIC_ORIGIN` | ✅ | Public origin; used in OAuth discovery + the `/connect` link. |
| `PORT` | optional | Default 8787 (dev). Fly/Manufact set 8080. Shell env overrides `--env-file`. |
| `DB_PATH` | optional | Default `./data/polito-mcp.sqlite`. Prod mounts a volume at `/data`. |
| `LOG_LEVEL` | optional | `trace/debug/info/warn/error/fatal`. Default `info`. |
| `SENTRY_DSN` | optional | Enables Sentry. Body redaction enforced regardless. |
| `NODE_ENV` | optional | `production` enables HSTS + production widget mounting. |

Generate a secret: `node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'`

A local dev `.env` lives at `apps/server/.env` (gitignored). Required keys:
`ENC_MASTER_KEY`, `JWT_SECRET`, `POLITO_BASE_URL`, `PUBLIC_ORIGIN`, `PORT`.

---

## Development workflow

```bash
npm install                                  # workspace install (root)

# Dev server (hot reload) — from apps/server/
node --env-file=.env --import tsx/esm --watch src/index.ts
# or: npm run dev  (from repo root or apps/server)

npm run build      --workspace apps/server   # tsc → apps/server/dist
npm run typecheck  --workspace apps/server   # tsc --noEmit   (clean)
npm run test       --workspace apps/server   # vitest, 28 tests

# Inspect the live MCP server (45 tools):
npx @mcp-use/inspector --url http://localhost:8787/mcp
# or open the mounted UI at  http://localhost:8787/inspector

# Quick MCP probe without auth (returns the /connect link):
#   POST /mcp initialize → capture mcp-session-id header
#   POST /mcp tools/list / tools/call (send the session id back)
# Note: /mcp may answer as SSE (event: message\ndata: {...}) — parse both.

# Real-PoliTO smoke test (never commit credentials):
POLITO_TEST_USERNAME=sXXXXXX POLITO_TEST_PASSWORD='...' \
  npx tsx apps/server/tests/real-polito.smoke.ts
```

**Known gap:** `npm run lint` fails — pre-existing. ESLint 9 needs an
`eslint.config.js` (flat config) and the repo has none. Not migration-related.

---

## MCP tools (45)

All are `readOnlyHint: true` unless noted. Each returns JSON (and, in Phase 2,
an optional widget). Names/descriptions are stable — do not rename.

- **Time:** `get_current_datetime`
- **Profile / grades:** `get_profile`, `get_grades`, `get_provisional_grades`,
  `accept_provisional_grade` (write), `reject_provisional_grade` (write/destructive)
- **Schedule:** `list_deadlines`, `list_today_lectures`, `list_lectures`, `get_next_lecture`
- **Courses:** `list_courses`, `get_course`, `list_course_notices`,
  `list_course_files`, `list_course_videolectures`,
  `list_course_virtual_classrooms`, `list_course_assignments`, `get_course_statistics`
- **Inbox:** `list_messages`, `mark_message_read` (write), `list_notifications`,
  `get_unread_emails_count`
- **Exams:** `list_exams`, `list_bookings`, `book_exam` (write),
  `cancel_exam_booking` (write/destructive)
- **Campus / places:** `find_free_classrooms`, `list_sites`, `list_free_rooms`,
  `search_places`, `get_place`
- **People:** `search_people`, `get_person`
- **Career / news:** `list_job_offers`, `get_job_offer`, `list_news`,
  `get_news_item`, `list_announcements`
- **Support:** `list_tickets`, `get_ticket`, `close_ticket` (write),
  `search_ticket_faqs`, `list_surveys`, `list_guides`
- **Account:** `delete_my_account` (write/destructive — requires `confirm: true`)

Tool error handling (`handleError`): network errors → `network_error`; missing/
expired auth → `not_authenticated` / `re_auth_required` (an upstream 401 marks
the stored token revoked); PoliTO errors → `polito_error`.

---

## PoliTO API notes

- **Spec:** https://github.com/polito/api-spec (TypeSpec → OpenAPI).
- Base URL **must** include `/api` (without it the host 302s to SAML SSO).
- **Auth:** `POST /auth/login` `loginType:"basic"` → `{ data: { token, username, clientId } }`.
- Most endpoints return a `{ data: <payload> }` envelope; `/provisional-grades`
  returns `{ data: [], states: [] }` at top level.
- Upstream **401** on any tool call → stored bearer expired → mark revoked → user
  must re-auth (`re_auth_required`).

---

## Deployment

Target is **mcp-use cloud (Manufact)** — Git-backed deploy from this repo (see
below). The old Fly.io setup (`infra/fly.toml`, `Dockerfile`, the `deploy.yml`
workflow) was removed when the project moved to `polito-mcp-app`.

> **⚠️ Persistence:** Fly gave a persistent volume at `/data`; Manufact's deploy
> CLI exposes **no volume option**, so the SQLite DB (users/tokens/OAuth/sessions)
> survives within a deployment but **resets on every redeploy**. Fine for a test
> deploy; for real users, externalize state (e.g. Turso/libSQL for the DB) first.

### Widget production build
Dev serves widgets via vite (in `getHandler()`). **Production needs prebuilt
bundles**: `npm run build:widgets --workspace apps/server` (= `mcp-use build
--no-typecheck`) emits `dist/resources/widgets/<name>/` + `dist/mcp-use.json`
(manifest, with a `buildId`). At runtime with `NODE_ENV=production`,
`mountWidgetsProduction` loads the manifest and serves the prebuilt widgets. Plain
`npm run build` (tsc) compiles the server only — **it does not build widgets**.

Caveats for `mcp-use build` (verified locally):
- `--no-typecheck` is required: the build's own typecheck looks for `tsc` at
  `apps/server/node_modules/typescript/bin/tsc`, but TypeScript is hoisted to the
  workspace root. We typecheck separately (`npm run typecheck`).
- It **imports `src/index.ts` to introspect tools, which calls `serve()` and
  `loadConfig()`** — so the env secrets must be present during the build, and it
  briefly binds a port. (A cleaner fix for the deploy pass: guard `serve()` in
  `index.ts` behind a main-module / env check so the entry can be imported
  without starting a listener.)

### Target: mcp-use cloud (Manufact)
mcp-use cloud is **Git-backed** — it builds & runs the server from the GitHub
repo (see `Dockerfile.manufact`, which clones `main`, builds, runs on `:8080`,
and creates `/data`). The whole point of the mcp-use migration is widget support,
so cloud deploy is most valuable now that Phase 2 is in.

**⚠️ `Dockerfile.manufact` needs two fixes before a widget-capable deploy:**
1. Its build step runs `npm run build` (tsc only) → **change to also build
   widgets** (`npm run build:widgets`), and ensure env secrets are available at
   build time (see the `mcp-use build` caveat above).
2. It runs `node apps/server/dist/index.js` from `WORKDIR /app`, so `cwd=/app`,
   but `mountWidgetsProduction` resolves widgets at `cwd/dist/resources/widgets`
   (i.e. `/app/dist/...`) while the build output is at
   `/app/apps/server/dist/...`. **Run with `cwd=apps/server`** (set `WORKDIR
   /app/apps/server` for the CMD) so production finds the manifest/widgets.

```bash
npx mcp-use login                 # auth to cloud.mcp-use.com (Manufact)
npx mcp-use whoami
npx mcp-use deploy                # deploy this MCP server from GitHub
npx mcp-use env list   <server>   # manage env vars (set the secrets below)
npx mcp-use cloud list            # list deployments
npx mcp-use cloud logs            # tail logs
npx mcp-use cloud restart|stop|start|delete
```

**Before deploying, confirm/set on the cloud server:** `ENC_MASTER_KEY`,
`JWT_SECRET`, `POLITO_BASE_URL=https://app.didattica.polito.it/api`,
`PUBLIC_ORIGIN=<the cloud URL>`, `NODE_ENV=production`, `DB_PATH=/data/polito-mcp.sqlite`.

**⚠️ Open question to verify first:** this server is **stateful** (SQLite user/
token/session DB) and runs a **custom OAuth AS**. It needs a **persistent disk**
at `/data` and **single-instance** execution (no horizontal scaling without
Redis). Confirm Manufact provides a persistent volume; otherwise the user DB
resets on every deploy and connected accounts are lost.

---

## Conventions for future work

- Keep `auth/`, `db/`, `polito/`, and `http/` route logic untouched unless the
  task is specifically about them.
- New tools: copy an existing `server.tool({...}, async (params, ctx) => {...})`
  block in `tools.ts`; resolve auth with `getPolitoAuthExtra(ctx)` and call PoliTO
  through `withPoliTo(userId, (c) => c.method())`; return via `json(...)` and wrap
  the body in `try/catch` → `handleError(err, 'tool_name')`.
- Widgets (Phase 2): folder name under `resources/` must exactly match the tool's
  `widget.name`; components use `useWidget()` from `mcp-use/react` (not props) and
  must check `isPending` before reading props.
- Tests use an in-process fake PoliTO (`tests/fake-polito.ts`); `/mcp` responses
  may be SSE — parse with the `parseMcp` helper in `oauth-flow.test.ts`.
```
