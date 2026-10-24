// Real GoTrue probe on a fresh database in the disposable Storage test stack.
// Never use production connections, users or credentials.
import { AuthClient } from "@supabase/supabase-js";
import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import postgres from "postgres";
const config = JSON.parse(await readFile("work/local-storage/connection.json", "utf8"));
const database = new URL(config.databaseUrl);
assert.equal(
  database.hostname,
  "127.0.0.1",
  "Only the isolated localhost test database is permitted",
);
assert.equal(database.port, "55442");
const run = randomUUID().replaceAll("-", ""),
  name = `pulse_auth_test_${run}`;
const container = `pulse-settings-auth-test-${run.slice(0, 12)}`;
const directory = `work/local-auth/${run}`;
await mkdir(directory, { recursive: true });
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
function docker(args, allowFailure = false) {
  const result = spawnSync("docker", ["--host=unix:///var/run/docker.sock", ...args], {
    env,
    encoding: "utf8",
  });
  if (result.status !== 0 && !allowFailure)
    throw new Error(`Isolated GoTrue Docker ${args[0]} failed`);
}
const admin = postgres(config.databaseUrl, { max: 1, onnotice: () => {} });
let target;
let created = false;
try {
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  database.pathname = `/${name}`;
  target = postgres(database.href, { max: 1 });
  await target.unsafe("CREATE SCHEMA auth; CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await target.end();
  target = undefined;
  database.hostname = "db";
  database.port = "5432";
  // GoTrue's migration and request queries both require the auth search path.
  database.searchParams.set("search_path", "auth,public");
  const values = {
    GOTRUE_DB_DRIVER: "postgres",
    GOTRUE_DB_DATABASE_URL: database.href,
    GOTRUE_SITE_URL: "http://127.0.0.1:4185",
    API_EXTERNAL_URL: "http://127.0.0.1:56439",
    GOTRUE_API_HOST: "0.0.0.0",
    GOTRUE_API_PORT: "9999",
    GOTRUE_JWT_SECRET: config.secret,
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_JWT_ADMIN_ROLES: "service_role",
    GOTRUE_EXTERNAL_EMAIL_ENABLED: "true",
    GOTRUE_MAILER_AUTOCONFIRM: "true",
    GOTRUE_DISABLE_SIGNUP: "false",
    GOTRUE_LOG_LEVEL: "error",
  };
  const envPath = `${directory}/auth.env`;
  await writeFile(
    envPath,
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    { mode: 0o600 },
  );
  docker([
    "run",
    "-d",
    "--name",
    container,
    "--network",
    "pulse-settings-storage-test",
    "-p",
    "127.0.0.1:56439:9999",
    "--env-file",
    envPath,
    "ghcr.io/supabase/gotrue:v2.197.0",
  ]);
  created = true;
  docker(["network", "connect", "pulse-settings-storage-test-loopback", container]);
  const url = "http://127.0.0.1:56439";
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
      ready = response.ok;
      await response.body?.cancel();
      if (ready) break;
    } catch {
      /* Service is migrating the fresh local database. */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(ready, "Isolated GoTrue must be healthy");
  const client = new AuthClient({ url, persistSession: false, autoRefreshToken: false });
  const email = `finish-${randomUUID()}@test.invalid`,
    password = randomBytes(24).toString("base64url"),
    results = [];
  const signup = await client.signUp({ email, password });
  assert.ifError(signup.error);
  assert.ok(signup.data.session);
  const owner = signup.data.user.id;
  results.push({ case: "email signup with local auto-confirm", result: "pass" });
  const login = await client.signInWithPassword({ email, password });
  assert.ifError(login.error);
  assert.equal(login.data.user.id, owner);
  results.push({ case: "password sign-in", result: "pass" });
  const claims = await client.getClaims(login.data.session.access_token);
  assert.ifError(claims.error);
  assert.equal(claims.data.claims.sub, owner);
  results.push({ case: "SDK getClaims with actual GoTrue-issued JWT", result: "pass" });
  const refresh = await client.refreshSession({ refresh_token: login.data.session.refresh_token });
  assert.ifError(refresh.error);
  assert.equal(refresh.data.user.id, owner);
  results.push({ case: "refresh and same-owner session", result: "pass" });
  const parts = refresh.data.session.access_token.split(".");
  parts[2] = Buffer.from("invalid-signature").toString("base64url");
  const bad = await client.getClaims(parts.join("."));
  assert.ok(bad.error);
  results.push({ case: "tampered JWT rejected", result: "pass" });
  const expiredHeader = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
    "base64url",
  );
  const expiredBody = Buffer.from(
    JSON.stringify({ sub: owner, role: "authenticated", exp: 1 }),
  ).toString("base64url");
  const expired = await client.getClaims(`${expiredHeader}.${expiredBody}.invalid`);
  assert.ok(expired.error);
  results.push({ case: "expired JWT rejected", result: "pass" });
  const wrong = await client.signInWithPassword({ email, password: password + "wrong" });
  assert.ok(wrong.error);
  results.push({ case: "wrong password rejected", result: "pass" });
  const logout = await client.signOut();
  assert.ifError(logout.error);
  const revoked = await client.refreshSession({
    refresh_token: refresh.data.session.refresh_token,
  });
  assert.ok(revoked.error);
  results.push({ case: "logout revokes refresh session", result: "pass" });

  await writeFile(
    "work/local-auth/results.json",
    JSON.stringify(
      {
        production: false,
        goTrue: "v2.197.0",
        fullApplicationMiddleware: false,
        localDatabaseRetained: name,
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
} finally {
  if (created) docker(["rm", "-f", container], true);
  if (target) await target.end({ timeout: 2 });
  await admin.end({ timeout: 2 });
  // The uniquely named local database is retained for inspection. Never reset or drop shared data.
}
