# InventoryOS

Real-time inventory management and demand forecasting for a single company with multiple
warehouses: every stock movement is recorded in an append-only ledger, dashboards update
live, managers get low-stock alerts, stock moves between warehouses through an approval
flow, and a nightly forecast job turns 12 months of sales into explained reorder advice.

## Projects

| Folder | What | Stack |
|---|---|---|
| `backend/` | REST API + Socket.IO | Node.js 24, Express 5, TypeScript, Prisma 7, SQLite |
| `backend/forecasting/` | Demand-forecast job | Python 3.11, pandas, statsmodels |
| `frontend/` | Web app | React 19, Vite, TypeScript, Tailwind CSS 4, shadcn/ui, TanStack Query/Table, Recharts |

API contract: [`backend/docs/API.md`](backend/docs/API.md). Project notes: [`CLAUDE.md`](CLAUDE.md).

## Run locally

```bash
# 1. Backend (http://localhost:4000/api)
cd backend
npm install
copy .env.example .env        # set JWT_ACCESS_SECRET, SEED_ADMIN_PASSWORD, SEED_DEMO_PASSWORD
npx prisma migrate deploy     # creates prisma/dev.db
npm run seed                  # admin, demo users and 12 months of demo history (~15 s)
npm run dev

# 2. Forecasts (once after seeding, then nightly)
cd backend/forecasting
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python forecast.py

# 3. Frontend (http://localhost:5173), in another terminal
cd frontend
npm install
npm run dev
```

The seed prints the demo logins: one admin (from `.env`), two managers, one employee per
warehouse and one viewer (all using `SEED_DEMO_PASSWORD`). Each role sees a different app.

## Demo data

128 products in 8 categories from 10 suppliers, stocked across 5 warehouses (Hyderabad,
Bangalore, Mumbai, Chennai, Delhi), with about 94,000 simulated transactions: weekly
seasonality, festival peaks, slow movers, dead stock, supplier lead times, missed reorders and
stockouts, returns, stock-count adjustments, and transfers in every status. The consistency
check runs at the end of the seed: every stock level equals the sum of its ledger rows.

## Checks

```bash
cd backend  && npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
cd frontend && npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
cd backend/forecasting && .venv\Scripts\python -m pytest
```
