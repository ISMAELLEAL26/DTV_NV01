const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

import { createClient } from "npm:@supabase/supabase-js@2.57.4";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) throw new Error("server configuration unavailable");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data: { user: actor } } = await admin.auth.getUser(token);
    if (!actor) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: actorProfile } = await admin.from("profiles").select("role:roles(permissions)").eq("id", actor.id).maybeSingle();
    const permissions = (actorProfile?.role as { permissions?: string[] } | null)?.permissions ?? [];
    if (!permissions.includes("all")) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json() as { username?: string; pin?: string; fullName?: string; roleId?: string | null; branchId?: string | null; branchIds?: string[]; phone?: string | null; position?: string | null; avatarUrl?: string | null; dailyRate?: number; hoursPerDay?: number; hourlyRate?: number };
    const username = body.username?.trim().toUpperCase();
    const fullName = body.fullName?.trim();
    const pin = body.pin?.trim();
    if (!username || !/^[A-Z0-9_-]{3,32}$/.test(username) || !fullName || !pin || !/^\d{6}$/.test(pin)) {
      return new Response(JSON.stringify({ error: "Completa los datos requeridos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const email = `${username.toLowerCase()}@pos.local`;
    const { data: existingProfile } = await admin.from("profiles").select("id").ilike("username", username).maybeSingle();
    if (existingProfile) return new Response(JSON.stringify({ error: "Ese nombre de usuario ya existe" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: authUsers, error: authUsersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (authUsersError) throw authUsersError;
    if (authUsers.users.some((user) => user.email?.toLowerCase() === email.toLowerCase())) {
      return new Response(JSON.stringify({ error: "Ese usuario ya tiene una cuenta interna. Usa otro nombre de usuario." }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const temporaryPassword = `${crypto.randomUUID()}Aa9!`;
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { username, full_name: fullName } });
    if (createError || !created.user) {
      console.error("admin user creation failed", createError);
      const authMessage = createError?.message?.toLowerCase() ?? '';
      const message = authMessage.includes("already") || authMessage.includes("exists") ? "Ese usuario ya tiene una cuenta interna. Usa otro nombre de usuario." : `No se pudo crear la cuenta interna: ${createError?.message ?? 'revisa los datos'}.`;
      return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { error: pinError } = await admin.rpc("set_auth_user_pin", { p_user_id: created.user.id, p_pin: pin });
    if (pinError) {
      console.error("admin PIN setup failed", pinError);
      await admin.auth.admin.deleteUser(created.user.id);
      return new Response(JSON.stringify({ error: "No se pudo configurar el PIN del usuario" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { error: profileError } = await admin.from("profiles").update({ full_name: fullName, username, role_id: body.roleId ?? null, branch_id: body.branchIds?.[0] ?? body.branchId ?? null, phone: body.phone?.trim() || null, position: body.position?.trim() || null, avatar_url: body.avatarUrl?.trim() || null, daily_rate: Number(body.dailyRate ?? 0), hours_per_day: Number(body.hoursPerDay ?? 8), hourly_rate: Number(body.hourlyRate ?? 0), active: false }).eq("id", created.user.id);
    if (profileError) {
      console.error("admin profile setup failed", profileError);
      await admin.auth.admin.deleteUser(created.user.id);
      return new Response(JSON.stringify({ error: "No se pudo completar el registro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const branchIds = [...new Set((body.branchIds ?? (body.branchId ? [body.branchId] : [])).filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (branchIds.length > 0) {
      const { error: accessError } = await admin.from("user_branch_access").insert(branchIds.map((branchId) => ({ user_id: created.user.id, branch_id: branchId })));
      if (accessError) {
        console.error("admin branch access setup failed", accessError);
        await admin.auth.admin.deleteUser(created.user.id);
        return new Response(JSON.stringify({ error: "No se pudo completar el registro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ id: created.user.id }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (cause) {
    console.error("admin-create-user failed", cause);
    return new Response(JSON.stringify({ error: "No se pudo completar el registro" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
