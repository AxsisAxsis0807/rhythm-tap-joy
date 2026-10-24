import { spawnSync } from "node:child_process";
import { randomBytes, createHmac } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
mkdirSync("work/local-storage", { recursive: true });
const env = { ...process.env };
for (const key of [
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "DOCKER_CERT_PATH",
])
  delete env[key];
function docker(args, input) {
  const result = spawnSync("docker", ["--host=unix:///var/run/docker.sock", ...args], {
    env,
    input,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${args[0]} failed: ${result.stderr.slice(-1500)}`);
  return result.stdout;
}
const prefix = "pulse-settings-storage-test",
  secret = randomBytes(40).toString("base64url"),
  password = randomBytes(24).toString("hex");
function token(role) {
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    body = Buffer.from(
      JSON.stringify({
        role,
        iss: "supabase",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      }),
    ).toString("base64url");
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}
const anon = token("anon"),
  service = token("service_role");
// Recreates only this verifier's exact disposable container names. Never target a shared stack.
docker(["pull", "postgres:17-alpine"]);
for (const suffix of ["api", "rest", "db"]) {
  try {
    docker(["rm", "-fv", `${prefix}-${suffix}`]);
  } catch {}
}
try {
  docker(["network", "rm", prefix]);
} catch {}
docker(["network", "create", "--internal", prefix]);
docker([
  "run",
  "-d",
  "--name",
  `${prefix}-db`,
  "--network",
  prefix,
  "--network-alias",
  "db",
  "-p",
  "127.0.0.1:55442:5432",
  "-e",
  `POSTGRES_PASSWORD=${password}`,
  "postgres:17-alpine",
]);
for (let attempt = 0; attempt < 50; attempt++) {
  try {
    docker(["exec", `${prefix}-db`, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]);
    break;
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
const bootstrap = `CREATE ROLE anon NOLOGIN;CREATE ROLE authenticated NOLOGIN;CREATE ROLE service_role NOLOGIN BYPASSRLS;CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD '${password}';GRANT anon,authenticated,service_role TO authenticator;CREATE ROLE supabase_storage_admin LOGIN NOINHERIT PASSWORD '${password}';CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role')$$;GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;CREATE EXTENSION IF NOT EXISTS pgcrypto;`;
docker(
  ["exec", "-i", `${prefix}-db`, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
  bootstrap,
);
const postgresUrl = `postgresql://postgres:${password}@db:5432/postgres`;
const storageEnv = {
  ANON_KEY: anon,
  SERVICE_KEY: service,
  PGRST_JWT_SECRET: secret,
  AUTH_JWT_SECRET: secret,
  DATABASE_URL: postgresUrl,
  DATABASE_SEARCH_PATH: "storage",
  FILE_SIZE_LIMIT: "104857600",
  STORAGE_BACKEND: "file",
  FILE_STORAGE_BACKEND_PATH: "/var/lib/storage",
  TENANT_ID: "local",
  REGION: "local",
  GLOBAL_S3_BUCKET: "local",
  POSTGREST_URL: "http://rest:3000",
  ENABLE_IMAGE_TRANSFORMATION: "false",
  REQUEST_ALLOW_X_FORWARDED_PATH: "true",
};
writeFileSync(
  "work/local-storage/storage.env",
  Object.entries(storageEnv)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n"),
  { mode: 0o600 },
);
writeFileSync(
  "work/local-storage/rest.env",
  `PGRST_DB_URI=postgresql://authenticator:${password}@db:5432/postgres\nPGRST_DB_SCHEMAS=public\nPGRST_DB_ANON_ROLE=anon\nPGRST_JWT_SECRET=${secret}\n`,
  { mode: 0o600 },
);
docker([
  "run",
  "-d",
  "--name",
  `${prefix}-rest`,
  "--network",
  prefix,
  "--network-alias",
  "rest",
  "-p",
  "127.0.0.1:55443:3000",
  "--env-file",
  "work/local-storage/rest.env",
  "postgrest/postgrest:v16.4",
]);
docker([
  "run",
  "-d",
  "--name",
  `${prefix}-api`,
  "--network",
  prefix,
  "-p",
  "127.0.0.1:55441:5000",
  "--env-file",
  "work/local-storage/storage.env",
  "supabase/storage-api:v1.82.1",
]);
writeFileSync(
  "work/local-storage/connection.json",
  JSON.stringify({
    databaseUrl: `postgresql://postgres:${password}@127.0.0.1:55442/postgres`,
    storageUrl: "http://127.0.0.1:55441",
    restUrl: "http://127.0.0.1:55443",
    secret,
    anonKey: anon,
    serviceKey: service,
  }),
  { mode: 0o600 },
);
console.log(
  "Isolated PostgreSQL / Storage API / PostgREST containers created; connection file stays under ignored work/.",
);

// A bridge network activates the localhost-only published ports; the stack's
// internal network remains the database/API connection. No host networking.
const loopback = prefix + "-loopback";
try {
  docker(["network", "inspect", loopback]);
} catch {
  docker(["network", "create", loopback]);
}
for (const suffix of ["db", "rest", "api"])
  docker(["network", "connect", loopback, `${prefix}-${suffix}`]);
// storage.objects exists before Storage finishes its migration transaction.
// Waiting only for that table can race the baseline GRANT with migration DDL
// and deadlock in pg_class. The HTTP listener starts after migrations finish.
for (let attempt = 0; attempt < 100; attempt++) {
  let healthy = false;
  try {
    const response = await fetch("http://127.0.0.1:55441/status", {
      signal: AbortSignal.timeout(2000),
    });
    healthy = response.ok;
    await response.body?.cancel();
  } catch {
    // Connection refusal is expected while the isolated service migrates.
  }
  if (!healthy) {
    if (attempt === 99) throw new Error("Storage API did not become ready after migrations");
    await new Promise((resolve) => setTimeout(resolve, 500));
    continue;
  }
  const result = docker([
    "exec",
    `${prefix}-db`,
    "psql",
    "-At",
    "-U",
    "postgres",
    "-c",
    "SELECT to_regclass('storage.objects') IS NOT NULL",
  ]);
  if (result.trim() === "t") break;
  if (attempt === 99) throw new Error("Storage migrations did not initialize");
  await new Promise((resolve) => setTimeout(resolve, 200));
}
docker(
  ["exec", "-i", `${prefix}-db`, "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres"],
  "GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;GRANT ALL ON ALL TABLES IN SCHEMA storage TO anon,authenticated,service_role;",
);
console.log("Baseline Storage grants applied. Next run verify-song-settings-storage.mjs.");
