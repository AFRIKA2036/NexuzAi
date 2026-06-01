import { countPlans, isAdminUser, isValidPlan, snippet } from "./logic.ts";

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
