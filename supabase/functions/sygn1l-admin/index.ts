// test

// supabase/functions/sygn1l-admin/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Body =
  | { op: "list_users"; page?: number; per_page?: number; q?: string }
  | { op: "delete_user"; id: string }
  | { op: "delete_self" }
  | { op: "delete_save"; id: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function err(message: string, status = 400) {
  return json({ error: message }, status);
}

serve(async (req) => {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const masterEmail = Deno.env.get("SYGN1L_MASTER_EMAIL"); // optional
    const masterUserId = Deno.env.get("SYGN1L_MASTER_USER_ID"); // optional

    if (!url || !serviceKey) return err("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY", 500);

    const supaAdmin = createClient(url, serviceKey);

    // Verify caller (must be signed in)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return err("Missing Authorization", 401);

    const supaAuth = createClient(url, serviceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supaAuth.auth.getUser();
    if (userErr || !userData?.user) return err("Unauthorized", 401);

    const caller = userData.user;
    const callerEmail = caller.email || "";
    const callerId = caller.id || "";

    // Restrict admin actions to master account (recommended)
    const isMaster =
      (masterUserId && callerId === masterUserId) ||
      (masterEmail && callerEmail.toLowerCase() === masterEmail.toLowerCase());

    // delete_self is allowed for any signed-in user if you want; but you asked for robust admin tools.
    // We'll still restrict *admin listing/deleting others* to master.
    const body = (await req.json()) as Body;

    if (body.op !== "delete_self" && !isMaster) {
      return err("Forbidden: not master account", 403);
    }

    // Helpers
    async function deleteSaveRow(userId: string) {
      const { error } = await supaAdmin.from("saves").delete().eq("player_id", userId);
      // ignore missing row; return error only if actual failure
      if (error) throw error;
    }

    if (body.op === "list_users") {
      const page = Math.max(1, Math.floor(body.page || 1));
      const perPage = Math.min(100, Math.max(1, Math.floor(body.per_page || 25)));
      const q = (body.q || "").trim().toLowerCase();

      const { data, error } = await supaAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw error;

      let users = data?.users || [];
      if (q) {
        users = users.filter((u) => {
          const email = (u.email || "").toLowerCase();
          const id = (u.id || "").toLowerCase();
          return email.includes(q) || id.includes(q);
        });
      }

      return json({
        users: users.map((u) => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
        })),
        // listUsers doesn't always provide a trustworthy total depending on backend,
        // but data.total exists on many setups.
        total: (data as any)?.total ?? null,
        page,
        per_page: perPage,
        q,
      });
    }

    if (body.op === "delete_save") {
      if (!body.id) return err("Missing id", 400);
      await deleteSaveRow(body.id);
      return json({ ok: true });
    }

    if (body.op === "delete_user") {
      if (!body.id) return err("Missing id", 400);

      // Delete save row first (optional but nice)
      try {
        await deleteSaveRow(body.id);
      } catch {
        // swallow so user deletion still proceeds
      }

      const { error } = await supaAdmin.auth.admin.deleteUser(body.id);
      if (error) throw error;

      return json({ ok: true });
    }

    if (body.op === "delete_self") {
      // self-delete: allow signed-in users to delete their own auth user + saves row
      const selfId = callerId;

      try {
        await deleteSaveRow(selfId);
      } catch {
        // ignore
      }

      const { error } = await supaAdmin.auth.admin.deleteUser(selfId);
      if (error) throw error;

      return json({ ok: true });
    }

    return err("Unknown op", 400);
  } catch (e) {
    return err(String(e?.message || e), 500);
  }
});