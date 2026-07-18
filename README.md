# User Payout Management System

A comprehensive Low-Level Design (LLD) implementation for managing user payouts in an affiliate sales platform. Built with **Node.js**, **Express**, and **SQLite**.

## Table of Contents

- [Problem Statement](#problem-statement)
- [Architecture Overview](#architecture-overview)
- [Database Schema](#database-schema)
- [Class Design](#class-design)
- [API Endpoints](#api-endpoints)
- [Business Rules Implementation](#business-rules-implementation)
- [Edge Cases & Failure Handling](#edge-cases--failure-handling)
- [Design Decisions & Trade-offs](#design-decisions--trade-offs)
- [Setup & Running](#setup--running)
- [Testing](#testing)
- [Example Walkthrough](#example-walkthrough)

---

## Problem Statement

### Question 1: User Payout Management
- Every affiliate sale enters the system as **Pending**
- System provides a **10% advance payout** on pending sales
- Admin later reconciles sales as **Approved** or **Rejected**
- Final payout accounts for advance already paid
- Users can withdraw only **once every 24 hours**

### Question 2: Failed Payout Recovery
- When a payout fails/is cancelled/rejected, the amount is **credited back** to the user's withdrawable balance
- User can then initiate another withdrawal

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│                        API Layer (Express)                    │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐   │
│  │ UserCtrl     │  │ SaleCtrl     │  │ WithdrawalCtrl    │   │
│  └──────┬──────┘  └──────┬───────┘  └────────┬──────────┘   │
│         │                │                    │              │
│  ┌──────┴──────────────────────────────────────┐             │
│  │                PayoutCtrl                    │             │
│  └──────┬───────────┬───────────┬──────────────┘             │
├─────────┼───────────┼───────────┼────────────────────────────┤
│         │  Service Layer        │                            │
│  ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────────────┐    │
│  │AdvancePayout│ │Reconcilia-  │ │PayoutRecovery       │    │
│  │Service      │ │tionService  │ │Service (Q2)         │    │
│  └──────┬──────┘ └──────┬──────┘ └──────┬──────────────┘    │
│         │               │               │                    │
│  ┌──────▼───────────────▼───────────────▼──────────────┐    │
│  │ WithdrawalService                                    │    │
│  └──────┬──────────────────────────────────────────────┘    │
├─────────┼────────────────────────────────────────────────────┤
│         │  Model Layer                                       │
│  ┌──────▼──────┐ ┌────────────┐ ┌──────────┐ ┌───────────┐ │
│  │ User        │ │ Sale       │ │ Payout   │ │ Withdrawal│ │
│  └──────┬──────┘ └─────┬──────┘ └────┬─────┘ └─────┬─────┘ │
├─────────┼──────────────┼─────────────┼──────────────┼────────┤
│         └──────────────┴─────────────┴──────────────┘        │
│                       SQLite Database                         │
└──────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### Entity Relationship Diagram

```
┌──────────────┐       ┌───────────────┐       ┌──────────────┐
│    users     │       │     sales     │       │   payouts    │
├──────────────┤       ├───────────────┤       ├──────────────┤
│ id (PK)      │◄──┐   │ id (PK)       │       │ id (PK)      │
│ name         │   ├──│ user_id (FK)  │       │ user_id (FK) │──►┐
│ email (UQ)   │   │   │ brand         │       │ type         │   │
│ withdrawable │   │   │ status        │       │ amount       │   │
│ _balance     │   │   │ earning       │       │ status       │   │
│ created_at   │   │   │ advance_paid  │       │ reference_ids│   │
│ updated_at   │   │   │ advance_locked│       │ created_at   │   │
└──────────────┘   │   │ created_at    │       │ updated_at   │   │
                   │   │ updated_at    │       └──────────────┘   │
                   │   └───────────────┘                          │
                   │                                              │
                   │   ┌───────────────┐                          │
                   │   │  withdrawals  │                          │
                   │   ├───────────────┤                          │
                   │   │ id (PK)       │                          │
                   ├──│ user_id (FK)  │                          │
                   │   │ amount        │                          │
                   │   │ status        │                          │
                   │   │ payout_id (FK)│──────────────────────────┘
                   │   │ created_at    │
                   │   │ updated_at    │
                   │   └───────────────┘
```

### Table Details

#### `users`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| name | TEXT | NOT NULL | User's display name |
| email | TEXT | UNIQUE, NOT NULL | User's email |
| withdrawable_balance | REAL | DEFAULT 0.0 | Current available balance |
| created_at | TEXT | DEFAULT now | Record creation time |
| updated_at | TEXT | DEFAULT now | Last update time |

#### `sales`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| user_id | TEXT | FK → users(id) | Owner of the sale |
| brand | TEXT | NOT NULL | Brand identifier |
| status | TEXT | CHECK(pending/approved/rejected) | Sale lifecycle status |
| earning | REAL | CHECK(≥ 0) | Sale earning amount |
| advance_paid | REAL | DEFAULT 0.0 | Advance amount disbursed |
| advance_locked | INTEGER | DEFAULT 0 | Idempotency flag (0 or 1) |

#### `payouts`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| user_id | TEXT | FK → users(id) | Payout recipient |
| type | TEXT | CHECK(advance/final/adjustment) | Payout category |
| amount | REAL | NOT NULL | Payout amount (can be negative for adjustments) |
| status | TEXT | CHECK(pending/processing/completed/failed/cancelled/rejected) | Payout status |
| reference_ids | TEXT | NULL | JSON array of related sale IDs |

#### `withdrawals`
| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | UUID |
| user_id | TEXT | FK → users(id) | Withdrawing user |
| amount | REAL | CHECK(> 0) | Withdrawal amount |
| status | TEXT | CHECK(pending/processing/completed/failed/cancelled/rejected) | Withdrawal status |
| payout_id | TEXT | FK → payouts(id) | Linked payout record |

### Indexes
```sql
idx_sales_user_id       ON sales(user_id)
idx_sales_status        ON sales(status)
idx_sales_user_status   ON sales(user_id, status)
idx_payouts_user_id     ON payouts(user_id)
idx_payouts_status      ON payouts(status)
idx_withdrawals_user_id ON withdrawals(user_id)
idx_withdrawals_created ON withdrawals(user_id, created_at)
```

---

## Class Design

### Models (Data Access Layer)
| Class | Responsibility |
|-------|---------------|
| `User` | CRUD on users, balance credit/debit/adjust |
| `Sale` | CRUD on sales, advance locking, status transitions |
| `Payout` | CRUD on payout records, status management |
| `Withdrawal` | CRUD on withdrawals, 24-hour cooldown check |

### Services (Business Logic Layer)
| Class | Responsibility |
|-------|---------------|
| `AdvancePayoutService` | Processes 10% advance payouts with idempotency |
| `ReconciliationService` | Admin reconciliation, final payout calculation |
| `WithdrawalService` | User withdrawals with cooldown enforcement |
| `PayoutRecoveryService` | Failed/cancelled/rejected payout recovery (Q2) |

### Controllers (API Layer)
| Class | Responsibility |
|-------|---------------|
| `UserController` | User CRUD endpoints |
| `SaleController` | Sale creation and querying |
| `PayoutController` | Advance, reconciliation, recovery endpoints |
| `WithdrawalController` | Withdrawal initiation and management |

---

## API Endpoints

### Users
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/users` | Create a new user |
| `GET` | `/api/users` | List all users |
| `GET` | `/api/users/:id` | Get user by ID |

### Sales
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/sales` | Create a new sale (pending) |
| `GET` | `/api/sales/:id` | Get sale by ID |
| `GET` | `/api/sales/user/:userId?status=` | Get sales for a user |

### Payouts
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/payouts/advance` | Run advance payout job (all users) |
| `POST` | `/api/payouts/advance/:userId` | Run advance payout for one user |
| `POST` | `/api/payouts/reconcile` | Admin reconciliation |
| `GET` | `/api/payouts/summary/:userId` | Get user payout summary |
| `GET` | `/api/payouts/user/:userId` | Get all payout records for user |
| `POST` | `/api/payouts/recover` | Recover single failed payout |
| `POST` | `/api/payouts/recover/bulk` | Bulk recover failed payouts |

### Withdrawals
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/withdrawals` | Initiate a withdrawal |
| `POST` | `/api/withdrawals/:id/complete` | Mark withdrawal as completed |
| `GET` | `/api/withdrawals/user/:userId` | Get withdrawal history |

### Request/Response Examples

#### Create Sale
```json
// POST /api/sales
// Request
{
  "userId": "uuid-here",
  "brand": "brand_1",
  "earning": 40
}

// Response (201)
{
  "success": true,
  "data": {
    "id": "sale-uuid",
    "user_id": "uuid-here",
    "brand": "brand_1",
    "status": "pending",
    "earning": 40,
    "advance_paid": 0,
    "advance_locked": 0
  }
}
```

#### Process Advance Payouts
```json
// POST /api/payouts/advance
// Response
{
  "success": true,
  "data": {
    "totalUsersProcessed": 1,
    "totalSalesProcessed": 3,
    "details": [
      {
        "userId": "uuid",
        "advanceAmount": 12,
        "salesProcessed": 3,
        "saleIds": ["sale-1", "sale-2", "sale-3"]
      }
    ]
  }
}
```

#### Reconcile Sales
```json
// POST /api/payouts/reconcile
// Request
{
  "updates": [
    { "saleId": "sale-1", "status": "rejected" },
    { "saleId": "sale-2", "status": "approved" },
    { "saleId": "sale-3", "status": "approved" }
  ]
}

// Response
{
  "success": true,
  "data": {
    "salesProcessed": 3,
    "salesResults": [
      { "saleId": "sale-1", "status": "rejected", "earning": 40, "advancePaid": 4, "finalAdjustment": -4 },
      { "saleId": "sale-2", "status": "approved", "earning": 40, "advancePaid": 4, "finalAdjustment": 36 },
      { "saleId": "sale-3", "status": "approved", "earning": 40, "advancePaid": 4, "finalAdjustment": 36 }
    ],
    "payoutSummaries": [
      { "userId": "uuid", "netPayout": 68, "salesReconciled": 3 }
    ]
  }
}
```

#### Recover Failed Payout (Q2)
```json
// POST /api/payouts/recover
// Request
{
  "withdrawalId": "withdrawal-uuid",
  "reason": "failed"  // or "cancelled" or "rejected"
}

// Response
{
  "success": true,
  "data": {
    "withdrawalId": "withdrawal-uuid",
    "userId": "uuid",
    "amountRecovered": 100,
    "reason": "failed",
    "newBalance": 200,
    "message": "₹100 has been credited back to withdrawable balance."
  }
}
```

---

## Business Rules Implementation

### 1. Advance Payout (10%)

**Implementation:** `AdvancePayoutService.processAdvanceForUser()`

- Queries all `pending` sales where `advance_locked = 0`
- Calculates 10% of each sale's earning
- Sets `advance_locked = 1` and stores `advance_paid` on the sale
- Credits the total advance to user's `withdrawable_balance`
- **Idempotency guarantee:** The `advance_locked` flag + SQL `WHERE advance_locked = 0` ensures a sale is never double-advanced, even if the job runs multiple times

### 2. Final Payout Calculation

**Implementation:** `ReconciliationService.reconcile()`

| Scenario | Formula | Example |
|----------|---------|---------|
| **Approved** | `finalPayout = earning - advance_paid` | ₹40 - ₹4 = ₹36 |
| **Rejected** | `finalPayout = -advance_paid` | -₹4 (clawback) |

### 3. 24-Hour Withdrawal Cooldown

**Implementation:** `Withdrawal.canWithdraw()`

```sql
SELECT COUNT(*) FROM withdrawals
WHERE user_id = ? AND status IN ('pending', 'processing', 'completed')
AND created_at > datetime('now', '-24 hours')
```

---

## Edge Cases & Failure Handling

| Edge Case | Handling |
|-----------|----------|
| **Duplicate advance payout job** | `advance_locked` flag prevents double-payment |
| **Reconcile already-reconciled sale** | Status check rejects with error message |
| **Withdraw with insufficient balance** | Pre-check throws `Insufficient balance` error |
| **Multiple withdrawals < 24h** | `canWithdraw()` check enforces cooldown |
| **Zero-earning sale** | Advance = 0, no balance impact |
| **All sales rejected** | Clawback reduces balance; balance may reach 0 |
| **Payment gateway failure** | `PayoutRecoveryService` credits back and allows retry |
| **Double recovery attempt** | Status check prevents recovering non-processing withdrawals |
| **Non-existent sale/user** | 404 errors with clear messages |
| **Negative withdrawal amount** | Validation rejects at controller level |
| **Concurrent operations** | SQLite transactions + WAL mode ensure consistency |

---

## Design Decisions & Trade-offs

### 1. SQLite vs External Database
**Decision:** SQLite (via `better-sqlite3`)
- **Pro:** Zero configuration, runs anywhere, single-file database
- **Pro:** Synchronous API simplifies transaction handling
- **Trade-off:** Not suitable for horizontally-scaled production; easily swappable to PostgreSQL/MySQL

### 2. Eager Balance Debit on Withdrawal
**Decision:** Debit balance immediately when withdrawal is initiated, not when payment completes
- **Pro:** Prevents over-withdrawal from concurrent requests
- **Trade-off:** Requires recovery service to credit back on failure

### 3. Per-Sale Advance Tracking
**Decision:** Store `advance_paid` on each sale, not just aggregate per user
- **Pro:** Enables precise per-sale final payout calculation during reconciliation
- **Pro:** Full audit trail at the sale level
- **Trade-off:** Slightly more storage; worth it for accuracy

### 4. Idempotent Advance Job via `advance_locked`
**Decision:** Boolean flag on sales rather than external deduplication table
- **Pro:** Simple, atomic, and impossible to bypass
- **Pro:** No separate deduplication infrastructure needed
- **Trade-off:** Cannot "undo" an advance lock without direct DB intervention

### 5. Dependency Injection Pattern
**Decision:** Constructor injection for all services/controllers
- **Pro:** Easy to test with in-memory databases
- **Pro:** Swappable implementations (e.g., different payment gateways)
- **Trade-off:** More boilerplate in app setup

### 6. Transaction Boundaries
**Decision:** Each business operation (advance, reconciliation, withdrawal) is wrapped in a DB transaction
- **Pro:** Atomicity — either all changes succeed or none do
- **Pro:** No partial state corruption on errors
- **Trade-off:** Longer lock duration during batch operations

---

## Setup & Running

### Prerequisites
- **Node.js** v18+ installed
- **npm** v9+ installed

### Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/user-payout-management-system.git
cd user-payout-management-system

# Install dependencies
npm install

# Seed the database with sample data
npm run seed

# Start the server
npm start
```

The server runs on `http://localhost:3000` by default.

### Quick Demo

```bash
# 1. Create a user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "email": "john@example.com"}'

# 2. Create sales (use the userId from step 1)
curl -X POST http://localhost:3000/api/sales \
  -H "Content-Type: application/json" \
  -d '{"userId": "USER_ID", "brand": "brand_1", "earning": 40}'

# 3. Process advance payouts
curl -X POST http://localhost:3000/api/payouts/advance

# 4. Reconcile sales
curl -X POST http://localhost:3000/api/payouts/reconcile \
  -H "Content-Type: application/json" \
  -d '{"updates": [{"saleId": "SALE_ID", "status": "approved"}]}'

# 5. Check balance
curl http://localhost:3000/api/payouts/summary/USER_ID

# 6. Withdraw
curl -X POST http://localhost:3000/api/withdrawals \
  -H "Content-Type: application/json" \
  -d '{"userId": "USER_ID", "amount": 10}'
```

---

## Testing

```bash
# Run all tests
npm test
```

The test suite covers:
1. ✅ Sale creation and status management
2. ✅ Advance payout calculation (10%)
3. ✅ Advance payout idempotency (no double-pay)
4. ✅ Reconciliation — approved sales (remaining = earning - advance)
5. ✅ Reconciliation — rejected sales (clawback)
6. ✅ Assignment example walkthrough (3 sales → ₹68 final payout)
7. ✅ 24-hour withdrawal cooldown enforcement
8. ✅ Failed payout recovery (Question 2)
9. ✅ Cancelled/rejected payout recovery
10. ✅ Double recovery prevention
11. ✅ Bulk recovery
12. ✅ Edge cases (₹0 earning, large amounts, all-rejected, etc.)

---

## Example Walkthrough (Assignment Example)

### Before Reconciliation

| Sale | Brand | Status | Earning |
|------|-------|--------|---------|
| 1 | brand_1 | pending | ₹40 |
| 2 | brand_1 | pending | ₹40 |
| 3 | brand_1 | pending | ₹40 |

**Total Pending Earnings:** ₹120
**Advance Payout (10%):** ₹12 (₹4 per sale)

### After Reconciliation

| Sale | Status | Earning | Advance Paid | Final Adjustment |
|------|--------|---------|--------------|------------------|
| 1 | rejected | ₹40 | ₹4 | **-₹4** |
| 2 | approved | ₹40 | ₹4 | **₹36** |
| 3 | approved | ₹40 | ₹4 | **₹36** |

**Final Payout = -₹4 + ₹36 + ₹36 = ₹68**

**Total User Balance = ₹12 (advance) + ₹68 (final) = ₹80** ← This equals 2 × ₹40 (the two approved sales) ✓

---

## Project Structure

```
├── src/
│   ├── index.js                    # Server entry point
│   ├── app.js                      # Express app factory (DI)
│   ├── config/
│   │   └── database.js             # SQLite setup & schema
│   ├── models/
│   │   ├── User.js                 # User data access
│   │   ├── Sale.js                 # Sale data access
│   │   ├── Payout.js               # Payout data access
│   │   └── Withdrawal.js           # Withdrawal data access
│   ├── services/
│   │   ├── AdvancePayoutService.js  # 10% advance logic
│   │   ├── ReconciliationService.js # Admin reconciliation
│   │   ├── WithdrawalService.js     # Withdrawal + cooldown
│   │   └── PayoutRecoveryService.js # Failed payout recovery (Q2)
│   ├── controllers/
│   │   ├── userController.js
│   │   ├── saleController.js
│   │   ├── payoutController.js
│   │   └── withdrawalController.js
│   ├── routes/
│   │   ├── userRoutes.js
│   │   ├── saleRoutes.js
│   │   ├── payoutRoutes.js
│   │   └── withdrawalRoutes.js
│   ├── middleware/
│   │   └── errorHandler.js
│   └── scripts/
│       └── seed.js                  # Sample data seeder
├── tests/
│   └── payout.test.js               # Comprehensive test suite
├── package.json
├── .gitignore
└── README.md
```

---

## License

ISC
