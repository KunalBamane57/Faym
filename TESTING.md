# Step-by-Step Testing Guide

### Step 1: Run Automated Tests (24 tests)

```bash
npm test
```

This runs all 24 unit tests covering every business rule.

---

### Step 2: Start the Server

Open a terminal in your project directory and run:

```bash
npm start
```

You should see the server banner on `http://localhost:3000`. **Keep this terminal open.**

---

### Step 3: Manual API Testing (in a NEW terminal)

Run these commands **one by one in order**. Each step builds on the previous one. We will use `Invoke-RestMethod` (PowerShell) since you are on Windows.

#### 3a. Create a User

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/users" -ContentType "application/json" -Body '{"name": "John Doe", "email": "john@example.com"}'
```

📝 **Copy the `id` from the response** — you'll need it for every next step. Let's call it `USER_ID`.

#### 3b. Create 3 Sales (₹40 each)

Run this **3 times** (replacing `USER_ID` with the actual id from step 3a):

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/sales" -ContentType "application/json" -Body '{"userId": "USER_ID", "brand": "brand_1", "earning": 40}'
```

📝 **Copy the 3 sale IDs** from the responses — call them `SALE_1`, `SALE_2`, `SALE_3`.

#### 3c. Check Sales

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/sales/user/USER_ID"
```

✅ You should see 3 pending sales, each with `earning: 40`.

---

### Step 4: Process Advance Payout (10%)

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/payouts/advance"
```

✅ **Expected:** `advanceAmount: 12` (10% of ₹120), `salesProcessed: 3`

#### 4b. Verify Idempotency — Run Again

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/payouts/advance"
```

✅ **Expected:** `advanceAmount: 0`, `salesProcessed: 0` — **no double payment!**

#### 4c. Check User Balance

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/payouts/summary/USER_ID"
```

✅ **Expected:** `withdrawableBalance: 12`

---

### Step 5: Reconcile Sales (1 rejected, 2 approved)

Replace `SALE_1`, `SALE_2`, `SALE_3` with the actual IDs from step 3b:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/payouts/reconcile" -ContentType "application/json" -Body '{"updates": [{"saleId": "SALE_1", "status": "rejected"}, {"saleId": "SALE_2", "status": "approved"}, {"saleId": "SALE_3", "status": "approved"}]}'
```

✅ **Expected results:**
| Sale | Adjustment |
|------|-----------|
| SALE_1 (rejected) | **-₹4** (clawback) |
| SALE_2 (approved) | **₹36** (₹40 - ₹4 advance) |
| SALE_3 (approved) | **₹36** (₹40 - ₹4 advance) |
| **Net Final Payout** | **₹68** |

#### 5b. Check Final Balance

```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/payouts/summary/USER_ID"
```

✅ **Expected:** `withdrawableBalance: 80` (₹12 advance + ₹68 final = ₹80)

---

### Step 6: Withdraw Money

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/withdrawals" -ContentType "application/json" -Body '{"userId": "USER_ID", "amount": 50}'
```

✅ **Expected:** Withdrawal created with `status: "processing"`

📝 **Copy the withdrawal `id`** — call it `WITHDRAWAL_ID`.

#### 6b. Test 24-Hour Cooldown

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/withdrawals" -ContentType "application/json" -Body '{"userId": "USER_ID", "amount": 10}'
```

✅ **Expected:** Error — `"Withdrawal cooldown active"`

---

### Step 7: Test Failed Payout Recovery (Question 2)

Replace `WITHDRAWAL_ID` with the ID from step 6:

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/payouts/recover" -ContentType "application/json" -Body '{"withdrawalId": "WITHDRAWAL_ID", "reason": "failed"}'
```

✅ **Expected:** `amountRecovered: 50`, balance goes back to **₹80**

#### 7b. Try Double Recovery (should fail)

```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/payouts/recover" -ContentType "application/json" -Body '{"withdrawalId": "WITHDRAWAL_ID", "reason": "failed"}'
```

✅ **Expected:** Error — `"Cannot recover"`
