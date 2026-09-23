import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

const response = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return response({ error: "Méthode non autorisée." }, 405);

  try {

  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return response({ error: "Non authentifié." }, 401);
  const service = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: userData, error: userError } = await service.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) return response({ error: "Non authentifié." }, 401);

  const { data: profile } = await service
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!profile?.is_admin) return response({ error: "Accès administrateur requis." }, 403);

  const body = await request.json().catch(() => ({}));

  if (body.action === "list") {
    const users = [];
    for (let page = 1; ; page += 1) {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
      if (error) return response({ error: error.message }, 400);
      if (!data.users.length) break;
      const { data: profiles, error: profilesError } = await service.from("profiles")
        .select("id,full_name,account_type,is_admin").in("id", data.users.map((account) => account.id));
      if (profilesError) return response({ error: profilesError.message }, 400);
      const profileMap = new Map((profiles || []).map((account) => [account.id, account]));
      users.push(...data.users.map((account) => ({
        id: account.id,
        email: account.email,
        created_at: account.created_at,
        last_sign_in_at: account.last_sign_in_at,
        full_name: profileMap.get(account.id)?.full_name || "",
        account_type: profileMap.get(account.id)?.account_type || "coach",
        is_admin: Boolean(profileMap.get(account.id)?.is_admin),
      })));
      if (data.users.length < 200) break;
    }
    return response({ users });
  }

  if (body.action === "delete") {
    if (!body.user_id || body.user_id === user.id) return response({ error: "Tu ne peux pas supprimer ton propre compte ici." }, 400);
    if (typeof body.user_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.user_id)) return response({ error: "Compte invalide." }, 400);
    const { error } = await service.auth.admin.deleteUser(body.user_id);
    if (error) return response({ error: error.message }, 400);
    return response({ ok: true });
  }

  if (body.action === "reset_password") {
    if (typeof body.user_id !== "string" || !/^[0-9a-f-]{36}$/i.test(body.user_id)) return response({ error: "Compte invalide." }, 400);
    const { data: target, error: targetError } = await service.auth.admin.getUserById(body.user_id);
    if (targetError || !target.user?.email) return response({ error: "Ce membre est introuvable." }, 404);
    // Canonical destination is server-controlled; no caller-supplied reset-token redirect.
    // Set APP_URL when hosting the app elsewhere and allow this URL in Supabase Auth.
    const appUrl = (Deno.env.get("APP_URL") || "https://mixmasterkd.github.io/gestionboxeur/").replace(/\/?$/, "/");
    const redirectTo = new URL("login.html?mode=recovery", appUrl).href;
    const { error } = await service.auth.resetPasswordForEmail(target.user.email, { redirectTo });
    if (error) return response({ error: error.message }, 400);
    return response({ ok: true });
  }

  if (body.action === "athlete_test_session") {
    // The authenticated admin can only enter their server-owned dedicated athlete.
    // Never accept a target user ID, email or password from the caller.
    const { data: mapping, error: mappingError } = await service.from("admin_test_accounts")
      .select("test_user_id").eq("admin_id", user.id).maybeSingle();
    if (mappingError) return response({ error: "Le compte athlète de test nécessite l’activation de la mise à jour de la plateforme." }, 409);
    let testUserId = mapping?.test_user_id;
    const email = `athlete-test-${user.id}@gestionboxeur.test`;
    if (!testUserId) {
      const { data: created, error: createError } = await service.auth.admin.createUser({
        email, password: `${crypto.randomUUID()}-${crypto.randomUUID()}!`, email_confirm: true,
        app_metadata: { is_test_athlete: true, test_admin_id: user.id },
        user_metadata: { full_name: "Athlète test", first_name: "Athlète", last_name: "test", account_type: "athlete", birth_date: "2000-01-01", sex: "M", weight_kg: 70, weight_unit: "kg", fights: 0, wins: 0, losses: 0 },
      });
      if (createError) {
        // Recover a simultaneous creation or a previous attempt interrupted before mapping.
        if (!/already|registered|exists/i.test(createError.message)) return response({ error: createError.message }, 400);
        for (let page = 1; !testUserId; page++) {
          const { data: accounts, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
          if (error) throw error;
          testUserId = accounts.users.find(account => account.email === email && account.app_metadata?.test_admin_id === user.id)?.id;
          if (accounts.users.length < 200) break;
        }
        if (!testUserId) return response({ error: "Impossible de retrouver le compte athlète de test." }, 409);
      } else testUserId = created.user.id;
      const { error } = await service.from("admin_test_accounts").upsert({ admin_id: user.id, test_user_id: testUserId }, { onConflict: "admin_id" });
      if (error) throw error;
    }
    const { data: account, error: accountError } = await service.auth.admin.getUserById(testUserId);
    const { data: testProfile, error: profileError } = await service.from("profiles").select("account_type,is_admin").eq("id", testUserId).single();
    if (accountError || profileError || account.user?.app_metadata?.test_admin_id !== user.id || account.user?.app_metadata?.is_test_athlete !== true || testProfile?.account_type !== "athlete" || testProfile?.is_admin) {
      return response({ error: "Ce compte ne peut pas être utilisé comme athlète de test." }, 403);
    }
    const { data: athlete, error: athleteError } = await service.from("athletes").select("id").eq("user_id", testUserId).single();
    if (athleteError) throw athleteError;
    const { error: coachError } = await service.from("coach_profiles").upsert({ user_id: user.id, display_name: user.user_metadata?.full_name || "Coach" }, { onConflict: "user_id", ignoreDuplicates: true });
    if (coachError) throw coachError;
    const { error: linkError } = await service.from("coach_athletes").upsert({ coach_id: user.id, athlete_id: athlete.id, status: "accepted", can_view_calendar: true, can_add_sessions: true, can_edit_own_sessions: true, can_view_feedback: true }, { onConflict: "coach_id,athlete_id", ignoreDuplicates: true });
    if (linkError) throw linkError;
    const { data: link, error: linkFailure } = await service.auth.admin.generateLink({ type: "magiclink", email: account.user.email! });
    if (linkFailure || !link.properties?.hashed_token) return response({ error: "Impossible de préparer la connexion athlète de test." }, 400);
    return response({ user_id: testUserId, token_hash: link.properties.hashed_token });
  }

  return response({ error: "Action inconnue." }, 400);
  } catch (error) {
    console.error("admin-users", error instanceof Error ? error.message : "Unexpected failure");
    return response({ error: "Le service de gestion des comptes est temporairement indisponible." }, 500);
  }
});
