// supabase/functions/sygn1l-admin/index.ts
//
// Sygn1L Admin Edge Function
// - list_users: list auth users (master-only)
// - delete_save: delete a user's save row(s) (master-only)
// - delete_user: delete auth user + save row(s) (master-only)
// - delete_self: delete caller's auth user + save row(s) (signed-in users allowed)
//
// Mobile/Safari hardened:
// - CORS + OPTIONS preflight
// - Accepts multiple payload shapes
// - Deletes saves even if your save key isn't player_id

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type AnyBody = Record<string, any>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders },
  });
}

function err(message: string, status = 400, extra?: unknown) {
  return json({ ok: false, error: message, ...(extra ? { extra } : {}) }, status);
}

function getNested(body: AnyBody, keys: string[], fallback: any = undefined) {
  for (const k of keys) {
    if (body && Object.prototype.hasOwnProperty.call(body, k)) return body[k];
  }
  for (const wrap of ["payload", "data", "args"]) {
    const w = body?.[wrap];
    if (!w) continue;
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(w, k)) return w[k];
    }
  }
  return fallback;
}

function getOp(body: AnyBody): string {
  return String(getNested(body, ["op", "action", "cmd"], "") || "").trim();
}

function getId(body: AnyBody): string {
  return String(getNested(body, ["id", "user_id", "uid"], "") || "").trim();
}

function getPage(body: AnyBody): number {
  const v = Number(getNested(body, ["page"], 1));
  return Number.isFinite(v) ? Math.max(1, Math.floor(v)) : 1;
}

function getPerPage(body: AnyBody): number {
  const v = Number(getNested(body, ["per_page", "perPage", "limit"], 25));
  const n = Number.isFinite(v) ? Math.floor(v) : 25;
  return Math.min(100, Math.max(1, n));
}

function getQuery(body: AnyBody): string {
  return String(getNested(body, ["q", "query", "search"], "") || "").trim();
}

async function deleteSaveRowAnyColumn(supaAdmin: any, userId: string) {
  // Try common save ownership columns
  const attempts = [
    { table: "saves", col: "player_id" },
    { table: "saves", col: "user_id" },
    { table: "saves", col: "id" },
  ];

  let deleted = 0;
  const errors: string[] = [];
  const details: { table: string; col: string; count?: number }[] = [];

  for (const a of attempts) {
    const { error, count } = await supaAdmin
      .from(a.table)
      .delete({ count: "exact" })
      .eq(a.col, userId);

    if (error) {
      errors.push(`${a.table}.${a.col}: ${error.message}`);
      continue;
    }

    if (typeof count === "number") {
      deleted += count;
      details.push({ table: a.table, col: a.col, count });
    } else {
      details.push({ table: a.table, col: a.col });
    }
  }

  return { deleted, errors, details };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    // Supabase blocks custom secrets with SUPABASE_ prefix, so we use SERVICE_ROLE_KEY
    const serviceKey =
  Deno.env.get("SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const masterEmail = Deno.env.get("SYGN1L_MASTER_EMAIL"); // recommended
    const masterUserId = Deno.env.get("SYGN1L_MASTER_USER_ID"); // optional

    if (!url) return err("Missing SUPABASE_URL", 500);
    if (!serviceKey) return err("Missing SERVICE_ROLE_KEY", 500);

    const supaAdmin = createClient(url, serviceKey);

    // Require caller auth
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return err("Missing Authorization", 401);

    // Validate bearer token (using service role)
    const supaAuth = createClient(url, serviceKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supaAuth.auth.getUser();
    if (userErr || !userData?.user) return err("Unauthorized", 401);

    const caller = userData.user;
    const callerEmail = (caller.email || "").toLowerCase();
    const callerId = caller.id || "";

    let body: AnyBody = {};
    try {
      body = (await req.json()) as AnyBody;
    } catch {
      body = {};
    }

    const op = getOp(body);
    if (!op) return err("Missing op", 400);

    const isMaster =
      (masterUserId && callerId === masterUserId) ||
      (masterEmail && callerEmail === masterEmail.toLowerCase());

    const isAdminOp = op === "list_users" || op === "delete_user" || op === "delete_save";
    if (isAdminOp && !isMaster) {
      return err("Forbidden: not master account", 403, { callerEmail, callerId });
    }

    if (op === "list_users") {
      const page = getPage(body);
      const perPage = getPerPage(body);
      const q = getQuery(body).toLowerCase();

      const { data, error } = await supaAdmin.auth.admin.listUsers({ page, perPage });
      if (error) return err(`listUsers failed: ${error.message}`, 500);

      let users = data?.users || [];
      if (q) {
        users = users.filter((u: any) => {
          const email = String(u.email || "").toLowerCase();
          const id = String(u.id || "").toLowerCase();
          return email.includes(q) || id.includes(q);
        });
      }

      return json({
        ok: true,
        users: users.map((u: any) => ({
          id: u.id,
          email: u.email,
          created_at: u.created_at,
        })),
        total: (data as any)?.total ?? null,
        page,
        per_page: perPage,
        q,
      });
    }

    if (op === "delete_save") {
      const id = getId(body);
      if (!id) return err("Missing id", 400);

      const res = await deleteSaveRowAnyColumn(supaAdmin, id);
      return json({
        ok: true,
        id,
        save_deleted_rows: res.deleted,
        save_delete_attempts: res.details,
        save_delete_errors: res.errors,
      });
    }

    if (op === "delete_user") {
      const id = getId(body);
      if (!id) return err("Missing id", 400);

      const saveRes = await deleteSaveRowAnyColumn(supaAdmin, id);

      const { error } = await supaAdmin.auth.admin.deleteUser(id);
      if (error) return err(`deleteUser failed: ${error.message}`, 500, { id });

      return json({
        ok: true,
        id,
        user_deleted: true,
        save_deleted_rows: saveRes.deleted,
        save_delete_attempts: saveRes.details,
        save_delete_errors: saveRes.errors,
      });
    }

    if (op === "delete_self") {
      const selfId = callerId;
      if (!selfId) return err("Missing caller id", 500);

      const saveRes = await deleteSaveRowAnyColumn(supaAdmin, selfId);

      const { error } = await supaAdmin.auth.admin.deleteUser(selfId);
      if (error) return err(`deleteSelf failed: ${error.message}`, 500, { id: selfId });

      return json({
        ok: true,
        id: selfId,
        user_deleted: true,
        save_deleted_rows: saveRes.deleted,
        save_delete_attempts: saveRes.details,
        save_delete_errors: saveRes.errors,
      });
    }

    return err("Unknown op", 400, { op });
  } catch (e) {
    return err(String((e as any)?.message || e), 500);
  }
});