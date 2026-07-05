const config = window.GAMBLING_SUPABASE || {};

export const isSupabaseConfigured =
  typeof config.url === "string" &&
  typeof config.anonKey === "string" &&
  config.url.startsWith("https://") &&
  !config.url.includes("YOUR_PROJECT_ID") &&
  !config.anonKey.includes("YOUR_SUPABASE_ANON_KEY") &&
  Boolean(window.supabase?.createClient);

export const startingCredits = Number(config.startingCredits || 1000);

export function createSupabaseBrowserClient(options = {}) {
  if (!isSupabaseConfigured) return null;
  return window.supabase.createClient(config.url, config.anonKey, options);
}

let casinoSupabase = null;

function getCasinoSupabase() {
  if (!casinoSupabase) casinoSupabase = createSupabaseBrowserClient();
  return casinoSupabase;
}

export async function getCurrentSession() {
  const supabase = getCasinoSupabase();
  if (!supabase) return { session: null, error: null };
  const { data, error } = await supabase.auth.getSession();
  return { session: data?.session || null, error };
}

export function onAuthChange(callback) {
  const supabase = getCasinoSupabase();
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

export async function signIn(email, password) {
  const supabase = getCasinoSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password, username) {
  const supabase = getCasinoSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = getCasinoSupabase();
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function ensureProfile(user) {
  const supabase = getCasinoSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  let { data: existing, error: selectError } = await supabase
    .from("profiles")
    .select("id, username, credits, avatar_url")
    .eq("id", user.id)
    .maybeSingle();

  if (selectError && String(selectError.message || "").includes("avatar_url")) {
    const fallback = await supabase
      .from("profiles")
      .select("id, username, credits")
      .eq("id", user.id)
      .maybeSingle();
    existing = fallback.data;
    selectError = fallback.error;
  }

  if (selectError) throw selectError;
  if (existing) return normalizeProfile(existing);

  const data = await invokeGameServer({ type: "profile" });
  return normalizeProfile(data.profile);
}

export async function playGameServer(payload) {
  const data = await invokeGameServer(payload);
  return {
    ...data,
    profile: normalizeProfile(data.profile)
  };
}

export async function multiplayerRequest(payload) {
  const data = await invokeGameServer(payload);
  return {
    ...data,
    profile: data.profile ? normalizeProfile(data.profile) : undefined
  };
}

export async function updateProfileAvatar(avatarUrl) {
  const data = await invokeGameServer({ type: "profile:update", avatarUrl });
  return normalizeProfile(data.profile);
}

export async function getLeaderboard(limit = 25) {
  const data = await invokeGameServer({ type: "leaderboard", limit });
  return {
    leaders: (data.leaders || []).map((leader) => ({
      ...normalizeProfile(leader),
      rank: Number(leader.rank || 0)
    }))
  };
}

export function subscribeToMultiplayerTable(tableId, callback) {
  const supabase = getCasinoSupabase();
  if (!supabase || !tableId) return () => {};

  const channel = supabase
    .channel(`multiplayer-table:${tableId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "multiplayer_tables", filter: `id=eq.${tableId}` },
      callback
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "multiplayer_table_seats", filter: `table_id=eq.${tableId}` },
      callback
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

async function invokeGameServer(payload) {
  const supabase = getCasinoSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data, error } = await supabase.functions.invoke("play-game", {
    body: payload
  });
  if (error) throw new Error(await functionErrorMessage(error));
  if (data?.error) throw new Error(data.error);
  return data;
}

async function functionErrorMessage(error) {
  const fallback = error?.message || "Edge Function request failed.";
  const response = error?.context;
  if (!response || typeof response.clone !== "function") return fallback;

  try {
    const body = await response.clone().json();
    return body?.error || body?.message || fallback;
  } catch {
    return fallback;
  }
}

function normalizeProfile(rawProfile) {
  return {
    ...rawProfile,
    credits: normalizeCredits(rawProfile?.credits),
    avatarUrl: rawProfile?.avatarUrl || rawProfile?.avatar_url || ""
  };
}

function normalizeCredits(value) {
  const credits = Number(value);
  if (!Number.isFinite(credits)) return startingCredits;
  return Math.round(credits * 100) / 100;
}
