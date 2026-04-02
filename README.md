# Vidyut Setu - P2P PowerTrading

Complete MERN-style hackathon project with separate layers:

- `frontend/` -> React + Vite + Tailwind futuristic dashboard UI
- `backend/` -> Express + MongoDB + JWT secured APIs with atomic trade settlement
- `database/` -> Mongo Docker compose and DB bootstrap scripts

Default ports used in this project:

- Backend API: 5055
- Frontend dev server: 5188

## Architecture Highlights

- JWT required for protected APIs (`Authorization: Bearer <token>`)
- Hackathon-safe strict settlement with synchronized writes (`Promise.all`)
- Live order book, wallet deduction visual, and blockchain-like settlement sequence
- Ledger refreshes every 5 seconds from API
- 6-digit dummy payment token verification before consumer settlement
- Payment ID generated for each trade and shown in immutable ledger
- Idempotency key protected trades (`x-idempotency-key`) to prevent duplicate debit
- Tamper-evident hash chain (`prevHash` -> `currentHash`) with integrity status in ledger

## One-Click Run (Windows)

From project root:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

This script will:

- create missing `.env` files
- install dependencies if missing
- try starting MongoDB via Docker
- run seed
- launch backend and frontend in separate terminals

To stop all Node dev servers:

```powershell
powershell -ExecutionPolicy Bypass -File .\stop-all.ps1
```

## Quick Start

1. Start MongoDB

```bash
cd database
docker compose up -d
```

2. Start backend

```bash
cd ../backend
copy .env.example .env
npm install
npm run seed
npm run dev
```

3. Start frontend

```bash
cd ../frontend
copy .env.example .env
npm install
npm run dev
```

## Demo Accounts

- Prosumer: `prosumer@sauryasetu.local` / `123456`
- Consumer: `consumer@sauryasetu.local` / `123456`
- Consumer payment token: `654321`
