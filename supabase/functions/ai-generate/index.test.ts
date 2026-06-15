import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { validateRequestBody } from "./index.ts";

Deno.test("validateRequestBody rejects empty body", () => {
  const result = validateRequestBody({});
  assertEquals(result.ok, false);
});

Deno.test("validateRequestBody rejects invalid agent_id", () => {
  const result = validateRequestBody({ agent_id: "invalid", messages: [{ role: "user", content: "hi" }] });
  assertEquals(result.ok, false);
});

Deno.test("validateRequestBody accepts valid request", () => {
  const result = validateRequestBody({
    agent_id: "email",
    messages: [{ role: "user", content: "Write an email" }]
  });
  assertEquals(result.ok, true);
});

Deno.test("validateRequestBody rejects too many messages", () => {
  const messages = Array(10).fill({ role: "user", content: "hi" });
  const result = validateRequestBody({ agent_id: "email", messages });
  assertEquals(result.ok, false);
});