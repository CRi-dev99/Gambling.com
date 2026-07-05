import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser client does not mutate credits directly", async () => {
  const app = await readFile(new URL("../static/js/app.js", import.meta.url), "utf8");
  const client = await readFile(new URL("../static/js/supabaseClient.js", import.meta.url), "utf8");
  const admin = await readFile(new URL("../static/js/admin.js", import.meta.url), "utf8");

  assert.equal(app.includes("updateProfileCredits"), false);
  assert.equal(app.includes("logGameRound"), false);
  assert.equal(client.includes(".from(\"profiles\")\n    .update"), false);
  assert.equal(client.includes(".from(\"game_history\").insert"), false);
  assert.equal(client.includes(".from(\"multiplayer_tables\").insert"), false);
  assert.equal(client.includes(".from(\"multiplayer_table_state\")"), false);
  assert.equal(client.includes("functions.invoke(\"play-game\""), true);
  assert.equal(admin.includes("supabase.from("), false);
  assert.equal(admin.includes(".from(\"profiles\")"), false);
  assert.equal(admin.includes(".from(\"game_history\")"), false);
  assert.equal(admin.includes(".from(\"admin_audit_log\")"), false);
  assert.equal(admin.includes("SERVICE_ROLE"), false);
  assert.equal(admin.includes("ADMIN_PASSWORD"), false);
});

test("multiplayer create reads form values before pending rerender", async () => {
  const app = await readFile(new URL("../static/js/app.js", import.meta.url), "utf8");
  const createStart = app.indexOf("async function createMultiplayerTableFromUi()");
  const createEnd = app.indexOf("async function joinMultiplayerByCodeFromUi()");
  const block = app.slice(createStart, createEnd);

  assert.ok(createStart > -1);
  assert.ok(block.indexOf("const stake = Number(elements.gameRoot.querySelector(\"#mpStake\")") < block.indexOf("await transitionMultiplayer"));
  assert.ok(block.indexOf("const maxPlayers = Number(elements.gameRoot.querySelector(\"#mpMaxPlayers\")") < block.indexOf("await transitionMultiplayer"));
  assert.ok(block.indexOf("const visibility = elements.gameRoot.querySelector(\"#mpVisibility\")") < block.indexOf("await transitionMultiplayer"));
  assert.ok(block.indexOf("const diceMode = elements.gameRoot.querySelector(\"#mpDiceMode\")") < block.indexOf("await transitionMultiplayer"));
});

test("html avoids ineffective meta frame-ancestors and supplies favicon", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../static/js/app.js", import.meta.url), "utf8");

  assert.equal(html.includes("frame-ancestors"), false);
  assert.equal(html.includes("rel=\"icon\""), true);
  assert.equal(html.includes("admin.html"), false);
  assert.equal(app.includes("admin:"), false);
});

test("database schema blocks direct client credit writes", async () => {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");

  assert.equal(/create\s+policy\s+"profiles_update_own"/i.test(schema), false);
  assert.equal(/create\s+policy\s+"history_insert_own"/i.test(schema), false);
  assert.equal(schema.includes("grant select on public.profiles to authenticated"), true);
  assert.equal(schema.includes("grant select on public.game_history to authenticated"), true);
  assert.equal(schema.includes("revoke insert, update, delete on public.profiles from anon, authenticated"), true);
  assert.equal(schema.includes("revoke insert, update, delete on public.game_history from anon, authenticated"), true);
  assert.equal(schema.includes("revoke all on public.game_sessions from anon, authenticated"), true);
  assert.equal(schema.includes("revoke execute on function public.create_game_session"), true);
  assert.equal(schema.includes("revoke execute on function public.apply_game_step"), true);
});

test("database RPCs avoid ambiguous profile and session identifiers", async () => {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");

  assert.equal(schema.includes("on conflict (id)"), false);
  assert.equal(schema.includes("on conflict on constraint profiles_pkey do nothing"), true);
  assert.equal(schema.includes("where game_sessions.id = p_session_id"), true);
  assert.equal(schema.includes("version = game_sessions.version + 1"), true);
});

test("multiplayer schema keeps private state and writes server-owned", async () => {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");

  assert.equal(schema.includes("create table if not exists public.multiplayer_tables"), true);
  assert.equal(schema.includes("create table if not exists public.multiplayer_table_seats"), true);
  assert.equal(schema.includes("create table if not exists public.multiplayer_table_state"), true);
  assert.equal(schema.includes("revoke all on public.multiplayer_table_state from anon, authenticated"), true);
  assert.equal(schema.includes("revoke insert, update, delete on public.multiplayer_tables from anon, authenticated"), true);
  assert.equal(schema.includes("revoke insert, update, delete on public.multiplayer_table_seats from anon, authenticated"), true);
  assert.equal(schema.includes("apply_multiplayer_credit_entries"), true);
  assert.equal(schema.includes("revoke execute on function public.apply_multiplayer_credit_entries"), true);
  assert.equal(schema.includes("create or replace function public.start_multiplayer_table_round"), true);
  assert.equal(schema.includes("create or replace function public.apply_multiplayer_table_step"), true);
  assert.equal(schema.includes("for update"), true);
});

test("edge function owns gameplay and atomic credit application", async () => {
  const edge = await readFile(new URL("../supabase/functions/play-game/index.ts", import.meta.url), "utf8");

  assert.equal(edge.includes("SUPABASE_SERVICE_ROLE_KEY"), true);
  assert.equal(edge.includes("create_game_session"), true);
  assert.equal(edge.includes("apply_game_step"), true);
  assert.equal(edge.includes("crypto.getRandomValues"), true);
  assert.equal(edge.includes("updateProfileCredits"), false);
  assert.equal(edge.includes("publicErrorMessage"), true);
});

test("edge function owns multiplayer matchmaking and settlement", async () => {
  const edge = await readFile(new URL("../supabase/functions/play-game/index.ts", import.meta.url), "utf8");

  assert.equal(edge.includes("multiplayer:create"), true);
  assert.equal(edge.includes("multiplayer:join"), true);
  assert.equal(edge.includes("multiplayer:timeout"), true);
  assert.equal(edge.includes("TURN_TIMEOUT_SECONDS"), true);
  assert.equal(edge.includes("start_multiplayer_table_round"), true);
  assert.equal(edge.includes("apply_multiplayer_table_step"), true);
  assert.equal(edge.includes("multiplayer_table_state"), true);
  assert.equal(edge.includes("settleMultiplayerTable"), false);
});

test("edge function stores viewer-neutral multiplayer public state", async () => {
  const edge = await readFile(new URL("../supabase/functions/play-game/index.ts", import.meta.url), "utf8");

  assert.equal(edge.includes("function multiplayerStoredPublicState"), true);
  assert.equal(edge.includes("return multiplayerPublicState(state, table, seats, null);"), true);
  assert.equal(edge.includes("p_public_state: storedPublicState"), true);
});

test("admin schema is service-role-only", async () => {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");

  assert.equal(schema.includes("create table if not exists public.admin_audit_log"), true);
  assert.equal(schema.includes("create table if not exists public.admin_game_overrides"), true);
  assert.equal(schema.includes("alter table public.admin_audit_log enable row level security"), true);
  assert.equal(schema.includes("alter table public.admin_game_overrides enable row level security"), true);
  assert.equal(schema.includes("grant select, insert, update, delete on public.admin_audit_log to service_role"), true);
  assert.equal(schema.includes("grant select, insert, update, delete on public.admin_game_overrides to service_role"), true);
  assert.equal(schema.includes("revoke all on public.admin_audit_log from anon, authenticated"), true);
  assert.equal(schema.includes("revoke all on public.admin_game_overrides from anon, authenticated"), true);
});

test("admin edge requests require server-side token checks", async () => {
  const edge = await readFile(new URL("../supabase/functions/play-game/index.ts", import.meta.url), "utf8");

  assert.equal(edge.includes("ADMIN_EMAILS"), true);
  assert.equal(edge.includes("ADMIN_TOKEN_SECRET"), true);
  assert.equal(edge.includes("admin:login"), true);
  assert.equal(edge.includes("requireAdminUser"), true);
  assert.equal(edge.includes("admin:credits:update"), true);
  assert.equal(edge.includes("admin:game-control:set"), true);
  assert.equal(edge.includes("admin:tables:force-timeout"), true);
});
