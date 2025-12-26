// supabase/functions/sygn1l-admin/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL or SERVICE_ROLE_KEY");
}

const supabaseAdmin = createClient(
  SUPABASE_URL,
  SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const op = body?.op;

    if (!op || typeof op !== "string") {
      return json({ error: "Invalid op" }, 400);
    }

    console.log("SYGN1L ADMIN op =", op);

    // ------------------------------------------------------------------
    // LIST USERS
    // ------------------------------------------------------------------
    if (op === "list_users") {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({
        page: 1,
        perPage: 200,
      });

      if (error) {
        console.error("ADMIN list_users failed", error);
        return json({ error: error.message }, 500);
      }

      return json({
        users: data.users.map((u) => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
        })),
      });
    }

    // ------------------------------------------------------------------
    // DELETE USER (FULLY INLINED, NO HELPERS)
    // ------------------------------------------------------------------
    if (op === "delete_user") {
      const { user_id } = body;

      if (!user_id) {
        return json({ error: "Missing user_id" }, 400);
      }

      console.log("ADMIN delete_user start", user_id);

      const tables = [
        { name: "phase_leaderboard", cols: ["player_id", "user_id", "id"] },
        { name: "profiles", cols: ["id", "user_id", "player_id"] },
        { name: "users", cols: ["id", "user_id", "player_id"] },
        { name: "saves", cols: ["user_id", "id"] },
      ];

      const cleanup: Record<string, any[]> = {};

      for (const table of tables) {
        cleanup[table.name] = [];

        for (const col of table.cols) {
          try {
            const { error, count } = await supabaseAdmin
              .from(table.name)
              .delete({ count: "exact" })
              .eq(col, user_id);

            cleanup[table.name].push({
              column: col,
              deleted: count ?? 0,
              error: error?.message ?? null,
            });
          } catch (e: any) {
            cleanup[table.name].push({
              column: col,
              deleted: 0,
              error: e?.message || String(e),
            });
          }
        }
      }

      console.log("ADMIN dependency cleanup result", cleanup);

      const { error: authError } =
        await supabaseAdmin.auth.admin.deleteUser(user_id);

      if (authError) {
        console.error("ADMIN auth delete failed", authError);
        return json(
          {
            error: "Auth delete failed",
            authError: authError.message,
            cleanup,
          },
          500
        );
      }

      console.log("ADMIN delete_user success", user_id);

      return json({ ok: true, cleanup });
    }

    // ------------------------------------------------------------------
    // UNKNOWN OP
    // ------------------------------------------------------------------
    return json({ error: "Unknown op", op }, 400);
  } catch (err: any) {
    console.error("ADMIN function crash", err);
    return json({ error: err?.message || String(err) }, 500);
  }
});