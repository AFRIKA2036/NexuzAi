import {
  countPlans,
  formatPaystackTransaction,
  formatSupabasePaymentProfile,
  isAdminUser,
  isValidPlan,
  mergePaymentRecords,
  paymentMetrics,
  snippet,
} from "./logic.ts";

function assertEquals(actual: unknown, expected: unknown) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
  }
}

Deno.test("isAdminUser accepts supported admin metadata shapes", () => {
  assertEquals(isAdminUser({ app_metadata: { is_admin: true } }), true);
  assertEquals(isAdminUser({ app_metadata: { role: "admin" } }), true);
  assertEquals(
    isAdminUser({ app_metadata: { roles: ["billing", "admin"] } }),
    true,
  );
});

Deno.test("isAdminUser rejects normal users", () => {
  assertEquals(
    isAdminUser({ app_metadata: { is_admin: false, role: "user" } }),
    false,
  );
  assertEquals(isAdminUser({ app_metadata: { roles: ["member"] } }), false);
  assertEquals(isAdminUser(null), false);
});

Deno.test("plan helpers keep dashboard actions constrained", () => {
  assertEquals(isValidPlan("free"), true);
  assertEquals(isValidPlan("pro"), true);
  assertEquals(isValidPlan("team"), true);
  assertEquals(isValidPlan("admin"), false);
  assertEquals(
    countPlans([{ plan: "free" }, { plan: "pro" }, { plan: "team" }, {
      plan: "legacy",
    }]),
    {
      free: 2,
      pro: 1,
      team: 1,
    },
  );
});

Deno.test("snippet normalizes whitespace and caps prompt previews", () => {
  assertEquals(snippet("  hello\n\nworld  ", 20), "hello world");
  assertEquals(snippet("abcdefghijklmnopqrstuvwxyz", 10), "abcdefghi...");
});

Deno.test("payment helpers merge Paystack transactions with Supabase references", () => {
  const paystack = formatPaystackTransaction({
    reference: "ref_123",
    amount: 15000,
    currency: "GHS",
    status: "success",
    channel: "mobile_money",
    paid_at: "2026-06-01T10:00:00.000Z",
    created_at: "2026-06-01T09:58:00.000Z",
    metadata: { planId: "pro" },
    customer: {
      email: "paid@example.com",
      first_name: "",
      last_name: "",
      customer_code: "CUS_123",
    },
  });
  const supabase = formatSupabasePaymentProfile({
    id: "profile-1",
    email: "paid@example.com",
    full_name: "Paid User",
    plan: "pro",
    paystack_customer_code: "CUS_123",
    paystack_last_reference: "ref_123",
    updated_at: "2026-06-01T10:01:00.000Z",
  });
  const orphan = formatSupabasePaymentProfile({
    id: "profile-2",
    email: "manual@example.com",
    full_name: "Manual User",
    plan: "team",
    paystack_customer_code: "CUS_999",
    paystack_last_reference: "ref_999",
    updated_at: "2026-05-31T10:00:00.000Z",
  });

  const rows = mergePaymentRecords([paystack], [supabase, orphan]);
  const metrics = paymentMetrics(rows);

  assertEquals(rows.length, 2);
  assertEquals(rows[0].reference, "ref_123");
  assertEquals(rows[0].email, "paid@example.com");
  assertEquals(rows[0].amount, 150);
  assertEquals(rows[1].source, "supabase");
  assertEquals(metrics.successfulCount, 1);
  assertEquals(metrics.paystackCount, 1);
  assertEquals(metrics.supabaseOnlyCount, 1);
  assertEquals(metrics.totalSuccessfulAmount, 150);
});
