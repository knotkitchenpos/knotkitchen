# KnotKitchen Admin Portal

A **fully standalone** admin portal that manages every restaurant registered on the KnotKitchen POS platform.

This project is deliberately **separate from `pos-frontend`** — the restaurant POS app only ever sees its own restaurant, while this portal has platform-wide access. The two apps do not share any source code, and both `package.json` files are independent.

## Structure

```
knotkitchen-admin/
├── backend/                 # Express + MongoDB admin API (port 4000)
│   ├── app.js
│   ├── config/
│   ├── controllers/
│   ├── middlewares/
│   ├── models/              # Mirrors the POS collections (Admin, Restaurant, User, Menu, Order, Table)
│   └── routes/
└── frontend/                # React + Vite + Tailwind admin UI (port 5173)
    └── src/
        ├── api/             # Axios client for the admin API
        ├── components/
        ├── context/         # Auth session
        └── pages/           # Login, Dashboard, Restaurants, Restaurant Detail, Orders, Users, Menus, Tables
```

## Prerequisites

- Node.js 18+
- MongoDB running with the **same database** the POS backend uses
- POS backend can be running or not — the admin backend connects directly to Mongo and reads the same collections

## Setup

### 1. Backend

```bash
cd knotkitchen-admin/backend
cp .env.example .env     # then edit the values
npm install
npm start                # starts on http://localhost:4000
```

On first start the backend automatically seeds a **Super Admin** account using the credentials in `.env`:

| Variable | Default |
|---|---|
| `ADMIN_EMAIL` | `admin@knotkitchen.io` |
| `ADMIN_PASSWORD` | `admin123` |

**Important:** `MONGODB_URI` must point to the same MongoDB database used by the POS backend so the portal sees all registered restaurants.

### 2. Frontend

```bash
cd knotkitchen-admin/frontend
npm install
npm run dev              # starts on http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:4000`, so no CORS setup is needed in development.

## Features

- **Platform dashboard** — total restaurants, users, orders, 30-day revenue, today's revenue, tables, menus
- **Restaurants** — list all registered restaurants with owner details, search, suspend/activate, drill into each restaurant
- **Restaurant detail** — owner account, recent orders, menu count, staff count, suspend/activate
- **Orders** — every order across all restaurants, filter by restaurant/status, update order status remotely
- **Users** — all staff accounts platform-wide, filter by restaurant, enable/disable accounts
- **Menus** — all menus platform-wide, publish/unpublish menus
- **Tables** — all FOH tables, filter by restaurant, update table status remotely

## API Endpoints (all under `/api`, authenticated)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/admin/login` | Admin login (sets `adminToken` cookie) |
| POST | `/admin/logout` | Logout |
| GET | `/admin/me` | Current admin profile |
| GET | `/admin/stats` | Global platform stats |
| GET | `/admin/restaurants` | All restaurants with stats |
| GET | `/admin/restaurants/:id` | Restaurant detail (menus, orders, tables, staff) |
| PATCH | `/admin/restaurants/:id/status` | Activate / suspend a restaurant |
| PUT | `/admin/restaurants/:id` | Update restaurant profile |
| GET | `/admin/users` | All users (`?restaurantId=`) |
| PATCH | `/admin/users/:id` | Update user (role, active, etc.) |
| GET | `/admin/menus` | All menus (`?restaurantId=`) |
| PATCH | `/admin/menus/:id/publish` | Publish / unpublish menu |
| PATCH | `/admin/menus/:menuId/items/:itemId` | Update a dish |
| GET | `/admin/orders` | All orders (`?restaurantId=&status=`) |
| PATCH | `/admin/orders/:id` | Update order status |
| GET | `/admin/tables` | All tables (`?restaurantId=`) |
| PATCH | `/admin/tables/:id` | Update table status |

## Separation from the POS

- `knotkitchen-admin` has its **own** `package.json`, own Vite config, own React app, and own Express app.
- The POS frontend (`pos-frontend`) is untouched — it remains a single-restaurant client built for owners/staff.
- The admin backend connects to Mongo with the same `MONGODB_URI`, reads the POS collections, and uses a separate `Admin` collection + JWT secret so admin sessions are fully independent from restaurant-user sessions.