export const ADMIN_PLANS = ["free", "pro", "team"] as const;

export type AdminPlan = typeof ADMIN_PLANS[number];

export function isAdminUser(
  user: { app_metadata?: Record<string, unknown> } | null | undefined,
) {
  const metadata = user?.app_metadata || {};
  if (metadata.is_admin === true) return true;
  if (metadata.role === "admin") return true;
  if (Array.isArray(metadata.roles) && metadata.roles.includes("admin")) {
    return true;
  }
  return false;
}

export function isValidPlan(plan: unknown): plan is AdminPlan {
  return typeof plan === "string" &&
    (ADMIN_PLANS as readonly string[]).includes(plan);
}

export function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const configured =
    (Deno.env.get("ALLOWED_ORIGINS") || Deno.env.get("APP_URL") || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

  const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(
    origin,
  );
  const allowedOrigin =
    configured.length === 0 || isLocalhost || configured.includes(origin)
      ? (origin || "*")
      : "";

  return {
    allowed: Boolean(allowedOrigin),
    headers: {
      "Access-Control-Allow-Origin": allowedOrigin || "null",
      "Access-Control-Allow-Headers":
        "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
      "X-Content-Type-Options": "nosniff",
    },
  };
}

export function snippet(value: unknown, maxLength = 90) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

export function countPlans(rows: Array<{ plan?: string | null }>) {
  return rows.reduce((acc, row) => {
    const plan = isValidPlan(row.plan) ? row.plan : "free";
    acc[plan] += 1;
    return acc;
  }, { free: 0, pro: 0, team: 0 });
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function json(
  payload: unknown,
  status: number,
  headers: Record<string, string>,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
