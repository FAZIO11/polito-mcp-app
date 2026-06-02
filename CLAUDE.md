# polito-mcp-app — CLAUDE.md

> Unofficial remote MCP server for the Politecnico di Torino student API, built
> on the **mcp-use** framework (https://docs.mcp-use.com) with interactive React
> widgets. Started as a migration of the upstream `polito-mcp` (official
> `@modelcontextprotocol/sdk`) and is now its own standalone project.

## Git commit style

Never add `Co-Authored-By` trailers to commits. Do not mention Claude or Anthropic
in commit messages.

---

## What this is

MCP server that wraps the PoliTO student API (`https://app.didattica.polito.it/api`)
so MCP-aware AI clients (Claude Desktop, Claude.ai, ChatGPT, Cursor, Windsurf) can
read a student's profile, grades, lectures, deadlines, messages, exams, bookings,
campus rooms, jobs, and more via natural language — and render that data as
interactive **Libretto** widgets, including a navigable dashboard.

**Owner:** Fazil Abdul Sathar
**Repo:** https://github.com/FAZIO11/polito-mcp-app  (private, branch `main`)
**Live:** https://bold-cloud-1ucpl.run.mcp-use.com/mcp  (mcp-use cloud / Manufact, org Fazio, EU)
**Status:** Migration + 5 data widgets + dashboard + cloud deploy all DONE and
verified live. **46 MCP tools, 6 widgets.** Storage is currently ephemeral on the
cloud (see Deployment). Next focus: iterating on the design language.

> ⚠️ The live deployment lags `main` by one commit when you arrive: the connect-
> card + auto-size fix (`69bc83a`) is pushed but a **redeploy** is needed to make
> it live (the deployed build is `8467178`). Redeploy from the Manufact dashboard.

---

## Architecture (what changed vs. upstream, what didn't)

**Unchanged from upstream:** `auth/` (OAuth 2.1 AS), `db/` (SQLite), `crypto/`,
`polito/client.ts` + `polito/types.ts`, the `http/` routes, and the
`withPoliTo()` / `clientForUser()` / `ToolAuthError` logic in `mcp/auth-context.ts`.

**Changed for mcp-use:** the MCP transport, tool registration syntax, app
composition, and the widget layer. `zod` was upgraded **3 → 4** (mcp-use peer dep).

### How mcp-use is wired in (important, non-obvious)

mcp-use@1.28.0; `@mcp-use/inspector`@6; `@mcp-use/cli`@3.2 (build + cloud).

- **`new MCPServer(config)` returns a Hono proxy.** `server.use/get/route(...)`
  proxy to `server.app` (a Hono instance). The constructor only installs a request
  logger + CORS; `/mcp`, `/inspector`, and widget routes mount later in
  `await server.getHandler()`. **Register custom routes/middleware BEFORE
  `getHandler()`** for correct precedence (see `app.ts`). `index.ts` serves
  `server.app.fetch` via `@hono/node-server`.

- **Auth into tools (the key seam).** mcp-use has its own OAuth (`config.oauth`)
  — we do **NOT** use it; the project keeps its own OAuth AS. The tool callback's
  2nd arg `ctx` is `Object.create(<live /mcp Hono request context>)`, so
  `ctx.get('politoAuth')` returns whatever the `/mcp` middleware (`mcp/server.ts`)
  set via `c.set('politoAuth', {userId, username, clientId, sessionId})`. The
  middleware resolves the user (JWT → MCP session → 30-day IP map) and
  `createPendingSession(sessionId)`. Tools read it via `getPolitoAuthExtra(ctx)`,
  which throws `ToolAuthError('not_authenticated', sessionId)` when not linked.

- **MCP session id** comes from the `mcp-session-id` header (mcp-use owns it).

- **Response helpers** (`mcp-use/server`): `text`, `object` (Record → flat
  structuredContent), `array` (`{data:[...]}`), `error`, `widget`. `tools.ts` has
  a `json(value)` helper (object vs array at runtime), `handleError()` (auth /
  PoliTO / network mapping), and `widgetAuthError()` (see widgets below).

- **No `instructions` option** in mcp-use — the upstream advisory hint was dropped.

### Widgets — the "Libretto" design system

The PoliTO *libretto universitario* reimagined as an engineer's drafting notebook:
Bricolage Grotesque (display) + IBM Plex Mono (data) from Google Fonts, warm
paper/graphite + one blueprint-blue accent, faint graph-paper grid, drafting
corner ticks, staggered load + GPA count-up. Light/dark via a manual toggle that
overrides the host theme. UI is locale-aware (English default, auto-Italian for
`it-*`); **PoliTO data is left in its original language** (Italian).

- `resources/_lib/kit.tsx` — design tokens, `GlobalStyle`, `Frame` (wraps content
  in **`<McpUseProvider autoSize>`** so the host iframe grows to fit — no internal
  scroll), `TitleBlock`, `ThemeToggle`, `Badge`, `CountUp`, `Rise`, `Empty`,
  `ConnectCard` + `ConnectFrame` (auth gate), `useLibretto()` (theme + locale + i18n
  `t()`), and the EN/IT string table.
- `resources/_lib/sections.tsx` — shared section renderers (`GradesSection`,
  `LecturesSection`, `DeadlinesSection`, `JobsSection`, `RoomsSection`) used by
  both the standalone widgets AND the dashboard.
- `resources/<name>/widget.tsx` — 6 default-exported components: `grades-table`,
  `today-lectures`, `deadline-calendar`, `job-board`, `free-rooms-grid`, and
  `dashboard` (home grid → drill-in + in-widget chat via `sendFollowUpMessage`).
- `_lib/` has no `widget.tsx`, so mcp-use widget discovery ignores it.

**Tool ↔ widget contract.** A widget tool sets `widget: { name, invoking, invoked }`
(folder name MUST equal `widget.name`) and returns `widget({ props, output:
text(summary) })`. **`props` is the widget data (structuredContent); `output` is
the concise text the LLM sees.** If `output` carries its own `structuredContent`
it OVERRIDES `props`, so keep `output` a `text()`. On auth failure, widget tools
use `widgetAuthError(err, name)` which returns `widget({ props: { connectUrl } })`
so the widget renders the **ConnectCard** (a real clickable sign-in button —
the link is always visible regardless of the model's wording). The 6 widget tools:
`get_grades`, `list_today_lectures`, `list_deadlines`, `list_job_offers`,
`find_free_classrooms`, `open_dashboard`.

To add a widget: create `resources/<name>/widget.tsx` (default export,
`useLibretto<Props>()`, render inside `<Frame>`, early-return `<ConnectFrame>` when
`props.connectUrl`), add `widget:{name}` to the tool, return `widget({props,output})`.

---

## Repo layout

```
polito-mcp-app/
├── apps/server/                # the runtime app (npm workspace)
│   ├── src/
│   │   ├── index.ts            # entry: await createApp() → @hono/node-server
│   │   ├── app.ts              # routes on server.app; await server.getHandler()
│   │   ├── config.ts           # zod-validated env (PUBLIC_ORIGIN normalized: strips /mcp)
│   │   ├── logger.ts           # pino + password redaction
│   │   ├── auth/               # OAuth 2.1 AS — UNCHANGED  (server/password/jwt/pkce/…)
│   │   ├── db/                 # SQLite (better-sqlite3) — UNCHANGED  (sqlite/users/oauth/sessions)
│   │   ├── crypto/keys.ts      # AES-256-GCM per-user HKDF token encryption
│   │   ├── http/               # Hono routes — UNCHANGED  (login-page/account/connect/rate-limit/context)
│   │   ├── mcp/                # ← mcp-use
│   │   │   ├── server.ts       #   MCPServer + /mcp auth middleware
│   │   │   ├── tools.ts        #   all 46 server.tool() registrations
│   │   │   └── auth-context.ts #   getPolitoAuthExtra(ctx), withPoliTo, ToolAuthError
│   │   └── polito/             # PolitoClient + types — UNCHANGED
│   ├── resources/              # React widgets (Libretto): _lib/{kit,sections}.tsx + <name>/widget.tsx
│   └── tests/                  # vitest (28): oauth-flow, pkce, crypto, rate-limit, redaction, …
├── apps/web/                   # Astro marketing + docs site
├── Dockerfile.manufact         # legacy self-clone Dockerfile — NOT used by the current deploy
└── .github/workflows/ci.yml    # vitest + tsc on push/PR to main
```

### Request flow (authenticated tool call)
```
MCP client → POST /mcp (Bearer JWT or mcp-session-id)
  → /mcp auth middleware: resolve user → c.set('politoAuth', {...})
  → mcp-use transport → tool callback (ctx = request context)
  → getPolitoAuthExtra(ctx) → withPoliTo(userId, fn)   # decrypts bearer
  → PolitoClient.method() → PoliTO API → json()/array()/widget() back
```

### Onboarding flow (not yet connected)
```
Tool call, no linked account → ToolAuthError('not_authenticated', sessionId)
  → widget tools: ConnectCard with PUBLIC_ORIGIN/connect?s=<id> ; other tools: text link
User opens link → login page → POST /connect (PoliTO /auth/login)
  → encrypt+store bearer → linkSessionToUser + 30-day IP map → next call auto-auth
```

### OAuth 2.1 AS flow (clients that do real OAuth)
```
POST /register (RFC 7591) → GET/POST /authorize (login page → PoliTO) → 302 code
  → POST /token (PKCE S256) → our JWT access token (30-day)
```
Note: mcp-use cloud fronts `/mcp` with its own OAuth proxy (`/mcp/authorize?target=`);
the session-based `/connect` flow is the primary onboarding path and is unaffected.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `ENC_MASTER_KEY` | ✅ | 64 hex chars. HKDF master for per-user token encryption. |
| `JWT_SECRET` | ✅ | 64 hex chars. Signs our OAuth access tokens. |
| `POLITO_BASE_URL` | ✅ | `https://app.didattica.polito.it/api` (real) · `.../mock/api` (mock). |
| `PUBLIC_ORIGIN` | ✅ | Public origin for `/connect` + OAuth discovery. Normalized in config: a trailing `/mcp` + slashes are stripped (mcp-use cloud injects it as the MCP endpoint URL). |
| `PORT` | optional | Default 8787 (dev). Cloud sets/uses 3000. Shell env overrides `--env-file`. |
| `DB_PATH` | optional | Default `./data/polito-mcp.sqlite`. Cloud uses `/tmp/polito-mcp.sqlite` (ephemeral). |
| `LOG_LEVEL` | optional | `trace…fatal`. Default `info`. |
| `SENTRY_DSN` | optional | Enables Sentry. Body redaction enforced regardless. |
| `NODE_ENV` | optional | `production` enables HSTS + prebuilt widget serving. |

Generate a secret: `node -e 'console.log(require("node:crypto").randomBytes(32).toString("hex"))'`
Local dev `.env` lives at `apps/server/.env` (gitignored). It currently points at
the **real** PoliTO API on port **8788** (8787 is reserved on this machine).

---

## Development workflow

```bash
npm install                                  # workspace install (root)

# Dev server (hot reload) — from apps/server/  (NOTE: use a free port; 8787 is taken)
PORT=8788 node --env-file=.env --import tsx/esm --watch src/index.ts

npm run typecheck   --workspace apps/server   # tsc --noEmit  (clean)
npm run test        --workspace apps/server   # vitest, 28 tests
npm run build       --workspace apps/server   # tsc → dist (server only, NO widgets)
npm run build:widgets --workspace apps/server # mcp-use build → dist/resources/widgets + manifest

# Inspect the live MCP server (46 tools) — local or cloud:
npx @mcp-use/inspector --url http://localhost:8788/mcp
# or the mounted UI at  http://localhost:8788/inspector

# Typecheck the widgets (they're outside the server tsconfig):
npx tsc --noEmit --jsx react-jsx --module esnext --moduleResolution bundler \
  --target es2022 --lib es2023,dom,dom.iterable --strict --skipLibCheck --types react \
  resources/_lib/*.tsx resources/*/widget.tsx

# /mcp may answer as SSE (event: message\ndata: {...}) — parse both (see oauth-flow.test.ts parseMcp).
```

**Known gap:** `npm run lint` fails — PRE-EXISTING. ESLint 9 needs an
`eslint.config.js` (flat config); the repo has none. Not migration-related.

---

## MCP tools (46)

All `readOnlyHint: true` unless noted. Names/descriptions are stable — do not rename.

- **App:** `open_dashboard` (widget), `get_current_datetime`
- **Profile / grades:** `get_profile`, `get_grades` (widget), `get_provisional_grades`,
  `accept_provisional_grade` (write), `reject_provisional_grade` (write/destructive)
- **Schedule:** `list_deadlines` (widget), `list_today_lectures` (widget),
  `list_lectures`, `get_next_lecture`
- **Courses:** `list_courses`, `get_course`, `list_course_notices`, `list_course_files`,
  `list_course_videolectures`, `list_course_virtual_classrooms`,
  `list_course_assignments`, `get_course_statistics`
- **Inbox:** `list_messages`, `mark_message_read` (write), `list_notifications`,
  `get_unread_emails_count`
- **Exams:** `list_exams`, `list_bookings`, `book_exam` (write),
  `cancel_exam_booking` (write/destructive)
- **Campus / places:** `find_free_classrooms` (widget), `list_sites`,
  `list_free_rooms`, `search_places`, `get_place`
- **People:** `search_people`, `get_person`
- **Career / news:** `list_job_offers` (widget), `get_job_offer`, `list_news`,
  `get_news_item`, `list_announcements`
- **Support:** `list_tickets`, `get_ticket`, `close_ticket` (write),
  `search_ticket_faqs`, `list_surveys`, `list_guides`
- **Account:** `delete_my_account` (write/destructive — requires `confirm: true`)

`handleError`: network → `network_error`; auth → `not_authenticated` /
`re_auth_required` (upstream 401 marks the stored token revoked); PoliTO →
`polito_error`. Widget tools use `widgetAuthError` for the not_authenticated case.

---

## PoliTO API notes

- **Spec:** https://github.com/polito/api-spec (TypeSpec → OpenAPI).
- Base URL **must** include `/api` (without it the host 302s to SAML SSO).
- **Auth:** `POST /auth/login` `loginType:"basic"` → `{ data: { token, username, clientId } }`.
- Most endpoints return `{ data: <payload> }`; `/provisional-grades` returns
  `{ data: [], states: [] }` at top level.
- Upstream **401** → stored bearer expired → mark revoked → user re-auths.

---

## Deployment (mcp-use cloud / Manufact)

**Live:** https://bold-cloud-1ucpl.run.mcp-use.com (MCP at `/mcp`), org Fazio, EU.
Manufact builds & runs from GitHub `main` (buildpack, not the legacy
`Dockerfile.manufact`). Fly.io was removed.

**Deploy via the Manufact dashboard UI** (`manufact.com` → Servers → Import from
GitHub → polito-mcp-app → Deploy/Redeploy). **The CLI `mcp-use deploy` returns 403
"insufficient permissions"** on the FREE plan even as org owner — use the UI.
(`mcp-use login --api-key <key>` does work for auth; the device flow 401s unless
you're already signed in at manufact.com.)

Configure Deployment form:
- **Preset:** mcp-use SDK
- **Build command:** `npm ci --include=dev && npm run build:widgets --workspace apps/server`
- **Start command:** `cd apps/server && node dist/index.js`
- **Port:** `3000` · **Region:** EU
- **Env:** `NODE_ENV=production`, `POLITO_BASE_URL=https://app.didattica.polito.it/api`,
  `DB_PATH=/tmp/polito-mcp.sqlite`, `PORT=3000`, `ENC_MASTER_KEY=<64hex>`,
  `JWT_SECRET=<64hex>`. (`PUBLIC_ORIGIN` is injected by Manufact and normalized in
  config, so it's optional.)

**Quirks (all handled / known):**
- Manufact applies env **only at runtime, not at build** → `mcp-use build`'s
  tool-registry type-gen warns "ENC_MASTER_KEY must be 64 hex" — **non-blocking**,
  widgets build fine.
- Manufact injects `PUBLIC_ORIGIN` as `<url>/mcp`; `config.ts` strips the trailing
  `/mcp` so `/connect` + OAuth links resolve. (Don't undo that normalization.)
- `@mcp-use/cli` is a declared devDependency (the build's `mcp-use` binary).

> **⚠️ Persistence (the open item):** the SQLite DB lives in `/tmp` and **resets on
> every redeploy** (Manufact exposes no persistent volume). Fine for testing; for
> real users, move state to **Turso/libSQL** (serverless SQLite, minimal change
> since we're already on SQLite) before relying on connected accounts persisting.

Manage: `npx mcp-use deployments list|logs|...`, `npx mcp-use servers ...`,
`npx mcp-use org ...`. (`cloud` is NOT a subcommand in CLI 3.2.)

---

## Conventions for future work

- Keep `auth/`, `db/`, `polito/`, `http/` route logic untouched unless the task is
  specifically about them.
- New tools: copy a `server.tool({...}, async (params, ctx) => {...})` block in
  `tools.ts`; resolve auth with `getPolitoAuthExtra(ctx)`, call PoliTO via
  `withPoliTo(userId, (c) => c.method())`, return `json(...)`, wrap in
  `try/catch → handleError(err, 'tool_name')` (or `widgetAuthError` for widget tools).
- Widgets: folder name === tool's `widget.name`; use `useLibretto<Props>()`, render
  inside `<Frame>`, early-return `<ConnectFrame>` on `props.connectUrl`, reuse the
  shared sections in `_lib/sections.tsx`, keep UI strings in the `_lib/kit.tsx` i18n
  table (EN/IT) and **leave PoliTO data untranslated**.
- Design changes are token-driven in `_lib/kit.tsx` (`tokens()` palette, `LIB_CSS`).
  If the in-client widget CSP ever blocks Google Fonts, self-host/inline the fonts.
- Tests use an in-process fake PoliTO (`tests/fake-polito.ts`); `/mcp` may be SSE —
  parse with the `parseMcp` helper in `oauth-flow.test.ts`. Run `npm run typecheck`
  + `npm run test` before committing; commit with the style rule at the top.

## Open threads / next steps

1. **Redeploy** to make `69bc83a` (connect card + auto-size) live.
2. Iterate on the **Libretto** design language (the current focus).
3. **Turso/libSQL** migration for persistent storage before real users.
4. Optional: guard `serve()` in `index.ts` behind a main-module check so
   `mcp-use build` can import the entry without starting a listener.
5. `eslint.config.js` (flat config) to un-break `npm run lint`.
