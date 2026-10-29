# InventoryOS: project memory

Real-time inventory management + demand forecasting. Single company, multiple warehouses.
Not e-commerce. Two independent npm projects: `backend/` and `frontend/` (no monorepo tooling).

## Current phase

**Phases 1-5 built** (features and demo data). Remaining from the spec (Phase 6): Playwright
flows, user create/edit dialogs, deployment config (SQLite needs a persistent disk), nightly
forecast scheduling, final README with screenshots.

Everything in the API is implemented (backend/docs/API.md) and tested: auth, RBAC, users,
catalogue, inventory movements (rules 1-4, 6), transfers (rule 5), ledger + consistency check,
notifications, dashboard, 6 analytics reports, forecasts + reorder recommendations, sockets.
Frontend has a real page for every route.

Demo data: `npm run seed` on an empty catalogue simulates 12 months (128 products, ~94k
transactions, 25 transfers in every status). Then run the forecast job (below) so the
Forecasts page and product charts have data. Fresh start: stop the API, delete
`prisma/dev.db*`, `npx prisma migrate deploy`, `npm run seed`, run the forecast job.

Known issue: on Windows, Vitest's worker process sometimes crashes natively
(exit code 3221226505) in the longer stock test files, roughly 2-3 runs in 10. It is not the app:
plain Node runs of the same workload (6,000 sequential + 15,000 concurrent requests) never
crash, and swapping native bcrypt for bcryptjs did not change the rate. Re-run if it happens; CI runs on Linux.

After each further piece of work: format, lint, typecheck, test, build, verify for real, report.

## Decisions (agreed; do not re-debate)

- Single company (no organizationId). No public registration: seeded admin creates users.
- Roles are an enum: ADMIN, MANAGER, EMPLOYEE, VIEWER. EMPLOYEE belongs to exactly one warehouse.
- No Redis, no Cloudinary, no email, no CSV import, no Docker. Product image = optional URL.
- **Database: SQLite** (file `backend/prisma/dev.db`) via Prisma 7 + `@prisma/adapter-better-sqlite3`.
  Chosen by the user instead of PostgreSQL. Consequences:
  - No DECIMAL(p,s): money precision enforced by Zod + rounding; money sums done in decimal.js, not SQL.
  - Enums stored as TEXT (Prisma validates). `contains` filters are case-insensitive for ASCII (LIKE).
  - CHECK rules and the append-only ledger are SQLite triggers, re-applied idempotently on every
    start/seed/test by `src/config/dbGuards.ts` (Prisma's SQLite migrations rebuild altered tables,
    which drops triggers). `PRAGMA foreign_keys = ON` must be set on the connection.
  - SQLite has one writer at a time, so writes are serialized; the atomic conditional update is still required.
  - **The adapter uses ONE connection; only interactive transactions take its lock. Every write
    must go through `prisma.$transaction(...)`**, or it could land inside another request's open
    transaction. Hash passwords (bcrypt) before opening a transaction.
  - The adapter reports trigger aborts as P2003 "Foreign key constraint violated"; the real message
    is read with `triggerMessage(err)` (`src/utils/dbErrors.ts`). Raw-query integers come back as BigInt.
  - Deployment (Phase 6) must use a persistent disk; Render free tier disk is ephemeral. Revisit then.
- Forecasting = nightly Python batch job writing the `Forecast` table. No always-on Python service.
- Money: Prisma `Decimal` + `decimal.js`. Prices 2 dp, costs 4 dp. API returns money as strings.
  Frontend formats with `Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' })`.
- Idempotency uses a dedicated `IdempotencyRecord` table (key per user, endpoint, request hash,
  stored response), written in the same DB transaction as the change. Covers transfer approve/cancel
  (which create no ledger rows) and dispatch/receive (which create several).
- Refresh tokens are opaque random strings stored as SHA-256 hashes, rotated on every refresh,
  with reuse detection (revoked token presented -> revoke all of that user's tokens).
- Integer auto-increment ids everywhere.
- The 4 core-logic files (inventory/transfer/reorder services, forecasting models.py) are written
  fully by Claude, with detailed comments (user's choice).

## Security rules (tested in backend/tests/security.test.ts, rbac.test.ts, auth.test.ts)

- Secrets only in `backend/.env` (git-ignored, never committed). `.env.example` has placeholders and
  an empty admin password. The frontend bundle may only contain `VITE_*` public URLs.
- `NODE_ENV` defaults to production. In production the API refuses to start with the example
  JWT secret or a non-https CORS origin. `trust proxy` is on only in production.
- Passwords: bcrypt cost 12, 10-72 bytes. Refresh tokens: SHA-256 hashes. Never select `passwordHash`
  into responses or audit entries (use `publicUserSelect`).
- Every route: authenticate -> authorize(role group) -> validate(Zod; unknown fields stripped).
  Row-level rules in services (`assertWarehouseAccess`, `scopedWarehouseId`, `userId` filters).
- Cookie endpoints (`/auth/login|refresh|logout`) use `trustedOrigin` (CSRF).
- Errors: generic envelope only; body-parser 4xx errors keep their status (413, 400).
- Known, accepted: 3 low npm advisories in the shadcn CLI (`deepmerge`), dev-time only, not bundled.

## Tooling and versions

- Node 24, npm 11. TypeScript 7 (native compiler) in both projects.
- Lint: **oxlint** (from the Vite template; works with TS 7, unlike typescript-eslint which needs TS < 6.1).
- Format: Prettier 3 (no semicolons, single quotes, trailing commas, width 100).
- Prisma pinned to **7.10.1** (npm `latest` tag points at 8.0.0-rc; do not upgrade to 8).
- TanStack Table: v8 (shadcn data-table docs target v8). React Router 8 (`react-router`, RouterProvider from `react-router/dom`).
- No dotenv: Node's `process.loadEnvFile()` (does not override variables already set).
- shadcn/ui: Radix base, "nova" preset, `cn` from the `cn` package. `src/components/ui` is generated:
  excluded from oxlint and Prettier. Accent colour: indigo (`--primary` in `src/index.css`).
- Tests use `prisma/test.db`, recreated by `tests/globalSetup.ts`; files run sequentially.

## Commands

Backend (`cd backend`): `npm run dev` · `build` · `start` · `typecheck` · `lint` · `test` · `format` ·
`format:check` · `seed` · `db:migrate` (new migration) · `db:deploy` · `db:generate`
Frontend (`cd frontend`): `npm run dev` · `build` · `typecheck` · `lint` · `test` · `format` · `format:check`
Forecasting (`cd backend/forecasting`): `.venv\Scripts\python -m pytest` · `.venv\Scripts\python forecast.py`

## Layout

```
backend/   src/{config,routes,controllers,services,middleware,validators,socket,utils}/ server.ts
           prisma/schema.prisma (+ migrations/, seed.ts)   forecasting/   tests/   docs/API.md
frontend/  src/{components/ui,pages,layouts,hooks,services,context,types,utils}/ App.tsx
```
Backend layering: Routes -> Controllers (thin) -> Services (ALL business logic) -> Prisma.

## Correctness rules (short form; must be proven by tests)

1. **Never negative**: decrease = `updateMany({ where: { quantity: { gte: qty } }, data: { decrement } })`
   inside `$transaction`; count 0 -> 409 INSUFFICIENT_STOCK. Increase = upsert. No read-then-write.
2. **Ledger**: every quantity change creates an `InventoryTransaction` in the same DB transaction.
   Ledger is append-only (trigger). Invariant: Inventory.quantity = SUM(quantityChange) per pair;
   `GET /api/admin/consistency-check` and tests use the same checker function.
3. **Idempotency**: `Idempotency-Key` header; same key + same body -> original response; different body -> 422.
4. **Valuation**: weighted-average `avgCost` recomputed on STOCK_IN/PURCHASE; outgoing rows freeze avgCost
   as unitCost; transfers keep avgCost and use the cost frozen at dispatch. Value = SUM(qty * avgCost).
5. **Transfers**: REQUESTED -> APPROVED -> IN_TRANSIT -> RECEIVED; CANCELLED only before IN_TRANSIT.
   Stock leaves on dispatch (all-or-nothing), arrives on receive. Check status first, 409 on invalid transition.
6. **Alerts**: notify active ADMIN + MANAGER only when quantity crosses from > reorderLevel to <= reorderLevel;
   separate OUT_OF_STOCK at 0. Emit socket events only after commit.
