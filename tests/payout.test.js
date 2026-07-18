const { createMemoryDatabase, initializeDatabase } = require("../src/config/database");
const User = require("../src/models/User");
const Sale = require("../src/models/Sale");
const Payout = require("../src/models/Payout");
const Withdrawal = require("../src/models/Withdrawal");
const AdvancePayoutService = require("../src/services/AdvancePayoutService");
const ReconciliationService = require("../src/services/ReconciliationService");
const WithdrawalService = require("../src/services/WithdrawalService");
const PayoutRecoveryService = require("../src/services/PayoutRecoveryService");

let db, userModel, saleModel, payoutModel, withdrawalModel;
let advancePayoutService, reconciliationService, withdrawalService, payoutRecoveryService;

beforeEach(async () => {
  db = await createMemoryDatabase();
  initializeDatabase(db);
  userModel = new User(db);
  saleModel = new Sale(db);
  payoutModel = new Payout(db);
  withdrawalModel = new Withdrawal(db);
  advancePayoutService = new AdvancePayoutService({ saleModel, userModel, payoutModel, db });
  reconciliationService = new ReconciliationService({ saleModel, userModel, payoutModel, db });
  withdrawalService = new WithdrawalService({ withdrawalModel, userModel, payoutModel, db });
  payoutRecoveryService = new PayoutRecoveryService({ payoutModel, withdrawalModel, userModel, db });
});

afterEach(() => { db.close(); });

function createTestUser(name = "John", email = "john@test.com") {
  return userModel.create({ name, email });
}
function createTestSale(userId, earning = 40, brand = "brand_1") {
  return saleModel.create({ userId, brand, earning });
}

describe("Sale Management", () => {
  test("create sale with pending status", () => {
    const user = createTestUser();
    const sale = createTestSale(user.id);
    expect(sale.status).toBe("pending");
    expect(sale.earning).toBe(40);
    expect(sale.advance_paid).toBe(0);
    expect(sale.advance_locked).toBe(0);
  });

  test("find sales by user", () => {
    const user = createTestUser();
    createTestSale(user.id, 40);
    createTestSale(user.id, 50);
    expect(saleModel.findByUserId(user.id)).toHaveLength(2);
  });

  test("reject invalid status transitions", () => {
    const user = createTestUser();
    const sale = createTestSale(user.id);
    saleModel.updateStatus(sale.id, "approved");
    expect(() => saleModel.updateStatus(sale.id, "rejected")).toThrow("Only pending sales");
  });
});

describe("Advance Payout Processing", () => {
  test("calculate 10% advance for pending sales", () => {
    const user = createTestUser();
    createTestSale(user.id, 40);
    createTestSale(user.id, 40);
    createTestSale(user.id, 40);
    const result = advancePayoutService.processAdvanceForUser(user.id);
    expect(result.advanceAmount).toBe(12);
    expect(result.salesProcessed).toBe(3);
    expect(userModel.findById(user.id).withdrawable_balance).toBe(12);
  });

  test("idempotent — no duplicate advance on re-run", () => {
    const user = createTestUser();
    createTestSale(user.id, 100);
    const r1 = advancePayoutService.processAdvanceForUser(user.id);
    expect(r1.advanceAmount).toBe(10);
    const r2 = advancePayoutService.processAdvanceForUser(user.id);
    expect(r2.advanceAmount).toBe(0);
    expect(r2.salesProcessed).toBe(0);
    expect(userModel.findById(user.id).withdrawable_balance).toBe(10);
  });

  test("lock each sale after advance is paid", () => {
    const user = createTestUser();
    const sale = createTestSale(user.id, 50);
    advancePayoutService.processAdvanceForUser(user.id);
    const updated = saleModel.findById(sale.id);
    expect(updated.advance_locked).toBe(1);
    expect(updated.advance_paid).toBe(5);
  });

  test("process advances for multiple users", () => {
    const u1 = createTestUser("U1", "u1@t.com");
    const u2 = createTestUser("U2", "u2@t.com");
    createTestSale(u1.id, 100);
    createTestSale(u2.id, 200);
    const result = advancePayoutService.processAllAdvances();
    expect(result.totalUsersProcessed).toBe(2);
  });

  test("create payout record for advance", () => {
    const user = createTestUser();
    createTestSale(user.id, 30);
    advancePayoutService.processAdvanceForUser(user.id);
    const payouts = payoutModel.findByUserId(user.id);
    expect(payouts).toHaveLength(1);
    expect(payouts[0].type).toBe("advance");
    expect(payouts[0].amount).toBe(3);
  });
});

describe("Reconciliation & Final Payout", () => {
  test("assignment example — 3 sales, 1 rejected, 2 approved = ₹68", () => {
    const user = createTestUser();
    const s1 = createTestSale(user.id, 40);
    const s2 = createTestSale(user.id, 40);
    const s3 = createTestSale(user.id, 40);

    const adv = advancePayoutService.processAdvanceForUser(user.id);
    expect(adv.advanceAmount).toBe(12);

    const rec = reconciliationService.reconcile([
      { saleId: s1.id, status: "rejected" },
      { saleId: s2.id, status: "approved" },
      { saleId: s3.id, status: "approved" },
    ]);

    const rejected = rec.salesResults.find(r => r.saleId === s1.id);
    expect(rejected.finalAdjustment).toBe(-4);

    const approved = rec.salesResults.filter(r => r.saleId !== s1.id);
    approved.forEach(a => expect(a.finalAdjustment).toBe(36));

    expect(rec.payoutSummaries[0].netPayout).toBe(68);
    expect(userModel.findById(user.id).withdrawable_balance).toBe(80);
  });

  test("Case 1 — Approved: remaining = earning - advance", () => {
    const user = createTestUser();
    const sale = createTestSale(user.id, 30);
    advancePayoutService.processAdvanceForUser(user.id);
    const rec = reconciliationService.reconcile([{ saleId: sale.id, status: "approved" }]);
    expect(rec.salesResults[0].finalAdjustment).toBe(27);
    expect(userModel.findById(user.id).withdrawable_balance).toBe(30);
  });

  test("Case 2 — Rejected: clawback advance", () => {
    const user = createTestUser();
    const sale = createTestSale(user.id, 50);
    advancePayoutService.processAdvanceForUser(user.id);
    const rec = reconciliationService.reconcile([{ saleId: sale.id, status: "rejected" }]);
    expect(rec.salesResults[0].finalAdjustment).toBe(-5);
    expect(userModel.findById(user.id).withdrawable_balance).toBe(0);
  });

  test("reconciliation without prior advance", () => {
    const user = createTestUser();
    const sale = createTestSale(user.id, 100);
    const rec = reconciliationService.reconcile([{ saleId: sale.id, status: "approved" }]);
    expect(rec.salesResults[0].finalAdjustment).toBe(100);
    expect(userModel.findById(user.id).withdrawable_balance).toBe(100);
  });

  test("reject already reconciled sales", () => {
    const user = createTestUser();
    const sale = createTestSale(user.id, 40);
    reconciliationService.reconcile([{ saleId: sale.id, status: "approved" }]);
    const rec = reconciliationService.reconcile([{ saleId: sale.id, status: "rejected" }]);
    expect(rec.salesResults[0].error).toContain("already reconciled");
  });
});

describe("Withdrawal Management", () => {
  test("allow withdrawal when balance sufficient", () => {
    const user = createTestUser();
    const sale = createTestSale(user.id, 100);
    advancePayoutService.processAdvanceForUser(user.id);
    reconciliationService.reconcile([{ saleId: sale.id, status: "approved" }]);
    const { withdrawal } = withdrawalService.initiateWithdrawal(user.id, 50);
    expect(withdrawal.amount).toBe(50);
    expect(userModel.findById(user.id).withdrawable_balance).toBe(50);
  });

  test("reject insufficient balance", () => {
    const user = createTestUser();
    expect(() => withdrawalService.initiateWithdrawal(user.id, 100)).toThrow("Insufficient");
  });

  test("enforce 24-hour cooldown", () => {
    const user = createTestUser();
    createTestSale(user.id, 1000);
    advancePayoutService.processAdvanceForUser(user.id);
    reconciliationService.reconcile([{ saleId: saleModel.findByUserId(user.id)[0].id, status: "approved" }]);
    withdrawalService.initiateWithdrawal(user.id, 100);
    expect(() => withdrawalService.initiateWithdrawal(user.id, 100)).toThrow("cooldown");
  });

  test("complete a withdrawal", () => {
    const user = createTestUser();
    createTestSale(user.id, 200);
    advancePayoutService.processAdvanceForUser(user.id);
    reconciliationService.reconcile([{ saleId: saleModel.findByUserId(user.id)[0].id, status: "approved" }]);
    const { withdrawal } = withdrawalService.initiateWithdrawal(user.id, 50);
    const completed = withdrawalService.completeWithdrawal(withdrawal.id);
    expect(completed.status).toBe("completed");
  });
});

describe("Failed Payout Recovery (Q2)", () => {
  test("credit back failed withdrawal", () => {
    const user = createTestUser();
    createTestSale(user.id, 200);
    advancePayoutService.processAdvanceForUser(user.id);
    reconciliationService.reconcile([{ saleId: saleModel.findByUserId(user.id)[0].id, status: "approved" }]);
    const { withdrawal } = withdrawalService.initiateWithdrawal(user.id, 100);
    const recovery = payoutRecoveryService.recoverFailedWithdrawal(withdrawal.id, "failed");
    expect(recovery.amountRecovered).toBe(100);
    expect(recovery.newBalance).toBe(200);
  });

  test("handle cancelled payout recovery", () => {
    const user = createTestUser();
    createTestSale(user.id, 300);
    advancePayoutService.processAdvanceForUser(user.id);
    reconciliationService.reconcile([{ saleId: saleModel.findByUserId(user.id)[0].id, status: "approved" }]);
    const { withdrawal } = withdrawalService.initiateWithdrawal(user.id, 150);
    const recovery = payoutRecoveryService.recoverFailedWithdrawal(withdrawal.id, "cancelled");
    expect(recovery.reason).toBe("cancelled");
    expect(recovery.amountRecovered).toBe(150);
  });

  test("prevent double recovery", () => {
    const user = createTestUser();
    createTestSale(user.id, 200);
    advancePayoutService.processAdvanceForUser(user.id);
    reconciliationService.reconcile([{ saleId: saleModel.findByUserId(user.id)[0].id, status: "approved" }]);
    const { withdrawal } = withdrawalService.initiateWithdrawal(user.id, 100);
    payoutRecoveryService.recoverFailedWithdrawal(withdrawal.id, "failed");
    expect(() => payoutRecoveryService.recoverFailedWithdrawal(withdrawal.id, "failed")).toThrow("Cannot recover");
  });

  test("bulk recover multiple failures", () => {
    const u1 = createTestUser("U1", "u1@t.com");
    const u2 = createTestUser("U2", "u2@t.com");
    createTestSale(u1.id, 200);
    createTestSale(u2.id, 300);
    advancePayoutService.processAllAdvances();
    reconciliationService.reconcile([
      { saleId: saleModel.findByUserId(u1.id)[0].id, status: "approved" },
      { saleId: saleModel.findByUserId(u2.id)[0].id, status: "approved" },
    ]);
    const w1 = withdrawalService.initiateWithdrawal(u1.id, 100);
    const w2 = withdrawalService.initiateWithdrawal(u2.id, 150);
    const result = payoutRecoveryService.bulkRecover([
      { withdrawalId: w1.withdrawal.id, reason: "failed" },
      { withdrawalId: w2.withdrawal.id, reason: "cancelled" },
    ]);
    expect(result.succeeded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
  });
});

describe("Edge Cases", () => {
  test("all sales rejected — balance goes to 0", () => {
    const user = createTestUser();
    const s1 = createTestSale(user.id, 40);
    const s2 = createTestSale(user.id, 60);
    advancePayoutService.processAdvanceForUser(user.id);
    reconciliationService.reconcile([
      { saleId: s1.id, status: "rejected" },
      { saleId: s2.id, status: "rejected" },
    ]);
    expect(userModel.findById(user.id).withdrawable_balance).toBe(0);
  });

  test("multiple advance jobs — only first pays", () => {
    const user = createTestUser();
    createTestSale(user.id, 100);
    const r1 = advancePayoutService.processAdvanceForUser(user.id);
    const r2 = advancePayoutService.processAdvanceForUser(user.id);
    const r3 = advancePayoutService.processAdvanceForUser(user.id);
    expect(r1.advanceAmount).toBe(10);
    expect(r2.advanceAmount).toBe(0);
    expect(r3.advanceAmount).toBe(0);
    expect(userModel.findById(user.id).withdrawable_balance).toBe(10);
  });

  test("reconcile non-existent sale", () => {
    const result = reconciliationService.reconcile([{ saleId: "fake-id", status: "approved" }]);
    expect(result.salesResults[0].error).toContain("not found");
  });
});
