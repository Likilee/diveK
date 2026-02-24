import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ensureEnvLoaded, requireEnv } from "@/lib/supabase/load-env";

const clientCache = new Map<string, SupabaseClient>();

/**
 * Returns a Supabase admin client (service_role) for the given target.
 *
 * - No argument / "prod" → production DiveK project
 * - "local" → local Supabase instance
 *
 * Backward-compatible: `getSupabaseAdminClient()` (no param) returns prod,
 * which search-service.ts depends on.
 */
export function getSupabaseAdminClient(
  target?: "local" | "prod",
): SupabaseClient {
  const resolvedTarget = target ?? "prod";

  const cached = clientCache.get(resolvedTarget);
  if (cached) {
    return cached;
  }

  ensureEnvLoaded();

  let url: string;
  let serviceRoleKey: string;

  if (resolvedTarget === "local") {
    url =
      process.env.SUPABASE_LOCAL_URL ??
      process.env.SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      requireEnv("SUPABASE_LOCAL_URL");
    serviceRoleKey =
      process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      requireEnv("SUPABASE_LOCAL_SERVICE_ROLE_KEY");
  } else {
    url =
      process.env.SUPABASE_PROD_URL ??
      process.env.SUPABASE_URL ??
      process.env.NEXT_PUBLIC_SUPABASE_URL ??
      requireEnv("SUPABASE_PROD_URL");
    serviceRoleKey =
      process.env.SUPABASE_PROD_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY ??
      requireEnv("SUPABASE_PROD_SERVICE_ROLE_KEY");
  }

  const client = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  clientCache.set(resolvedTarget, client);
  return client;
}
