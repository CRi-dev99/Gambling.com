import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("browser client does not mutate credits directly", async () => {
  const app = await readFile(new URL("../static/js/app.js", import.meta.url), "utf8");
  const client = await readFile(new URL("../static/js/supabaseClient.js", import.meta.url), "utf8");

  assert.equal(app.includes("updateProfileCredits"), false);
  assert.equal(app.includes("logGameRound"), false);
  assert.equal(client.includes(".from(\"profiles\")\n    .update"), false);
  assert.equal(client.includes(".from(\"game_history\").insert"), false);
  assert.equal(client.includes("functions.invoke(\"play-game\""), true);
});

test("database schema blocks direct client credit writes", async () => {
  const schema = await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8");

  assert.equal(/create\s+policy\s+"profiles_update_own"/i.test(schema), false);
  assert.equal(/create\s+policy\s+"history_insert_own"/i.test(schema), false);
  assert.equal(schema.includes("revoke insert, update, delete on public.profiles from anon, authenticated"), true);
  assert.equal(schema.includes("revoke insert, update, delete on public.game_history from anon, authenticated"), true);
  assert.equal(schema.includes("revoke all on public.game_sessions from anon, authenticated"), true);
});

test("edge function owns gameplay and atomic credit application", async () => {
  const edge = await readFile(new URL("../supabase/functions/play-game/index.ts", import.meta.url), "utf8");

  assert.equal(edge.includes("SUPABASE_SERVICE_ROLE_KEY"), true);
  assert.equal(edge.includes("create_game_session"), true);
  assert.equal(edge.includes("apply_game_step"), true);
  assert.equal(edge.includes("crypto.getRandomValues"), true);
  assert.equal(edge.includes("updateProfileCredits"), false);
});
