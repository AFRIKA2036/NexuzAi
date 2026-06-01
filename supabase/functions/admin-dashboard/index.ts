import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  countPlans,
  getCorsHeaders,
  isAdminUser,
  isValidPlan,
  json,
  snippet,
  todayIsoDate,
} from "./logic.ts";

type SupabaseClient = any;

export async function handleAdminDashboard(req: Request) {
  const requestId = crypto.randomUUID();
  const cors = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors.headers });
  }
  if (!cors.allowed) {
    return json(
      { error: "Origin is not allowed", requestId },
      403,
      cors.headers,
    );
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed", requestId }, 405, cors.headers);
  }

  try {
    const token = getBearerToken(req);
    if (!token) {
      return json({ error: "Unauthorized", requestId }, 401, cors.headers);
    }

    const supabaseUrl = requiredEnv("SUPABASE_URL");
    const serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: authError } = await admin.auth.getUser(
      token,
    );
    if (authError || !userData.user) {
      return json({ error: "Unauthorized", requestId }, 401, cors.headers);
    }
    if (!isAdminUser(userData.user)) {
      return json(
        { error: "Admin access required", requestId },
        403,
        cors.headers,
      );
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "summary");

    if (action === "updatePlan") {
      const validation = validatePlanUpdate(body.userId, body.plan);
      if (!validation.ok) {
        return json({ error: validation.error, requestId }, 400, cors.headers);
      }

      const result = await updateUserPlan(
        admin,
        validation.userId,
        validation.plan,
      );
      return json({ ...result, requestId }, 200, cors.headers);
    }

    if (action !== "summary") {
      return json(
        { error: "Unsupported action", requestId },
        400,
        cors.headers,
      );
    }

    const dashboard = await getDashboardData(admin);
    return json({ ...dashboard, requestId }, 200, cors.headers);
  } catch (err) {
    console.error("[ADMIN_DASHBOARD] unexpected error", {
      requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return json(
      { error: "Unexpected server error", requestId },
      500,
      cors.headers,
    );
  }
}

async function getDashboardData(admin: SupabaseClient) {
  const today = todayIsoDate();
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  sevenDaysAgo.setHours(0, 0, 0, 0);

  const [
    usersCount,
    generationsCount,
    activeCount,
    profileRows,
    signupRows,
    recentUsers,
    recentGenerations,
    usageRows,
  ] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("generations").select("id", { count: "exact", head: true }),
    admin.from("usage_daily").select("user_id", { count: "exact", head: true })
      .eq("usage_date", today),
    admin.from("profiles").select("plan"),
    admin.from("profiles").select("created_at").gte(
      "created_at",
      sevenDaysAgo.toISOString(),
    ),
    admin.from("profiles")
      .select("id, email, full_name, plan, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(25),
    admin.from("generations")
      .select("id, user_id, created_at, agent_id, prompt, output_format")
      .order("created_at", { ascending: false })
      .limit(15),
    admin.from("usage_daily")
      .select("user_id, request_count, updated_at")
      .eq("usage_date", today)
      .order("request_count", { ascending: false })
      .limit(15),
  ]);

  throwFirstError([
    usersCount,
    generationsCount,
    activeCount,
    profileRows,
    signupRows,
    recentUsers,
    recentGenerations,
    usageRows,
  ]);

  const userIds = uniqueIds([
    ...((recentGenerations.data || []) as Array<{ user_id: string }>).map((
      row,
    ) => row.user_id),
    ...((usageRows.data || []) as Array<{ user_id: string }>).map((row) =>
      row.user_id
    ),
  ]);
  const profileMap = await getProfileMap(admin, userIds);

  const plans = countPlans(
    (profileRows.data || []) as Array<{ plan?: string }>,
  );

  return {
    generatedAt: new Date().toISOString(),
    metrics: {
      totalUsers: usersCount.count || 0,
      totalGenerations: generationsCount.count || 0,
      activeToday: activeCount.count || 0,
      paidUsers: plans.pro + plans.team,
      plans,
    },
    signupTrend: buildSignupTrend(
      (signupRows.data || []) as Array<{ created_at?: string }>,
    ),
    recentUsers: ((recentUsers.data || []) as Array<Record<string, unknown>>)
      .map(formatUserRow),
    recentGenerations:
      ((recentGenerations.data || []) as Array<Record<string, unknown>>).map((
        row,
      ) => ({
        id: row.id,
        userId: row.user_id,
        email: profileMap.get(String(row.user_id))?.email || "Unknown",
        agentId: row.agent_id,
        prompt: snippet(row.prompt),
        outputFormat: row.output_format || "text",
        createdAt: row.created_at,
      })),
    topUsageToday: ((usageRows.data || []) as Array<Record<string, unknown>>)
      .map((row) => ({
        userId: row.user_id,
        email: profileMap.get(String(row.user_id))?.email || "Unknown",
        requestCount: Number(row.request_count || 0),
        updatedAt: row.updated_at,
      })),
  };
}

function buildSignupTrend(rows: Array<{ created_at?: string }>) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.created_at) continue;
    const key = new Date(row.created_at).toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  return Array.from({ length: 7 }, (_value, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = date.toISOString().slice(0, 10);
    return { date: key, count: counts.get(key) || 0 };
  });
}

async function updateUserPlan(
  admin: SupabaseClient,
  id: string,
  plan: "free" | "pro" | "team",
) {
  const { data, error } = await admin
    .from("profiles")
    .update({ plan, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id, email, full_name, plan, created_at, updated_at")
    .single();

  if (error) throw new Error(`Plan update failed: ${error.message}`);
  return { user: formatUserRow(data as Record<string, unknown>) };
}

function validatePlanUpdate(userId: unknown, plan: unknown) {
  const id = String(userId || "");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(id)
  ) {
    return { ok: false as const, error: "Invalid user id" };
  }
  if (!isValidPlan(plan)) return { ok: false as const, error: "Invalid plan" };
  return { ok: true as const, userId: id, plan };
}

async function getProfileMap(admin: SupabaseClient, userIds: string[]) {
  const map = new Map<string, { email: string; fullName: string | null }>();
  if (userIds.length === 0) return map;

  const { data, error } = await admin
    .from("profiles")
    .select("id, email, full_name")
    .in("id", userIds);

  if (error) throw new Error(`Profile lookup failed: ${error.message}`);

  for (
    const row of (data || []) as Array<
      { id: string; email: string; full_name: string | null }
    >
  ) {
    map.set(row.id, { email: row.email, fullName: row.full_name });
  }
  return map;
}

function formatUserRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name || "",
    plan: isValidPlan(row.plan) ? row.plan : "free",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function uniqueIds(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function throwFirstError(
  results: Array<{ error?: { message?: string } | null }>,
) {
  const failed = results.find((result) => result.error);
  if (failed?.error) {
    throw new Error(failed.error.message || "Supabase query failed");
  }
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  return authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

if (import.meta.main) {
  Deno.serve(handleAdminDashboard);
}
