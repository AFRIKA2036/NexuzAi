export const ADMIN_PLANS = ["free", "pro", "team"] as const;

export type AdminPlan = typeof ADMIN_PLANS[number];
export type PaymentSource = "paystack" | "supabase";

export type PaymentRecord = {
  id: string;
  source: PaymentSource;
  email: string;
  fullName: string;
  plan: AdminPlan | "unknown";
  status: string;
  reference: string;
  customerCode: string;
  amount: number | null;
  amountSubunit: number | null;
  currency: string;
  channel: string;
  paidAt: string;
  createdAt: string;
};

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

export function formatPaystackTransaction(row: Record<string, any>) {
  const customer = row.customer || {};
  const metadata = row.metadata || {};
  const plan = getPaystackPlan(metadata);
  const amountSubunit = Number.isFinite(Number(row.amount))
    ? Number(row.amount)
    : null;
  const currency = String(row.currency || "").toUpperCase();

  return {
    id: `paystack:${row.reference || row.id || crypto.randomUUID()}`,
    source: "paystack" as const,
    email: String(customer.email || row.email || ""),
    fullName: String(customer.first_name || customer.last_name
      ? `${customer.first_name || ""} ${customer.last_name || ""}`.trim()
      : ""),
    plan,
    status: String(row.status || "unknown"),
    reference: String(row.reference || ""),
    customerCode: String(customer.customer_code || ""),
    amount: amountSubunit === null ? null : amountSubunit / 100,
    amountSubunit,
    currency,
    channel: String(row.channel || ""),
    paidAt: String(row.paid_at || row.created_at || ""),
    createdAt: String(row.created_at || row.paid_at || ""),
  };
}

export function formatSupabasePaymentProfile(row: Record<string, unknown>) {
  const reference = String(row.paystack_last_reference || "");
  const customerCode = String(row.paystack_customer_code || "");
  const id = String(row.id || reference || customerCode || crypto.randomUUID());

  return {
    id: `supabase:${id}`,
    source: "supabase" as const,
    email: String(row.email || ""),
    fullName: String(row.full_name || ""),
    plan: isValidPlan(row.plan) ? row.plan : "unknown" as const,
    status: "profile_record",
    reference,
    customerCode,
    amount: null,
    amountSubunit: null,
    currency: "",
    channel: "",
    paidAt: String(row.updated_at || row.created_at || ""),
    createdAt: String(row.created_at || row.updated_at || ""),
  };
}

export function mergePaymentRecords(
  paystackRows: PaymentRecord[],
  supabaseRows: PaymentRecord[],
) {
  const byReference = new Map(
    supabaseRows
      .filter((row) => row.reference)
      .map((row) => [row.reference, row]),
  );
  const usedSupabaseIds = new Set<string>();

  const merged = paystackRows.map((payment) => {
    const profile = payment.reference
      ? byReference.get(payment.reference)
      : undefined;
    if (profile) usedSupabaseIds.add(profile.id);

    return {
      ...payment,
      email: payment.email || profile?.email || "",
      fullName: payment.fullName || profile?.fullName || "",
      plan: payment.plan !== "unknown" ? payment.plan : profile?.plan || "unknown",
      customerCode: payment.customerCode || profile?.customerCode || "",
    };
  });

  for (const profile of supabaseRows) {
    if (!usedSupabaseIds.has(profile.id)) merged.push(profile);
  }

  return merged.sort((a, b) =>
    new Date(b.paidAt || b.createdAt || 0).getTime() -
    new Date(a.paidAt || a.createdAt || 0).getTime()
  );
}

export function paymentMetrics(rows: PaymentRecord[]) {
  return rows.reduce(
    (acc, row) => {
      if (row.source === "paystack") acc.paystackCount += 1;
      if (row.source === "supabase") acc.supabaseOnlyCount += 1;

      const status = String(row.status || "").toLowerCase();
      if (status === "success") {
        acc.successfulCount += 1;
        acc.totalSuccessfulAmount += row.amount || 0;
        if (row.currency) acc.currencies.add(row.currency);
      } else if (status === "failed") {
        acc.failedCount += 1;
      } else if (status === "abandoned") {
        acc.abandonedCount += 1;
      } else if (status === "ongoing" || status === "pending") {
        acc.pendingCount += 1;
      }

      return acc;
    },
    {
      successfulCount: 0,
      failedCount: 0,
      abandonedCount: 0,
      pendingCount: 0,
      paystackCount: 0,
      supabaseOnlyCount: 0,
      totalSuccessfulAmount: 0,
      currencies: new Set<string>(),
    },
  );
}

export function calculateRevenueTrend(rows: PaymentRecord[], days = 14) {
  const counts = new Map<string, number>();
  const now = new Date();

  // Initialize map with zeros for the last X days
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    counts.set(d.toISOString().slice(0, 10), 0);
  }

  for (const row of rows) {
    if (row.status !== "success" || !row.amount) continue;
    const dateStr = (row.paidAt || row.createdAt || "").slice(0, 10);
    if (counts.has(dateStr)) {
      counts.set(dateStr, (counts.get(dateStr) || 0) + row.amount);
    }
  }

  return Array.from(counts.entries())
    .map(([date, amount]) => ({ date, amount: Number(amount.toFixed(2)) }))
    .sort((a, b) => a.date.localeCompare(b.date));
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

function getPaystackPlan(metadata: Record<string, any>) {
  const planId = metadata.planId || metadata.plan;
  if (isValidPlan(planId)) return planId;

  const fields = Array.isArray(metadata.custom_fields)
    ? metadata.custom_fields
    : [];
  const planField = fields.find((field) =>
    field?.variable_name === "plan" || field?.display_name === "Plan"
  );
  return isValidPlan(planField?.value) ? planField.value : "unknown";
}
