# Vidyut Setu — P2P Solar Energy Trading Platform

> **🏆 Hackathon Edition** · Decentralized · Tamper-Proof · AI-Priced · CO₂-Tracked

## Architecture

| Layer | Stack |
|---|---|
| Frontend | React + Vite + Tailwind + Recharts + Socket.io-client |
| Backend  | Express + MongoDB + JWT + Socket.io |
| Database | MongoDB via Docker |

**Ports:** Backend `5055` · Frontend `5188`

---

## ⚡ Feature Highlights

### 🌿 Environmental
- **CO₂ offset tracking** — every trade calculates `energyKw × 0.82 kg/kWh` (solar vs Indian coal grid)
- **Trees equivalent** counter for community impact
- **Green Energy Certificate (REC)** — downloadable JSON per trade with full audit trail

### 🧠 AI-Powered
- **Real dynamic pricing** — `7 + demandPressure - supplyDiscount` formula, adjusts per broadcast

### 🔗 Blockchain-style
- **Tamper-evident hash chain** (`prevHash → currentHash`) with live integrity verification
- **Idempotency keys** prevent double-settlement
- **Atomic settlement** (`Promise.all`) — wallet + listing updated in one batch

### 📡 Real-Time
- **Socket.io** — trade settlements and new listings pushed live (no 5s polling)
- **Live energy meter** fluctuating every 3.5s simulating IoT

### 🛡️ Production-Ready Polish
- **Security middleware** — Helmet + API rate limiting + response compression
- **Operational health telemetry** — API health endpoint exposes DB status + uptime
- **Safer shutdown script** — stops only Vidyut Setu Node processes

### 🎨 UI (Stitch Vidyut Aurora Design System)
- Glassmorphism panels with Stitch-generated design tokens
- Tabbed navigation: Market · Community · Ledger
- Toast notifications (no more `alert()`)
- Carbon leaderboard with medal rankings
- Recharts line chart (generation vs consumption)
- Consumer marketplace search, sort, and price filters
- Session persistence + live backend status indicator
- Fully mobile-responsive

---

## 🚀 One-Click Run (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File .\start-all.ps1
```

Open: **http://localhost:5188**

---

## 🧪 Demo Accounts

| Role | Email | Password | Token |
|---|---|---|---|
| ☀️ Prosumer | `prosumer@sauryasetu.local` | `123456` | — |
| 🏠 Consumer | `consumer@sauryasetu.local` | `123456` | `654321` |
| 🏠 Consumer 2 | `consumer2@sauryasetu.local` | `123456` | `112233` |
| 🏠 Consumer 3 | `consumer3@sauryasetu.local` | `123456` | `998877` |

5 prosumers + 3 consumers pre-seeded with 5 active marketplace listings.

---

## Manual Start

```bash
# 1. MongoDB
cd database && docker compose up -d

# 2. Backend
cd backend && cp .env.example .env && npm install && npm run seed && npm run dev

# 3. Frontend
cd frontend && cp .env.example .env && npm install && npm run dev
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/login` | JWT login |
| GET  | `/api/wallet/me` | User wallet |
| GET  | `/api/listings` | Live marketplace |
| POST | `/api/broadcast` | Publish energy packet |
| POST | `/api/trade` | Atomic energy settlement |
| GET  | `/api/community/stats` | CO₂ stats + leaderboard |
| GET  | `/api/ledger/recent` | Last 20 trades |
| GET  | `/api/ledger/certificate/:id` | Green Energy REC |
| WebSocket | `trade:settled` | Real-time settlement push |
| WebSocket | `listing:new` | Real-time listing push |
