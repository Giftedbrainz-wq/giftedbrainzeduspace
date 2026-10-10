/* Gifted Brainz EduSpace — API core (EdgeOne Pages Node Function).
 *
 * This module is platform-agnostic apart from one storage adapter: it talks to
 * Supabase Postgres through the small storage facade below, and it is mounted
 * by node-functions/api/[[default]].js (all /api/* routes) and
 * node-functions/api/index.js (/api itself).
 *
 * Runtime: EdgeOne Pages **Node** Functions. Node built-ins (node:crypto,
 * node:zlib, Buffer, node:fs) are available there; they are NOT available in
 * EdgeOne Edge Functions, which is why this project must stay in
 * node-functions/ and must never be moved to edge-functions/.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import { AsyncLocalStorage } from "node:async_hooks";
import { seed } from "./seed.js";

/* ------------------------------------------------------------------
   Request context bridge.

   EdgeOne Pages hands each request a single `context` object rather than
   Netlify's (request, context) pair. Environment variables live on
   `context.env` and the client IP on `context.clientIp`, so the entry point
   calls bindContext() once per request and everything below reads through
   env() / clientIp() instead of touching process.env directly.
------------------------------------------------------------------- */
const REQUEST_CONTEXT = new AsyncLocalStorage();
function makeRequestContext(context) {
  return {
    env: context && context.env && typeof context.env === "object" ? context.env : null,
    clientIp: String(context?.clientIp || context?.request?.eo?.clientIp || "").trim(),
    method: String(context?.request?.method || "GET").toUpperCase()
  };
}
export function bindContext(context) {
  // Kept as a compatibility helper for callers that still bind context before
  // invoking the handler. New route entry points use runWithContext(), which
  // makes the context request-local and safe when 300+ requests share one
  // warm Node process concurrently.
  const requestContext = makeRequestContext(context);
  globalThis.__gbGetStore = () => storeFacade;
  return requestContext;
}
export function runWithContext(context, fn) {
  const requestContext = makeRequestContext(context);
  globalThis.__gbGetStore = () => storeFacade;
  return REQUEST_CONTEXT.run(requestContext, fn);
}
function requestContext() {
  return REQUEST_CONTEXT.getStore() || null;
}
function env(name) {
  const scoped = requestContext()?.env;
  const fromContext = scoped ? scoped[name] : undefined;
  if (fromContext !== undefined && fromContext !== null && fromContext !== "") return String(fromContext);
  const fromProcess = typeof process !== "undefined" && process.env ? process.env[name] : undefined;
  return fromProcess === undefined || fromProcess === null ? "" : String(fromProcess);
}
function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(env(name));
}

var SUBJECTS = ["Mathematics", "Use of English", "Physics", "Chemistry", "Biology"];
var REQUIRED_REGISTRATION_SUBJECT = "Use of English";
var MAX_SELECTED_SUBJECTS = 4;
const CORE_SUBJECT_DEFS = [
  { name: "Mathematics", icon: "➗" },
  { name: "Use of English", icon: "📘" },
  { name: "Physics", icon: "⚡" },
  { name: "Chemistry", icon: "🧪" },
  { name: "Biology", icon: "🌿" }
];
const API_ERROR = {
  SESSION_EXPIRED: "Your session has expired. Please sign in again.",
  UNAUTHORIZED: "You do not have permission to perform this action.",
  CENTRAL_DATABASE: "Unable to connect to the central database. Please try again."
};
const sessionExpiredError = () => ({ error: API_ERROR.SESSION_EXPIRED, code: "SESSION_EXPIRED" });
const unauthorizedError = (extra = {}) => ({ error: API_ERROR.UNAUTHORIZED, code: "UNAUTHORIZED", ...extra });
const activationError = (kind = "material") => ({ error: `This ${kind} is available to activated students. Activate your account for ₦${ACTIVATION_PRICE_NAIRA.toLocaleString("en-NG")}.`, code: "ACTIVATION_REQUIRED", activationPrice: ACTIVATION_PRICE_NAIRA });
function normaliseSelectedSubjects(value) {
  const arr = Array.isArray(value) ? value.map(v => cleanString(v, 80)) : [];
  return [...new Set(arr)].filter(Boolean).filter(x => SUBJECTS.includes(x));
}
function validateSelectedSubjects(value) {
  const subjects = normaliseSelectedSubjects(value);
  if (!subjects.includes(REQUIRED_REGISTRATION_SUBJECT)) return { error: "Use of English is compulsory." };
  if (subjects.length > MAX_SELECTED_SUBJECTS) return { error: "You can select a maximum of 4 subjects, including Use of English." };
  return { subjects };
}
var CONTENT_PACK_VERSION = "2026.08.16-content-7-final";
var CONTENT_PACK = {
  version: CONTENT_PACK_VERSION,
  subjects: SUBJECTS,
  notes: seed.notes || [],
  tests: seed.tests || [],
  questionBank: seed.questionBank || [],
  announcements: seed.announcements || []
};
// EdgeOne Makers Node Functions have a 1 MB request-body limit. Uploads use
// base64 inside JSON, which expands the binary by about 4/3, so keep each
// binary chunk at 512 KiB to leave room for JSON/request overhead.
var MAX_CHUNK = 512 * 1024;
var TOKEN_TTL = 12 * 60 * 60;
var STUDENT_SESSION_TTL = 30 * 24 * 60 * 60;
var STUDENT_SESSION_COOKIE = "gb_session";
var ACTIVATION_PRICE_NAIRA = 3000;
function normaliseBuffer(value) {
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(String(value ?? ""), "utf8");
}
function decodeBuffer(buf, type) {
  if (type === "arrayBuffer") return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  if (type === "json") return JSON.parse(buf.toString("utf8"));
  return buf.toString("utf8");
}
/* Supabase Postgres KV store.
 *
 * Supabase is the production source of truth for all persistent EduSpace data.
 * The application keeps the existing small store facade so the large feature
 * surface does not need to know which database is underneath it. Values are
 * stored as base64 text; JSON/text/binary decoding happens at the facade edge.
 * The table is protected by RLS and is only accessed here with the server-side
 * Supabase Secret key. It is intentionally never exposed to browser code.
 */
var SUPABASE_STORE_LABEL = "supabase-postgres";
var SupabaseKVStore = class {
  constructor(base, secretKey) {
    this.base = String(base || "").replace(/\/$/, "");
    this.secretKey = String(secretKey || "");
    this.label = SUPABASE_STORE_LABEL;
  }
  headers(extra = {}) {
    const headers = { apikey: this.secretKey, ...extra };
    if (!String(this.secretKey).startsWith("sb_secret_")) headers.Authorization = `Bearer ${this.secretKey}`;
    return headers;
  }
  async request(path, opts = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(opts.timeoutMs || 20000));
    try {
      const r = await fetch(this.base + path, { ...opts, headers: this.headers(opts.headers || {}), signal: controller.signal });
      const text = await r.text().catch(() => "");
      if (!r.ok) {
        const error = new Error(`Supabase storage request failed (${r.status}): ${text.slice(0, 500)}`);
        error.status = r.status;
        throw error;
      }
      return { response: r, text };
    } finally { clearTimeout(timer); }
  }
  keyQuery(key) { return encodeURIComponent(String(key)); }
  async getRow(key) {
    const path = `/rest/v1/gb_kv?select=key,value,updated_at&key=eq.${this.keyQuery(key)}&limit=1`;
    const { text } = await this.request(path, { method: "GET" });
    let rows = [];
    try { rows = JSON.parse(text || "[]"); } catch { rows = []; }
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }
  async get(key, opts = {}) {
    const row = await this.getRow(key);
    if (!row || row.value === null || row.value === undefined) return null;
    const buf = Buffer.from(String(row.value), "base64");
    return decodeBuffer(buf, opts.type || "text");
  }
  async getWithMetadata(key, opts = {}) {
    const row = await this.getRow(key);
    if (!row) return { data: null, etag: null };
    const buf = Buffer.from(String(row.value || ""), "base64");
    const data = decodeBuffer(buf, opts.type || "text");
    return { data, etag: String(row.updated_at || "") };
  }
  async set(key, value, opts = {}) {
    const payload = { key: String(key), value: normaliseBuffer(value).toString("base64") };
    if (opts.onlyIfNew) {
      const { text } = await this.request("/rest/v1/gb_kv?on_conflict=key", {
        method: "POST",
        headers: { "content-type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify(payload)
      });
      let rows = [];
      try { rows = JSON.parse(text || "[]"); } catch { rows = []; }
      return { modified: Array.isArray(rows) && rows.length > 0 };
    }
    await this.request(`/rest/v1/gb_kv?on_conflict=key`, {
      method: "POST",
      headers: { "content-type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(payload)
    });
    return { modified: true };
  }
  async setJSON(key, value, opts = {}) { return this.set(key, JSON.stringify(value), opts); }
  async delete(key) {
    await this.request(`/rest/v1/gb_kv?key=eq.${this.keyQuery(key)}`, { method: "DELETE" });
  }
};
async function createSupabaseStore() {
  const cfg = supabaseConfig();
  if (!cfg.base || !cfg.secretKey) throw new Error("Supabase database storage is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  return new SupabaseKVStore(cfg.base, cfg.secretKey);
}

var backendPromise = null;
var activeBackend = null;
var storageStatus = { backend: "starting", persistent: false, notes: [] };
function isCentralStore(candidate = activeBackend) { return candidate?.label === SUPABASE_STORE_LABEL; }
async function resolveBackend() {
  const notes = [];
  const cfg = supabaseConfig();
  if (!cfg.base || !cfg.secretKey) {
    const error = new Error("Supabase Postgres is required for production data storage. Set SUPABASE_URL and SUPABASE_SECRET_KEY on the Student Portal server.");
    error.storageUnavailable = true;
    storageStatus = { backend: "unavailable", persistent: false, notes: [error.message] };
    throw error;
  }
  try {
    const supabase = await createSupabaseStore();
    activeBackend = supabase;
    storageStatus = { backend: SUPABASE_STORE_LABEL, persistent: true, notes: ["Supabase Postgres is the production source of truth for EduSpace data."] };
    return supabase;
  } catch (error) {
    const status = Number(error?.status || 0);
    if (status === 401 || status === 403) notes.push("Supabase rejected the server credential. Verify SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY and project permissions.");
    else if (status === 404) notes.push("The Supabase gb_kv table or REST route was not found. Apply supabase/schema.sql to the configured project.");
    else notes.push("Supabase Postgres storage unavailable: " + (error?.message || error));
  }
  const error = new Error("Supabase Postgres storage is unavailable. Verify the Supabase URL, Secret key, and gb_kv schema/migration before using the portal.");
  error.storageUnavailable = true;
  storageStatus = { backend: "unavailable", persistent: false, notes };
  throw error;
}

async function backend() {
  if (!backendPromise) {
    backendPromise = resolveBackend().catch((error) => {
      // Never cache a rejected startup promise. A transient Supabase outage,
      // DNS failure, schema deployment race, or rotated secret must be able to
      // recover on the next request without requiring a new function instance.
      backendPromise = null;
      activeBackend = null;
      throw error;
    });
  }
  return backendPromise;
}
async function withBackend(run) {
  const current = await backend();
  try {
    return await run(current);
  } catch (error) {
    console.error(`Storage backend "${current.label || "unknown"}" failed.`, error);
    // Supabase is the single source of truth. A failed operation must never
    // demote this request to per-instance memory, filesystem or another store.
    backendPromise = null;
    activeBackend = null;
    storageStatus = { backend: "unavailable", persistent: false, notes: ["Supabase Postgres is unavailable; local fallback is disabled."] };
    const failure = new Error("Persistent storage became unavailable. Supabase Postgres is the only application-data store; no local or per-instance fallback is permitted.");
    failure.storageUnavailable = true;
    throw failure;
  }
}
var storeFacade = {
  get: (key, opts) => withBackend((s) => s.get(key, opts)),
  getWithMetadata: (key, opts = {}) => withBackend(async (s) => {
    if (typeof s.getWithMetadata === "function") return s.getWithMetadata(key, opts);
    return { data: await s.get(key, opts), etag: null };
  }),
  set: (key, value, opts = {}) => withBackend((s) => s.set(key, value, opts)),
  setJSON: (key, value, opts = {}) => withBackend((s) => s.setJSON(key, value, opts)),
  delete: (key) => withBackend((s) => s.delete(key))
};
function store() {
  return storeFacade;
}
function storageReport() {
  const report = { ...storageStatus, backend: activeBackend?.label || storageStatus.backend };
  report.available = report.persistent === true;
  report.storageUnavailable = report.persistent !== true;
  return report;
}
// Static release floor for server-side live runtime overrides.
 // An older blob runtime must never replace the newer API code shipped in this package.
 // Newer published runtimes remain eligible.
 var CURRENT_API_VERSION = "12.1.9";
 function versionNumber(v) {
   const m = String(v || "").match(/^(\d+)\.(\d+)\.(\d+)/);
   return m ? Number(m[1]) * 1000000 + Number(m[2]) * 1000 + Number(m[3]) : 0;
 }
 var runtimeCache = { key: "", handler: null, checkedAt: 0 };
var RUNTIME_CHECK_MS = 5e3;
var RUNTIME_GENERATION = 5;
async function activeRuntimeHandler(appUpdate) {
  const key = String(appUpdate?.runtimeKey || "");
  if (!key) return null;
  if (Number(appUpdate?.runtimeGeneration || 0) < RUNTIME_GENERATION) return null;
  const publishedVersion = String(appUpdate?.assetVersion || appUpdate?.version || "");
  if (publishedVersion && versionNumber(publishedVersion) && versionNumber(publishedVersion) < versionNumber(CURRENT_API_VERSION)) {
    return null;
  }
  const now = Date.now();
  if (runtimeCache.handler && runtimeCache.key === key && now - runtimeCache.checkedAt < RUNTIME_CHECK_MS) return runtimeCache.handler;
  runtimeCache.checkedAt = now;
  try {
    const source = await store().get(key, { type: "text" });
    if (!source) return null;
    const mod = await import("data:text/javascript;base64," + Buffer.from(source, "utf8").toString("base64") + "#" + encodeURIComponent(key));
    if (typeof mod.default !== "function") throw new Error("Published API module has no default handler.");
    runtimeCache = { key, handler: mod.default, checkedAt: now };
    return mod.default;
  } catch (error) {
    console.error("Runtime update could not be loaded:", error);
    runtimeCache = { key: "", handler: null, checkedAt: now };
    return null;
  }
}
function contentTypeForPath(filePath) {
  const ext = String(filePath).toLowerCase().split(".").pop();
  return { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8", json: "application/json; charset=utf-8", webmanifest: "application/manifest+json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon", mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg" }[ext] || "application/octet-stream";
}
function safeRuntimePath(name) {
  const p = String(name || "").replace(/^\/+/, "");
  if (/\/$/.test(p)) return null;
  if (!p || p.includes("\0") || p.includes("..") || !/^[A-Za-z0-9._\-/() @+%]+$/.test(p)) return null;
  return p;
}
var runtimeManifestFiles = (manifest) => (manifest?.files || []).filter((f) => f && typeof f.path === "string" && !f.path.endsWith("/"));
function stripModuleExports(source) {
  return String(source || "").replace(/^[ \t]*export\s+(default\s+)?(?=(const|let|var|function|async\s+function|class)\b)/gm, "").replace(/^[ \t]*export\s*\{[^}]*\}\s*;?[ \t]*$/gm, "");
}
function relativeImportsOf(source) {
  const out = [];
  const re = /^[ \t]*import\s+([^;"']*?)\s+from\s+["'](\.[^"']*)["'][ \t]*;?[ \t]*$/gm;
  let m;
  while (m = re.exec(String(source || ""))) out.push({ statement: m[0], clause: m[1].trim(), specifier: m[2] });
  return out;
}
function libKeyFor(specifier) {
  const parts = String(specifier || "").replace(/\\/g, "/").split("/").filter((x) => x && x !== "." && x !== "..");
  const at = parts.indexOf("lib");
  return (at >= 0 ? parts.slice(at + 1) : parts).join("/");
}
function inlineLibImports(source, libSources, chain = []) {
  let out = String(source || "");
  const prelude = [];
  for (const imp of relativeImportsOf(out)) {
    const key = libKeyFor(imp.specifier);
    if (!libSources.has(key)) {
      throw new Error(`The update package is incomplete: the API imports "${imp.specifier}", but node-functions/lib/${key} is not in the ZIP.`);
    }
    if (chain.includes(key)) throw new Error(`The update package has a circular import: node-functions/lib/${key}.`);
    if (/\bas\b|\*|^\s*[A-Za-z_$]/.test(imp.clause.replace(/^\{[\s\S]*\}$/, "{}"))) {
      throw new Error(`The update package uses an import style the live update channel cannot inline: "${imp.statement.trim()}". Only plain named imports of node-functions/lib modules are supported \u2014 no default, namespace (*) or renamed (as) imports.`);
    }
    prelude.push(stripModuleExports(inlineLibImports(libSources.get(key), libSources, [...chain, key])).trim());
    out = out.replace(imp.statement, "");
  }
  return prelude.length ? prelude.join("\n") + "\n" + out : out;
}
// Kept only as a defensive migration guard for historical runtime packages.
// The current release does not import any external storage adapter.
var STORE_IMPORT_RE = /import\s+\{\s*getStore\s*\}\s+from\s+["'](?:@edgeone\/pages-blob|@netlify\/blobs)["'];?/g;
function rewriteRuntimeApiSource(source, libSources) {
  let out = String(source || "");
  out = out.replace(
    STORE_IMPORT_RE,
    'const getStore = globalThis.__gbGetStore;\nif (typeof getStore !== "function") throw new Error("The published API module could not reach the EdgeOne Pages Blob client.");'
  );
  out = inlineLibImports(out, libSources);
  const leftover = [];
  const specifiers = /(?:\bfrom\s*|\bimport\s*\(\s*)["']([^"']+)["']/g;
  let m;
  while (m = specifiers.exec(out)) {
    const s = m[1];
    if (!/^(node:|file:|data:|https?:)/.test(s)) leftover.push(s);
  }
  if (leftover.length) {
    throw new Error(`The update API still imports ${[...new Set(leftover)].map((s) => `"${s}"`).join(", ")}. The live update channel can only resolve node: built-ins and modules bundled under node-functions/lib, so this package was not published.`);
  }
  return out;
}
async function deleteRuntimePackage(update) {
  if (!update) return;
  try {
    if (update.manifestKey) {
      const manifest = await store().get(update.manifestKey, { type: "json" });
      for (const f of manifest?.files || []) await store().delete(f.key).catch(() => {
      });
      await store().delete(update.manifestKey).catch(() => {
      });
    }
    if (update.runtimeKey) await store().delete(update.runtimeKey).catch(() => {
    });
  } catch {
  }
}
async function publishRuntimePackage(zipBuffer, version) {
  const entries = unzipEntries(zipBuffer);
  const publicFiles = [];
  let apiSource = null;
  const libSources = /* @__PURE__ */ new Map();
  // The canonical EdgeOne layout is node-functions/lib/api-core.js plus
  // node-functions/lib/*.js helpers. The historical Netlify layout
  // (netlify/functions/api.mjs + netlify/lib/*) is still accepted so an older
  // update ZIP can be published without being repackaged first.
  const API_ENTRIES = ["node-functions/lib/api-core.js", "netlify/functions/api.mjs"];
  const LIB_PREFIXES = ["node-functions/lib/", "netlify/lib/"];
  for (const [rawName, data] of Object.entries(entries)) {
    const name = rawName.replace(/\\/g, "/").replace(/^\.\//, "");
    if (API_ENTRIES.includes(name)) {
      // Prefer the EdgeOne entry when a ZIP happens to carry both layouts.
      if (!apiSource || name === API_ENTRIES[0]) apiSource = Buffer.from(data).toString("utf8");
      continue;
    }
    const libPrefix = LIB_PREFIXES.find((prefix) => name.startsWith(prefix));
    if (libPrefix && /\.(mjs|js)$/.test(name)) {
      const libName = name.slice(libPrefix.length);
      if (libName !== "api-core.js") libSources.set(libName, Buffer.from(data).toString("utf8"));
    } else if (name.startsWith("public/") && !name.endsWith("/")) {
      const rel = safeRuntimePath(name.slice(7));
      if (rel) publicFiles.push({ path: rel, data: Buffer.from(data), contentType: contentTypeForPath(rel) });
    }
  }
  if (!publicFiles.some((f) => f.path === "index.html") || !publicFiles.some((f) => f.path === "app.js")) throw new Error("The update package is invalid: public/index.html and public/app.js are required.");
  if (!apiSource) throw new Error("The update package is invalid: node-functions/lib/api-core.js is missing.");
  if (!libSources.has("seed.js") && !libSources.has("seed.mjs")) throw new Error("The update package is invalid: node-functions/lib/seed.js is missing.");
  const rewrittenApi = rewriteRuntimeApiSource(apiSource, libSources);
  const safeVersion = String(version || "latest").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) || "latest";
  const prefix = `app-runtime/${safeVersion}`;
  const files = [];
  for (const file of publicFiles) {
    const key = `${prefix}/files/${file.path}`;
    await store().set(key, file.data);
    files.push({ path: file.path, key, contentType: file.contentType, size: file.data.length, sha256: crypto.createHash("sha256").update(file.data).digest("hex") });
  }
  const apiKey = `${prefix}/api-core.js`;
  let check;
  try {
    check = await import("data:text/javascript;base64," + Buffer.from(rewrittenApi, "utf8").toString("base64") + "#validation-" + Date.now());
  } catch (error) {
    throw new Error("The update package was rejected because its API file could not be loaded: " + (error?.message || "unknown error") + ". The live app was left untouched.");
  }
  if (typeof check.default !== "function") throw new Error("The update API could not be validated: node-functions/lib/api-core.js must export a default request handler. The live app was left untouched.");
  await store().set(apiKey, rewrittenApi);
  const manifestKey = `${prefix}/manifest.json`;
  await store().setJSON(manifestKey, { version: safeVersion, files, apiKey, createdAt: (/* @__PURE__ */ new Date()).toISOString() });
  return { runtimeKey: apiKey, manifestKey, assetVersion: safeVersion, files: files.length, runtimeGeneration: RUNTIME_GENERATION };
}
var attempts = /* @__PURE__ */ new Map();
function rateLimit(request, bucket, limit, windowMs) {
  // EdgeOne exposes the caller's address on the request context (bound per
  // request) and, at the edge, in eo-client-ip. x-forwarded-for is the last
  // resort because a proxy in front of the site may append to it.
  const ip = String(requestContext()?.clientIp || "").trim() || request.headers.get("eo-client-ip") || request.headers.get("x-forwarded-for") || "unknown";
  const key = bucket + ":" + String(ip).split(",")[0].trim();
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < windowMs);
  if (a.length >= limit) {
    // Keep the pruned list so a blocked caller cannot regrow its own bucket.
    attempts.set(key, a);
    return false;
  }
  a.push(now);
  attempts.set(key, a);
  if (attempts.size > 5e3) {
    // Evict only buckets whose entries have all aged out. Clearing the whole
    // map here would have reset every active limit at once, which is exactly
    // what a brute-force attempt would try to trigger.
    for (const [k, times] of attempts) {
      if (!times.some((t) => now - t < windowMs)) attempts.delete(k);
    }
  }
  return true;
}
var clone = (x) => JSON.parse(JSON.stringify(x));
function normalise(d) {
  const now = new Date().toISOString();
  const incoming = Array.isArray(d.subjects) ? d.subjects : [];
  d.subjects = incoming.map((s, i) => ({
    id: cleanString(s?.id, 80) || crypto.randomUUID(),
    name: cleanString(s?.name, 80).replace(/\s+/g, " ").trim(),
    icon: cleanString(s?.icon, 8) || "📘",
    position: Number.isFinite(Number(s?.position)) ? Number(s.position) : i,
    active: s?.active !== false,
    createdAt: s?.createdAt || now,
    updatedAt: s?.updatedAt || now
  })).filter(s => s.name);

  // Never allow a partially migrated catalog to strand compulsory/core subjects.
  // Older data blobs may contain a non-empty custom subject array while missing
  // one or more of the five original subjects; restore only the missing cores.
  const byName = new Map(d.subjects.map(s => [String(s.name).trim().toLowerCase(), s]));
  let nextPosition = d.subjects.reduce((max, s) => Math.max(max, Number(s.position) || 0), -1) + 1;
  for (const core of CORE_SUBJECT_DEFS) {
    const key = core.name.toLowerCase();
    const existing = byName.get(key);
    if (existing) {
      if (core.name === REQUIRED_REGISTRATION_SUBJECT && existing.active === false) {
        existing.active = true;
        existing.updatedAt = now;
      }
      continue;
    }
    const restored = {
      id: "subject-" + core.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      name: core.name, icon: core.icon, position: nextPosition++, active: true,
      createdAt: now, updatedAt: now
    };
    d.subjects.push(restored);
    byName.set(key, restored);
  }

  d.subjects.sort((a,b) => Number(a.position)-Number(b.position) || String(a.name).localeCompare(String(b.name)));
  SUBJECTS = d.subjects.filter(s => s.active).map(s => s.name);
  if (!SUBJECTS.includes(REQUIRED_REGISTRATION_SUBJECT)) SUBJECTS.push(REQUIRED_REGISTRATION_SUBJECT);
  d.collections = Array.isArray(d.collections) ? d.collections.filter(c => c && c.id && c.subjectId).map(c => ({
    ...c,
    subjectId: String(c.subjectId),
    subject: cleanString(c.subject || "", 80),
    name: cleanString(c.name || "Untitled collection", 160),
    sort_mode: ["manual", "alphabetical", "newest"].includes(String(c.sort_mode)) ? String(c.sort_mode) : "manual",
    items: Array.isArray(c.items) ? c.items.map((it, i) => ({
      id: it?.id || crypto.randomUUID(), type: it?.type === "cbt" ? "cbt" : "material",
      materialId: it?.materialId || it?.material?.id || null, quizId: it?.quizId || it?.quiz?.id || null,
      title: cleanString(it?.title || it?.titleOverride || "", 200), titleOverride: cleanString(it?.titleOverride || "", 200),
      position: Number.isFinite(Number(it?.position)) ? Number(it.position) : i
    })) : []
  })) : [];
  d.users = Array.isArray(d.users) ? d.users : [];
  d.notes = Array.isArray(d.notes) ? d.notes : [];
  d.tests = Array.isArray(d.tests) ? d.tests : [];
  d.tests = d.tests.map(t => ({
    ...t,
    questions: Array.isArray(t.questions) ? t.questions.map(q => ({ ...q, marks: Number.isFinite(Number(q?.marks)) && Number(q.marks) > 0 ? Number(q.marks) : 1 })) : [],
    questionPool: Array.isArray(t.questionPool) ? t.questionPool.map(q => ({ ...q, marks: Number.isFinite(Number(q?.marks)) && Number(q.marks) > 0 ? Number(q.marks) : 1 })) : [],
    passMark: Number.isFinite(Number(t.passMark)) ? Math.min(100, Math.max(0, Number(t.passMark))) : 50,
    studentFields: Array.isArray(t.studentFields) ? t.studentFields.slice(0, 30).map(f => ({ key: cleanString(f.key,80), label: cleanString(f.label,160) || 'Field', type: ['text','email','tel','number','textarea','select'].includes(f.type) ? f.type : 'text', required: !!f.required, leaderboard: !!f.leaderboard, options: Array.isArray(f.options) ? f.options.slice(0,20).map(v=>cleanString(v,120)).filter(Boolean) : [] })) : [],
    oneAttempt: t.oneAttempt !== false,
    resultVisibility: t.resultVisibility === 'held' ? 'held' : 'immediate',
    resultReleased: t.resultVisibility === 'held' ? !!t.resultReleased : true,
    sections: Array.isArray(t.sections) ? t.sections : [],
    shuffleQuestions: t.shuffleQuestions !== false,
    shuffleOptions: t.shuffleOptions !== false
  }));
  d.results = Array.isArray(d.results) ? d.results : [];
  d.announcements = Array.isArray(d.announcements) ? d.announcements : [];
  d.questionBank = Array.isArray(d.questionBank) ? d.questionBank : [];
  d.topics = Array.isArray(d.topics) ? d.topics : [];
  d.questionReports = Array.isArray(d.questionReports) ? d.questionReports : [];
  const topicByKey = new Map(d.topics.map(t => [`${String(t.subject||"").toLowerCase()}|${String(t.name||"").trim().toLowerCase()}`, t]));
  for (const q of d.questionBank) {
    q.topic = cleanString(q.topic || "", 200);
    q.topicId = q.topicId || "";
    if (q.q && Array.isArray(q.options) && q.options.length >= 4 && Number.isInteger(Number(q.answer))) {
      const improved = improveImportedExplanation(q.q, q.options, Number(q.answer), q.explanation || "");
      if (improved) q.explanation = improved.slice(0, 4000);
    }
    if (q.topic && !q.topicId) {
      const key = `${String(q.subject||"").toLowerCase()}|${q.topic.trim().toLowerCase()}`;
      const existing = topicByKey.get(key);
      if (existing) q.topicId = existing.id;
      else {
        const t = { id: crypto.randomUUID(), subject: q.subject, name: q.topic.trim(), slug: q.topic.trim().toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        d.topics.push(t); topicByKey.set(key,t); q.topicId = t.id;
      }
    }
    if (!q.topicId) {
      const key = `${String(q.subject||"").toLowerCase()}|uncategorized / topic not assigned`;
      let t = topicByKey.get(key);
      if (!t) { t={id:crypto.randomUUID(),subject:q.subject,name:"Uncategorized / Topic Not Assigned",slug:"uncategorized-topic-not-assigned",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}; d.topics.push(t); topicByKey.set(key,t); }
      q.topicId=t.id; if(!q.topic) q.topic=t.name;
    }
  }
  d.feedback = Array.isArray(d.feedback) ? d.feedback : [];
  d.notifications = Array.isArray(d.notifications) ? d.notifications : [];
  d.pushSubscriptions = Array.isArray(d.pushSubscriptions) ? d.pushSubscriptions : [];
  d.duels = Array.isArray(d.duels) ? d.duels : [];
  d.questionSets = Array.isArray(d.questionSets) ? d.questionSets : [];
  d.practiceHistory = Array.isArray(d.practiceHistory) ? d.practiceHistory : [];
  d.aiChats = Array.isArray(d.aiChats) ? d.aiChats : [];
  d.aiChats = d.aiChats.filter(c => c && c.id && c.userId).map(c => ({ ...c, messages: Array.isArray(c.messages) ? c.messages.slice(-80) : [] }));
  d.practiceHistory = d.practiceHistory.filter(x => x && x.id && x.userId && x.subject).map(x => ({ ...x, questionIds: Array.isArray(x.questionIds) ? [...new Set(x.questionIds.map(String))] : [], cycle: Number(x.cycle) > 0 ? Number(x.cycle) : 1 }));
  d.questionSets = d.questionSets.map(set => ({ ...set,
    sections: Array.isArray(set.sections) ? set.sections.map(sec => ({ ...sec, questions: Array.isArray(sec.questions) ? sec.questions.map(q => ({ ...q, marks: Number.isFinite(Number(q?.marks)) && Number(q.marks) > 0 ? Number(q.marks) : 1 })) : [] })) : [],
    passMark: Number.isFinite(Number(set.passMark)) ? Math.min(100,Math.max(0,Number(set.passMark))) : 50,
    oneAttempt: set.oneAttempt !== false,
    resultVisibility: set.resultVisibility === "held" ? "held" : "immediate",
    resultReleased: set.resultVisibility === "held" ? !!set.resultReleased : true,
    studentFields: normaliseStudentFields(set.studentFields)
  }));
  // Migrate older 1-v-1 records into the turn-based state model. Existing
  // answers are preserved and used to determine the next player/question.
  for (const duel of d.duels) {
    if (!duel || !Array.isArray(duel.players)) continue;
    duel.answers = duel.answers && typeof duel.answers === "object" ? duel.answers : {};
    duel.submitted = duel.submitted && typeof duel.submitted === "object" ? duel.submitted : {};
    duel.scores = duel.scores && typeof duel.scores === "object" ? duel.scores : {};
    duel.timeouts = duel.timeouts && typeof duel.timeouts === "object" ? duel.timeouts : {};
    for (const player of duel.players) {
      duel.answers[player.id] = duel.answers[player.id] && typeof duel.answers[player.id] === "object" ? duel.answers[player.id] : {};
      duel.timeouts[player.id] = Array.isArray(duel.timeouts[player.id]) ? duel.timeouts[player.id] : [];
      const score = (duel.questions || []).reduce((n, q, i) => n + (Number.isInteger(duel.answers[player.id][i]) && Number(duel.answers[player.id][i]) === Number(q.answer) ? 1 : 0), 0);
      duel.scores[player.id] = score;
      player.score = score;
    }
    if (duel.status === "active" && duel.players.length === 2) {
      const first = duel.players[0], second = duel.players[1];
      const firstCount = Object.keys(duel.answers[first.id] || {}).filter(k => Number.isInteger(duel.answers[first.id][k])).length;
      const secondCount = Object.keys(duel.answers[second.id] || {}).filter(k => Number.isInteger(duel.answers[second.id][k])).length;
      if (!Number.isInteger(duel.currentQuestionIndex)) duel.currentQuestionIndex = Math.min(Math.min(firstCount, secondCount), Math.max(0, (duel.questions || []).length - 1));
      if (!duel.currentTurnUserId) duel.currentTurnUserId = firstCount > secondCount ? second.id : first.id;
      if (!duel.turnStartedAt) duel.turnStartedAt = duel.startedAt || new Date().toISOString();
      const turnStartMs = Date.parse(String(duel.turnStartedAt || ""));
      if (!duel.turnDeadlineAt) duel.turnDeadlineAt = new Date((Number.isFinite(turnStartMs) ? turnStartMs : Date.now()) + DUEL_TURN_TTL_MS).toISOString();
      if (firstCount >= (duel.questions || []).length && secondCount >= (duel.questions || []).length) {
        duel.status = "finished";
        duel.finishedAt = duel.finishedAt || new Date().toISOString();
      }
    }
  }
  if (typeof d.appUpdate !== "object") d.appUpdate = null;
  if (!d.settings || typeof d.settings !== "object") d.settings = {};
  if (typeof d.settings.tokenVersion !== "number") d.settings.tokenVersion = 1;
  if (!d.settings.leaderboardResetAt) d.settings.leaderboardResetAt = "";
  if (!d.settings.subjectLeaderboardResetAt || typeof d.settings.subjectLeaderboardResetAt !== "object") d.settings.subjectLeaderboardResetAt = {};
  if (!Array.isArray(d.settings.deletedAnnouncementIds)) d.settings.deletedAnnouncementIds = [];
  for (const a of d.announcements) {
    if (!a.format) a.format = "text";
    if (!Array.isArray(a.media)) a.media = [];
    a.bodyFormat = a.format;
    a.attachments = a.media;
    if (!a.createdAt) a.createdAt = a.date || (/* @__PURE__ */ new Date(0)).toISOString();
  }
  for (const u of d.users) {
    // Existing accounts start at token version 1 so tokens already in circulation
    // stay valid until an administrator changes the account.
    if (!Number.isFinite(Number(u.tokenVersion)) || Number(u.tokenVersion) < 1) u.tokenVersion = 1;
    if (!u.deviceId) u.deviceId = "GB-" + crypto.randomBytes(8).toString("hex").toUpperCase();
    if (!u.productKey) u.productKey = "GBE-" + crypto.randomBytes(10).toString("hex").toUpperCase();
    if (!u.authUserId) u.authUserId = "";
    if (typeof u.emailVerified !== "boolean") u.emailVerified = !!u.emailVerifiedAt;
    if (typeof u.activated !== "boolean") u.activated = false;
    u.selectedSubjects = normaliseSelectedSubjects(u.selectedSubjects);
    if (!u.selectedSubjects.includes(REQUIRED_REGISTRATION_SUBJECT)) u.selectedSubjects.unshift(REQUIRED_REGISTRATION_SUBJECT);
    u.selectedSubjects = u.selectedSubjects.slice(0, MAX_SELECTED_SUBJECTS);
  }
  for (const n of d.notes) {
    if (!Array.isArray(n.attachments)) {
      n.attachments = n.fileKey ? [{ key: n.fileKey, url: n.fileUrl || "/api/files/" + encodeURIComponent(n.fileKey), fileName: n.fileName || "file", contentType: n.contentType || "application/octet-stream" }] : [];
    }
    if (!n.format) n.format = "text";
    n.bodyFormat = n.format;
    if (!n.createdAt) n.createdAt = n.date || (/* @__PURE__ */ new Date(0)).toISOString();
    if (n.access !== "activated") n.access = "all";
  }
  for (const t of d.tests) if (t.access !== "activated") t.access = "all";
  for (const set of d.questionSets) if (set.access !== "activated") set.access = "all";
  return d;
}
function mergeContentPack(d) {
  const version = String(CONTENT_PACK.version || "");
  const current = String(d.settings?.contentPackVersion || "");
  if (current === version) return false;
  const upsertManaged = (collection, items) => {
    for (const item of items || []) {
      const idx = collection.findIndex((x) => String(x.id) === String(item.id));
      if (idx >= 0) collection[idx] = clone(item);
      else collection.push(clone(item));
    }
  };
  // Content-pack upgrades must never wipe administrator-created CBTs or questions.
  // Upsert bundled records by ID so the release can add/fix managed content while
  // preserving custom records that live alongside the bundled material.
  upsertManaged(d.tests, CONTENT_PACK.tests);
  upsertManaged(d.questionBank, CONTENT_PACK.questionBank);
  upsertManaged(d.notes, CONTENT_PACK.notes);
  const deletedAnnouncements = new Set((d.settings?.deletedAnnouncementIds || []).map(String));
  upsertManaged(d.announcements, (CONTENT_PACK.announcements || []).filter((a) => !deletedAnnouncements.has(String(a.id))));
  d.settings.contentPackVersion = version;
  return true;
}
var PERSIST_COLLECTIONS = ["topics", "questionReports", "users", "notes", "tests", "results", "announcements", "questionBank", "feedback", "notifications", "pushSubscriptions", "duels", "questionSets", "practiceHistory", "aiChats", "subjects", "collections"];
var jsonEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function ensureVapidKeys(d) {
  const st = d.settings || (d.settings = {});
  if (st.vapidPrivateJwk && st.vapidPublicJwk && st.vapidSubject) return st;
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privateJwk = pair.privateKey.export({ format: "jwk" });
  const publicJwk = pair.publicKey.export({ format: "jwk" });
  st.vapidPrivateJwk = privateJwk;
  st.vapidPublicJwk = publicJwk;
  st.vapidSubject = cleanString(env("GB_VAPID_SUBJECT") || "mailto:admin@example.com", 240) || "mailto:admin@example.com";
  return st;
}
function vapidPublicRaw(jwk) {
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
}
function hkdfExtract(salt, ikm) {
  return crypto.createHmac("sha256", salt).update(ikm).digest();
}
function hkdfExpand(prk, info, length) {
  const out = [];
  let previous = Buffer.alloc(0);
  let counter = 1;
  while (Buffer.concat(out).length < length) {
    previous = crypto.createHmac("sha256", prk).update(Buffer.concat([previous, Buffer.from(info), Buffer.from([counter++])])).digest();
    out.push(previous);
  }
  return Buffer.concat(out).subarray(0, length);
}
function pointJwk(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 65 || raw[0] !== 4) throw new Error("The push subscription public key is invalid.");
  return { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33, 65).toString("base64url") };
}
function signVapid(st, audience) {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60, sub: st.vapidSubject };
  const input = Buffer.from(JSON.stringify(header)).toString("base64url") + "." + Buffer.from(JSON.stringify(payload)).toString("base64url");
  const key = crypto.createPrivateKey({ key: st.vapidPrivateJwk, format: "jwk" });
  const sig = crypto.sign("sha256", Buffer.from(input), { key, dsaEncoding: "ieee-p1363" });
  return input + "." + sig.toString("base64url");
}
function encryptPush(subscription, payload) {
  const p = subscription?.keys || {};
  const clientRaw = Buffer.from(String(p.p256dh || ""), "base64url");
  const auth2 = Buffer.from(String(p.auth || ""), "base64url");
  if (clientRaw.length !== 65 || auth2.length < 16) throw new Error("The push subscription keys are invalid.");
  const clientPublic = crypto.createPublicKey({ key: pointJwk(clientRaw), format: "jwk" });
  const eph = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ephJwk = eph.publicKey.export({ format: "jwk" });
  const ephRaw = vapidPublicRaw(ephJwk);
  const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: clientPublic });
  const ikm = hkdfExpand(hkdfExtract(auth2, shared), Buffer.concat([Buffer.from("WebPush: info\0"), clientRaw, ephRaw]), 32);
  const salt = crypto.randomBytes(16);
  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);
  const plaintext = Buffer.concat([Buffer.from(JSON.stringify(payload), "utf8"), Buffer.from([2])]);
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(ephRaw.length, 20);
  return { body: Buffer.concat([header, ephRaw, encrypted]), publicRaw: ephRaw };
}
async function sendWebPush(st, subscription, payload) {
  const endpoint = String(subscription?.endpoint || "");
  if (!/^https?:\/\//i.test(endpoint)) throw new Error("Invalid push endpoint.");
  const audience = new URL(endpoint).origin;
  const { body } = encryptPush(subscription, payload);
  const jwt = signVapid(st, audience);
  const publicRaw = vapidPublicRaw(st.vapidPublicJwk);
  const response = await fetch(endpoint, { method: "POST", headers: { "TTL": "86400", "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm", "Authorization": `vapid t=${jwt}, k=${publicRaw.toString("base64url")}` }, body });
  if (!response.ok) {
    const err = new Error(`Push endpoint returned ${response.status}.`);
    err.status = response.status;
    throw err;
  }
  return true;
}
function activeStudentIds(d) {
  return (Array.isArray(d.users) ? d.users : []).filter(u => String(u.status || "active") === "active").map(u => String(u.id));
}
function buildPublishNotifications(d, { type, title, message, url, eventKey }) {
  const createdAt = new Date().toISOString();
  const key = String(eventKey || `${type}:${url || ""}`);
  const existing = new Set((Array.isArray(d.notifications) ? d.notifications : [])
    .filter(n => String(n.eventKey || "") === key)
    .map(n => String(n.userId || "")));
  return activeStudentIds(d)
    .filter(userId => !existing.has(String(userId)))
    .map(userId => ({ id:crypto.randomUUID(), userId, type, title, message, url, eventKey:key, createdAt, read:false }));
}

async function sendWebPushes(d, items) {
  if (!d.pushSubscriptions.length || !items.length) return false;
  const st = ensureVapidKeys(d);
  const byUser = new Map(items.map((x) => [x.userId, x]));
  let removed = false;
  const results = await Promise.allSettled(d.pushSubscriptions.map(async (sub) => {
    const item = byUser.get(sub.userId);
    if (!item) return;
    try {
      await sendWebPush(st, sub, { title: item.title, body: item.message || "", url: item.url || "/dashboard.html", type: item.type || "notification", version: item.version || "" });
    } catch (err) {
      if (err?.status === 404 || err?.status === 410) {
        const i = d.pushSubscriptions.findIndex((x) => x.id === sub.id);
        if (i >= 0) {
          d.pushSubscriptions.splice(i, 1);
          removed = true;
        }
      }
    }
  }));
  void results;
  return removed;
}
function attachPersistBase(d) {
  try {
    Object.defineProperty(d, "__persistBase", { value: clone(d), writable: true, configurable: true, enumerable: false });
  } catch {
  }
  return d;
}
function mergeChangedCollection(baseList, nextList, latestList) {
  const idOf = (item) => String(item?.id || "");
  const base = new Map((Array.isArray(baseList) ? baseList : []).map((x) => [idOf(x), x]));
  const next = new Map((Array.isArray(nextList) ? nextList : []).map((x) => [idOf(x), x]));
  const latest = new Map((Array.isArray(latestList) ? latestList : []).map((x) => [idOf(x), x]));
  const order = [...Array.isArray(latestList) ? latestList : []];
  const pos = new Map(order.map((x, i) => [idOf(x), i]));
  for (const [id, value] of next) {
    if (!id) continue;
    const b = base.get(id), l = latest.get(id);
    const changed = !b || !jsonEqual(value, b);
    if (!changed) continue;
    if (!l) {
      pos.set(id, order.length);
      order.push(value);
      latest.set(id, value);
    } else {
      const i = pos.get(id);
      if (Number.isInteger(i)) order[i] = value;
      latest.set(id, value);
    }
  }
  for (const [id, b] of base) {
    if (!next.has(id)) {
      const l = latest.get(id);
      if (l && jsonEqual(l, b)) {
        const i = pos.get(id);
        if (Number.isInteger(i)) {
          order.splice(i, 1);
          pos.delete(id);
          for (let n = i; n < order.length; n++) pos.set(idOf(order[n]), n);
        }
        latest.delete(id);
      }
    }
  }
  return order;
}
function mergeDuelCollection(baseList, nextList, latestList) {
  const base = new Map((Array.isArray(baseList) ? baseList : []).map(x => [String(x?.id || ""), x]));
  const next = new Map((Array.isArray(nextList) ? nextList : []).map(x => [String(x?.id || ""), x]));
  const latest = new Map((Array.isArray(latestList) ? latestList : []).map(x => [String(x?.id || ""), clone(x)]));
  for (const [id, n] of next) {
    if (!id) continue;
    const b = base.get(id), l = latest.get(id);
    if (!l) { latest.set(id, clone(n)); continue; }
    if (!b) { latest.set(id, clone(n)); continue; }
    const merged = clone(l);
    // Merge nested answer/submission/score maps so two players answering
    // simultaneously cannot overwrite one another's progress.
    merged.answers = { ...(l.answers || {}) };
    for (const [uid, answers] of Object.entries(n.answers || {})) merged.answers[uid] = { ...(merged.answers[uid] || {}), ...(answers || {}) };
    merged.submitted = { ...(l.submitted || {}), ...(n.submitted || {}) };
    merged.left = { ...(l.left || {}), ...(n.left || {}) };
    merged.timeouts = { ...(l.timeouts || {}) };
    for (const [uid, indexes] of Object.entries(n.timeouts || {})) merged.timeouts[uid] = [...new Set([...(merged.timeouts[uid] || []), ...(indexes || [])])];
    const playerMap = new Map((l.players || []).map(p => [String(p.id), clone(p)]));
    for (const p of n.players || []) playerMap.set(String(p.id), clone(p));
    merged.players = [...playerMap.values()];
    // A 1-v-1 room holds exactly two players. If two joiners ever raced past
    // the room lock, unioning both snapshots would produce a three-player
    // "duel" whose turn logic is undefined. Keep the players the stored state
    // already accepted and drop the late arrival instead.
    if (merged.players.length > 2) {
      const authoritative = new Map((l.players || []).map(p => [String(p.id), clone(p)]));
      for (const p of n.players || []) {
        if (authoritative.size >= 2) break;
        if (!authoritative.has(String(p.id))) authoritative.set(String(p.id), clone(p));
      }
      merged.players = [...authoritative.values()].slice(0, 2);
      const allowed = new Set(merged.players.map(p => String(p.id)));
      for (const uid of Object.keys(merged.answers)) if (!allowed.has(uid)) delete merged.answers[uid];
      for (const uid of Object.keys(merged.timeouts)) if (!allowed.has(uid)) delete merged.timeouts[uid];
      for (const uid of Object.keys(merged.submitted)) if (!allowed.has(uid)) delete merged.submitted[uid];
    }
    merged.scores = {};
    for (const player of merged.players) merged.scores[player.id] = duelScore(merged, player.id);
    // Turn state is a single ordered state machine. Prefer the snapshot that
    // advanced the turn; never merge an older turn back over a newer one.
    const turnFields = ["currentQuestionIndex", "currentTurnUserId", "turnStartedAt", "turnDeadlineAt"];
    const nextTurnIndex = Number(n.currentQuestionIndex ?? -1);
    const latestTurnIndex = Number(l.currentQuestionIndex ?? -1);
    if (nextTurnIndex > latestTurnIndex || (nextTurnIndex === latestTurnIndex && n.turnStartedAt && String(n.turnStartedAt) >= String(l.turnStartedAt || ""))) {
      for (const key of turnFields) if (n[key] !== undefined) merged[key] = clone(n[key]);
    }
    if (merged.players.length === 2 && merged.status === "finished") {
      merged.finishedAt = merged.finishedAt || new Date().toISOString();
    }
    // Terminal states are not ordered on a numeric scale: a completed match
    // must never be turned into a cancelled or expired one by a snapshot that
    // was taken before it finished. "finished" is therefore absorbing, and a
    // cancellation/expiry is only accepted while the match is still open.
    const OPEN = { waiting: 1, active: 2 };
    if (merged.status !== "finished") {
      if (n.status === "finished") merged.status = "finished";
      else if ((n.status === "cancelled" || n.status === "expired") && OPEN[merged.status]) merged.status = n.status;
      else if (OPEN[n.status] && OPEN[merged.status] && OPEN[n.status] > OPEN[merged.status]) merged.status = n.status;
    }
    for (const key of ["startedAt", "finishedAt", "cancelledAt", "expiredAt"]) if (n[key]) merged[key] = n[key];
    if (merged.status === "finished") {
      // Keep the completed match clean: a stale cancel/expire marker would
      // otherwise make a finished duel render as abandoned.
      delete merged.cancelledAt;
      delete merged.expiredAt;
      merged.finishedAt = merged.finishedAt || new Date().toISOString();
    }
    latest.set(id, merged);
  }
  return [...latest.values()];
}
function mergeConcurrent(base, next, latest) {
  const out = clone(latest || next || {});
  for (const key of PERSIST_COLLECTIONS) {
    out[key] = key === "duels"
      ? mergeDuelCollection(base?.[key], next?.[key], latest?.[key])
      : mergeChangedCollection(base?.[key], next?.[key], latest?.[key]);
  }
  const bs = base?.settings || {}, ns = next?.settings || {}, ls = latest?.settings || {};
  out.settings = { ...ls };
  const keys = /* @__PURE__ */ new Set([...Object.keys(bs), ...Object.keys(ns)]);
  for (const key of keys) {
    const nextHas = Object.prototype.hasOwnProperty.call(ns, key);
    const baseHas = Object.prototype.hasOwnProperty.call(bs, key);
    if (nextHas !== baseHas || !jsonEqual(ns[key], bs[key])) {
      if (nextHas) out.settings[key] = clone(ns[key]);
      else delete out.settings[key];
    }
  }
  if (next?.appUpdate && !jsonEqual(next.appUpdate, base?.appUpdate) || !next?.appUpdate && base?.appUpdate) out.appUpdate = clone(next.appUpdate);
  if (next?.appUpdate == null && base?.appUpdate == null) out.appUpdate = latest?.appUpdate ?? null;
  return out;
}
var loadInFlight = null;
var DATA_CACHE = null;
var DATA_CACHE_AT = 0;
// Writes always bypass this cache and re-read + merge against fresh storage
// in saveLocked() regardless of TTL, so this only governs how current a GET
// response can be - it never affects write correctness. A longer window
// meaningfully cuts full-dataset storage reads during normal traffic (a
// class of students loading the dashboard within the same few seconds all
// share one read instead of one each) at the cost of up to this many
// milliseconds of staleness on read-only views like stats and leaderboards.
var DATA_CACHE_TTL_MS = 4000;
var SAVE_LOCK = { chain: Promise.resolve() };

async function loadFresh() {
  let d = await store().get("data", { type: "json" });
  if (!d) {
    const backup = await store().get("data.backup", { type: "json" });
    if (backup) {
      d = backup;
      await store().setJSON("data", backup);
    }
  }
  if (d) {
    const beforeSubjects = JSON.stringify(d.subjects ?? null);
    let normal = normalise(d);
    const subjectCatalogChanged = beforeSubjects !== JSON.stringify(normal.subjects ?? null);
    let contentChanged = mergeContentPack(normal);
    // A content-pack upgrade replaces the managed question bank, so run the
    // migration pass again over the new questions to guarantee topic IDs exist.
    if (contentChanged) normal = normalise(normal);
    const topicMigrationChanged = normal.settings.topicMigrationVersion !== 1;
    if (topicMigrationChanged) normal.settings.topicMigrationVersion = 1;
    const explanationMigrationChanged = normal.settings.explanationMigrationVersion !== 1;
    if (explanationMigrationChanged) normal.settings.explanationMigrationVersion = 1;
    if (contentChanged || subjectCatalogChanged || topicMigrationChanged || explanationMigrationChanged) await store().setJSON("data", normal);
    if (typeof normal._revision !== "number") normal._revision = 1;
    return normal;
  }
  const fresh = normalise(clone(seed));
  fresh.settings.contentPackVersion = CONTENT_PACK.version;
  fresh.settings.topicMigrationVersion = 1;
  fresh.settings.explanationMigrationVersion = 1;
  fresh._revision = 1;
  await store().setJSON("data", fresh);
  return fresh;
}

async function load(options = {}) {
  // GET/HEAD traffic is overwhelmingly read-only. A very short per-instance
  // cache removes repeated large central-store reads when a classroom of students loads
  // the dashboard/test pages together. Writes and explicit fresh reads always
  // bypass the cache. The 1000 ms TTL keeps the window small while materially
  // reducing shared-storage pressure during concurrency spikes.
  const method = requestContext()?.method || "GET";
  const readRequest = method === "GET" || method === "HEAD";
  const now = Date.now();
  if (readRequest && !options.fresh && DATA_CACHE && now - DATA_CACHE_AT < DATA_CACHE_TTL_MS) {
    return attachPersistBase(clone(DATA_CACHE));
  }
  // Collapse simultaneous cold-start/request bursts into one storage read.
  if (!loadInFlight) {
    loadInFlight = loadFresh().finally(() => {
      loadInFlight = null;
    });
  }
  // DATA_CACHE and the object handed back to the caller must stay two
  // independent copies: request handlers routinely mutate the returned
  // object in place before calling save() (d.users.push(...), u.name=...,
  // etc.), and if that object were the same reference as DATA_CACHE, an
  // in-progress, not-yet-saved edit from one request could leak into a
  // concurrent request's cache read within the same cache window. So this
  // keeps two independent clones - it just makes the clone itself cheaper
  // (see clone() below) rather than removing one.
  const base = await loadInFlight;
  DATA_CACHE = clone(base);
  DATA_CACHE_AT = Date.now();
  return attachPersistBase(clone(base));
}

async function saveLocked(d) {
  SAVE_LOCK.chain = SAVE_LOCK.chain.then(async () => {
    const writerId = crypto.randomUUID();
    for (let attempt = 0; attempt < 5; attempt++) {
      const latestRaw = await store().get("data", { type: "json" });
      const latest = latestRaw ? normalise(latestRaw) : null;
      const base = d?.__persistBase || latest || {};
      let out = latest && Number(latest._revision || 0) !== Number(base._revision || 0) ? mergeConcurrent(base, d, latest) : clone(d);
      delete out.__persistBase;
      out._revision = (Number(latest?._revision) || Number(base._revision) || 0) + 1;
      out._saveId = writerId;
      out.savedAt = new Date().toISOString();
      // The main record is large, so mirroring it on every single
      // save would double the write cost of ordinary actions. Refresh the
      // rollback copy periodically instead; it only needs to be recent enough
      // to recover from a corrupt write, not identical to the previous save.
      if (latestRaw && shouldRefreshBackup()) await store().setJSON("data.backup", latestRaw);
      await store().setJSON("data", out);
      const confirmed = await store().get("data", { type: "json" });
      if (confirmed && confirmed._saveId === writerId) {
        delete out._saveId;
        try {
          for (const key of Object.keys(d)) delete d[key];
          Object.assign(d, clone(out));
        } catch {
        }
        attachPersistBase(d);
        DATA_CACHE = clone(out);
        DATA_CACHE_AT = Date.now();
        return d;
      }
    }
    throw new Error("The central data store was updated by another administrator at the same time. Please save your change again so it can be merged safely.");
  });
  return SAVE_LOCK.chain;
}

var backupCounter = 0;
function shouldRefreshBackup() {
  backupCounter = (backupCounter + 1) % 25;
  return backupCounter === 1;
}

async function save(d) {
  // Serialise writes inside this warm function, merge against the latest
  // central revision and confirm that this writer's save landed.
  return saveLocked(d);
}


async function deleteFile(key) {
  if (!key) return;
  try {
    const meta = await store().get(`${key}.meta`, { type: "json" });
    if (meta && Number.isInteger(meta.parts)) {
      for (let i = 0; i < meta.parts; i++) await store().delete(`${key}.part.${i}`).catch(() => {
      });
    }
    await store().delete(`${key}.meta`).catch(() => {
    });
    await store().delete(key).catch(() => {
    });
  } catch {
  }
}
var secretPromise = null;
function secret() {
  const configured = env("AUTH_SECRET").trim();
  if (!configured) return Promise.reject(Object.assign(new Error("Authentication is not configured: set AUTH_SECRET in the Student Portal server environment."), { authConfiguration: true }));
  return Promise.resolve(configured);
}
var b64url = (x) => Buffer.from(x).toString("base64url");
async function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", await secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
async function issue(userId, role, version = 1) {
  return sign({ sub: userId, role, v: version, exp: Math.floor(Date.now() / 1e3) + TOKEN_TTL });
}
async function verifyToken(raw, role) {
  const [body, sig] = String(raw || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", await secret()).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.exp || p.exp < Math.floor(Date.now() / 1e3)) return null;
    if (role && p.role !== role) return null;
    return p;
  } catch {
    return null;
  }
}
function supabaseConfig() {
  const base = env("SUPABASE_URL").replace(/\/$/, "");
  const anonKey = env("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY");
  return { base, anonKey, secretKey, configured: !!(base && anonKey && secretKey) };
}
async function supabaseRequest(path, { method = "GET", body, key, timeoutMs = 20000 } = {}) {
  const cfg = supabaseConfig();
  if (!cfg.base || !key) throw new Error("Supabase authentication is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SECRET_KEY on the Student Portal server.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { apikey: key };
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(cfg.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const message = data?.msg || data?.message || data?.error_description || data?.error || `Supabase authentication request failed (${r.status}).`;
      const error = new Error(String(message)); error.status = r.status; error.data = data; throw error;
    }
    return data;
  } finally { clearTimeout(timer); }
}
async function supabaseCreateUser(email, password, metadata = {}) {
  const cfg = supabaseConfig();
  if (!cfg.configured) throw new Error("Supabase authentication is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SECRET_KEY on the Student Portal server.");
  return supabaseRequest("/auth/v1/admin/users", { method: "POST", key: cfg.secretKey, body: { email, password, email_confirm: true, user_metadata: metadata } });
}
async function supabaseSignUp(email, password, metadata = {}, redirectTo = "") {
  const cfg = supabaseConfig();
  if (!cfg.configured) throw new Error("Supabase authentication is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SECRET_KEY on the Student Portal server.");
  const suffix = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
  return supabaseRequest(`/auth/v1/signup${suffix}`, { method: "POST", key: cfg.anonKey, body: { email, password, data: metadata } });
}
async function supabaseResendVerification(email, redirectTo = "") {
  const cfg = supabaseConfig();
  if (!cfg.configured) throw new Error("Supabase authentication is not configured.");
  const suffix = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
  return supabaseRequest(`/auth/v1/resend${suffix}`, { method: "POST", key: cfg.anonKey, body: { type: "signup", email } });
}
async function supabaseUpdateUser(id, patch) {
  const cfg = supabaseConfig();
  if (!cfg.configured) throw new Error("Supabase authentication is not configured.");
  return supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "PUT", key: cfg.secretKey, body: patch });
}
async function supabaseSignIn(email, password) {
  const cfg = supabaseConfig();
  if (!cfg.configured) throw new Error("Supabase authentication is not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SECRET_KEY on the Student Portal server.");
  return supabaseRequest("/auth/v1/token?grant_type=password", { method: "POST", key: cfg.anonKey, body: { email, password } });
}
async function supabaseDeleteUser(id) {
  const cfg = supabaseConfig();
  if (!cfg.configured || !id) return;
  await supabaseRequest(`/auth/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", key: cfg.secretKey }).catch(() => {});
}
function sessionHash(raw) { return crypto.createHash("sha256").update(String(raw || "")).digest("hex"); }
function studentSessionCookie(raw, maxAge = STUDENT_SESSION_TTL) {
  return `${STUDENT_SESSION_COOKIE}=${encodeURIComponent(raw)}; Path=/; Max-Age=${Math.max(0, Math.floor(maxAge))}; HttpOnly; Secure; SameSite=Lax`;
}
function clearStudentSessionCookie() {
  return `${STUDENT_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
async function createStudentSession(user) {
  const raw = crypto.randomBytes(32).toString("base64url");
  const now = Date.now();
  await store().setJSON(`student-session/${sessionHash(raw)}`, {
    userId: user.id,
    authUserId: user.authUserId || "",
    version: Number(user.tokenVersion || 1),
    deviceId: user.deviceId || "",
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + STUDENT_SESSION_TTL * 1000).toISOString()
  });
  return { raw, cookie: studentSessionCookie(raw) };
}
async function verifyStudentSession(request) {
  const raw = cookieValue(request, STUDENT_SESSION_COOKIE);
  if (!raw) return null;
  const key = `student-session/${sessionHash(raw)}`;
  // IMPORTANT: storage failures must propagate. Treating a failed database read
  // as "no session" turns a real central-storage outage into a misleading
  // 401 "Authentication required" response and blocks every authenticated
  // operation with the wrong diagnosis.
  const session = await store().get(key, { type: "json" });
  if (!session) return null;
  const expires = Date.parse(String(session.expiresAt || ""));
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    await store().delete(key).catch(() => {});
    return null;
  }
  const d = await load();
  const user = d?.users?.find(u => u.id === session.userId);
  if (!isRankedStudent(user) || Number(session.version || 1) !== Number(user.tokenVersion || 1)) return null;
  return { sub: user.id, role: "student", session: true, user };
}
async function destroyStudentSession(request) {
  const raw = cookieValue(request, STUDENT_SESSION_COOKIE);
  if (raw) await store().delete(`student-session/${sessionHash(raw)}`).catch(() => {});
}

function bearer(request) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}
// Download tickets are a separate role, so a ticket can never be replayed
// against any other API route (every other route requires "student"/"admin").
var DOWNLOAD_ROLE = "download";
var DOWNLOAD_COOKIE = "gb_dl";
var DOWNLOAD_TICKET_TTL = 30 * 60;
function cookieValue(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.split("=");
    if (rawKey.trim() === name) return decodeURIComponent(rest.join("=").trim());
  }
  return "";
}
async function issueDownloadTicket(subject, forRole, version) {
  return sign({ sub: subject, role: DOWNLOAD_ROLE, for: forRole, v: version, exp: Math.floor(Date.now() / 1e3) + DOWNLOAD_TICKET_TTL });
}
function downloadCookieHeader(value, maxAge) {
  // HttpOnly keeps the ticket out of page scripts, SameSite=Strict stops it
  // being sent from other sites, and the narrow path means it is only ever
  // attached to file downloads.
  return `${DOWNLOAD_COOKIE}=${encodeURIComponent(value)}; Path=/api/files; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}
/* Authorise a request.
 *
 * A signature/expiry check alone is not enough for student routes: a token
 * stays cryptographically valid for its full 12-hour lifetime, so a student who
 * was suspended, rejected, deleted, or had their password reset would otherwise
 * keep full access until it expired. Student tokens therefore also have to
 * match the account's current state and token version.
 */
var auth = async (request, role) => {
  if (role === "student") {
    return verifyStudentSession(request);
  }
  return verifyToken(bearer(request), role);
};
function studentTokenValid(d, payload) {
  if (!payload) return false;
  const user = d?.users?.find((u) => u.id === payload.sub);
  if (!isRankedStudent(user)) return false;
  return Number(payload.v || 1) === Number(user.tokenVersion || 1);
}
// Invalidate every token already issued to this student. Called whenever an
// administrator changes the account in a way that must end existing sessions.
function revokeStudentTokens(user) {
  if (!user) return;
  user.tokenVersion = Number(user.tokenVersion || 1) + 1;
}
// Registration reserves the normalised username and email so two simultaneous
// sign-ups cannot claim the same identity. Those reservations must be released
// when the account is deleted, otherwise the details could never be reused.
async function releaseUserUniqueKeys(user) {
  if (!user) return;
  const keys = [];
  if (user.username) keys.push(`unique/username/${encodeURIComponent(String(user.username).toLowerCase())}`);
  if (user.email) keys.push(`unique/email/${encodeURIComponent(String(user.email).toLowerCase())}`);
  for (const key of keys) {
    try {
      const claim = await store().get(key, { type: "json" });
      // Only clear a reservation that still belongs to the removed account.
      if (!claim || claim.userId === user.id) await store().delete(key);
    } catch {
    }
  }
}
async function adminAuth(request, d, permission = "admin:read") {
  const p = await verifyToken(bearer(request), "admin");
  if (!p) return { error: "session", value: null };
  if (p.iss !== "gifted-brainz-admin" || p.aud !== "gifted-brainz-api" || p.sub !== "admin" || p.role !== "admin") return { error: "permission", value: null };
  const permissions = Array.isArray(p.permissions) ? p.permissions : [];
  if (!permissions.includes("admin:all") && !permissions.includes(permission)) return { error: "permission", value: null };
  return { error: null, value: p };
}
function requiredAdminPermission(request) {
  const method = String(request.method || "GET").toUpperCase();
  return method === "GET" || method === "HEAD" ? "admin:read" : "admin:write";
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 32).toString("hex") };
}
function hashMatches(password, salt, expected) {
  if (!salt || !expected) return false;
  const h = crypto.scryptSync(String(password), salt, 32).toString("hex");
  const a = Buffer.from(h), b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function verifyPassword(password, u) {
  if (!u.passwordHash) return false;
  return hashMatches(password, u.passwordSalt || "gifted-brainz-salt", u.passwordHash);
}
function normalizeTutorReply(value) {
  let s = String(value ?? "").replace(/\r\n?/g, "\n");
  for (let pass = 0; pass < 3; pass++) {
    const next = s.replace(/\\\\(?=[A-Za-z\[\]\(\)\.\*\_\`\#\;\,\:\!])/g, "\\");
    if (next === s) break;
    s = next;
  }
  s = s.replace(/\\=/g, "=");
  s = s.replace(/^\s*```(?:markdown|md|text)?\s*$/gim, "")
       .replace(/^\s*```\s*$/gim, "")
       .replace(/^(\s*\d+)\\\.(?=\s+)/gm, "$1.")
       .replace(/^\s*[-_*]{3,}\s*$/gm, "");
  return s.trim();
}

async function callConfiguredAI(messages, { temperature = 0.2, maxTokens = 5000 } = {}) {
  const key = env("GROQ_API_KEY").trim();
  const endpoint = env("GROQ_API_URL").trim() || "https://api.groq.com/openai/v1/chat/completions";
  const model = env("GROQ_MODEL").trim() || "openai/gpt-oss-120b";
  if (!key) throw new Error("Gifted Brainz AI is not configured yet. Set GROQ_API_KEY on the server.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);
  try {
    const r = await fetch(endpoint, {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${key}`},
      body:JSON.stringify({model,messages,temperature,max_tokens:maxTokens}),
      signal:controller.signal
    });
    const data = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(data?.error?.message || `Groq AI request failed (${r.status}).`);
    const text = data?.choices?.[0]?.message?.content;
    if (!text) throw new Error("Groq returned no usable response.");
    return text;
  } finally { clearTimeout(timer); }
}
function extractJSON(text){
  const raw=String(text||"").trim().replace(/^```(?:json)?\s*/i,"").replace(/\s*```$/i,"");
  try{return JSON.parse(raw)}catch{}
  const a=raw.indexOf("["),b=raw.lastIndexOf("]"); if(a>=0&&b>a) return JSON.parse(raw.slice(a,b+1));
  const c=raw.indexOf("{"),d=raw.lastIndexOf("}"); if(c>=0&&d>c) return JSON.parse(raw.slice(c,d+1));
  throw new Error("The AI response was not valid JSON. Please generate again.");
}
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      ...extra
    }
  });
}
/* ------------------------------------------------------------------
   Request body reading.

   EdgeOne Pages Node Functions do not always expose a spec-complete Request:
   depending on how the gateway forwards a call, `request.json()` can reject
   even though the client sent perfectly valid JSON (the body may arrive as an
   already-parsed object, as text, or as raw bytes, and the stream can only be
   consumed once). The old helper called `request.json()` and relabelled every
   failure as "Invalid JSON.", which is what made material uploads and question
   bank practice fail with a server error on a body that was never malformed.

   readRawBody() tries each shape in turn and caches the result per request, so
   no route can double-consume the stream.
------------------------------------------------------------------- */
var bodyCache = /* @__PURE__ */ new WeakMap();

function preParsedBody(request) {
  for (const key of ["parsedBody", "bodyJson", "jsonBody", "_body", "body"]) {
    const value = request?.[key];
    if (value && typeof value === "object" && !ArrayBuffer.isView(value) && !(value instanceof ArrayBuffer) && typeof value.getReader !== "function")
      return value;
  }
  return null;
}

async function readRawBody(request) {
  if (bodyCache.has(request)) return bodyCache.get(request);
  let bytes = Buffer.alloc(0);
  const attempts = [
    async () => {
      if (typeof request.arrayBuffer !== "function") return null;
      return Buffer.from(await request.arrayBuffer());
    },
    async () => {
      if (typeof request.text !== "function") return null;
      return Buffer.from(await request.text(), "utf8");
    },
    async () => {
      const b = request?.body;
      if (!b || typeof b.getReader !== "function") return null;
      const reader = b.getReader();
      const chunks = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    }
  ];
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      if (result && result.length) { bytes = result; break; }
      if (result && !bytes.length) bytes = result;
    } catch {
      // Try the next shape: a rejected reader here does not mean bad input.
    }
  }
  bodyCache.set(request, bytes);
  return bytes;
}

function stripBom(text) {
  return text.charCodeAt(0) === 65279 ? text.slice(1) : text;
}

async function readJSON(request) {
  const preParsed = preParsedBody(request);
  if (preParsed) return preParsed;

  const bytes = await readRawBody(request);
  const text = stripBom(bytes.toString("utf8")).trim();
  // An empty body on a POST that only carries headers is not an error; the
  // route's own validation decides whether the missing fields matter.
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : { value: parsed };
  } catch (error) {
    const err = new Error(
      `The request body was not valid JSON (content-type "${request.headers?.get?.("content-type") || "unknown"}", ${bytes.length} bytes). ${error.message}`
    );
    err.badRequest = true;
    throw err;
  }
}
var publicUser = (u) => ({ id: u.id, name: u.name, username: u.username, email: u.email, whatsapp: u.whatsapp || "", status: u.status || "active", activated: !!u.activated, emailVerified: u.emailVerified === true, deviceId: u.deviceId || "", productKey: u.productKey || "", selectedSubjects: normaliseSelectedSubjects(u.selectedSubjects).length ? normaliseSelectedSubjects(u.selectedSubjects) : [REQUIRED_REGISTRATION_SUBJECT] });
var cleanString = (v, max = 5e3) => String(v ?? "").trim().slice(0, max);
var ALLOWED_TAGS = /* @__PURE__ */ new Set([
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "strike",
  "br",
  "p",
  "div",
  "span",
  "ul",
  "ol",
  "li",
  "blockquote",
  "h1",
  "h2",
  "h3",
  "h4",
  "sup",
  "sub",
  "code",
  "pre",
  "a",
  "img",
  "video",
  "audio"
]);
var SELF_CLOSING = /* @__PURE__ */ new Set(["br", "img"]);
function sanitizeHtml(input, max = 4e4) {
  const raw = String(input ?? "").slice(0, max);
  let out = "";
  let i = 0;
  const open = [];
  while (i < raw.length) {
    const lt = raw.indexOf("<", i);
    if (lt === -1) {
      out += escapeText(raw.slice(i));
      break;
    }
    out += escapeText(raw.slice(i, lt));
    const gt = raw.indexOf(">", lt);
    if (gt === -1) {
      out += escapeText(raw.slice(lt));
      break;
    }
    const tag = raw.slice(lt + 1, gt);
    i = gt + 1;
    if (/^!--/.test(tag)) continue;
    const closing = tag.startsWith("/");
    const name = (closing ? tag.slice(1) : tag).trim().split(/[\s/>]/)[0].toLowerCase();
    if (!ALLOWED_TAGS.has(name)) {
      if (!closing && /^(script|style|iframe|object|embed)$/.test(name)) {
        const end = raw.toLowerCase().indexOf(`</${name}`, i);
        i = end === -1 ? raw.length : raw.indexOf(">", end) + 1 || raw.length;
      }
      continue;
    }
    if (closing) {
      const idx = open.lastIndexOf(name);
      if (idx === -1) continue;
      while (open.length > idx) out += `</${open.pop()}>`;
      continue;
    }
    if (SELF_CLOSING.has(name)) {
      out += `<${name}>`;
      continue;
    }
    out += `<${name}${safeAttributes(name, tag)}>`;
    open.push(name);
  }
  while (open.length) out += `</${open.pop()}>`;
  return out;
}
function escapeText(t) {
  return String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}
function safeAttributes(name, tag) {
  if (name === "a") {
    const m = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const href = (m && (m[2] ?? m[3] ?? m[4]) || "").trim();
    const url = safeUrl(href);
    if (!url) return "";
    return ` href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer nofollow"`;
  }
  if (["img", "video", "audio"].includes(name)) {
    const key = /data-gb-file\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const fileKey = (key && (key[2] ?? key[3] ?? key[4]) || "").trim();
    if (!/^[a-zA-Z0-9._:-]{1,220}$/.test(fileKey)) return "";
    const alt = /alt\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const title = /title\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
    const label = (alt && (alt[2] ?? alt[3] ?? alt[4]) || "").slice(0, 300);
    const ttl = (title && (title[2] ?? title[3] ?? title[4]) || "").slice(0, 300);
    const playback = name === "video" ? ' controls playsinline preload="metadata"' : name === "audio" ? ' controls preload="metadata"' : ' loading="lazy"';
    return ` data-gb-file="${escapeAttr(fileKey)}"${label ? ` alt="${escapeAttr(label)}"` : ""}${ttl ? ` title="${escapeAttr(ttl)}"` : ""}${playback}`;
  }
  return "";
}

function escapeAttr(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function safeUrl(href) {
  const v = String(href || "").trim();
  if (!v) return "";
  if (/^(https?:\/\/|mailto:|tel:)/i.test(v)) return v.slice(0, 2e3);
  if (/^(\/|#)/.test(v)) return v.slice(0, 2e3);
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return "https://" + v.slice(0, 2e3);
  return "";
}
function linkifyHtml(html) {
  return html.replace(
    /(<a\b[^>]*>.*?<\/a>)|((?:https?:\/\/|www\.)[^\s<>"']+)/gi,
    (whole, anchor, url) => {
      if (anchor) return anchor;
      const clean = url.replace(/[).,;:!?]+$/, "");
      const trailing = url.slice(clean.length);
      const href = /^www\./i.test(clean) ? "https://" + clean : clean;
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer nofollow">${escapeText(clean)}</a>${escapeText(trailing)}`;
    }
  );
}
function richBody(value, max = 4e4) {
  return linkifyHtml(sanitizeHtml(value, max));
}
function stripHtml(value) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/\s+/g, " ").trim();
}
function shuffleCopy(list) {
  const a = Array.isArray(list) ? list.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function romanNumeralStructure(q) {
  const text = stripHtml(q?.q || "");
  return /\bI\./i.test(text) && /\bII\./i.test(text) && /\bIII\./i.test(text) && /\bIV\./i.test(text);
}
function validQuestion(q) {
  const text = stripHtml(q?.q || "");
  const options = Array.isArray(q?.options) ? q.options : [];
  return !!text && options.length >= 4 && options.length <= 5 && options.every(o => stripHtml(o || "").length > 0) && Number.isInteger(Number(q?.answer)) && Number(q.answer) >= 0 && Number(q.answer) < options.length;
}
function questionMarks(q) {
  const n = Number(q?.marks);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function validateQuestionForSubject(q, subject) {
  if (!validQuestion(q)) return "Question text, four or five non-empty options and a valid correct answer are required.";
  if (q?.marks !== undefined && (!Number.isFinite(Number(q.marks)) || Number(q.marks) <= 0)) return "Each CBT question must carry a positive marks value.";
  if (q.roman && !romanNumeralStructure(q)) return "A Roman-numeral question must visibly contain statements I., II., III. and IV.";
  if (q.passageId && !stripHtml(q.passage || "").length) return "Every passage question must include its shared passage text.";
  return "";
}
function questionKey(q) {
  return stripHtml(q?.q || "").replace(/\s+/g, " ").trim().toLowerCase();
}
function validateQuestionSet(questions, subject) {
  if (!Array.isArray(questions) || !questions.length) return "A CBT must contain at least one question.";
  const seen = /* @__PURE__ */ new Map();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const error = validateQuestionForSubject(q, subject);
    if (error) return error;
    const key = questionKey(q);
    if (key) {
      if (seen.has(key)) return `Question ${seen.get(key) + 1} and question ${i + 1} appear to be duplicates. Remove or rewrite one of them.`;
      seen.set(key, i);
    }
  }
  return "";
}

function studentSubjects(user) {
  const selected = normaliseSelectedSubjects(user?.selectedSubjects);
  return selected.length ? selected : [REQUIRED_REGISTRATION_SUBJECT];
}
function assertSubjectAllowed(user, subject) {
  const clean = cleanString(subject || "", 80);
  if (!SUBJECTS.includes(clean)) return { ok: false, status: 400, error: "Choose a valid subject." };
  const allowed = studentSubjects(user);
  if (!allowed.includes(clean)) return { ok: false, status: 403, error: `You are not registered for ${clean}.` };
  return { ok: true, subject: clean, subjects: allowed };
}
function assertUserSubject(user, subject) {
  const result = assertSubjectAllowed(user, subject);
  return result.ok ? null : json({ error: result.error }, result.status);
}
function sanitizeQuestionSetForStudent(set, allowedSubjects) {
  return {
    id: set.id, title: set.title, duration: Number(set.duration) || 0,
    shuffleQuestions: set.shuffleQuestions !== false, shuffleOptions: set.shuffleOptions !== false,
    passMark: Number(set.passMark)||50, oneAttempt:set.oneAttempt!==false, resultVisibility:set.resultVisibility === "held" ? "held" : "immediate", resultReleased:set.resultVisibility !== "held" || set.resultReleased === true, studentFields:normaliseStudentFields(set.studentFields),
    sections: (Array.isArray(set.sections) ? set.sections : []).filter(sec => allowedSubjects.includes(sec.subject)).map(sec => ({
      subject: sec.subject, questions: Array.isArray(sec.questions) ? sec.questions : []
    }))
  };
}
function normaliseStudentFields(fields) {
  if (!Array.isArray(fields)) return [{ key:"full_name", label:"Full Name", type:"text", required:true, leaderboard:true, options:[] }];
  const out=[]; const used=new Set();
  for (let i=0;i<fields.length && out.length<30;i++) {
    const f=fields[i]||{}; let key=cleanString(f.key,80).toLowerCase().replace(/[^a-z0-9_]+/g,"_").replace(/^_+|_+$/g,"")||`field_${i+1}`;
    while(used.has(key)) key=`${key}_${i+1}`; used.add(key);
    out.push({key,label:cleanString(f.label,160)||`Field ${i+1}`,type:["text","email","tel","number","textarea","select"].includes(f.type)?f.type:"text",required:!!f.required,leaderboard:!!f.leaderboard,options:Array.isArray(f.options)?f.options.slice(0,20).map(v=>cleanString(v,120)).filter(Boolean):[]});
  }
  return out;
}
function normaliseQuestion(q) {
  const passage = q.passage ? richBody(q.passage, 12e3) : "";
  const options = Array.isArray(q.options) ? q.options.slice(0, 5).map((o) => richBody(o, 1e3)) : [];
  const image = q.image && (q.image.key || q.image.fileKey) ? normaliseAttachments([q.image])[0] : null;
  return {
    id: cleanString(q.id, 100) || crypto.randomUUID(),
    type: q.type === "passage" ? "passage" : "mcq",
    subject: cleanString(q.subject, 80),
    topicId: cleanString(q.topicId, 100),
    topic: cleanString(q.topic, 200),
    passageId: cleanString(q.passageId, 120),
    sectionId: cleanString(q.sectionId, 100),
    passage,
    q: richBody(q.q, 6e3),
    options,
    answer: Number(q.answer),
    explanation: richBody(q.explanation || "", 4e3),
    image,
    source: cleanString(q.source, 500),
    needsReview: !!q.needsReview,
    roman: !!q.roman,
    marks: questionMarks(q),
    createdAt: q.createdAt || (/* @__PURE__ */ new Date()).toISOString()
  };
}
function publicQuestion(q, includeAnswer = false) {
  const image = q.image && (q.image.key || q.image.fileKey) ? normaliseAttachments([q.image])[0] : q.image || null;
  const out = { id: q.id, type: q.type || "mcq", passageId: q.passageId || "", passage: q.passage || "", sectionId: q.sectionId || "", q: q.q, options: q.options, image, marks: questionMarks(q) };
  if (includeAnswer) {
    out.answer = Number(q.answer);
    out.explanation = q.explanation || "";
  }
  if (q.roman) out.roman = true;
  return out;
}
function buildReviewFromPresented(items, answers) {
  return items.map((item, i) => {
    const chosen = Number.isInteger(answers?.[i]) ? answers[i] : null;
    const q = item.q;
    const answer = Number.isInteger(item.answerIndex) ? item.answerIndex : Number(q.answer);
    return { number: i + 1, q: q.q, passage: q.passage || "", image: q.image || null, options: q.options, answer, chosen, correct: chosen === answer, explanation: q.explanation || "" };
  });
}
function unzipEntries(buffer) {
  const b = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (b.readUInt32LE(i) === 101010256) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("The document archive could not be read.");
  const count = b.readUInt16LE(eocd + 10), cdSize = b.readUInt32LE(eocd + 12), cdOffset = b.readUInt32LE(eocd + 16);
  const out = {};
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (b.readUInt32LE(p) !== 33639248) break;
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), usize = b.readUInt32LE(p + 24), nameLen = b.readUInt16LE(p + 28), extraLen = b.readUInt16LE(p + 30), commentLen = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const name = b.slice(p + 46, p + 46 + nameLen).toString("utf8");
    const localNameLen = b.readUInt16LE(off + 26), localExtraLen = b.readUInt16LE(off + 28), start = off + 30 + localNameLen + localExtraLen;
    const raw = b.slice(start, start + csize);
    let data = raw;
    if (method === 8) {
      data = zlib.inflateRawSync(raw, { maxOutputLength: 16 * 1024 * 1024 });
    } else if (method !== 0) throw new Error("This Word document uses an unsupported compression method.");
    if (data.length > 16 * 1024 * 1024) throw new Error("The Word document is too large to extract safely.");
    if (usize && data.length !== usize) throw new Error("The document archive is incomplete.");
    out[name] = data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
function decodePdfText(buffer) {
  const src = Buffer.from(buffer);
  let text = "";
  const ascii = src.toString("latin1");
  const streams = [...ascii.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)];
  for (const m of streams) {
    let part = Buffer.from(m[1], "latin1");
    try {
      const before = ascii.slice(Math.max(0, m.index - 160), m.index);
      if (/FlateDecode/i.test(before)) part = zlib.inflateSync(part);
    } catch {
    }
    const s = part.toString("latin1");
    for (const x of s.matchAll(/\((?:\\.|[^\)])*\)\s*Tj/g)) {
      const raw = x[0].replace(/\s*Tj$/i, "").slice(1, -1);
      text += raw.replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: "\n", r: "\n", t: "	", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" })[c] || c) + " ";
    }
    for (const x of s.matchAll(/\[([^\]]+)\]\s*TJ/g)) {
      text += x[1].replace(/\((.*?)\)/g, "$1").replace(/-?\d+(?:\.\d+)?/g, " ") + " ";
    }
  }
  return text.replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function decodeTextEntities(value) {
  // Decode HTML/numeric entities repeatedly because imported documents may
  // contain double-encoded entities such as &amp;gt; or &amp;amp;.  Stop when a
  // pass makes no further change so we never loop indefinitely.
  let out = String(value ?? "");
  for (let pass = 0; pass < 4; pass++) {
    const next = out
      .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)); } catch { return _; } })
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } })
      .replace(/\u00a0/g, " ");
    if (next === out) break;
    out = next;
  }
  return out;
}
function normaliseImportedMathMarkup(value) {
  let out = decodeTextEntities(value)
    .replace(/([A-Za-z0-9]+)<sub>\s*1\s*<\/sub>\s*<sub>\s*0\s*<\/sub>/gi, "$1<sub>10</sub>")
    .replace(/([A-Za-z0-9]+)<sub>\s*([0-9]+)\s*<\/sub>/gi, "$1<sub>$2</sub>");
  // Convert common caret notation to real HTML superscripts for imported math.
  out = out.replace(/\^\(([^()\n]+)\)/g, "<sup>$1</sup>")
    .replace(/\^([+-]?\d+(?:\/\d+)?)/g, "<sup>$1</sup>")
    // Convert explicit underscore base/index notation to HTML subscripts.
    .replace(/([A-Za-z0-9])_([A-Za-z0-9]+)/g, "$1<sub>$2</sub>")
    .replace(/\blog(\d+)/gi, "log<sub>$1</sub>");
  // Promote common Unicode superscript/subscript characters into semantic HTML.
  const sup = { "⁰":"0","¹":"1","²":"2","³":"3","⁴":"4","⁵":"5","⁶":"6","⁷":"7","⁸":"8","⁹":"9","⁻":"-","⁺":"+" };
  const sub = { "₀":"0","₁":"1","₂":"2","₃":"3","₄":"4","₅":"5","₆":"6","₇":"7","₈":"8","₉":"9","₋":"-","₊":"+" };
  for (const [u, ascii] of Object.entries(sup)) out = out.replaceAll(u, `<sup>${ascii}</sup>`);
  for (const [u, ascii] of Object.entries(sub)) out = out.replaceAll(u, `<sub>${ascii}</sub>`);
  return out;
}
function compactImportedText(value) {
  return normaliseImportedMathMarkup(String(value ?? ""))
    .replace(/\s+/g, " ")
    .replace(/\s*<br\s*\/?>\s*/gi, "<br>")
    .replace(/\s+(?=<\/?(?:sup|sub)>)/gi, "")
    .replace(/(?<=<\/(?:sup|sub)>)\s+/gi, " ")
    .trim();
}

function cleanImportedQuestionText(value, opts = {}) {
  let out = decodeTextEntities(value);
  const kind = String(opts.kind || "content");

  // Remove publisher/document artefacts that frequently leak out of PDFs/Word files.
  out = out
    .replace(/(?:https?:\/\/|www\.)\S+/gi, " ")
    .replace(/^\s*(?:download\s+.*|www\.[^\n]*)$/gim, " ")
    .replace(/\b(?:jamb\s+past\s+questions?|jamb|(?:biology|chemistry|physics|mathematics|use\s+of\s+english))\s+\d{4}\b/gi, " ")
    .replace(/^\s*\d{1,3}\s*\/\s*\d{1,3}\s*$/gm, " ")
    .replace(/^\s*(?:page|pg\.)\s*\d{1,4}\s*$/gim, " ")
    .replace(/^\s*(?:fig(?:ure)?\s*\.?\s*\d{1,3}|fig\.)\s*$/gim, " ");

  // “Fig. 2”, “Figure 2”, etc. are usually source labels rather than part of
  // the question. Preserve the semantic reference without leaking the label.
  // In passages, keep the wording natural; elsewhere remove the label.
  out = out.replace(/\b(?:fig(?:ure)?\s*\.?\s*\d{1,3})\b/gi, kind === "passage" ? "the diagram" : "");
  out = out.replace(/\b(?:see|refer\s+to|study)\s+(?:the\s+)?(?:fig(?:ure)?\s*\.?\s*\d{1,3})\b/gi, "$1 the diagram");
  out = out.replace(/\s*\(\s*(?:fig(?:ure)?\s*\.?\s*\d{1,3})\s*\)\s*/gi, " ");

  // Remove repeated source instructions already represented by the structured
  // passage/group fields.
  out = out
    .replace(/^\s*(?:use|study|refer\s+to|read|consider)\s+(?:this|the|fig(?:ure)?\.?)?.{0,220}?\bquestions?\s+\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}[^\n]*$/gim, " ")
    .replace(/^\s*(?:question|questions)\s+\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}\s*(?:are|is)?\s*(?:based\s+on|from)\s*(?:the)?\s*$/gim, " ");

  // Normalize stray OCR punctuation/spacing without touching mathematical
  // operators such as > when they are genuine content.
  out = out
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return out;
}

function xmlToText(xml) {
  return decodeTextEntities(
    String(xml)
      .replace(/<w:tab[^>]*\/>/g, "\t")
      .replace(/<w:br[^>]*\/>/g, "\n")
      .replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (m) => m.replace(/<[^>]+>/g, " ") + "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function xmlToTextWithImages(xml, imageByRid) {
  const source = String(xml);
  const paragraphs = [...source.matchAll(/<w:p\b[\s\S]*?<\/w:p>/gi)].map(m => m[0]);
  const rendered = paragraphs.map((pXml) => {
    let p = pXml;
    // Replace drawings with their image markers first so they survive run parsing.
    p = p.replace(/<w:drawing[\s\S]*?<\/w:drawing>/gi, (m) => {
      const rid = /r:embed\s*=\s*["']([^"']+)["']/i.exec(m)?.[1] || /r:id\s*=\s*["']([^"']+)["']/i.exec(m)?.[1] || "";
      return rid && imageByRid.has(rid) ? ` [[GBIMG:${rid}]] ` : " ";
    }).replace(/<w:pict[\s\S]*?<\/w:pict>/gi, (m) => {
      const rid = /r:id\s*=\s*["']([^"']+)["']/i.exec(m)?.[1] || "";
      return rid && imageByRid.has(rid) ? ` [[GBIMG:${rid}]] ` : " ";
    });
    // Convert each Word run into text while preserving actual superscript/subscript.
    p = p.replace(/<w:r\b[\s\S]*?<\/w:r>/gi, (runXml) => {
      const text = [...runXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gi)].map(m => m[1]).join("")
        + [...runXml.matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/gi)].map(m => m[1]).join("");
      const breaks = (runXml.match(/<w:br\b[^>]*\/>/gi) || []).length;
      const tabs = (runXml.match(/<w:tab\b[^>]*\/>/gi) || []).length;
      if (!text && !breaks && !tabs) return "";
      const val = text + "\n".repeat(breaks) + "\t".repeat(tabs);
      const vert = /<w:vertAlign\b[^>]*w:val\s*=\s*["'](superscript|subscript)["']/i.exec(runXml)?.[1]?.toLowerCase();
      if (vert === "superscript") return `<sup>${val}</sup>`;
      if (vert === "subscript") return `<sub>${val}</sub>`;
      return val;
    });
    // Handle any text that sits outside a run, then strip the remaining XML.
    p = p.replace(/<w:tab\b[^>]*\/>/gi, "\t").replace(/<w:br\b[^>]*\/>/gi, "\n").replace(/<[^>]+>/g, "");
    return p;
  }).join("\n");
  return decodeTextEntities(rendered)
    .replace(/\r/g, "")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
function relationshipTargetMap(relsXml) {
  const out = new Map();
  for (const m of String(relsXml || "").matchAll(/<Relationship\b[^>]*?Id\s*=\s*["']([^"']+)["'][^>]*?Target\s*=\s*["']([^"']+)["'][^>]*?\/?>(?:<\/Relationship>)?/gi)) {
    const target = String(m[2]).replace(/^\.?\//, "");
    out.set(m[1], target.startsWith("word/") ? target : `word/${target}`);
  }
  return out;
}
function extractDocxParts(buffer) {
  const z = unzipEntries(buffer);
  const doc = z["word/document.xml"];
  if (!doc) throw new Error("No Word document body was found.");
  const rels = relationshipTargetMap(z["word/_rels/document.xml.rels"]?.toString("utf8") || "");
  const assets = new Map();
  const imageByRid = new Map();
  for (const [rid, target] of rels.entries()) {
    if (!/^word\/media\//i.test(target)) continue;
    const data = z[target];
    if (!data || !data.length) continue;
    const fileName = target.split("/").pop() || `image-${assets.size + 1}.bin`;
    const contentType = guessContentType(fileName);
    const marker = `[[GBIMG:${rid}]]`;
    const asset = { marker, rid, fileName, contentType, data: Buffer.from(data) };
    assets.set(marker, asset);
    imageByRid.set(rid, asset);
  }
  const text = xmlToTextWithImages(doc.toString("utf8"), imageByRid);
  return { text, assets };
}
function extractPdfImageAssets(buffer) {
  const ascii = Buffer.from(buffer).toString("latin1");
  const assets = new Map();
  let index = 0;
  for (const m of ascii.matchAll(/<<([\s\S]*?\/Subtype\s*\/Image[\s\S]*?)>>\s*stream\r?\n/g)) {
    const dict = m[1];
    const streamStart = m.index + m[0].length;
    const end = ascii.indexOf("endstream", streamStart);
    if (end < 0) continue;
    const raw = Buffer.from(ascii.slice(streamStart, end).replace(/\r?\n$/, ""), "latin1");
    const filterMatch = /\/Filter\s*\/([A-Za-z0-9]+)/i.exec(dict);
    const filter = filterMatch?.[1] || "";
    let data = raw;
    let contentType = "";
    let ext = "";
    if (/^DCTDecode$/i.test(filter)) { contentType = "image/jpeg"; ext = ".jpg"; }
    else if (/^JPXDecode$/i.test(filter)) { contentType = "image/jp2"; ext = ".jp2"; }
    else continue;
    const marker = `[[GBIMG:PDF:${index++}]]`;
    assets.set(marker, { marker, rid: marker, fileName: `figure-${index}${ext}`, contentType, data });
  }
  return assets;
}
async function extractDocumentParts(buffer, fileName, contentType) {
  const n = String(fileName || "").toLowerCase(), t = String(contentType || "").toLowerCase();
  if (/\.docx$/.test(n) || t.includes("wordprocessingml.document")) return extractDocxParts(buffer);
  if (/\.doc$/.test(n) || t.includes("msword")) return { text: buffer.toString("latin1").replace(/[^\x20-\x7E\r\n\t]/g, " ").replace(/\s+/g, " ").trim(), assets: new Map() };
  if (/\.pdf$/.test(n) || t.includes("application/pdf")) return { text: decodePdfText(buffer), assets: extractPdfImageAssets(buffer) };
  return {
    text: buffer.toString("utf8").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim(),
    assets: new Map()
  };
}
async function extractDocumentText(buffer, fileName, contentType) {
  return (await extractDocumentParts(buffer, fileName, contentType)).text;
}
function parseExtractedQuestions(text, assets = new Map(), subject = "") {
  const clean = cleanImportedQuestionText(text).replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n");
  const diagnostics = {
    characters: clean.length, numbered: 0, skipped: 0, skippedReasons: [], answerKeyFound: false,
    explanationsFound: 0, fiveOptionQuestions: 0, passageGroups: 0, imagesFound: assets.size, imagesAttached: 0,
    convertedFiveToFour: 0, comprehensionGroups: 0, clozeGroups: 0
  };
  const answerMap = new Map();
  const reasonMap = new Map();
  const lines = clean.split(/\n/);
  const lineOffsets = [];
  let cursor = 0;
  for (const line of lines) { lineOffsets.push(cursor); cursor += line.length + 1; }
  // Do not invent a generic instruction for imported groups. When the source contains
  // an instruction, preserve that wording; otherwise leave the shared context unlabelled.
  const extractSourceInstruction = (rawPreamble, kind) => {
    const src = String(rawPreamble || "").replace(/\r/g, "").trim();
    if (!src) return "";
    const patterns = [
      /^\s*(?:read\s+(?:the\s+following\s+)?passage(?:s)?(?:\s+carefully)?[^\n]*?)(?:[.!?]|$)/im,
      /^\s*(?:answer\s+questions?\s+\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}[^\n]*?)(?:[.!?]|$)/im,
      /^\s*(?:for\s+questions?\s+\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}[^\n]*?)(?:[.!?]|$)/im,
      /^\s*(?:use\s+(?:the\s+)?(?:passage|information|diagram|figure|chart|graph|illustration|map|picture)[^\n]*?)(?:[.!?]|$)/im,
      /^\s*(?:complete\s+the\s+passage[^\n]*?)(?:[.!?]|$)/im
    ];
    for (const re of patterns) {
      const m = src.match(re);
      if (m && m[0].trim()) return m[0].trim();
    }
    return "";
  };
  const cueKind = (value) => {
    const s = String(value || "");
    if (/\b(?:fig(?:ure)?\.?|diagram|chart|graph|illustration|map|photograph|picture)\b/i.test(s)) return "diagram";
    if (/\b(?:cloze|fill(?:\s+in)?\s+the\s+(?:blank|gap)|gaps?)\b/i.test(s)) return "cloze";
    if (/\b(?:passage|read\s+each|read\s+the\s+following|read\s+the\s+passage|comprehension)\b/i.test(s)) return "passage";
    return "information";
  };
  const isSectionHeader = (line, kind) => {
    const s = String(line || "").trim();
    if (kind === "answers") return /^(?:answer\s*key|answers|correct\s*answers)\s*[:\-]?$/i.test(s);
    return /^(?:reasons|explanations|rationales)\s*[:\-]?$/i.test(s);
  };
  const isPassageHeader = (line) => {
    const s = String(line || "").trim();
    return /^(?:comprehension(?:\s+passage)?|cloze(?:\s+(?:test|passage))?|passage\s+(?:[ivxlcdm]+|\d+)|passage\s+one|passage\s+two|passage\s+three|passage\s+four|passage\s+five)$/i.test(s)
      || /^(?:read\s+(?:the\s+following\s+)?passage|read\s+each\s+passage\s+carefully|read\s+the\s+passage\s+below)/i.test(s);
  };
  const isEnglishComprehensionCue = (line) => {
    const s = String(line || "").trim();
    return /^(?:read\s+(?:the\s+following\s+)?passage|read\s+each\s+passage\s+carefully|read\s+the\s+passage\s+below|for\s+questions?\s*\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}|answer\s+questions?\s*\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}\s+(?:on|from)\s+the\s+passage)/i.test(s)
      || /\b(?:comprehension|passage)\b/i.test(s) && /^\s*(?:section|part|read|answer|questions?)/i.test(s);
  };
  const findSection = (re) => { const idx = lines.findIndex(line => re.test(String(line || "").trim())); return idx >= 0 ? lines.slice(idx + 1).join("\n") : ""; };
  const answerSection = findSection(/^(?:answer\s*key|answers|correct\s*answers)\s*[:\-]?$/i);
  const reasonSection = findSection(/^(?:reasons|explanations|rationales)\s*[:\-]?$/i);
  if (answerSection) for (const m of answerSection.matchAll(/(?:^|\n|[\s,;])([0-9]{1,3})[.)\-:]?\s*([A-E])\b/gi)) answerMap.set(Number(m[1]), "ABCDE".indexOf(m[2].toUpperCase()));
  if (reasonSection) {
    const rl = reasonSection.split(/\n/); let current = null, buffer = [];
    const flush = () => { if (current !== null) { const r = buffer.join(" ").trim(); if (r) reasonMap.set(current, r); } buffer = []; };
    for (const line of rl) { const m = /^\s*(\d{1,3})[.)\-:]\s*(.*)$/.exec(line); if (m) { flush(); current = Number(m[1]); if (m[2]) buffer.push(m[2]); } else if (current !== null && line.trim()) buffer.push(line.trim()); }
    flush();
  }
  diagnostics.answerKeyFound = answerMap.size > 0;
  let questionText = clean;
  const sectionIndex = lines.findIndex(line => isSectionHeader(line, "answers") || isSectionHeader(line, "reasons"));
  if (sectionIndex >= 0) questionText = lines.slice(0, sectionIndex).join("\n").trim();
  // English comprehension questions are often embedded in long unnumbered prose passages.
  // Only accept question numbers that start a new line. This prevents dates, percentages,
  // years, list numbers, and other numerals inside a passage from being mistaken for questions.
  const starts = [...questionText.matchAll(/(?:^|\n)[ \t]*(?:Question\s*)?(\d{1,3})[.)\-:](?=\s)/gi)];
  const candidates = [];
  let expected = 1;
  for (let i = 0; i < starts.length; i++) {
    const m = starts[i], n = Number(m[1]);
    const index = m.index + (m[0].length - m[0].trimStart().length);
    const preceding = questionText.slice(Math.max(0, index - 220), index);
    const reset = n === 1 && (expected !== 1) && /(?:passage|comprehension|read the following|read each passage|read the passage below|section\s*\d*)/i.test(preceding);
    if (n === expected || (expected === 1 && n > 0) || reset) {
      candidates.push({ m, n, index });
      expected = n + 1;
    }
  }
  const passageHeaderOffsets = [];
  for (const h of lines.map((line, i) => ({ line: String(line || "").trim(), i }))) {
    if (isPassageHeader(h.line)) passageHeaderOffsets.push(lineOffsets[h.i]);
  }
  const chunks = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const nextQuestion = i + 1 < candidates.length ? candidates[i + 1].index : questionText.length;
    const nextHeader = passageHeaderOffsets.find(pos => pos > c.index && pos < nextQuestion);
    const end = nextHeader ?? nextQuestion;
    const chunk = questionText.slice(c.index, end).trim(); if (chunk.length > 10) chunks.push({ text: chunk, number: c.n, start: c.index, end });
  }
  diagnostics.numbered = chunks.length;
  const qStarts = new Map(chunks.map(c => [c.number, c.start]));
  const groupDefs = [];
  const makeGroup = (from, to, rawPreamble, kind, markers = []) => {
    if (to < from || from == null) return;
    const sourceInstruction = extractSourceInstruction(rawPreamble, kind);
    const prose = String(rawPreamble || "")
      .replace(/^[ \t]*(?:use|study|refer\s+to|read|consider|in\s+questions?)[^\n]*(?:questions?|q(?:uestions?)?\.?)[ \t]*\d{1,3}\s*(?:to|[-–—])[ \t]*\d{1,3}[^\n]*$/gim, "")
      .replace(/^[ \t]*(?:comprehension(?:\s+passage)?|cloze(?:\s+(?:test|passage))?|passage\s+(?:[ivxlcdm]+|\d+)|passage\s+(?:one|two|three|four|five))[ \t]*$/gim, "")
      .replace(/^[ \t]*read each passage carefully and answer the questions that follow it\.?[ \t]*$/gim, "")
      .replace(/^[ \t]*read the (?:following )?passage(?:s)?[^\n]*$/gim, "")
      .replace(/^[ \t]*answer questions?[^\n]*$/gim, "")
      .replace(/^[ \t]*for questions?[^\n]*$/gim, "")
      .replace(/^[ \t]*in questions?\s*\d{1,3}\s*(?:to|[-–—])\s*\d{1,3}[^\n]*$/gim, "")
      .replace(/\[\[GBIMG:[^\]]+\]\]/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    const cleanedProse = prose ? cleanImportedQuestionText(prose, { kind }) : "";
    const passage = sourceInstruction
      ? (cleanedProse ? `${sourceInstruction}\n\n${cleanedProse}` : sourceInstruction)
      : cleanedProse;
    const id = `AUTO-GROUP-${from}-${to}-${crypto.createHash("sha1").update(`${kind}\n${rawPreamble}`).digest("hex").slice(0, 8)}`;
    groupDefs.push({ id, from, to, passage, kind, markers: markers.filter(x => assets.has(x)) });
  };
  // Detect linked blocks such as “Use Fig. 1 to answer questions 2–4”.
  const groupRe = /(.{0,300}?(?:use|study|refer\s+to|read|consider|in)\b[\s\S]{0,220}?)(?:questions?|q(?:uestions?)?\.?)[ \t]*(\d{1,3})\s*(?:to|[-–—])\s*(\d{1,3})/gi;
  for (const m of questionText.matchAll(groupRe)) {
    const from = Number(m[2]), to = Number(m[3]); if (to <= from) continue;
    const first = qStarts.get(from); if (first === undefined) continue;
    let prevEnd = 0; for (const c of chunks) if (c.number < from) prevEnd = Math.max(prevEnd, c.end);
    const preamble = questionText.slice(prevEnd, first).trim();
    if (!preamble) continue;
    const markers = [...preamble.matchAll(/\[\[GBIMG:[^\]]+\]\]/g)].map(x => x[0]);
    makeGroup(from, to, preamble, cueKind(preamble), markers);
  }
  // Detect standard comprehension/cloze/passage headings even when the source gives no range.
  const headerIndexes = lines.map((line, i) => ({ line: String(line || "").trim(), i })).filter(x => isPassageHeader(x.line));
  for (let h = 0; h < headerIndexes.length; h++) {
    const header = headerIndexes[h];
    const nextHeaderLine = headerIndexes[h + 1]?.i ?? lines.length;
    const startOffset = lineOffsets[header.i];
    const endOffset = nextHeaderLine < lineOffsets.length ? lineOffsets[nextHeaderLine] : questionText.length;
    const block = questionText.slice(startOffset, Math.min(endOffset, questionText.length)).trim();
    const nums = chunks.filter(c => c.start >= startOffset && c.start < Math.min(endOffset, questionText.length)).map(c => c.number);
    if (!nums.length) continue;
    const firstQuestion = Math.min(...nums), lastQuestion = Math.max(...nums);
    const firstChunk = chunks.find(c => c.number === firstQuestion);
    const preamble = firstChunk ? questionText.slice(startOffset, firstChunk.start).trim() : block;
    const markers = [...preamble.matchAll(/\[\[GBIMG:[^\]]+\]\]/g)].map(x => x[0]);
    const kind = /\bcloze\b|fill(?:\s+in)?\s+the\s+(?:blank|gap)/i.test(block) ? "cloze" : "passage";
    makeGroup(firstQuestion, lastQuestion, preamble, kind, markers);
    if (kind === "cloze") diagnostics.clozeGroups += 1; else diagnostics.comprehensionGroups += 1;
  }
  // Detect a passage-style instruction without an explicit range, especially in English.
  const instructionLines = lines.map((line, i) => ({ line: String(line || "").trim(), i }))
    .filter(x => isEnglishComprehensionCue(x.line));
  for (let k = 0; k < instructionLines.length; k++) {
    const item = instructionLines[k];
    const nextLine = instructionLines[k + 1]?.i ?? lines.length;
    const endOffset = nextLine < lineOffsets.length ? lineOffsets[nextLine] : questionText.length;
    const nums = chunks.filter(c => c.start >= lineOffsets[item.i] && c.start < endOffset).map(c => c.number);
    if (!nums.length) continue;
    const firstQuestion = Math.min(...nums), lastQuestion = Math.max(...nums);
    const firstChunk = chunks.find(c => c.number === firstQuestion);
    const block = questionText.slice(lineOffsets[item.i], endOffset).trim();
    const preamble = firstChunk ? questionText.slice(lineOffsets[item.i], firstChunk.start).trim() : block;
    makeGroup(firstQuestion, lastQuestion, preamble, cueKind(block), [...preamble.matchAll(/\[\[GBIMG:[^\]]+\]\]/g)].map(x => x[0]));
  }
  // English fallback: if no explicit "Passage/Comprehension" heading exists, treat the
  // prose immediately preceding a run of numbered questions as the shared passage.
  // This is deliberately conservative: it activates only for English and only when the
  // preamble contains normal prose and no option markers.
  if (/^(?:English|Use\s+of\s+English)\b/i.test(String(subject || "")) && chunks.length && groupDefs.length === 0) {
    const firstChunk = chunks[0];
    const preceding = questionText.slice(0, firstChunk.start).trim();
    if (preceding && preceding.length >= 120 && !/(?:^|\n)[ \t]*[A-D][.)](?=\s)/i.test(preceding)) {
      const firstNum = chunks[0].number;
      const lastNum = chunks[chunks.length - 1].number;
      const looksLikePassage = /[.!?][ \t]*(?:[A-Z][a-z]|["“])/m.test(preceding) || preceding.split(/\s+/).length >= 45;
      if (looksLikePassage) makeGroup(firstNum, lastNum, preceding, "passage", []);
    }
  }

  // De-duplicate overlapping group definitions, preferring the richer/earlier definition.
  const uniqueGroups = [];
  for (const g of groupDefs) {
    const existing = uniqueGroups.find(x => x.from === g.from && x.to === g.to);
    if (!existing || g.passage.length > existing.passage.length) {
      if (existing) uniqueGroups.splice(uniqueGroups.indexOf(existing), 1);
      uniqueGroups.push(g);
    }
  }
  // Associate PDF assets in document order with shared groups when the PDF parser cannot retain inline positions.
  if (assets.size) {
    const assetMarkers = [...assets.keys()]; let assetIndex = 0;
    for (const g of uniqueGroups) {
      if (!g.markers.length && assetIndex < assetMarkers.length) g.markers = [assetMarkers[assetIndex++]];
    }
  }
  diagnostics.passageGroups = uniqueGroups.length;
  const findGroup = (n) => uniqueGroups
    .filter(g => n >= g.from && n <= g.to)
    .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0] || null;
  const note = (number, reason) => { diagnostics.skipped++; if (diagnostics.skippedReasons.length < 20) diagnostics.skippedReasons.push({ number: number || "?", reason }); };
  const out = [];
  for (const c of chunks) {
    const chunk = c.text, qNumber = c.number;
    const inlineReasonMatch = /(?:^|\n|\s)(?:reason|explanation|rationale)\s*[:\-]\s*([\s\S]+)$/i.exec(chunk);
    let explanation = compactImportedText(cleanImportedQuestionText(inlineReasonMatch?.[1] || reasonMap.get(qNumber) || "")).trim(); if (explanation) diagnostics.explanationsFound++;
    const bodyWithoutReason = inlineReasonMatch ? chunk.slice(0, inlineReasonMatch.index).trim() : chunk;
    const ans = /\b(?:answer|ans|correct(?: answer)?)\s*[:.\-]?\s*([A-E])\b/i.exec(bodyWithoutReason);
    const body = bodyWithoutReason.replace(/^\s*(?:answer|ans|correct(?: answer)?)\s*[:.\-]?\s*[A-E]\b[^\n]*$/gim, "").replace(/(?:\n|\s)(?:answer|ans|correct(?: answer)?)\s*[:.\-]?\s*[A-E]\b[^\n]*$/i, "").trim();
    const om = [...body.matchAll(/(?:^|\n|\s)([A-E])[.)\-:](?=\s)/gi)];
    if (om.length < 4) { note(qNumber, `only ${om.length} of the required A–D options were found`); continue; }
    if (om.length > 5) note(qNumber, "more than five option markers were found; only A–E were considered");
    const hadFive = om.length >= 5; if (hadFive) diagnostics.fiveOptionQuestions++;
    const limit = Math.min(om.length, 5);
    let qText = compactImportedText(cleanImportedQuestionText(body.slice(0, om[0].index).trim().replace(/^(?:Question\s*)?\d{1,3}[.)\-:]\s*/i, "")));
    const markerMatches = [...body.matchAll(/\[\[GBIMG:[^\]]+\]\]/g)].map(x => x[0]).filter(x => assets.has(x));
    const group = findGroup(qNumber);
    const groupMarkers = group?.markers || [];
    let imageRef = markerMatches[0] || groupMarkers[0] || null;
    if (!imageRef && assets.size && !group && out.length === 0) imageRef = [...assets.keys()][0];
    if (imageRef) { qText = qText.replace(/\[\[GBIMG:[^\]]+\]\]/g, " ").replace(/\s{2,}/g, " ").trim(); diagnostics.imagesAttached++; }
    const isRoman = /\bI\./i.test(qText) && /\bII\./i.test(qText) && /\bIII\./i.test(qText) && /\bIV\./i.test(qText);
    const rawOpts = [];
    for (let j = 0; j < limit; j++) {
      const st = om[j].index + om[j][0].length; const en = j + 1 < limit ? om[j + 1].index : body.length;
      rawOpts.push(compactImportedText(cleanImportedQuestionText(body.slice(st, en).replace(/\[\[GBIMG:[^\]]+\]\]/g, " ").trim())));
    }
    // Gifted Brainz stores four options only. When a source has A–E, fold E into D and remap E as D.
    const sourceAnswer = ans ? "ABCDE".indexOf(ans[1].toUpperCase()) : (answerMap.get(qNumber) ?? -1);
    const options = rawOpts.slice(0, 4);
    let answerIndex = sourceAnswer < 0 ? 0 : Math.min(sourceAnswer, 3);
    if (rawOpts.length >= 5) {
      const eText = rawOpts[4];
      if (eText) options[3] = options[3] ? `${options[3]} / ${eText}` : eText;
      answerIndex = sourceAnswer === 4 ? 3 : Math.min(sourceAnswer, 3);
      diagnostics.convertedFiveToFour += 1;
    }
    if (!qText) { note(qNumber, "the question text was empty"); continue; }
    if (options.some(x => !x)) { note(qNumber, "one of the four A–D options came through blank"); continue; }
    explanation = improveImportedExplanation(qText, options, answerIndex, explanation);
     const passage = group?.passage || "";
    const needsReview = sourceAnswer < 0 || (sourceAnswer >= options.length && sourceAnswer < 4);
    out.push({ q: qText, options, answer: answerIndex, explanation, needsReview, roman: isRoman, source: "Imported document", number: qNumber || null, extraOptionCount: Math.max(0, rawOpts.length - 4), type: group ? "passage" : "mcq", passageId: group?.id || "", passage, imageRef });
  }
  return { questions: out, report: diagnostics, assets };
}


function stripRawHtmlTags(value) {
  return String(value ?? "")
    .replace(/(<\/?(?:sup|sub)>)/gi, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?(?:p|div|span|strong|em|b|i|u|table|tr|td|th|ol|ul|li)[^>]*>/gi, " ")
    .replace(/\s+/g, " ").trim();
}
function explanationLooksMechanicalOrMeta(value) {
  const s=stripRawHtmlTags(value).toLowerCase();
  if(!s)return true;
  return /(source|printed|displayed expression|source key|retain|reproduced as it appears|source item|typeset|extraction|document|inconsistent|consult the original)/i.test(s)
    || /^(convert|place|write|choose|select)\b/.test(s) && s.length<120;
}
function generatedStudentFriendlyExplanation(question, options, answerIndex) {
  const q=stripRawHtmlTags(question);
  const answer=Array.isArray(options)&&Number.isInteger(answerIndex)?stripRawHtmlTags(options[answerIndex]||""):"";
  const m=q.match(/(?:convert|change|express)\s+(\d+)\s*(?:₁₀|_10)\s+(?:to|into)\s+(?:base\s*)?(\d+)/i);
  if(m){
    const value=Number(m[1]), base=Number(m[2]);
    if(Number.isInteger(value)&&base>=2&&base<=36){
      const parts=[]; let n=value, place=0;
      if(n===0)parts.push("0");
      while(n>0){const rem=n%base;if(rem)parts.unshift(`${rem}×${base}<sup>${place}</sup>`);n=Math.floor(n/base);place++;}
      const result=value.toString(base).toUpperCase();
      return `To convert ${value}<sub>10</sub> to base ${base}, express ${value} as powers of ${base}: ${parts.join(" + ")}. The coefficients of these powers give ${result}<sub>${base}</sub>. Therefore, the correct answer is ${answer ? `<b>${answer}</b>.` : "the option showing this value."}`;
    }
  }
  const bin=q.match(/(?:convert|change|evaluate)\s+([01]{2,})\s*(?:₂|_2)\s*(?:to|into)\s+(?:decimal|base\s*10)/i);
  if(bin){
    const v=bin[1]; let total=0; const terms=[];
    [...v].forEach((digit,i)=>{const p=v.length-1-i;if(digit==="1"){terms.push(`2<sup>${p}</sup>`);total+=2**p;}});
    return `Expand the binary number using powers of 2: ${v}<sub>2</sub> = ${terms.join(" + ")} = ${total}<sub>10</sub>. Therefore, the correct answer is ${answer ? `<b>${answer}</b>.` : "the option with this value."}`;
  }
  return answer
    ? `Apply the rule tested in the question step by step, simplify the result, and compare it with the four options. The result is <b>${answer}</b>.`
    : "Apply the rule tested in the question step by step and compare the result with the four options.";
}
function improveImportedExplanation(question, options, answerIndex, existing) {
  const cleaned=compactImportedText(stripRawHtmlTags(existing));
  return explanationLooksMechanicalOrMeta(cleaned) ? generatedStudentFriendlyExplanation(question,options,answerIndex,cleaned) : cleaned;
}
function extractionReport(report, questions) {
  const needsReview = questions.filter((q) => q.needsReview).length;
  const clean = questions.length - needsReview;
  let quality = "good";
  if (!questions.length) quality = "failed";
  else if (report.skipped > questions.length * 0.25 || needsReview > questions.length * 0.5) quality = "partial";
  else if (report.skipped || needsReview) quality = "fair";
  const bits = [];
  bits.push(`${questions.length} question${questions.length === 1 ? "" : "s"} extracted from ${report.numbered} numbered block${report.numbered === 1 ? "" : "s"}.`);
  bits.push(clean ? `${clean} came through with a confirmed correct answer.` : "None of them carried a confirmed correct answer.");
  if (needsReview) bits.push(`${needsReview} need${needsReview === 1 ? "s" : ""} you to set the correct answer by hand.`);
  if (report.skipped) bits.push(`${report.skipped} block${report.skipped === 1 ? " was" : "s were"} skipped because they did not look like complete multiple-choice questions.`);
  bits.push(report.answerKeyFound ? "An answer key was detected in the document." : "No answer key was detected in the document.");
  if (report.explanationsFound) bits.push(`${report.explanationsFound} question${report.explanationsFound === 1 ? " has" : "s have"} an explanation/reason detected and attached.`);
  else bits.push("No explanation/reason was detected in the document.");
  if (report.fiveOptionQuestions) bits.push(`${report.fiveOptionQuestions} source question${report.fiveOptionQuestions === 1 ? " was" : "s were"} converted from A–E to A–D by folding E into D.`);
  if (report.comprehensionGroups) bits.push(`${report.comprehensionGroups} comprehension passage group${report.comprehensionGroups === 1 ? " was" : "s were"} detected.`);
  if (report.clozeGroups) bits.push(`${report.clozeGroups} cloze passage group${report.clozeGroups === 1 ? " was" : "s were"} detected.`);
  if (report.convertedFiveToFour) bits.push(`${report.convertedFiveToFour} question${report.convertedFiveToFour === 1 ? " is" : "s are"} stored with exactly four options A–D.`);
  return {
    quality,
    needsReview,
    clean,
    skipped: report.skipped,
    numbered: report.numbered,
    answerKeyFound: report.answerKeyFound,
    skippedReasons: report.skippedReasons,
    summary: bits.join(" "),
    verdict: quality === "good" ? "Extracted properly \u2705" : quality === "fair" ? "Extracted, with a few items to check \u26A0\uFE0F" : quality === "partial" ? "Only partly extracted \u2014 please review \u26A0\uFE0F" : "Extraction failed \u274C"
  };
}
async function persistImportedImageAssets(questions, assets, sourceTag = "import") {
  const stored = new Map();
  for (const q of questions) {
    const marker = q.imageRef;
    if (!marker) continue;
    const asset = assets.get(marker);
    if (!asset) continue;
    let meta = stored.get(marker);
    if (!meta) {
      const safeName = String(asset.fileName || "image.png").replace(/[^a-zA-Z0-9._() \-]/g, "_") || "image.png";
      const key = `uploads/import-${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safeName}`;
      await store().set(key, asset.data);
      await store().setJSON(`${key}.meta`, { fileName: safeName, contentType: asset.contentType || guessContentType(safeName) || "application/octet-stream", size: asset.data.length, parts: 1, importedFrom: sourceTag });
      meta = { key, fileName: safeName, contentType: asset.contentType || guessContentType(safeName) || "application/octet-stream", size: asset.data.length };
      stored.set(marker, meta);
    }
    q.image = meta;
    delete q.imageRef;
  }
  for (const q of questions) delete q.imageRef;
  return questions;
}
async function readStoredFile(key, maxBytes = 15 * 1024 * 1024) {
  const safe = String(key || "");
  if (!/^uploads\/[A-Za-z0-9._()\- ]+$/.test(safe)) throw new Error("Invalid uploaded file.");

  // Object-storage backends can be briefly eventually-consistent immediately
  // after upload completion. Retry the metadata/part reads before declaring
  // the reference unreadable.
  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const meta = await store().get(`${safe}.meta`, { type: "json" });
      if (!meta) throw new Error("Uploaded file not found.");
      if (Number(meta.size) > maxBytes) throw new Error("The document is too large to extract. Keep it below 15 MB.");
      if (Number.isInteger(meta.parts) && meta.parts > 0) {
        let bufs = [];
        for (let i = 0; i < meta.parts; i++) {
          const x2 = await store().get(`${safe}.part.${i}`, { type: "arrayBuffer" });
          if (!x2) throw new Error(`The uploaded document is incomplete (chunk ${i + 1} of ${meta.parts} is not yet available).`);
          bufs.push(Buffer.from(x2));
        }
        return Buffer.concat(bufs);
      }
      const x = await store().get(safe, { type: "arrayBuffer" });
      if (!x) throw new Error("Uploaded file not found.");
      return Buffer.from(x);
    } catch (e) {
      lastError = e;
      if (attempt < 3) await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    }
  }
  throw new Error(lastError?.message || "The uploaded file could not be read. Please upload it again.");
}
async function makePresentedSession(prefix, userId, sourceId, questions, shuffleQuestions = true, shuffleOptions = true, mode = "practice", duration = 0) {
  // Questions are grouped two levels deep: first by section (so a Roman-numeral
  // or other dedicated section always stays together as one contiguous block,
  // never interleaved with ordinary questions even when shuffling is on), then
  // within each section by passage (so a comprehension passage's questions
  // also stay together). Shuffling, when enabled, only reorders groups at each
  // level - it never breaks a section or a passage apart.
  const sectionOrder = [];
  const sectionMap = /* @__PURE__ */ new Map();
  for (const q of questions) {
    const sKey = q.sectionId || "default";
    if (!sectionMap.has(sKey)) {
      const s = { key: sKey, items: [] };
      sectionMap.set(sKey, s);
      sectionOrder.push(s);
    }
    sectionMap.get(sKey).items.push(q);
  }
  const orderedSections = shuffleQuestions ? shuffleCopy(sectionOrder) : sectionOrder;
  const ordered = orderedSections.flatMap((section) => {
    const groups = [];
    const map = /* @__PURE__ */ new Map();
    for (const q of section.items) {
      const key = q.passageId || q.id;
      if (!map.has(key)) {
        const g = { key, items: [] };
        map.set(key, g);
        groups.push(g);
      }
      map.get(key).items.push(q);
    }
    const orderedGroups = shuffleQuestions ? shuffleCopy(groups) : groups;
    return orderedGroups.flatMap((g) => g.items);
  });
  const presented = [];
  for (const q of ordered) {
    const order = shuffleOptions ? shuffleCopy([0, 1, 2, 3]) : [0, 1, 2, 3];
    const answerIndex = order.indexOf(q.answer);
    const pq = { ...q, options: order.map((i) => q.options[i]), answer: answerIndex };
    presented.push({ q: pq, answerIndex, optionOrder: order });
  }
  const sessionId = crypto.randomUUID();
  await store().setJSON(`${prefix}-${sessionId}`, { id: sessionId, userId, sourceId, mode, duration, created: Date.now(), items: presented.map((x) => ({ id: x.q.id, answerIndex: x.answerIndex, optionOrder: x.optionOrder })) });
  return { sessionId, presented };
}
async function getSession(prefix, id) {
  return store().get(`${prefix}-${String(id || "").replace(/[^a-zA-Z0-9-]/g, "")}`, { type: "json" });
}
function sessionExpired(session, graceSeconds = 60) {
  if (!session?.created) return true;
  const duration = Number(session.duration) || 0;
  if (duration <= 0) return false;
  return Date.now() > Number(session.created) + duration * 60 * 1e3 + graceSeconds * 1e3;
}
function mediaKind(contentType, fileName) {
  const t = String(contentType || "").toLowerCase();
  const n = String(fileName || "").toLowerCase();
  if (t.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return "image";
  if (t.startsWith("video/") || /\.(mp4|webm|ogv|mov|m4v)$/.test(n)) return "video";
  if (t.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/.test(n)) return "audio";
  if (t === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
  if (t.startsWith("text/") || /\.(txt|md|csv|json)$/.test(n)) return "text";
  return "file";
}
var EXT_TYPES = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
  "3gp": "video/3gpp",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
  ogg: "audio/ogg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip"
};
function guessContentType(fileName) {
  const ext = String(fileName || "").toLowerCase().split(".").pop();
  return EXT_TYPES[ext] || "";
}
function normaliseAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).filter((f) => f && (f.fileKey || f.key)).map((f) => {
    const key = String(f.fileKey || f.key);
    const fileName = cleanString(f.fileName || f.name, 180) || "file";
    let contentType = cleanString(f.contentType || f.type, 160);
    if (!contentType || contentType === "application/octet-stream") contentType = guessContentType(fileName) || "application/octet-stream";
    return { key, url: "/api/files/" + encodeURIComponent(key), fileName, contentType, kind: mediaKind(contentType, fileName), size: Number(f.size) || 0 };
  });
}
function normalisePath(pathname) {
  // EdgeOne routes /api/* straight to this function, so the incoming path is
  // already the API path. The legacy Netlify function prefix is still stripped
  // so that a cached client or bookmarked URL keeps working after the move.
  let p = pathname.replace(/^\/\.netlify\/functions\/api/, "").replace(/^\/\.edgeone\/functions\/api/, "");
  if (!p.startsWith("/")) p = "/" + p;
  if (!p.startsWith("/api")) p = "/api" + (p === "/" ? "" : p);
  if (p.length > 4 && p.endsWith("/")) p = p.slice(0, -1);
  return p || "/api";
}
// Routing is declared by the function's file path on EdgeOne Pages
// (node-functions/api/[[default]].js), so no exported route config is needed.

function effectiveLeaderboardReset(d, subject = "") {
  const general = Date.parse(String(d.settings?.leaderboardResetAt || "")) || 0;
  const specific = subject ? Date.parse(String(d.settings?.subjectLeaderboardResetAt?.[subject] || "")) || 0 : 0;
  return Math.max(general, specific);
}
// One shared timestamp reader for every ranking path. Parsing each field
// separately matters: a migrated result can carry a non-empty but unparseable
// `date` alongside a valid `submittedAt`, and choosing the field by truthiness
// would yield NaN and silently hide that result from the leaderboard.
function resultVisibilityFor(d, r) {
  if (!r) return false;
  if (r.resultVisibility === "held" && r.resultReleased !== true) return false;
  const test = d.tests.find(t => t.id === r.testId);
  if (test && test.resultVisibility === "held" && test.resultReleased !== true) return false;
  if (r.questionSetId) {
    const set = d.questionSets.find(qs => qs.id === r.questionSetId);
    if (set && set.resultVisibility === "held" && set.resultReleased !== true) return false;
  }
  return true;
}
function resultSubmittedMs(r) {
  const submitted = Date.parse(String(r?.submittedAt || ""));
  if (Number.isFinite(submitted)) return submitted;
  const legacy = Date.parse(String(r?.date || ""));
  return Number.isFinite(legacy) ? legacy : 0;
}
// A result counts towards a leaderboard when it was submitted strictly after
// the reset that applies to that leaderboard.
function countsAfterReset(r, resetAt) {
  return !resetAt || resultSubmittedMs(r) > resetAt;
}
// Only active, approved students appear in any ranking. The dashboard and the
// public leaderboard previously used different rules, so the same student could
// hold a rank in one view and be missing from the other.
function isRankedStudent(u) {
  return !!u && u.status === "active";
}
var DUEL_ROOM_TTL_MS = 15 * 60 * 1000;
var DUEL_TURN_TTL_MS = 30 * 1000;
var DUEL_OPEN_STATUSES = new Set(["waiting", "active", "finished", "cancelled"]);
function duelExpiresAt(duel) {
  const created = Date.parse(String(duel?.createdAt || ""));
  return Number.isFinite(created) ? new Date(created + DUEL_ROOM_TTL_MS).toISOString() : null;
}
function duelCodeExpired(duel) {
  if (!duel || duel.status !== "waiting") return false;
  const created = Date.parse(String(duel.createdAt || ""));
  return !Number.isFinite(created) || Date.now() >= created + DUEL_ROOM_TTL_MS;
}
function expireWaitingDuels(d) {
  let changed = false;
  for (const duel of d.duels || []) {
    if (duelCodeExpired(duel)) {
      duel.status = "expired";
      duel.expiredAt = duel.expiredAt || new Date().toISOString();
      void releaseDuelLock(duel.hostId);
      changed = true;
    }
  }
  return changed;
}
function duelCurrentForUser(d, userId) {
  const duels = Array.isArray(d.duels) ? d.duels : [];
  for (const duel of duels) {
    if (duelCodeExpired(duel)) {
      duel.status = "expired";
      duel.expiredAt = duel.expiredAt || new Date().toISOString();
      continue;
    }
    if (DUEL_OPEN_STATUSES.has(duel.status) && duel.players?.some(p => p.id === userId) && !duel.left?.[userId]) return duel;
  }
  return null;
}
var localDuelLocks = new Map();
async function acquireDuelLock(userId, duelId) {
  const key = `duel-lock-${String(userId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (!isCentralStore()) {
    const local = localDuelLocks.get(key);
    if (local) {
      const error = new Error("You already have a 1-v-1 room. Leave your current room before creating or joining another.");
      error.code = "DUEL_LOCKED";
      throw error;
    }
    localDuelLocks.set(key, { duelId: duelId || "__creating__" });
    return key;
  }
  const existing = await store().getWithMetadata(key, { type: "json" }).catch(() => null);
  if (existing?.data) {
    const lock = existing.data;
    const expires = Number(lock.waitingExpiresAt || 0);
    if (expires && Date.now() >= expires) {
      await store().delete(key).catch(() => {});
    } else if (String(lock.duelId || "") !== String(duelId || "")) {
      const error = new Error("You already have a 1-v-1 room. Leave your current room before creating or joining another.");
      error.code = "DUEL_LOCKED";
      throw error;
    } else {
      return key;
    }
  }
  const lock = { duelId: duelId || null, createdAt: new Date().toISOString(), waitingExpiresAt: null };
  const result = await store().setJSON(key, lock, { onlyIfNew: true });
  if (!result?.modified) {
    const error = new Error("You already have a 1-v-1 room. Leave your current room before creating or joining another.");
    error.code = "DUEL_LOCKED";
    throw error;
  }
  return key;
}
async function setDuelLock(userId, duelId, waitingExpiresAt = null) {
  const key = `duel-lock-${String(userId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  if (!isCentralStore()) {
    localDuelLocks.set(key, { duelId, waitingExpiresAt });
    return;
  }
  await store().setJSON(key, { duelId, createdAt: new Date().toISOString(), waitingExpiresAt });
}
async function releaseDuelLock(userId) {
  const key = `duel-lock-${String(userId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  localDuelLocks.delete(key);
  if (isCentralStore()) await store().delete(key).catch(() => {});
}
var localDuelRoomLocks = new Map();
// A room lock only has to cover one read-modify-save cycle. Giving it a short
// lease means that a function instance which dies mid-mutation (or whose
// best-effort release fails) cannot block the room forever: the next player
// reclaims the expired lease instead of receiving DUEL_ROOM_BUSY indefinitely.
var DUEL_ROOM_LOCK_TTL_MS = 15 * 1000;
function duelRoomBusyError() {
  const error = new Error("This 1-v-1 room is being updated by another player. Please try again.");
  error.code = "DUEL_ROOM_BUSY";
  return error;
}
async function acquireDuelRoomWriteLock(duelId) {
  const key = `duel-write-lock-${String(duelId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const owner = crypto.randomUUID();
  const now = Date.now();
  if (!isCentralStore()) {
    const held = localDuelRoomLocks.get(key);
    if (held && held.expiresAt > now) throw duelRoomBusyError();
    localDuelRoomLocks.set(key, { owner, expiresAt: now + DUEL_ROOM_LOCK_TTL_MS });
    return { key, owner };
  }
  const existing = await store().get(key, { type: "json" }).catch(() => null);
  if (existing && Number(existing.expiresAt || 0) > now) throw duelRoomBusyError();
  if (existing) {
    // The previous holder's lease has run out. Drop it so the conditional
    // create below can decide a single winner among the waiting requests.
    await store().delete(key).catch(() => {});
  }
  const claimed = await store().setJSON(
    key,
    { duelId, owner, createdAt: new Date(now).toISOString(), expiresAt: now + DUEL_ROOM_LOCK_TTL_MS },
    { onlyIfNew: true }
  );
  if (!claimed?.modified) throw duelRoomBusyError();
  return { key, owner };
}
async function releaseDuelRoomWriteLock(duelId, owner = null) {
  const key = `duel-write-lock-${String(duelId).replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const held = localDuelRoomLocks.get(key);
  if (held && (!owner || held.owner === owner)) localDuelRoomLocks.delete(key);
  if (!isCentralStore()) return;
  try {
    if (owner) {
      // Only release our own lease, never one that a later request reclaimed
      // after ours expired.
      const current = await store().get(key, { type: "json" }).catch(() => null);
      if (current && current.owner && current.owner !== owner) return;
    }
    await store().delete(key);
  } catch (error) {
    // The lease expiry above is the recovery path, but a failure here is still
    // worth surfacing in the function logs rather than swallowing silently.
    console.error(`Failed to release the 1-v-1 room lock for duel ${duelId}.`, error);
  }
}
/* Serialise one mutation of a single duel room.
 *
 * Every write path (join, answer, leave, submit, timeout persistence) must go
 * through here. The callback receives freshly loaded data plus the duel found
 * inside the lock, so it can never validate turn state against a snapshot that
 * another player has already moved past. The lease is always released, and a
 * busy room is reported to the caller as a retryable 409 rather than an error.
 */
async function withDuelRoomLock(duelId, run) {
  let lease = null;
  try {
    lease = await acquireDuelRoomWriteLock(duelId);
  } catch (error) {
    if (error?.code === "DUEL_ROOM_BUSY") return json({ error: error.message }, 409);
    throw error;
  }
  try {
    const fresh = await load();
    const duel = fresh.duels.find(z => z.id === duelId);
    return await run(fresh, duel);
  } finally {
    await releaseDuelRoomWriteLock(duelId, lease.owner);
  }
}
function duelPlayerScore(duel, userId) {
  const answers = duel.answers?.[userId] || {};
  return (duel.questions || []).reduce((n, q, i) => {
    const value = answers[i];
    return n + (Number.isInteger(value) && Number(value) === Number(q.answer) ? 1 : 0);
  }, 0);
}
function duelScore(duel, userId) { return duelPlayerScore(duel, userId); }
function duelAnsweredCount(duel, userId) {
  return Object.values(duel.answers?.[userId] || {}).filter(v => Number.isInteger(v)).length;
}
function duelTurnRemainingMs(duel) {
  const deadline = Date.parse(String(duel?.turnDeadlineAt || ""));
  return Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : 0;
}
function initialiseDuelTurn(duel) {
  if (!duel.currentTurnUserId && duel.players?.length === 2) duel.currentTurnUserId = duel.players[0].id;
  if (!Number.isInteger(duel.currentQuestionIndex)) duel.currentQuestionIndex = 0;
  if (!duel.turnStartedAt) duel.turnStartedAt = new Date().toISOString();
  if (!duel.turnDeadlineAt) duel.turnDeadlineAt = new Date(Date.now() + DUEL_TURN_TTL_MS).toISOString();
}
function finishDuel(duel) {
  duel.scores = duel.scores || {};
  for (const p of duel.players || []) {
    duel.scores[p.id] = duelPlayerScore(duel, p.id);
    p.score = duel.scores[p.id];
  }
  if (duel.status !== "finished") {
    duel.status = "finished";
    duel.finishedAt = duel.finishedAt || new Date().toISOString();
  }
  duel.currentTurnUserId = null;
  duel.turnStartedAt = null;
  duel.turnDeadlineAt = null;
}
function advanceDuelTurn(duel, timedOut = false) {
  if (duel.status !== "active") return;
  initialiseDuelTurn(duel);
  const index = duel.currentQuestionIndex;
  const userId = duel.currentTurnUserId;
  duel.answers[userId] = duel.answers[userId] || {};
  if (timedOut && !Object.prototype.hasOwnProperty.call(duel.answers[userId], index)) duel.timeouts[userId] = [...new Set([...(duel.timeouts?.[userId] || []), index])];
  const playerIndex = duel.players.findIndex(p => p.id === userId);
  const opponent = duel.players.find((p, i) => i !== playerIndex);
  if (!opponent) return;
  if (playerIndex === 0) {
    // Player 1 answers first; player 2 now answers the same question.
    duel.currentTurnUserId = opponent.id;
  } else {
    // Both players have now had a turn on this question.
    if (index + 1 >= duel.questions.length) {
      finishDuel(duel);
      return;
    }
    duel.currentQuestionIndex = index + 1;
    duel.currentTurnUserId = duel.players[0].id;
  }
  duel.turnStartedAt = new Date().toISOString();
  duel.turnDeadlineAt = new Date(Date.now() + DUEL_TURN_TTL_MS).toISOString();
}
function processDuelTurnTimeout(duel) {
  if (duel.status !== "active") return false;
  initialiseDuelTurn(duel);
  if (duelTurnRemainingMs(duel) > 0) return false;
  advanceDuelTurn(duel, true);
  return true;
}
function updateDuelScores(duel) {
  duel.answers = duel.answers || {};
  duel.timeouts = duel.timeouts || {};
  duel.scores = duel.scores || {};
  for (const p of duel.players || []) {
    duel.scores[p.id] = duelPlayerScore(duel, p.id);
    p.score = duel.scores[p.id];
  }
  if (duel.status === "active" && duel.players?.length === 2) {
    initialiseDuelTurn(duel);
    processDuelTurnTimeout(duel);
  }
  if (duel.status === "finished") {
    for (const p of duel.players || []) {
      duel.scores[p.id] = duelPlayerScore(duel, p.id);
      p.score = duel.scores[p.id];
    }
  }
}
function duelPublic(d, duel, viewerId) {
  updateDuelScores(duel);
  const players = (duel.players || []).map(p => ({
    id: p.id,
    name: p.name,
    username: p.username,
    score: duel.scores?.[p.id] ?? 0,
    answered: duelAnsweredCount(duel, p.id),
    submitted: !!duel.submitted?.[p.id],
    left: !!duel.left?.[p.id],
    timeouts: (duel.timeouts?.[p.id] || []).length
  }));
  const questions = (duel.questions || []).map((q, i) => ({ index: i, id: q.id, subject: q.subject, q: q.q, options: Array.isArray(q.options) ? q.options : [] }));
  const me = duel.players?.find(p => p.id === viewerId);
  return {
    myId: viewerId,
    id: duel.id,
    code: duel.code,
    subject: duel.subject,
    count: questions.length,
    status: duel.status,
    createdAt: duel.createdAt,
    expiresAt: duelExpiresAt(duel),
    startedAt: duel.startedAt || null,
    finishedAt: duel.finishedAt || null,
    hostId: duel.hostId,
    players,
    questions,
    currentQuestionIndex: Number.isInteger(duel.currentQuestionIndex) ? duel.currentQuestionIndex : 0,
    currentTurnUserId: duel.currentTurnUserId || null,
    turnStartedAt: duel.turnStartedAt || null,
    turnDeadlineAt: duel.turnDeadlineAt || null,
    turnRemainingMs: duel.status === "active" ? duelTurnRemainingMs(duel) : 0,
    isMyTurn: duel.status === "active" && duel.currentTurnUserId === viewerId,
    myAnswers: duel.answers?.[viewerId] || {},
    myScore: duel.scores?.[viewerId] ?? 0,
    myAnswered: me ? duelAnsweredCount(duel, viewerId) : 0,
    review: duel.status === "finished" ? (duel.questions || []).map((q, i) => ({
      index: i,
      question: q.q,
      options: q.options || [],
      correctAnswer: Number(q.answer),
      players: (duel.players || []).map(p => ({
        id: p.id,
        answer: Object.prototype.hasOwnProperty.call(duel.answers?.[p.id] || {}, i) ? duel.answers[p.id][i] : null,
        correct: Number.isInteger(duel.answers?.[p.id]?.[i]) && Number(duel.answers[p.id][i]) === Number(q.answer),
        timedOut: (duel.timeouts?.[p.id] || []).includes(i)
      }))
    })) : [],
    canLeave: !!duel.players?.some(p => p.id === viewerId) && !duel.left?.[viewerId]
  };
}
function duelQuestions(bank, subject, count) {
  const pool = bank.filter(q => q && q.type === "mcq" && q.subject === subject && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer));
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, Math.min(Math.max(3, count || 10), 20)).map(q => ({ id: q.id, subject: q.subject, q: q.q, options: q.options.slice(), answer: q.answer }));
}
function duelCode(existing) {
  for (let i = 0; i < 20; i++) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!existing.some(d => d.code === code && d.status !== "finished")) return code;
  }
  return String(Date.now()).slice(-6);
}


function topicKey(subject,name){ return `${String(subject||"").trim().toLowerCase()}|${String(name||"").trim().replace(/\s+/g," ").toLowerCase()}`; }
function topicFor(d, topicId, subject=""){ const wanted=String(subject||"").trim().replace(/\s+/g," ").toLowerCase(); return d.topics.find(t => String(t.id)===String(topicId) && (!subject || !t.subject || String(t.subject).trim().replace(/\s+/g," ").toLowerCase()===wanted)); }
function publicTopic(t,d){ return { id:t.id, subject:t.subject, name:t.name, slug:t.slug||"", count:d.questionBank.filter(q=>q.topicId===t.id).length }; }
function eligibleTopicQuestions(d, subject, topicIds){
  const ids=new Set((Array.isArray(topicIds)?topicIds:[]).map(String));
  return d.questionBank.filter(q=>q && q.subject===subject && ["mcq","passage","cloze"].includes(q.type||"mcq") && Array.isArray(q.options) && q.options.length===4 && Number.isInteger(Number(q.answer)) && Number(q.answer)>=0 && Number(q.answer)<q.options.length && ids.has(String(q.topicId||"")));
}
function selectUniqueQuestions(pool,count){
  const seen=new Set(), unique=[];
  for(const q of Array.isArray(pool)?pool:[]){
    const id=String(q?.id||"");
    const key=id||JSON.stringify([q?.q,q?.options]);
    if(seen.has(key)) continue;
    seen.add(key); unique.push(q);
  }
  const copy=shuffleCopy(unique);
  return copy.slice(0, Math.min(Math.max(1, Number(count)||1), copy.length));
}
function reportPublic(r,d){
  const q=d.questionBank.find(q=>q.id===r.questionId);
  const u=d.users.find(u=>u.id===r.userId);
  return {...r, reportCount:d.questionReports.filter(x=>x.questionId===r.questionId).length, studentName:u?.name||"Unknown student", studentUsername:u?.username||"", questionText:q?.q||r.questionText||"", currentTopic:q?.topic||r.topic||""};
}
async function handler(request) {
  const url = new URL(request.url);
  const p = normalisePath(url.pathname);
  const m = request.method;
  try {
    // Supabase Auth recovery/verification operations are independent of the
    // application KV store. Do not make an otherwise healthy Auth flow fail
    // merely because the application database is temporarily unavailable.
    const authServiceOnly = new Set(["/api/auth/reset-request", "/api/auth/update-password", "/api/auth/resend-verification"]).has(p);
    if (m !== "OPTIONS" && p !== "/api/health" && p !== "/api/status" && p !== "/api/admin/health") {
      let bootstrapData = null;
      try {
        bootstrapData = await load();
      } catch (error) {
        if (!authServiceOnly) throw error;
      }
      if (bootstrapData) {
        const live = await activeRuntimeHandler(bootstrapData.appUpdate);
        if (live && live !== handler) return live(request);
      }
    }
    if (m === "GET" && p === "/api/health") return json({ ok: true, time: Date.now() });
    if (p === "/api/echo") {
      // Deployment probe: reports what the function actually received for a
      // JSON body, without ever echoing the payload itself.
      if (m !== "POST") return json({ error: "Send a POST request to /api/echo." }, 405);
      const bytes = await readRawBody(request);
      let parsed = false, parseError = null, keys = [];
      try {
        const value = JSON.parse(stripBom(bytes.toString("utf8")).trim() || "{}");
        parsed = true;
        keys = value && typeof value === "object" ? Object.keys(value).slice(0, 20) : [];
      } catch (error) { parseError = error.message; }
      return json({
        ok: parsed,
        method: m,
        contentType: request.headers?.get?.("content-type") || null,
        bytes: bytes.length,
        parsed,
        keys,
        parseError,
        preParsedBody: Boolean(preParsedBody(request)),
        runtime: "edgeone-node-function",
        time: Date.now()
      }, parsed ? 200 : 400);
    }
    if (m === "GET" && p === "/api/status") {
      try {
        const d = await load({ fresh: true });
        return json({
          ok: true,
          storage: storageReport(),
          students: d.users.length,
          contentPackVersion: d.settings.contentPackVersion || null,
          authentication: { provider: "Supabase Auth", configured: supabaseConfig().configured, sessionCookie: "HttpOnly Secure SameSite=Lax" }, database: { provider: "Supabase Postgres", configured: !!(supabaseConfig().base && supabaseConfig().secretKey), sourceOfTruth: true },
          time: Date.now()
        });
      } catch (error) {
        if (error?.storageUnavailable) return json({ ok:false, storage:storageReport(), error:API_ERROR.CENTRAL_DATABASE, code:"CENTRAL_DATABASE_UNAVAILABLE", retryable:true },503);
        return json({ ok:false, storage:storageReport(), error:error?.message || "The server could not complete the health check.", code:"HEALTH_CHECK_FAILED", retryable:false },500);
      }
    }
    if (m === "OPTIONS") return new Response(null, { status: 204, headers: { "allow": "GET,POST,PATCH,DELETE,OPTIONS" } });
    if (m === "GET" && p === "/api/admin/health") {
      const adminToken = await verifyToken(bearer(request), "admin");
      if (!adminToken || adminToken.iss !== "gifted-brainz-admin" || adminToken.aud !== "gifted-brainz-api" || adminToken.sub !== "admin" || adminToken.role !== "admin" || !Array.isArray(adminToken.permissions) || !adminToken.permissions.includes("admin:all")) return json({ ok:false, error:API_ERROR.SESSION_EXPIRED, code:"SESSION_EXPIRED" },401);
      try {
        const d = await load({ fresh: true });
        return json({
          ok:true,
          role:"admin",
          authentication:"shared server credential",
          storage:storageReport(),
          database:{ provider:"Supabase Postgres", sourceOfTruth:true, students:d.users.length },
          time:Date.now()
        });
      } catch (error) {
        if (error?.storageUnavailable) return json({ ok:false, error:API_ERROR.CENTRAL_DATABASE, code:"CENTRAL_DATABASE_UNAVAILABLE", storage:storageReport(), time:Date.now() },503);
        return json({ ok:false, error:error?.message || "The shared backend could not complete the health check.", code:"BACKEND_HEALTH_CHECK_FAILED", storage:storageReport(), time:Date.now() },500);
      }
    }
    if (m === "GET" && p === "/api/subjects") {
      const d = await load();
      const catalog = d.subjects.filter(s => s.active !== false).sort((a,b) => Number(a.position)-Number(b.position) || String(a.name).localeCompare(String(b.name)))
        .map(s => ({ id:s.id, name:s.name, icon:s.icon, position:s.position, active:s.active !== false }));
      const studentToken = await auth(request, "student");
      if (studentToken) {
        if (url.searchParams.get("catalog") !== "all") {
          const u = d.users.find(u2 => u2.id === studentToken.sub);
          const allowed = new Set(studentSubjects(u));
          return json(catalog.filter(s => allowed.has(s.name)));
        }
        return json(catalog);
      }
      const adminToken = await verifyToken(bearer(request), "admin");
      if (adminToken) return json(catalog);
      // Subject names/icons are public catalog metadata; exposing them does not
      // expose student records or protected content and lets registration forms
      // stay in sync with administrator-created subjects.
      return json(catalog);
    }
    if (m === "GET" && p === "/api/app/update") {
      const d = await load();
      const up = d.appUpdate;
      if (!up) return json({ available: false });
      return json({ available: true, version: up.version, notes: up.notes, date: up.date, assetVersion: up.assetVersion || null });
    }
    if (m === "GET" && p === "/api/app/runtime/manifest") {
      const d = await load();
      const up = d.appUpdate;
      if (!up?.manifestKey) return json({ available: false }, 404);
      const manifest = await store().get(up.manifestKey, { type: "json" });
      if (!manifest) return json({ error: "Update manifest not found." }, 404);
      return json({ version: manifest.version, files: runtimeManifestFiles(manifest).map((f) => ({ path: f.path, contentType: f.contentType, size: f.size, sha256: f.sha256 })) });
    }
    if (m === "GET" && p.startsWith("/api/app/runtime/file/")) {
      const raw = decodeURIComponent(p.slice("/api/app/runtime/file/".length));
      const safe = safeRuntimePath(raw);
      if (!safe) return json({ error: "File not found." }, 404);
      const d = await load(), up = d.appUpdate;
      if (!up?.manifestKey) return json({ error: "No live update." }, 404);
      const manifest = await store().get(up.manifestKey, { type: "json" });
      const f = runtimeManifestFiles(manifest).find((x) => x.path === safe);
      if (!f) return json({ error: "File not found." }, 404);
      const obj = await store().get(f.key, { type: "arrayBuffer" });
      if (!obj) return json({ error: "File not found." }, 404);
      return new Response(obj, { status: 200, headers: { "content-type": f.contentType, "cache-control": "public, max-age=31536000, immutable", "x-content-type-options": "nosniff" } });
    }
    if (m === "POST" && p === "/api/register") {
      if (!supabaseConfig().configured) return json({ error: "Student authentication is not configured yet. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SECRET_KEY on the Student Portal server." }, 503);
      if (!rateLimit(request, "register", 8, 9e5)) return json({ error: "Too many registration attempts. Try again later." }, 429);
      const x = await readJSON(request), d = await load();
      const name = cleanString(x.name, 120), email = cleanString(x.email, 160).toLowerCase();
      const username = cleanString(x.username, 80), password = String(x.password ?? "");
      const whatsapp = cleanString(x.whatsapp, 30).replace(/[\s()\-]/g, "");
      const subjectCheck = validateSelectedSubjects(x.selectedSubjects);
      if (subjectCheck.error) return json({ error: subjectCheck.error }, 400);
      if (!name || !email || !username || !whatsapp || password.length < 8)
        return json({ error: "Name, email, WhatsApp number, username and a password of at least 8 characters are required." }, 400);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      if (!/^\+?[1-9]\d{7,14}$/.test(whatsapp)) return json({ error: "Enter a valid WhatsApp number with country code, e.g. +2348012345678." }, 400);
      if (!/^[a-zA-Z0-9._-]{3,80}$/.test(username)) return json({ error: "Username may only contain letters, numbers, dot, dash and underscore." }, 400);
      if (d.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return json({ error: "That username is already in use." }, 409);
      if (d.users.some((u) => u.email === email)) return json({ error: "An account with that email already exists." }, 409);
      const userId = crypto.randomUUID(), reservations = [];
      const reserve = async (kind, value) => {
        const key = `unique/${kind}/${encodeURIComponent(value)}`;
        const claim = await store().get(key, { type: "json" });
        if (claim?.userId && claim.userId !== userId) {
          const stillActive = d.users.some((u) => u.id === claim.userId && (kind === "username"
            ? String(u.username || "").toLowerCase() === String(value).toLowerCase()
            : String(u.email || "").toLowerCase() === String(value).toLowerCase()));
          if (!stillActive) await store().delete(key).catch(() => {});
        }
        const created = await store().setJSON(key, { userId, at: new Date().toISOString() }, { onlyIfNew: true });
        if (created && created.modified === false) return false;
        reservations.push(key); return true;
      };
      const releaseReservations = async () => { for (const key of reservations) await store().delete(key).catch(() => {}); };
      if (!await reserve("username", username.toLowerCase())) { await releaseReservations(); return json({ error: "That username is already in use." }, 409); }
      if (!await reserve("email", email)) { await releaseReservations(); return json({ error: "An account with that email already exists." }, 409); }
      let authUserId = "", emailVerified = false;
      try {
          const authUser = await supabaseCreateUser(email, password, { name, username, role: "student" });
        const remoteUser = authUser?.user || authUser;
        if (Array.isArray(remoteUser?.identities) && remoteUser.identities.length === 0) throw Object.assign(new Error("An account with that email already exists."), { status: 422 });
        authUserId = String(remoteUser?.id || "");
        emailVerified = true;
        if (!authUserId) throw new Error("Supabase did not return an authentication user ID.");
      } catch (error) {
        await releaseReservations();
        if (error?.status === 422 || /already registered|already exists/i.test(String(error?.message || ""))) return json({ error: "An account with that email already exists." }, 409);
        throw error;
      }
      const ph = passwordHash(password), now = new Date().toISOString();
      const user = { id: userId, authUserId, name, username, email, whatsapp, selectedSubjects: subjectCheck.subjects, passwordHash: ph.hash, passwordSalt: ph.salt, status: "active", emailVerified, emailVerifiedAt: emailVerified ? now : "", verificationSentAt: now, firstLogin: true, joined: now, requestedAt: now, deviceId: "GB-" + crypto.randomBytes(8).toString("hex").toUpperCase(), productKey: "GBE-" + crypto.randomBytes(10).toString("hex").toUpperCase() };
      d.users.push(user);
      try { await save(d); } catch (error) { await releaseReservations(); await supabaseDeleteUser(authUserId); throw error; }
      return json({ pending: false, emailVerified: true, user: publicUser(user), deviceId: user.deviceId, productKey: user.productKey,
        message: "Your Gifted Brainz EduSpace account has been created successfully. You can now log in." });
    }
    if (m === "GET" && p === "/api/auth/session") {
      const a = await auth(request, "student");
      if (!a) return json({ ...sessionExpiredError(), authenticated: false }, 401, { "set-cookie": clearStudentSessionCookie() });
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub);
      return json({ authenticated: true, user: publicUser(u), expiresIn: STUDENT_SESSION_TTL });
    }
    if (m === "POST" && p === "/api/auth/logout") {
      await destroyStudentSession(request);
      return json({ ok: true }, 200, { "set-cookie": clearStudentSessionCookie() });
    }
    if (m === "POST" && p === "/api/auth/resend-verification") {
      return json({ error: "Email verification is not required for new EduSpace accounts." }, 410);
    }
    if (false && m === "POST" && p === "/api/auth/resend-verification") {
      if (!rateLimit(request, "resend-verification", 5, 9e5)) return json({ error: "Too many verification requests. Try again later." }, 429);
      const x = await readJSON(request), email = cleanString(x.email, 160).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      const cfg = supabaseConfig();
      if (!cfg.configured) return json({ error: "Email verification is not configured yet. Please contact the coordinator." }, 503);
      await supabaseResendVerification(email, redirectTo).catch(() => {});
      return json({ ok: true, message: "If an account exists for that email, a verification email has been sent." });
    }
    if (m === "POST" && p === "/api/auth/reset-request") {
      return json({ error: "Password resets are handled by the administrator after identity verification." }, 410);
    }
    if (false && m === "POST" && p === "/api/auth/reset-request") {
      if (!rateLimit(request, "reset-request", 5, 9e5)) return json({ error: "Too many password reset requests. Try again later." }, 429);
      const x = await readJSON(request), email = cleanString(x.email, 160).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      const cfg = supabaseConfig();
      if (!cfg.configured) return json({ error: "Password reset is not configured yet. Please contact the coordinator." }, 503);
      const redirectTo = `${new URL(request.url).origin}/reset.html`;
      await supabaseRequest("/auth/v1/recover", { method: "POST", key: cfg.anonKey, body: { email, redirect_to: redirectTo } }).catch(() => {});
      return json({ ok: true, message: "If an account exists for that email, a password reset link has been sent." });
    }
    if (m === "POST" && p === "/api/auth/update-password") {
      return json({ error: "Password resets are handled by the administrator after identity verification." }, 410);
    }
    if (false && m === "POST" && p === "/api/auth/update-password") {
      const x = await readJSON(request), accessToken = String(x.accessToken || "").trim(), next = String(x.password || "");
      if (!accessToken || next.length < 8) return json({ error: "A valid reset session and a password of at least 8 characters are required." }, 400);
      const cfg = supabaseConfig();
      if (!cfg.configured) return json({ error: "Password reset is not configured yet." }, 503);
      const authHeaders = { apikey: cfg.anonKey, Authorization: `Bearer ${accessToken}` };
      const identity = await fetch(`${cfg.base}/auth/v1/user`, { method: "GET", headers: authHeaders });
      const identityData = await identity.json().catch(() => ({}));
      if (!identity.ok || !identityData?.id) return json({ error: "The password reset session is invalid or expired." }, 401);
      const r = await fetch(`${cfg.base}/auth/v1/user`, { method: "PUT", headers: { ...authHeaders, "content-type": "application/json" }, body: JSON.stringify({ password: next }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return json({ error: data?.msg || data?.message || "The password reset session is invalid or expired." }, r.status === 401 ? 401 : 400);
      // Keep the application profile in sync with the authoritative Supabase
      // identity and revoke every existing EduSpace session for this student.
      // Supabase Auth is authoritative for the new password. Keep the local
      // profile/session state synchronized, but never turn a central-store
      // outage into a false success. The password has already changed at this
      // point, so callers receive a clear database error and can retry the
      // synchronization safely.
      try {
        const d = await load({ fresh: true });
        const u = d.users.find(u2 => String(u2.authUserId || "") === String(identityData.id));
        if (u) {
          const ph = passwordHash(next);
          u.passwordHash = ph.hash;
          u.passwordSalt = ph.salt;
          revokeStudentTokens(u);
          await save(d);
        }
      } catch (error) {
        if (error?.storageUnavailable) return json({ ok:false, error:API_ERROR.CENTRAL_DATABASE, code:"CENTRAL_DATABASE_UNAVAILABLE", passwordUpdated:true, requiresRetry:true },503);
        throw error;
      }
      return json({ ok: true });
    }
    if (m === "POST" && p === "/api/login") {
      if (!supabaseConfig().configured) return json({ error: "Student authentication is not configured yet. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SECRET_KEY on the Student Portal server." }, 503);
      if (!rateLimit(request, "login", 12, 9e5)) return json({ error: "Too many login attempts. Try again in a few minutes." }, 429);
      const x = await readJSON(request), d = await load();
      const identifier = cleanString(x.username, 80), password = String(x.password ?? "");
      const u = d.users.find((a) => a.username.toLowerCase() === identifier.toLowerCase() || String(a.email || "").toLowerCase() === identifier.toLowerCase());
      if (!u || u.status !== "active") return json({ error: "Invalid username or password, or account is inactive." }, 401);
      let authUserId = String(u.authUserId || ""), signedUser = null;
      try {
        const signed = await supabaseSignIn(String(u.email || ""), password);
        signedUser = signed?.user || null;
        const signedId = String(signedUser?.id || signed?.id || "");
        if (!signedId) return json({ error: "Authentication service did not return a valid user." }, 503);
        authUserId = signedId;
      } catch (error) {
        // Only accounts created before Supabase Auth was introduced may use the
        // one-time migration path. For an account already linked to Supabase, a
        // failed Supabase password check MUST reject the login. Never reuse an
        // existing authUserId after authentication failure.
        if (authUserId) return json({ error: "Invalid username or password." }, 401);
        if (verifyPassword(password, u)) {
          try {
            const created = await supabaseCreateUser(String(u.email || ""), password, { name: u.name, username: u.username, role: "student" });
            authUserId = String(created?.user?.id || created?.id || "");
          } catch (createError) {
            if (/already registered|already exists/i.test(String(createError?.message || ""))) {
              try { const signedAgain = await supabaseSignIn(String(u.email || ""), password); authUserId = String(signedAgain?.user?.id || signedAgain?.id || ""); } catch {}
            }
          }
        }
        if (!authUserId) return json({ error: "Invalid username or password." }, 401);
      }
      if (!authUserId) return json({ error: "Authentication service did not return a valid user." }, 503);
      let profileChanged = false;
      if (u.authUserId !== authUserId) { u.authUserId = authUserId; profileChanged = true; }
      if (signedUser && (signedUser.email_confirmed_at || signedUser.confirmed_at) && !u.emailVerified) { u.emailVerified = true; u.emailVerifiedAt = u.emailVerifiedAt || new Date().toISOString(); profileChanged = true; }
      if (profileChanged) await save(d);
      const session = await createStudentSession(u);
      return json({ user: publicUser(u), authenticated: true, sessionExpiresIn: STUDENT_SESSION_TTL }, 200, { "set-cookie": session.cookie });
    }
    if (m === "POST" && p === "/api/activate") {
      return json({ error: "Student-side activation codes are no longer used. Contact the coordinator with your Product Key." }, 410);
    }
    if (m === "POST" && p === "/api/admin/login") {
      // Administrator credentials are intentionally NOT stored on the student
      // backend. The separate Admin Portal serverless function authenticates
      // against its own environment variables and mints the shared admin token.
      return json({ error: "Admin sign-in is available only on the separate Admin Portal." }, 404);
    }
    if (m === "GET" && p === "/api/ai/chats") {
      const a = await auth(request, "student"); if (!a) return json(sessionExpiredError(), 401);
      const d = await load();
      // The sidebar list only ever shows title/date - it never reads
      // .messages (see renderHistory() in ai.html). Shipping every message
      // of every one of the student's last 50 conversations on every page
      // load was pure wasted payload and JSON-parse time; a specific
      // conversation's messages are now fetched only when it's opened, via
      // GET /api/ai/chats/:id below.
      return json(d.aiChats.filter(c => c.userId === a.sub).sort((x,y) => String(y.updatedAt||"").localeCompare(String(x.updatedAt||""))).slice(0,50).map(c => ({ id:c.id, title:c.title||"New conversation", updatedAt:c.updatedAt })));
    }
    if (m === "GET" && /^\/api\/ai\/chats\/[^/]+$/.test(p)) {
      const a = await auth(request, "student"); if (!a) return json(sessionExpiredError(), 401);
      const d = await load();
      const c = d.aiChats.find(c2 => c2.id === p.split("/").pop() && c2.userId === a.sub);
      if (!c) return json({ error: "Conversation not found." }, 404);
      return json({ id:c.id, title:c.title||"New conversation", updatedAt:c.updatedAt, messages:c.messages||[] });
    }
    if (m === "POST" && p === "/api/ai/chats") {
      const a = await auth(request, "student"); if (!a) return json(sessionExpiredError(), 401);
      const x = await readJSON(request), d = await load();
      const messages = Array.isArray(x.messages) ? x.messages.slice(-80).map(m => ({ role:m?.role === "assistant" ? "assistant" : "user", content:cleanString(m?.content,6000) })).filter(m=>m.content) : [];
      if (!messages.length) return json({ error:"A conversation must contain at least one message." },400);
      const title = cleanString(x.title,160) || cleanString(messages.find(m=>m.role==="user")?.content,160) || "New conversation";
      const chat = { id:crypto.randomUUID(), userId:a.sub, title, messages, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() };
      d.aiChats.unshift(chat); const own=d.aiChats.filter(c=>c.userId===a.sub).slice(0,50); const ownIds=new Set(own.map(c=>c.id)); d.aiChats=d.aiChats.filter(c=>c.userId!==a.sub || ownIds.has(c.id)).slice(0,500);
      await save(d); return json(chat,201);
    }
    if (m === "PATCH" && /^\/api\/ai\/chats\/[^/]+$/.test(p)) {
      const a = await auth(request, "student"); if (!a) return json(sessionExpiredError(), 401);
      const id=decodeURIComponent(p.split("/").pop()), x=await readJSON(request), d=await load(), chat=d.aiChats.find(c=>c.id===id&&c.userId===a.sub);
      if(!chat)return json({error:"Conversation not found."},404);
      if(Array.isArray(x.messages)) chat.messages=x.messages.slice(-80).map(m=>({role:m?.role==="assistant"?"assistant":"user",content:cleanString(m?.content,6000)})).filter(m=>m.content);
      if(x.title!==undefined) chat.title=cleanString(x.title,160)||chat.title;
      chat.updatedAt=new Date().toISOString(); await save(d); return json(chat);
    }
    if (m === "DELETE" && /^\/api\/ai\/chats\/[^/]+$/.test(p)) {
      const a = await auth(request, "student"); if (!a) return json(sessionExpiredError(), 401);
      const id=decodeURIComponent(p.split("/").pop()), d=await load(), i=d.aiChats.findIndex(c=>c.id===id&&c.userId===a.sub);
      if(i<0)return json({error:"Conversation not found."},404); d.aiChats.splice(i,1); await save(d); return json({ok:true,id});
    }
    if (m === "POST" && p === "/api/ai/tutor") {
      const a=await auth(request,"student"); if(!a)return json(sessionExpiredError(),401);
      if(!rateLimit(request,"student-ai",30,9e5))return json({error:"AI usage limit reached for now. Please try again later."},429);
      const x=await readJSON(request), question=cleanString(x.question,6000), context=cleanString(x.context,6000), mode=cleanString(x.mode,40)||"explain";
      if(!question)return json({error:"Tell Gifted Brainz AI what you want help with."},400);
      const history=Array.isArray(x.history)?x.history.slice(-10).map(m=>({role:m?.role==="assistant"?"assistant":"user",content:cleanString(m?.content,6000)})).filter(m=>m.content):[];
      const instruction=`You are Gifted Brainz AI, the reasoning-focused learning tutor inside Gifted Brainz EduSpace. Motto: No cramming, just understanding. Before answering, silently reason through the problem, check the factual basis, and verify calculations; output only the helpful final answer, never private chain-of-thought. Answer the student's exact question first. Then build understanding with the smallest useful sequence of explanation, example, guided practice and feedback. For quantitative problems, identify the governing principle, work carefully step by step, check the result for consistency and state units where relevant. For conceptual questions, separate facts from assumptions and correct misconceptions precisely. If the student gives an attempted answer, diagnose the reasoning rather than merely replacing it with the correct answer. Adapt difficulty to the student's demonstrated level and use the supplied conversation history/context to resolve references such as “this”, “that”, question numbers or options. Prefer Nigerian secondary-school/exam conventions when applicable, including familiar terminology and realistic examples. Do not invent syllabus facts, sources, formulas or numerical values. When uncertain, say what is uncertain and give the safest useful explanation. Do not write a mini-textbook unless explicitly requested. Keep responses focused, conversational and readable; use short headings or numbered steps only when they improve comprehension. No decorative horizontal rules, filler, emoji, or repetition. For mathematics and science, ALWAYS use real LaTeX delimiters: inline \(...\) and display \[...\]. Use LaTeX for fractions, roots, powers, indices, equations, simultaneous equations, matrices and symbols. Never place mathematical LaTeX in code blocks, never double-escape delimiters, and use ordinary numbered punctuation such as 1. and 2. When a comparison, classification or summary genuinely helps (e.g. comparing two concepts, listing properties, contrasting examples), present it as a proper Markdown pipe table (a header row, a |---|---| separator row, then data rows) rather than a wall of prose - but only when a table is clearly the clearest format, not for every answer. Mode: ${mode}. Relevant context: ${context||"none"}`;
      const messages=[{role:"system",content:instruction},...history,{role:"user",content:question}];
      const text=await callConfiguredAI(messages,{temperature:0.14,maxTokens:2400});
      return json({reply:normalizeTutorReply(text)});
    }
    if (m === "GET" && p === "/api/tests") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub), allowed = studentSubjects(u);
      return json(d.tests.filter((t) => t.published && allowed.includes(t.subject)).map((t) => ({ id: t.id, title: t.title, subject: t.subject, duration: t.duration, count: t.questions.length, instructions: t.instructions || "", locked: t.access === "activated" && !u.activated, activationPrice: ACTIVATION_PRICE_NAIRA, access: t.access === "activated" ? "activated" : "all", resultVisibility: t.resultVisibility === "held" ? "held" : "immediate", studentFields: Array.isArray(t.studentFields) ? t.studentFields : [], passMark: Number(t.passMark)||50, oneAttempt: t.oneAttempt !== false })));
    }
    if (m === "GET" && /^\/api\/tests\/[^/]+$/.test(p)) {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const id = p.split("/").pop(), d = await load(), u = d.users.find(u2 => u2.id === a.sub), t = d.tests.find((t2) => t2.id === id && t2.published);
      if (!t) return json({ error: "Test not found." }, 404);
      if (t.access === "activated" && !u.activated) return json({ error: `This CBT requires account activation. Activate your account for ₦${ACTIVATION_PRICE_NAIRA.toLocaleString("en-NG")}.` }, 403);
      const subjectGuard = assertUserSubject(u, t.subject); if (subjectGuard) return subjectGuard;
      let sourceQuestions = Array.isArray(t.questionPool) && t.questionPool.length ? t.questionPool : t.questions;
      if (Array.isArray(t.questionPool) && t.questionPool.length) {
        const count = Math.min(Math.max(1, Number(t.questionPoolCount) || t.questionPool.length), sourceQuestions.length);
        sourceQuestions = shuffleCopy(sourceQuestions).slice(0, count);
      }
      const made = await makePresentedSession("cbt-sessions", a.sub, t.id, sourceQuestions, t.shuffleQuestions !== false, t.shuffleOptions !== false, "practice", t.duration);
      return json({ id: t.id, title: t.title, subject: t.subject, duration: t.duration, instructions: t.instructions || "", sections: Array.isArray(t.sections) ? t.sections : [], studentFields: Array.isArray(t.studentFields) ? t.studentFields : [], passMark: Number(t.passMark)||50, oneAttempt: t.oneAttempt !== false, resultVisibility: t.resultVisibility === "held" ? "held" : "immediate", sessionId: made.sessionId, count: made.presented.length, questions: made.presented.map((x) => publicQuestion({ ...x.q, answer: x.answerIndex }, false)) });
    }
    if (m === "POST" && /^\/api\/tests\/[^/]+\/submit$/.test(p)) {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const id = p.split("/")[3], x = await readJSON(request), d = await load(), u = d.users.find(u2 => u2.id === a.sub), t = d.tests.find((t2) => t2.id === id && t2.published);
      if (!t) return json({ error: "Test not found." }, 404);
      if (t.access === "activated" && !u.activated) return json({ error: `This CBT requires account activation. Activate your account for ₦${ACTIVATION_PRICE_NAIRA.toLocaleString("en-NG")}.` }, 403);
      const subjectGuard = assertUserSubject(u, t.subject); if (subjectGuard) return subjectGuard;
      const submittedFields = x.studentForm && typeof x.studentForm === "object" ? x.studentForm : {};
      for (const field of (Array.isArray(t.studentFields) ? t.studentFields : [])) {
        const value = cleanString(submittedFields[field.key] ?? "", 1000);
        if (field.required && !value) return json({ error: `${field.label || "Required field"} is required.` }, 400);
        if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return json({ error: `${field.label || "Email"} must be a valid email address.` }, 400);
      }
      if (!Array.isArray(x.answers) || x.answers.some((v) => v !== null && !Number.isInteger(v))) return json({ error: "Invalid answer submission." }, 400);
      let session = x.sessionId ? await getSession("cbt-sessions", x.sessionId) : null;
      let presented = t.questions.map((q) => ({ q, answerIndex: q.answer }));
      if (session) {
        if (session.userId !== a.sub || session.sourceId !== id || sessionExpired(session, 60)) return json({ error: "This CBT session has expired. Start the test again." }, 409);
        if (x.answers.length !== session.items.length) return json({ error: "Invalid answer submission." }, 400);
        const sourcePool = [...(Array.isArray(t.questionPool) ? t.questionPool : []), ...(Array.isArray(t.questions) ? t.questions : [])];
        const qMap = new Map(sourcePool.map(q2 => [String(q2.id), q2]));
        presented = session.items.map((it) => {
          const q = qMap.get(String(it.id));
          if (!q) return null;
          return q ? { q: { ...q, options: it.optionOrder.map((i) => q.options[i]) }, answerIndex: it.answerIndex } : null;
        });
        if (presented.some(item => !item)) return json({ error: "A question in this CBT session is no longer available. Start the test again." }, 409);
      } else if (x.answers.length !== t.questions.length) return json({ error: "Invalid answer submission." }, 400);
      let correct = 0, unanswered = 0, earnedMarks = 0, totalMarks = 0;
      x.answers.forEach((v, i) => {
        const marks = questionMarks(presented[i]?.q);
        totalMarks += marks;
        if (v === null) unanswered++;
        else if (v === presented[i]?.answerIndex) { correct++; earnedMarks += marks; }
      });
      const total = presented.length;
      const percentage = totalMarks ? Math.round((earnedMarks / totalMarks) * 100) : 0;
      if (t.oneAttempt !== false && d.results.some((r2) => r2.userId === a.sub && r2.testId === id)) return json({ error: "You have already submitted this test." }, 409);
      // The check above only sees this request's snapshot, so two simultaneous
      // submissions could both pass it and then be merged into two separate
      // results for a one-attempt test. Claim a deterministic completion key
      // first: only the request that creates it may record the result.
      const claimKey = `cbt-completion/${String(a.sub).replace(/[^a-zA-Z0-9_-]/g, "")}/${String(t.id).replace(/[^a-zA-Z0-9_-]/g, "")}`;
      const resultId = crypto.randomUUID();
      const claim = await store().setJSON(claimKey, { resultId, userId: a.sub, testId: t.id, at: new Date().toISOString() }, { onlyIfNew: true }).catch(() => null);
      if (claim && claim.modified === false) return json({ error: "You have already submitted this test." }, 409);
      // Store the exact questions and option order the student saw. Rebuilding
      // the review later from the live test would show shuffled answers against
      // the wrong questions, and would break outright if the test is edited.
      const reviewSnapshot = buildReviewFromPresented(presented, x.answers);
      const r = { id: resultId, userId: a.sub, studentName: u?.name || u?.username || "Student", testId: t.id, testTitle: t.title, subject: t.subject, score: percentage, passMark: Number(t.passMark)||50, passed: percentage >= (Number(t.passMark)||50), resultVisibility: t.resultVisibility === "held" ? "held" : "immediate", resultReleased: t.resultVisibility !== "held", earnedMarks, totalMarks, correct, wrong: total - correct - unanswered, unanswered, answers: x.answers.slice(), studentForm: Object.fromEntries((Array.isArray(t.studentFields)?t.studentFields:[]).map(f=>[f.key,cleanString(submittedFields[f.key]??"",1000)])), date: (/* @__PURE__ */ new Date()).toISOString(), submittedAt: (/* @__PURE__ */ new Date()).toISOString(), reviewSnapshot };
      d.results.unshift(r);
      try {
        await save(d);
      } catch (error) {
        // Release the claim so the student can retry a submission that failed
        // before it was ever recorded.
        await store().delete(claimKey).catch(() => {});
        throw error;
      }
      if (session) await store().delete(`cbt-sessions-${String(x.sessionId).replace(/[^a-zA-Z0-9-]/g, "")}`).catch(() => {
      });
      return json(t.resultVisibility === "held" && !t.resultReleased ? { result: { id:r.id, testId:r.testId, testTitle:r.testTitle, subject:r.subject, resultVisibility:"held", resultReleased:false, date:r.date, submittedAt:r.submittedAt }, held:true } : { result: r, review: reviewSnapshot });
    }
    if (m === "GET" && /^\/api\/results\/[^/]+\/review$/.test(p)) {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub), r = d.results.find((r2) => r2.id === p.split("/")[3] && r2.userId === a.sub);
      if (!r) return json({ error: "Result not found." }, 404);
      if (!resultVisibilityFor(d, r)) return json({ error: "This result has not been released yet." }, 403);
      const subjectGuard = assertUserSubject(u, r.subject); if (subjectGuard) return subjectGuard;
      // Prefer the snapshot taken at submission time for any result that has
      // one; it is the only faithful record of what the student was shown.
      if (Array.isArray(r.reviewSnapshot)) return json({ result: { ...r }, review: r.reviewSnapshot });
      // Legacy fallback for results recorded before snapshots were stored. The
      // reconstruction uses the test's current, unshuffled order, so it can
      // differ from what the student originally saw.
      const t = d.tests.find((t2) => t2.id === r.testId);
      if (!t) return json({ error: "This test is no longer available for review." }, 404);
      const presented = t.questions.map((q) => ({ q, answerIndex: q.answer }));
      return json({ result: { ...r }, review: buildReviewFromPresented(presented, r.answers || []), reconstructed: true });
    }
    if (m === "GET" && p === "/api/question-bank") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub), subject = cleanString(url.searchParams.get("subject") || "", 80);
      const subjectGuard = assertUserSubject(u, subject); if (subjectGuard) return subjectGuard;
      return json({ subject, count: d.questionBank.filter((q) => q.subject === subject).length });
    }
    
    if (m === "GET" && p === "/api/question-bank/topics") {
      const a=await auth(request,"student"); if(!a)return json(sessionExpiredError(),401);
      const d=await load(), u=d.users.find(x=>x.id===a.sub), subject=cleanString(url.searchParams.get("subject")||"",80);
      const guard=assertUserSubject(u,subject); if(guard)return guard;
      return json(d.topics.filter(t=>t.subject===subject).map(t=>publicTopic(t,d)));
    }
    if (m === "POST" && p === "/api/question-bank/topic-session") {
      const a=await auth(request,"student"); if(!a)return json(sessionExpiredError(),401);
      const x=await readJSON(request), d=await load(), u=d.users.find(v=>v.id===a.sub);
      const subject=cleanString(x.subject,80), guard=assertUserSubject(u,subject); if(guard)return guard;
      const topicIds=Array.isArray(x.topicIds)?[...new Set(x.topicIds.map(String))]:[];
      if(!topicIds.length)return json({error:"Select at least one topic."},400);
      const topics=d.topics.filter(t=>topicIds.includes(String(t.id))&&t.subject===subject);
      if(topics.length!==topicIds.length)return json({error:"One or more selected topics are invalid for this subject."},400);
      const pool=eligibleTopicQuestions(d,subject,topicIds);
      const uniquePool=selectUniqueQuestions(pool,pool.length);
      const single=topicIds.length===1;
      const requested=Math.floor(Number(x.count)||1);
      const maxAllowed=single?Math.min(40,uniquePool.length):Math.min(100,uniquePool.length);
      if(requested<1||requested>maxAllowed)return json({error:`Only ${uniquePool.length} unique valid questions are available in the selected topic pool. Choose a number from 1 to ${maxAllowed}.`,available:uniquePool.length,max:maxAllowed},400);
      const picked=selectUniqueQuestions(uniquePool,requested);
      const mode=x.mode==="study"?"study":"practice";
      const made=await makePresentedSession("qb-topic-sessions",a.sub,`${subject}:${topicIds.sort().join(",")}`,picked,true,true,mode,Number(x.duration)||0);
      const byId=new Map(made.presented.map(x=>[x.q.id,x]));
      return json({sessionId:made.sessionId,subject,topicIds,mode,count:made.presented.length,
        topics:topics.map(t=>publicTopic(t,d)),
        questions:made.presented.map(x=>publicQuestion({...x.q,answer:x.answerIndex},false))});
    }
    if (m === "POST" && /^\/api\/question-bank\/topic-session\/[^/]+\/submit$/.test(p)) {
      const a=await auth(request,"student"); if(!a)return json(sessionExpiredError(),401);
      const id=p.split("/")[4], x=await readJSON(request), s=await getSession("qb-topic-sessions",id);
      const d=await load(), u=d.users.find(v=>v.id===a.sub);
      if(!s||s.userId!==a.sub||sessionExpired(s,60))return json({error:"This topic-practice session has expired. Start another one."},409);
      if(!Array.isArray(x.answers)||x.answers.length!==s.items.length||x.answers.some(v=>v!==null&&(!Number.isInteger(v)||v<0||v>3)))return json({error:"Invalid answer submission."},400);
      const questions=s.items.map(it=>{const q=d.questionBank.find(q2=>q2.id===it.id);return q?{q:{...q,options:it.optionOrder.map(k=>q.options[k])},answerIndex:it.answerIndex}:null;});
      if(questions.some(v=>!v))return json({error:"A question in this session is no longer available. Start another session."},409);
      const review=buildReviewFromPresented(questions,x.answers);
      const correct=x.answers.reduce((n,v,i)=>n+(v!==null&&v===questions[i].answerIndex?1:0),0);
      const result={id:crypto.randomUUID(),userId:a.sub,testId:`topic:${s.sourceId}`,testTitle:"Topic Practice",subject:s.sourceId.split(":")[0],score:Math.round(correct/questions.length*100),correct,wrong:questions.length-correct-x.answers.filter(v=>v===null).length,unanswered:x.answers.filter(v=>v===null).length,answers:x.answers.slice(),date:new Date().toISOString(),submittedAt:new Date().toISOString(),kind:"topic-practice",topicIds:s.sourceId.split(":").slice(1)[0]?.split(",")||[],reviewSnapshot:review};
      d.results.unshift(result); d.practiceHistory.unshift({id:crypto.randomUUID(),userId:a.sub,subject:result.subject,questionIds:s.items.map(it=>it.id),cycle:1,completedAt:new Date().toISOString()}); d.practiceHistory=d.practiceHistory.slice(0,5000);
      await save(d); await store().delete(`qb-topic-sessions-${String(id).replace(/[^a-zA-Z0-9-]/g,"")}`).catch(()=>{});
      return json({result,review});
    }
    if (m === "POST" && /^\/api\/questions\/[^/]+\/report$/.test(p)) {
      const a=await auth(request,"student"); if(!a)return json(sessionExpiredError(),401);
      if(!rateLimit(request,"question-report",20,36e5))return json({error:"You have sent several reports already. Please try again later."},429);
      const id=decodeURIComponent(p.split("/")[3]), x=await readJSON(request), d=await load(), u=d.users.find(v=>v.id===a.sub), q=d.questionBank.find(v=>v.id===id);
      if(!u||!q)return json({error:"Question not found."},404);
      if (x.sessionId) {
        const sessionKinds=["qb-sessions","qb-topic-sessions","cbt-sessions","set-sessions"];
        let matched=false;
        for (const kind of sessionKinds) {
          const s=await getSession(kind, cleanString(x.sessionId,120));
          if (!s || s.userId!==a.sub) continue;
          if ((s.items||[]).some(it=>String(it.id)===String(id))) { matched=true; break; }
        }
        if (!matched) return json({error:"That question was not part of your reported session."},403);
      } else {
        return json({error:"A valid practice or CBT session is required to report a question."},400);
      }
      const reasons=["Incorrect answer","Incorrect question","Typographical/spelling error","Wrong or missing option","Incorrect explanation","Missing/incorrect image or diagram","Ambiguous/confusing question","Other"];
      const reason=reasons.includes(x.reason)?x.reason:"Other", details=cleanString(x.details||"",2000);
      const duplicate=d.questionReports.find(r=>r.questionId===id&&r.userId===a.sub&&r.reason===reason&&r.status==="Pending");
      if(duplicate)return json({error:"You already have a pending report for this question and reason.",report:reportPublic(duplicate,d)},409);
      const report={id:crypto.randomUUID(),questionId:id,subject:q.subject,topic:q.topic||"Uncategorized / Topic Not Assigned",userId:a.sub,sessionId:cleanString(x.sessionId||"",120),cbtId:cleanString(x.cbtId||"",120),reason,details,createdAt:new Date().toISOString(),status:"Pending"};
      d.questionReports.unshift(report); d.notifications.unshift({id:crypto.randomUUID(),userId:"admin",type:"question-report",title:"New question report",message:`${u.name||"A student"} reported a ${reason.toLowerCase()} in ${q.subject}.`,url:"/admin.html#bank",createdAt:new Date().toISOString(),read:false}); await save(d); return json(reportPublic(report,d),201);
    }

if (m === "POST" && p === "/api/question-bank/session") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const x = await readJSON(request), d = await load(), u = d.users.find(u2 => u2.id === a.sub), subject = cleanString(x.subject, 80), mode = x.mode === "study" ? "study" : "practice";
      const subjectGuard = assertUserSubject(u, subject); if (subjectGuard) return subjectGuard;
      const all = d.questionBank.filter((q) => q.subject === subject);
      if (!all.length) return json({ error: "There are no questions in this subject yet." }, 404);
      const requested = Math.min(100, Math.max(1, Number(x.count) || 1));
      let history = d.practiceHistory.find(h => h.id === `practice:${a.sub}:${subject}`);
      if (!history) {
        history = { id: `practice:${a.sub}:${subject}`, userId: a.sub, subject, questionIds: [], cycle: 1, updatedAt: new Date().toISOString() };
        d.practiceHistory.push(history);
      }
      const allIds = new Set(all.map(q => String(q.id)));
      history.questionIds = (Array.isArray(history.questionIds) ? history.questionIds : []).map(String).filter(id => allIds.has(id));
      let unpracticed = all.filter(q => !history.questionIds.includes(String(q.id)));
      if (mode === "practice" && !unpracticed.length) {
        history.questionIds = [];
        history.cycle = Number(history.cycle || 1) + 1;
        history.updatedAt = new Date().toISOString();
        unpracticed = all.slice();
        await save(d);
      }
      const pool = mode === "practice" ? unpracticed : all;
      // Respect the student's requested question count exactly. A shared passage or image
      // remains attached to each selected question, so one question does not expand into
      // an entire linked passage group.
      const selected = shuffleCopy(pool).slice(0, Math.min(requested, pool.length));
      const duration = mode === "practice" ? Math.min(120, Math.max(1, Number(x.duration) || 10)) : 0;
      const made = await makePresentedSession("qb-sessions", a.sub, subject, selected, false, true, mode, duration);
      return json({ sessionId: made.sessionId, subject, mode, duration, count: made.presented.length, questions: made.presented.map((x2) => publicQuestion({ ...x2.q, answer: x2.answerIndex }, mode === "study")) });
    }
    if (m === "POST" && /^\/api\/question-bank\/session\/[^/]+\/submit$/.test(p)) {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const id = p.split("/")[4], x = await readJSON(request), s = await getSession("qb-sessions", id), d = await load(), u = d.users.find(u2 => u2.id === a.sub);
      if (!s || s.userId !== a.sub || s.mode !== "practice" || sessionExpired(s, 60)) return json({ error: "This practice session has expired. Start another one." }, 409);
      const subjectGuard = assertUserSubject(u, s.sourceId); if (subjectGuard) return subjectGuard;
      if (!Array.isArray(x.answers) || x.answers.length !== s.items.length || x.answers.some((v) => v !== null && (!Number.isInteger(v) || v < 0 || v > 3))) return json({ error: "Invalid answer submission." }, 400);
      const questions = s.items.map((it, i) => {
        const q = d.questionBank.find((q2) => q2.id === it.id);
        return q ? { q: { ...q, options: it.optionOrder.map((k) => q.options[k]) }, answerIndex: it.answerIndex } : null;
      });
      if (questions.some((x2) => !x2)) return json({ error: "One of the questions in this session is no longer available. Please start another session." }, 409);
      let correct = 0, unanswered = 0;
      x.answers.forEach((v, i) => {
        if (v === null) unanswered++;
        else if (v === questions[i]?.answerIndex) correct++;
      });
      const total = questions.length;
      const submittedAt = new Date().toISOString();
      const r = { id: crypto.randomUUID(), userId: a.sub, testId: `qb:${s.sourceId}:${id}`, testTitle: `Question Bank \u2014 ${s.sourceId}`, subject: s.sourceId, score: total ? Math.round(correct / total * 100) : 0, correct, wrong: total - correct - unanswered, unanswered, answers: x.answers.slice(), date: submittedAt, submittedAt, kind: "question-bank", reviewSnapshot: buildReviewFromPresented(questions, x.answers) };
      d.results.unshift(r);
      const history = d.practiceHistory.find(h => h.id === `practice:${a.sub}:${s.sourceId}`);
      if (history && s.mode === "practice") {
        history.questionIds = [...new Set([...(history.questionIds || []).map(String), ...s.items.map(it => String(it.id))])];
        history.updatedAt = submittedAt;
      }
      await save(d);
      await store().delete(`qb-sessions-${id}`).catch(() => {
      });
      return json({ result: r, review: buildReviewFromPresented(questions, x.answers) });
    }

    if (m === "GET" && p === "/api/question-sets") {
      const a = await auth(request, "student"); if (!a) return json(sessionExpiredError(), 401);
      const d = await load(), u = d.users.find(u2=>u2.id===a.sub), allowed = studentSubjects(u);
      return json(d.questionSets.filter(set => set.published && (set.sections||[]).some(sec=>allowed.includes(sec.subject))).map(set=>sanitizeQuestionSetForStudent(set, allowed).sections.length ? ({...sanitizeQuestionSetForStudent(set,allowed), locked:set.access === "activated" && !u.activated, activationPrice:ACTIVATION_PRICE_NAIRA, access:set.access === "activated" ? "activated" : "all", sections:sanitizeQuestionSetForStudent(set,allowed).sections.map(sec=>({subject:sec.subject,count:sec.questions.length}))}) : null).filter(Boolean));
    }
    if (m === "GET" && /^\/api\/question-sets\/[^/]+$/.test(p)) {
      const a=await auth(request,"student"); if(!a)return json(sessionExpiredError(),401); const d=await load(),u=d.users.find(u2=>u2.id===a.sub),set=d.questionSets.find(s=>s.id===p.split("/").pop()&&s.published); if(!set)return json({error:"Question set not found."},404); if(set.access==="activated"&&!u.activated)return json(activationError("assessment set"),403); const safe=sanitizeQuestionSetForStudent(set,studentSubjects(u)); if(!safe.sections.length)return json({error:"You are not registered for any subject in this set."},403); const flat=safe.sections.flatMap(sec=>sec.questions.map(q=>({...q,subject:sec.subject}))); const made=await makePresentedSession("set-sessions",a.sub,set.id,flat,set.shuffleQuestions!==false,set.shuffleOptions!==false,"practice",set.duration||0); const byId=new Map(made.presented.map(x=>[x.q.id,x])); return json({id:set.id,title:set.title,duration:set.duration||0,passMark:Number(set.passMark)||50,oneAttempt:set.oneAttempt!==false,resultVisibility:set.resultVisibility||"immediate",resultReleased:set.resultVisibility!=="held"||set.resultReleased===true,studentFields:normaliseStudentFields(set.studentFields),sessionId:made.sessionId,sections:safe.sections.map(sec=>({subject:sec.subject,questions:sec.questions.map(q=>{const x=byId.get(q.id); return x?publicQuestion({...x.q,answer:x.answerIndex},false):null}).filter(Boolean)}))});
    }
    if (m === "POST" && /^\/api\/question-sets\/[^/]+\/submit$/.test(p)) {
      const a=await auth(request,"student"); if(!a)return json(sessionExpiredError(),401); const id=p.split("/")[3],x=await readJSON(request),s=await getSession("set-sessions",x.sessionId),d=await load(),u=d.users.find(u2=>u2.id===a.sub),set=d.questionSets.find(qs=>qs.id===id&&qs.published); if(!set)return json({error:"Question set not found."},404); if(set.access==="activated"&&!u.activated)return json({error:`This assessment set requires account activation. Activate your account for ₦${ACTIVATION_PRICE_NAIRA.toLocaleString("en-NG")}.`},403); for(const field of (Array.isArray(set.studentFields)?set.studentFields:[])){const value=cleanString(x.studentForm?.[field.key]??"",1000);if(field.required&&!value)return json({error:`${field.label||"Required field"} is required.`},400);if(field.type==="email"&&value&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))return json({error:`${field.label||"Email"} must be a valid email address.`},400)} if(set.oneAttempt!==false&&d.results.some(r=>r.questionSetId===id&&r.userId===a.sub))return json({error:"You have already submitted this assessment."},409); if(!s||s.userId!==a.sub||s.sourceId!==id||s.mode!=="practice"||sessionExpired(s,60))return json({error:"This question-set session has expired. Start the set again."},409); const allowed=new Set(studentSubjects(u)); const visible=set.sections.flatMap(sec=>allowed.has(sec.subject)?sec.questions.map(q=>({...q,subject:sec.subject})):[]); const presented=s.items.map(it=>{const q=visible.find(q2=>q2.id===it.id); return q?{q:{...q,options:it.optionOrder.map(i=>q.options[i])},answerIndex:it.answerIndex}:null}).filter(Boolean); if(!Array.isArray(x.answers)||x.answers.length!==presented.length)return json({error:"Invalid answer submission."},400); let correct=0,unanswered=0,earnedMarks=0,totalMarks=0; const bySubject={}; x.answers.forEach((v,i)=>{ const subj=presented[i]?.q?.subject||"Unknown"; const marks=questionMarks(presented[i]?.q); totalMarks+=marks; if(v===null)unanswered++; else if(v===presented[i]?.answerIndex){correct++;earnedMarks+=marks;} if(!bySubject[subj])bySubject[subj]={correct:0,total:0,unanswered:0,earnedMarks:0,totalMarks:0}; bySubject[subj].total++; bySubject[subj].totalMarks+=marks; if(v===null)bySubject[subj].unanswered++; else if(v===presented[i]?.answerIndex){bySubject[subj].correct++;bySubject[subj].earnedMarks+=marks;} }); const reviewSnapshot=buildReviewFromPresented(presented,x.answers); const results=[]; for(const [subject,stat] of Object.entries(bySubject)){ const r={id:crypto.randomUUID(),userId:a.sub,testId:`set:${id}:${subject}`,testTitle:set.title,subject,score:stat.totalMarks?Math.round((stat.earnedMarks/stat.totalMarks)*100):0,earnedMarks:stat.earnedMarks,totalMarks:stat.totalMarks,correct:stat.correct,wrong:stat.total-stat.correct-stat.unanswered,unanswered:stat.unanswered,answers:x.answers.slice(),date:new Date().toISOString(),submittedAt:new Date().toISOString(),kind:"question-set",questionSetId:id,reviewSnapshot}; results.push(r); } if(set.oneAttempt!==false){const claimKey=`set-completion/${String(a.sub).replace(/[^a-zA-Z0-9_-]/g,"")}/${String(id).replace(/[^a-zA-Z0-9_-]/g,"")}`;const claim=await store().setJSON(claimKey,{userId:a.sub,setId:id,at:new Date().toISOString()},{onlyIfNew:true}).catch(()=>null);if(claim&&claim.modified===false)return json({error:"You have already submitted this assessment."},409)}
      for(const r of results){r.passMark=Number(set.passMark)||50;r.passed=Number(r.score)>=r.passMark;r.resultVisibility=set.resultVisibility;r.resultReleased=set.resultVisibility!=="held";r.studentForm=Object.fromEntries((Array.isArray(set.studentFields)?set.studentFields:[]).map(f=>[f.key,cleanString(x.studentForm?.[f.key]??"",1000)]));}
      d.results.unshift(...results); await save(d); await store().delete(`set-sessions-${String(x.sessionId||"").replace(/[^a-zA-Z0-9-]/g,"")}`).catch(()=>{}); if(set.resultVisibility==="held"&&!set.resultReleased)return json({results:results.map(r=>({id:r.id,subject:r.subject,testTitle:r.testTitle,resultVisibility:"held",resultReleased:false,date:r.date})),held:true,overall:{score:totalMarks?Math.round((earnedMarks/totalMarks)*100):0,earnedMarks,totalMarks,correct,wrong:presented.length-correct-unanswered,unanswered}}); return json({results,overall:{score:totalMarks?Math.round((earnedMarks/totalMarks)*100):0,earnedMarks,totalMarks,correct,wrong:presented.length-correct-unanswered,unanswered},review:reviewSnapshot});
    }

    if (m === "POST" && p === "/api/duel/create") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const x = await readJSON(request), d = await load();
      const expiredChanged = expireWaitingDuels(d);
      const current = duelCurrentForUser(d, a.sub);
      if (current) {
        if (expiredChanged) await save(d);
        return json({ error: "You already have a 1-v-1 room. Leave your current room before creating another.", current: duelPublic(d, current, a.sub) }, 409);
      }
      const me = d.users.find(u => u.id === a.sub);
      if (!me) return json({ error: "Student account not found." }, 404);
      const subject = String(x.subject || "").trim();
      if (!SUBJECTS.includes(subject)) return json({ error: "Choose a valid subject for the 1-v-1 match." }, 400);
      const subjectGuard = assertUserSubject(me, subject); if (subjectGuard) return subjectGuard;
      const questions = duelQuestions(d.questionBank, subject, Number(x.count) || 10);
      if (questions.length < 3) return json({ error: "Not enough questions are available for this subject." }, 409);
      try { await acquireDuelLock(a.sub, null); } catch (lockError) {
        if (lockError?.code === "DUEL_LOCKED") return json({ error: lockError.message }, 409);
        throw lockError;
      }
      const duel = { id: crypto.randomUUID(), code: duelCode(d.duels), subject, questions, hostId: a.sub, players: [{ id: a.sub, name: me.name, username: me.username, score: 0 }], answers: { [a.sub]: {} }, submitted: { [a.sub]: false }, scores: { [a.sub]: 0 }, timeouts: { [a.sub]: [] }, left: {}, status: "waiting", currentQuestionIndex: 0, currentTurnUserId: null, turnStartedAt: null, turnDeadlineAt: null, createdAt: new Date().toISOString() };
      try {
        await setDuelLock(a.sub, duel.id, Date.now() + DUEL_ROOM_TTL_MS + 60_000);
        d.duels.unshift(duel); d.duels = d.duels.slice(0, 300); await save(d);
      } catch (error) {
        await releaseDuelLock(a.sub);
        throw error;
      }
      return json(duelPublic(d, duel, a.sub), 201);
    }
    if (m === "POST" && p === "/api/duel/join") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const x = await readJSON(request), d = await load(), joiningUser = d.users.find(u=>u.id===a.sub);
      const code = cleanString(x.code, 12);
      const requestedDuel = d.duels.find(z => z.code === code && z.status === "waiting");
      if (requestedDuel && duelCodeExpired(requestedDuel)) {
        requestedDuel.status = "expired"; requestedDuel.expiredAt = new Date().toISOString();
        await save(d); await releaseDuelLock(requestedDuel.hostId);
        return json({ error: "That 1-v-1 room code expired after 15 minutes." }, 410);
      }
      const expiredChanged = expireWaitingDuels(d);
      const current = duelCurrentForUser(d, a.sub);
      if (current && current.code !== code) {
        if (expiredChanged) await save(d);
        return json({ error: "You already have a 1-v-1 room. Leave your current room before joining another.", current: duelPublic(d, current, a.sub) }, 409);
      }
      const duel = d.duels.find(z => z.code === code && z.status === "waiting");
      if (duel) { const subjectGuard = assertUserSubject(joiningUser, duel.subject); if (subjectGuard) return subjectGuard; }
      if (!duel) {
        if (expiredChanged) await save(d);
        return json({ error: "That 1-v-1 room was not found, has expired after 15 minutes, or has already started." }, 404);
      }
      if (duel.hostId === a.sub) return json(duelPublic(d, duel, a.sub));
      if (duel.players.length >= 2) return json({ error: "That 1-v-1 room is already full." }, 409);
      const me = d.users.find(u => u.id === a.sub);
      if (!me) return json({ error: "Student account not found." }, 404);
      try { await acquireDuelLock(a.sub, duel.id); } catch (lockError) {
        if (lockError?.code === "DUEL_LOCKED") return json({ error: lockError.message }, 409);
        throw lockError;
      }
      let lease = null;
      let joined = null;
      let joinedData = d;
      try {
        lease = await acquireDuelRoomWriteLock(duel.id);
        // Re-read the room *inside* the lock. The snapshot loaded before the
        // lock may already be stale: another joiner could have taken the second
        // seat and released the lock while this request was waiting for it.
        // Validating the pre-lock copy is what previously allowed two joiners
        // to both believe the room had a free seat.
        joinedData = await load();
        joined = joinedData.duels.find(z => z.id === duel.id);
        if (!joined || joined.status !== "waiting") {
          await releaseDuelLock(a.sub);
          return json({ error: "That 1-v-1 room was not found, has expired after 15 minutes, or has already started." }, 409);
        }
        if (joined.players.some(pl => pl.id === a.sub)) return json(duelPublic(joinedData, joined, a.sub));
        if (joined.players.length >= 2) { await releaseDuelLock(a.sub); return json({ error: "That 1-v-1 room is already full." }, 409); }
        joined.answers = joined.answers || {}; joined.submitted = joined.submitted || {}; joined.timeouts = joined.timeouts || {}; joined.scores = joined.scores || {};
        joined.players.push({ id: a.sub, name: me.name, username: me.username, score: 0 });
        joined.answers[a.sub] = {}; joined.submitted[a.sub] = false; joined.timeouts[a.sub] = []; joined.scores[a.sub] = 0; joined.status = "active"; joined.startedAt = new Date().toISOString(); joined.currentQuestionIndex = 0; joined.currentTurnUserId = joined.players[0].id; joined.turnStartedAt = new Date().toISOString(); joined.turnDeadlineAt = new Date(Date.now() + DUEL_TURN_TTL_MS).toISOString();
        await save(joinedData);
      } catch (error) {
        await releaseDuelLock(a.sub);
        if (error?.code === "DUEL_ROOM_BUSY") return json({ error: error.message }, 409);
        throw error;
      } finally { if (lease) await releaseDuelRoomWriteLock(duel.id, lease.owner); }
      return json(duelPublic(joinedData, joined, a.sub));
    }
    if (m === "GET" && /^\/api\/duel\/[^/]+$/.test(p)) {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const id = p.split("/").pop(), d = await load(), u = d.users.find(u2 => u2.id === a.sub), duel = d.duels.find(z => z.id === id);
      if (duel) { const subjectGuard = assertUserSubject(u, duel.subject); if (subjectGuard) return subjectGuard; }
      if (!duel || !duel.players.some(pl => pl.id === a.sub) || duel.left?.[a.sub]) return json({ error: "1-v-1 match not found or already left." }, 404);
      if (duelCodeExpired(duel)) { duel.status = "expired"; duel.expiredAt = new Date().toISOString(); await save(d); await releaseDuelLock(duel.hostId); return json({ error: "That 1-v-1 room code expired after 15 minutes." }, 410); }
      const changed = processDuelTurnTimeout(duel);
      updateDuelScores(duel);
      if (!changed) return json(duelPublic(d, duel, a.sub));
      // A polled read may be the request that discovers an expired turn. That
      // is a state transition like any other, so persist it under the room
      // lock against fresh data instead of writing a possibly stale snapshot.
      return await withDuelRoomLock(id, async (fresh, freshDuel) => {
        if (!freshDuel) return json(duelPublic(d, duel, a.sub));
        const advanced = processDuelTurnTimeout(freshDuel);
        updateDuelScores(freshDuel);
        if (advanced) await save(fresh);
        return json(duelPublic(fresh, freshDuel, a.sub));
      });
    }
    if (m === "POST" && /^\/api\/duel\/[^/]+\/leave$/.test(p)) {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const id = p.split("/")[3];
      return await withDuelRoomLock(id, async (d, duel) => {
        if (!duel || !duel.players.some(pl => pl.id === a.sub)) return json({ error: "1-v-1 match not found." }, 404);
        duel.left = duel.left || {};
        duel.left[a.sub] = true;
        // Only an open match can be cancelled. Leaving after the last answer
        // has completed the match must not overwrite the finished result.
        if (duel.status === "waiting" || duel.status === "active") {
          duel.status = "cancelled";
          duel.cancelledAt = duel.cancelledAt || new Date().toISOString();
        }
        await save(d);
        await releaseDuelLock(a.sub);
        return json({ ok: true, left: true, status: duel.status });
      });
    }
    if (m === "POST" && /^\/api\/duel\/[^/]+\/answer$/.test(p)) {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const id = p.split("/")[3], x = await readJSON(request);
      // The whole read-validate-mutate-save cycle runs under the room lock, so
      // two rapid answers cannot both pass the "already answered" check and
      // then overwrite each other during the concurrent merge.
      return await withDuelRoomLock(id, async (d, duel) => {
        if (!duel || !duel.players.some(pl => pl.id === a.sub) || duel.left?.[a.sub]) return json({ error: "1-v-1 match not found or already left." }, 404);
        if (duel.status !== "active") return json({ error: duel.status === "cancelled" ? "This 1-v-1 match has been cancelled." : "This 1-v-1 match is not active." }, 409);
        initialiseDuelTurn(duel);
        if (processDuelTurnTimeout(duel)) {
          updateDuelScores(duel);
          await save(d);
          if (duel.status === "finished") return json(duelPublic(d, duel, a.sub));
          if (duel.currentTurnUserId !== a.sub) return json({ error: "Your turn has expired. It is now your opponent's turn.", duel: duelPublic(d, duel, a.sub) }, 409);
        }
        if (duel.currentTurnUserId !== a.sub) return json({ error: "It is not your turn yet. Please wait for your opponent.", duel: duelPublic(d, duel, a.sub) }, 409);
        const index = Number(x.index), answer = Number(x.answer);
        if (!Number.isInteger(index) || index !== duel.currentQuestionIndex || index < 0 || index >= duel.questions.length || !Number.isInteger(answer) || answer < 0 || answer >= duel.questions[index].options.length) return json({ error: "That question is no longer active. Refresh the match and try again." }, 409);
        duel.answers[a.sub] = duel.answers[a.sub] || {};
        if (Object.prototype.hasOwnProperty.call(duel.answers[a.sub], index)) return json({ error: "You have already answered this turn." }, 409);
        duel.answers[a.sub][index] = answer;
        advanceDuelTurn(duel, false);
        if (duel.status === "finished") {
          duel.submitted[a.sub] = true;
          for (const p2 of duel.players) duel.submitted[p2.id] = true;
        }
        updateDuelScores(duel);
        await save(d);
        return json(duelPublic(d, duel, a.sub));
      });
    }
    // Kept for backward compatibility with older clients. In turn-based play,
    // submitting is equivalent to letting the current turn expire rather than
    // ending a player's entire match prematurely.
    if (m === "POST" && /^\/api\/duel\/[^/]+\/submit$/.test(p)) {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const id = p.split("/")[3];
      return await withDuelRoomLock(id, async (d, duel) => {
        if (!duel || !duel.players.some(pl => pl.id === a.sub) || duel.left?.[a.sub]) return json({ error: "1-v-1 match not found or already left." }, 404);
        if (duel.status !== "active") return json({ error: "This 1-v-1 match is not active." }, 409);
        initialiseDuelTurn(duel);
        if (duel.currentTurnUserId !== a.sub) return json({ error: "It is not your turn." }, 409);
        advanceDuelTurn(duel, true);
        updateDuelScores(duel);
        await save(d);
        return json(duelPublic(d, duel, a.sub));
      });
    }
    if (m === "GET" && p === "/api/duels/mine") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub), allowed = studentSubjects(u); const items = d.duels.filter(z => z.players.some(pl => pl.id === a.sub) && allowed.includes(z.subject)).slice(0, 10).map(z => duelPublic(d, z, a.sub)); return json(items);
    }
    if (m === "GET" && p === "/api/dashboard") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load(), u = d.users.find((u2) => u2.id === a.sub);
      if (!u || u.status !== "active") return json({ error: "Account unavailable." }, 401);
      const allowedSubjects = studentSubjects(u);
      const results = d.results.filter((r) => { const t = d.tests.find(t2 => t2.id === r.testId); const visible = resultVisibilityFor(d, r); return r.userId === u.id && allowedSubjects.includes(r.subject) && visible; });
      const avg = results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0;
      // The general and per-subject boards must be filtered independently.
      // Applying the subject reset to the shared `all` bucket meant that
      // clearing one subject's board also erased those attempts from the
      // overall board, even though the general reset had not been touched.
      const generalReset = effectiveLeaderboardReset(d);
      const aggregates = /* @__PURE__ */ new Map();
      const bucketFor = (userId) => {
        if (!aggregates.has(userId)) aggregates.set(userId, { all: { sum: 0, n: 0 }, subjects: {} });
        return aggregates.get(userId);
      };
      for (const r of d.results) {
        const resultUser = d.users.find(user => user.id === r.userId);
        if (!resultUser || !studentSubjects(resultUser).includes(r.subject)) continue;
        const score = Number(r.score) || 0;
        if (countsAfterReset(r, generalReset)) {
          const a0 = bucketFor(r.userId);
          a0.all.sum += score;
          a0.all.n++;
        }
        const subjectReset = effectiveLeaderboardReset(d, r.subject || "");
        if (countsAfterReset(r, subjectReset)) {
          const a0 = bucketFor(r.userId);
          if (!a0.subjects[r.subject]) a0.subjects[r.subject] = { sum: 0, n: 0 };
          a0.subjects[r.subject].sum += score;
          a0.subjects[r.subject].n++;
        }
      }
      const makeLeaderboard = (subject) => d.users.filter(isRankedStudent).map((user) => {
        const a0 = aggregates.get(user.id);
        const rr = subject ? a0?.subjects?.[subject] : a0?.all;
        return { id: user.id, name: user.name || user.username || user.email || "Student", score: rr?.n ? Math.round(rr.sum / rr.n) : 0, tests: rr?.n || 0 };
      }).filter((x) => x.tests > 0).sort((x, y) => y.score - x.score || y.tests - x.tests || x.name.localeCompare(y.name));
      const lb = makeLeaderboard("");
      const subjectLeaderboards = allowedSubjects.reduce((out, subject) => {
        out[subject] = makeLeaderboard(subject).slice(0, 10);
        return out;
      }, {});
      const subjectRanks = allowedSubjects.reduce((out, subject) => {
        out[subject] = makeLeaderboard(subject).findIndex((x) => x.id === u.id) + 1 || 0;
        return out;
      }, {});
      const selectedSubjects = allowedSubjects;
      const recommendations = selectedSubjects.map(subject => {
        const rr = results.filter(r => r.subject === subject);
        const average = rr.length ? Math.round(rr.reduce((sum,r)=>sum+(Number(r.score)||0),0)/rr.length) : null;
        return { subject, average, tests: rr.length, priority: !rr.length ? "Start practice" : average < 60 ? "High priority revision" : average < 80 ? "Keep revising" : "Maintain strength" };
      });
      return json({
        user: publicUser(u),
        avg,
        tests: results.length,
        recommendations,
        results,
        rank: lb.findIndex((x) => x.id === u.id) + 1 || 0,
        leaderboard: lb.slice(0, 10),
        subjectLeaderboards,
        subjectRanks,
        counts: { materials: d.notes.filter((n) => n.published).length, announcements: d.announcements.filter((a2) => a2.published).length, tests: d.tests.filter((t) => t.published).length }
      });
    }
    if (m === "GET" && p === "/api/notes") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub), allowed = studentSubjects(u);
      return json(d.notes.filter((n) => n.published && allowed.includes(n.subject)).map(({ body, ...n }) => {
        const locked = n.access === "activated" && !u.activated;
        if (!locked) return { ...n, hasBody: !!body, locked, activationPrice: ACTIVATION_PRICE_NAIRA };
        return { ...n, hasBody: false, body: "", locked: true, activationPrice: ACTIVATION_PRICE_NAIRA, attachments: [], media: [], fileUrl: "", fileKey: "", fileName: "" };
      }));
    }
    if (m === "GET" && /^\/api\/notes\/[^/]+$/.test(p)) {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub), n = d.notes.find((n2) => n2.id === p.split("/").pop() && n2.published);
      if (!n) return json({ error: "Material not found." }, 404);
      const subjectGuard = assertUserSubject(u, n.subject); if (subjectGuard) return subjectGuard;
      if (n.access === "activated" && !u.activated) return json(activationError("material"), 403);
      return json(n);
    }
    if (m === "GET" && (p === "/api/materials" || p === "/api/notes/full")) {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load(), u = d.users.find(u2 => u2.id === a.sub), allowed = studentSubjects(u);
      return json(d.notes.filter((n) => n.published && allowed.includes(n.subject)).sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || ""))).map(n => {
        const locked = n.access === "activated" && !u.activated;
        if (!locked) return { ...n, locked: false, activationPrice: ACTIVATION_PRICE_NAIRA };
        const { attachments, media, fileUrl, fileKey, fileName, ...safeNote } = n;
        return { ...safeNote, attachments: [], media: [], fileUrl: "", fileKey: "", fileName: "", body: "", locked: true, activationPrice: ACTIVATION_PRICE_NAIRA };
      }));
    }
    if (m === "GET" && p === "/api/leaderboard") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load(), viewer = d.users.find(u2 => u2.id === a.sub);
      const subject = cleanString(url.searchParams.get("subject") || "", 60);
      if (subject) { const subjectGuard = assertUserSubject(viewer, subject); if (subjectGuard) return subjectGuard; }
      const resetAt = effectiveLeaderboardReset(d, subject);
      const rows = d.users.filter(isRankedStudent).map((u) => {
        const allowed = studentSubjects(u);
        const rr = d.results.filter((r) => r.userId === u.id && allowed.includes(r.subject) && (!subject || r.subject === subject) && countsAfterReset(r, resetAt));
        return { name: u.name || u.username || u.email || "Student", username: u.username, avg: rr.length ? Math.round(rr.reduce((s, r) => s + r.score, 0) / rr.length) : 0, tests: rr.length };
      }).filter((x) => x.tests > 0).sort((x, y) => y.avg - x.avg || y.tests - x.tests || x.name.localeCompare(y.name));
      return json(rows.slice(0, 50));
    }
    if (m === "PATCH" && p === "/api/me") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const x = await readJSON(request), d = await load(), u = d.users.find(u2 => u2.id === a.sub);
      if (!u) return json({ error: "Account unavailable." }, 401);
      const name = cleanString(x.name, 120), username = cleanString(x.username, 80), email = cleanString(x.email, 160).toLowerCase();
      if (username && !/^[a-zA-Z0-9._-]{3,80}$/.test(username)) return json({ error: "Username may only contain letters, numbers, dot, dash and underscore." }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
      if (username && d.users.some(v => v.id !== u.id && v.username.toLowerCase() === username.toLowerCase())) return json({ error: "That username is already in use." }, 409);
      if (email && d.users.some(v => v.id !== u.id && String(v.email || "").toLowerCase() === email)) return json({ error: "That email is already in use." }, 409);
      // Selected subjects are administrator-controlled (see PATCH /api/admin/students/:id).
      // A student's own profile update can never change them, regardless of what the
      // request body contains — this is enforced here, not merely hidden in the UI.
      if (email && email !== String(u.email || "").toLowerCase() && u.authUserId) {
        try { await supabaseUpdateUser(u.authUserId, { email, email_confirm: false }); } catch (error) { return json({ error: "The email address could not be updated in the authentication service." }, 400); }
      }
      if (name) u.name = name;
      if (username) u.username = username;
      if (email) u.email = email;
      await save(d);
      return json({ ok: true, user: publicUser(u) });
    }
    if (m === "POST" && p === "/api/me/password") {
      return json({ error: "Student self-service password changes are disabled. Contact the administrator for a password reset after identity verification." }, 410);
    }
    if (m === "POST" && p === "/api/me/delete") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      if (!rateLimit(request, "delete-account", 5, 9e5)) return json({ error: "Too many deletion attempts. Try again later." }, 429);
      const x = await readJSON(request), d = await load();
      const u = d.users.find((u2) => u2.id === a.sub);
      if (!u) return json({ error: "Account unavailable." }, 401);
      if (cleanString(x.username, 80).toLowerCase() !== String(u.username).toLowerCase() || !verifyPassword(String(x.password || ""), u))
        return json({ error: "The username or password is incorrect. Your account has not been deleted." }, 401);
      try { await supabaseSignIn(String(u.email || ""), String(x.password || "")); } catch { return json({ error: "The username or password is incorrect. Your account has not been deleted." }, 401); }
      await supabaseDeleteUser(u.authUserId);
      revokeStudentTokens(u);
      d.users = d.users.filter((x2) => x2.id !== u.id);
      d.results = d.results.filter((x2) => x2.userId !== u.id);
      await save(d);
      await releaseUserUniqueKeys(u);
      return json({ ok: true, deletedUserId: u.id });
    }
    if (m === "GET" && p === "/api/announcements") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      return json((await load()).announcements.filter((a2) => a2.published));
    }
    if (m === "POST" && p === "/api/feedback") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      if (!rateLimit(request, "feedback", 20, 36e5)) return json({ error: "You have sent several messages already. Please try again later." }, 429);
      const x = await readJSON(request), d = await load();
      const u = d.users.find((v) => v.id === a.sub);
      if (!u) return json({ error: "Account not found." }, 404);
      const rating = Math.round(Number(x.rating) || 0);
      const kind = ["feedback", "complaint", "suggestion"].includes(x.kind) ? x.kind : "feedback";
      const subject = cleanString(x.subject, 140);
      const message = cleanString(x.message, 4e3);
      if (rating < 1 || rating > 5) return json({ error: "Please tap between 1 and 5 stars." }, 400);
      if (message.length < 4) return json({ error: "Please tell us a little more so we can act on it." }, 400);
      const entry = {
        id: crypto.randomUUID(),
        userId: u.id,
        name: u.name,
        username: u.username,
        email: u.email || "",
        rating,
        kind,
        subject: subject || (kind === "complaint" ? "Complaint" : "Feedback"),
        message,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        resolved: false
      };
      d.feedback.unshift(entry);
      if (d.feedback.length > 2e3) d.feedback.length = 2e3;
      await save(d);
      return json({ ok: true, entry, message: "Thank you \u2014 your feedback has reached the Gifted Brainz team." });
    }
    if (m === "GET" && p === "/api/feedback") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load();
      const mine = d.feedback.filter((f) => f.userId === a.sub);
      const rated = d.feedback.filter((f) => Number(f.rating) > 0);
      const average = rated.length ? Math.round(rated.reduce((s, f) => s + Number(f.rating), 0) / rated.length * 10) / 10 : 0;
      const breakdown = [5, 4, 3, 2, 1].map((star) => ({ star, count: rated.filter((f) => Number(f.rating) === star).length }));
      return json({ mine, summary: { average, total: rated.length, breakdown } });
    }
    if (m === "GET" && p === "/api/push/public-key") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load();
      const before = JSON.stringify(d.settings.vapidPublicJwk || null);
      const st = ensureVapidKeys(d);
      if (JSON.stringify(st.vapidPublicJwk) !== before) await save(d);
      return json({ publicKey: vapidPublicRaw(st.vapidPublicJwk).toString("base64url") });
    }
    if (m === "POST" && p === "/api/push/subscribe") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const x = await readJSON(request), d = await load();
      const endpoint = cleanString(x.endpoint, 2e3), keys = x.keys || {};
      if (!/^https?:\/\//i.test(endpoint) || !keys.p256dh || !keys.auth) return json({ error: "The device notification subscription is incomplete." }, 400);
      const id = crypto.createHash("sha256").update(endpoint).digest("hex");
      const existing = d.pushSubscriptions.find((s) => s.id === id);
      const row = { id, userId: a.sub, endpoint, p256dh: cleanString(keys.p256dh, 300), auth: cleanString(keys.auth, 300), keys: { p256dh: cleanString(keys.p256dh, 300), auth: cleanString(keys.auth, 300) }, createdAt: existing?.createdAt || (/* @__PURE__ */ new Date()).toISOString(), updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
      if (existing) Object.assign(existing, row);
      else d.pushSubscriptions.push(row);
      await save(d);
      return json({ ok: true, id });
    }
    if (m === "GET" && p === "/api/notifications") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const d = await load();
      const unreadOnly = url.searchParams.get("unread") === "1";
      const mine = d.notifications.filter((n) => n.userId === a.sub && (!unreadOnly || !n.read)).sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || ""))).slice(0, 100);
      return json({ items: mine, unread: mine.filter((n) => !n.read).length });
    }
    if (m === "POST" && p === "/api/notifications/read") {
      const a = await auth(request, "student");
      if (!a) return json(sessionExpiredError(), 401);
      const x = await readJSON(request), d = await load();
      const ids = Array.isArray(x.ids) ? new Set(x.ids.map(String)) : null;
      for (const n of d.notifications) if (n.userId === a.sub && (!ids || ids.has(String(n.id)))) n.read = true;
      await save(d);
      return json({ ok: true });
    }
    // Exchange a header-authenticated API token for a download-only cookie
    // ticket, so the browser can fetch media without a token in the URL.
    // Signing out drops the cookie immediately rather than leaving it to expire.
    if (m === "DELETE" && p === "/api/files/ticket")
      return json({ ok: true }, 200, { "set-cookie": downloadCookieHeader("", 0) });
    if (m === "POST" && p === "/api/files/ticket") {
      const d = await load();
      const sessionStudent = await auth(request, "student");
      if (sessionStudent) {
        const user = d.users.find(u => u.id === sessionStudent.sub);
        const ticket = await issueDownloadTicket(sessionStudent.sub, "student", user?.tokenVersion || 1);
        return json({ ok: true, expiresIn: DOWNLOAD_TICKET_TTL }, 200, { "set-cookie": downloadCookieHeader(ticket, DOWNLOAD_TICKET_TTL) });
      }
      const headerToken = bearer(request);
      const adminTok = headerToken ? await verifyToken(headerToken, "admin") : null;
      if (adminTok && (adminTok.v || 1) === (d.settings.tokenVersion || 1)) {
        const ticket = await issueDownloadTicket("admin", "admin", adminTok.v || 1);
        return json({ ok: true, expiresIn: DOWNLOAD_TICKET_TTL }, 200, { "set-cookie": downloadCookieHeader(ticket, DOWNLOAD_TICKET_TTL) });
      }
      return json(sessionExpiredError(), 401);
    }
    if (p.startsWith("/api/files/")) {
      // Media is loaded by the browser itself (img/video/anchor), which cannot
      // send an Authorization header. Those requests are therefore authorised by
      // a short-lived, download-only cookie ticket issued by /api/files/ticket.
      //
      // A general API token is deliberately NOT accepted from the query string:
      // such a URL is kept in browser history, is copied whenever a link is
      // shared, and is commonly written to proxy and access logs, yet it would
      // grant every permission of that role until it expired.
      const d = await load();
      const headerToken = bearer(request);
      let student = headerToken ? await verifyToken(headerToken, "student") : null;
      let adminTok = student ? null : headerToken ? await verifyToken(headerToken, "admin") : null;
      if (student && !studentTokenValid(d, student)) student = null;
      if (adminTok && (adminTok.v || 1) !== (d.settings.tokenVersion || 1)) adminTok = null;
      if (!student && !adminTok) {
        const ticket = await verifyToken(cookieValue(request, DOWNLOAD_COOKIE), DOWNLOAD_ROLE);
        if (ticket?.role === DOWNLOAD_ROLE) {
          if (ticket.for === "admin") {
            if ((ticket.v || 1) === (d.settings.tokenVersion || 1)) adminTok = ticket;
          } else if (studentTokenValid(d, { sub: ticket.sub, v: ticket.v })) {
            student = ticket;
          }
        }
      }
      if (!student && !adminTok) return json(sessionExpiredError(), 401);
      const key = decodeURIComponent(p.slice("/api/files/".length));
      if (!/^uploads\/[A-Za-z0-9._()\- ]+$/.test(key)) return json({ error: "File not found." }, 404);
      if (student) {
        const viewer = d.users.find(u => u.id === student.sub);
        const protectedMaterial = d.notes.some(n => n.access === "activated" && (String(n.fileKey || "") === key || (Array.isArray(n.attachments) && n.attachments.some(f => String(f?.key || "") === key))));
        if (protectedMaterial && !viewer?.activated) return json(activationError("material"), 403);
      }
      if (d.appUpdate && d.appUpdate.fileKey === key && !adminTok)
        return json({ error: "This file is not available for download." }, 403);
      const meta = await store().get(`${key}.meta`, { type: "json" });
      if (!meta) return json({ error: "File not found." }, 404);
      const kind = mediaKind(meta?.contentType, meta?.fileName);
      const chunked = Number.isInteger(meta.parts) && Number(meta.parts) > 0;
      const partSize = Number(meta?.chunkSize) || 0;
      let totalSize = Number(meta?.size) || 0;
      // Older uploads may have incomplete metadata with size=0. Resolve the
      // size without ever returning the object body to the client.
      if (!totalSize && chunked && partSize > 0) {
        const lastIndex = Math.max(0, Number(meta.parts) - 1);
        const lastPart = await store().get(`${key}.part.${lastIndex}`, { type: "arrayBuffer" });
        if (lastPart) totalSize = lastIndex * partSize + lastPart.byteLength;
      } else if (!totalSize && !chunked) {
        const wholeForSize = await store().get(key, { type: "arrayBuffer" });
        if (wholeForSize) totalSize = wholeForSize.byteLength;
      }
      if (totalSize && Number(meta.size) !== totalSize) {
        // Persist the recovered size so subsequent HEAD requests are metadata-only.
        await store().setJSON(`${key}.meta`, { ...meta, size: totalSize });
      }
      const disposition = url.searchParams.get("inline") === "1" ? "inline" : "attachment";
      const baseHeaders = {
        "content-type": meta?.contentType || "application/octet-stream",
        "content-disposition": `${disposition}; filename="${String(meta?.fileName || "download").replace(/["\\\r\n]/g, "_")}"`,
        "cache-control": "private, max-age=0, must-revalidate",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
        "content-security-policy": "default-src 'none'; img-src 'self' data:; media-src 'self' blob:; style-src 'unsafe-inline'; frame-src 'self'"
      };
      const rangeHeader = request.headers.get("range") || "";
      // HEAD is metadata-only. Never read/return the full object for HEAD;
      // doing so can trigger EdgeOne's 6 MB client response limit before the
      // browser can even learn the file size.
      if (m === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { ...baseHeaders, "accept-ranges": "bytes", "content-length": String(totalSize) }
        });
      }
      // Cloud Functions cap client response bodies at 6 MB. Keep every ranged
      // response comfortably below that limit so large PDFs, images, audio and
      // video can still be read/viewed through the authenticated file route.
      const RANGE_MAX = 4 * 1024 * 1024;
      const canRange = totalSize > 0;
      if (canRange && /^bytes=\d*-\d*$/.test(rangeHeader)) {
        const [rawStart, rawEnd] = rangeHeader.replace("bytes=", "").split("-");
        let start = rawStart === "" ? Math.max(0, totalSize - Number(rawEnd || 0)) : Number(rawStart);
        let end = rawStart === "" ? totalSize - 1 : rawEnd === "" ? totalSize - 1 : Number(rawEnd);
        end = Math.min(end, totalSize - 1, start + RANGE_MAX - 1);
        if (!(start >= 0 && end >= start && start < totalSize))
          return new Response(null, { status: 416, headers: { "content-range": `bytes */${totalSize}`, "accept-ranges": "bytes" } });
        let body;
        if (chunked && partSize > 0) {
          const chunks = [];
          let cursor = start;
          while (cursor <= end) {
            const index = Math.floor(cursor / partSize);
            if (index >= meta.parts) break;
            const part = await store().get(`${key}.part.${index}`, { type: "arrayBuffer" });
            if (!part) break;
            const partStart = index * partSize;
            const from = cursor - partStart;
            const to = Math.min(part.byteLength, end - partStart + 1);
            if (to <= from) break;
            chunks.push(new Uint8Array(part).subarray(from, to));
            cursor = partStart + to;
          }
          if (cursor <= end) return new Response(null, { status: 500, headers: { ...baseHeaders, "cache-control": "no-store" } });
          body = Buffer.concat(chunks.map((c) => Buffer.from(c)));
        } else {
          const whole = await store().get(key, { type: "arrayBuffer" });
          if (!whole) return json({ error: "File not found." }, 404);
          const wholeBytes = new Uint8Array(whole);
          body = Buffer.from(wholeBytes.subarray(start, end + 1));
        }
        return new Response(body, {
          status: 206,
          headers: { ...baseHeaders, "accept-ranges": "bytes", "content-range": `bytes ${start}-${start + body.length - 1}/${totalSize}`, "content-length": String(body.length) }
        });
      }
      let obj = null;
      if (chunked) {
        const total = meta.parts;
        let i = 0;
        obj = new ReadableStream({
          async pull(c) {
            if (i >= total) {
              c.close();
              return;
            }
            const part = await store().get(`${key}.part.${i++}`, { type: "arrayBuffer" });
            c.enqueue(new Uint8Array(part || new ArrayBuffer(0)));
          }
        });
      } else {
        obj = await store().get(key, { type: "arrayBuffer" });
      }
      if (!obj) return json({ error: "File not found." }, 404);
      const length = totalSize || (obj instanceof ArrayBuffer ? obj.byteLength : 0);
      return new Response(obj, {
        status: 200,
        headers: { ...baseHeaders, ...canRange || length ? { "accept-ranges": "bytes", "content-length": String(length) } : {} }
      });
    }
    if (m === "PUT" && p === "/api/admin/upload/direct") {
      const ticket = cleanString(url.searchParams.get("ticket") || "", 120);
      if (!ticket) return json({ error: "Upload ticket missing." }, 401);
      const meta = await store().get(`upload-ticket/${ticket}`, { type: "json" });
      if (!meta || Number(meta.expiresAt || 0) < Date.now()) {
        if (meta) await store().delete(`upload-ticket/${ticket}`).catch(() => {});
        return json({ error: "Upload ticket expired." }, 401);
      }
      const bytes = await readRawBody(request);
      const directLimit = 700 * 1024;
      if (Number(meta.size) > directLimit) return json({ error: "Direct upload tickets are limited to small files; use the chunked upload flow for larger files." }, 413);
      if (bytes.length > directLimit) return json({ error: "Direct upload is limited to 700 KB." }, 413);
      if (Number(meta.size) !== bytes.length) return json({ error: "Uploaded file size does not match the declared size." }, 400);
      await store().set(meta.path, bytes);
      await store().setJSON(`${meta.path}.meta`, {
        fileName: meta.fileName, contentType: meta.contentType, size: bytes.length, parts: 0, created: Date.now()
      });
      await store().delete(`upload-ticket/${ticket}`).catch(() => {});
      return json({ ok: true, path: meta.path, fileName: meta.fileName, size: bytes.length });
    }
    if (p.startsWith("/api/admin/")) {
      const d = await load();
      const authz = await adminAuth(request, d, requiredAdminPermission(request));
      if (authz.error === "session" || authz.error === "identity") return json(sessionExpiredError(), 401);
      if (authz.error === "permission") return json(unauthorizedError(), 403);
      const a = authz.value;

      // -----------------------------------------------------------------
      // EduSpace admin compatibility: catalog, materials and student
      // security operations are backed by the same Student central store.
      // -----------------------------------------------------------------
      if (m === "GET" && /^\/api\/admin\/students\/[^/]+\/security-questions$/.test(p)) {
        const id = decodeURIComponent(p.split("/")[4]);
        const u = d.users.find(v => v.id === id);
        if (!u) return json({ error: "Student not found." }, 404);
        const labels = {
          first_school: "What was the name of your first school?",
          birth_city: "What city or town were you born in?",
          favourite_subject: "What is your favourite school subject?",
          childhood_nickname: "What nickname did you use as a child?",
          first_teacher: "What was the name of your first teacher?",
          special_word: "What special word or phrase would you remember for verification?"
        };
        const questions = Array.isArray(u.securityQuestions) ? u.securityQuestions.slice(0, 2).map(q => ({
          key: q.key,
          question: labels[q.key] || q.question || "Verification question"
        })).filter(q => q.key) : [];
        return json({ configured: questions.length === 2, questions });
      }
      if (m === "POST" && /^\/api\/admin\/students\/[^/]+\/security-questions$/.test(p)) {
        const id = decodeURIComponent(p.split("/")[4]);
        const u = d.users.find(v => v.id === id);
        if (!u) return json({ error: "Student not found." }, 404);
        const x = await readJSON(request);
        const supplied = Array.isArray(x.securityQuestions) ? x.securityQuestions : [];
        const keys = Array.isArray(x.keys) && x.keys.length ? x.keys.map(v => cleanString(v, 80)) : supplied.map(v => cleanString(v?.key, 80));
        const answers = Array.isArray(x.answers) && x.answers.length ? x.answers.map(v => cleanString(v, 300).trim().toLowerCase()) : supplied.map(v => cleanString(v?.answer, 300).trim().toLowerCase());
        const allowedKeys = new Set(["first_school","birth_city","favourite_subject","childhood_nickname","first_teacher","special_word"]);
        if (keys.length !== 2 || answers.length !== 2 || !keys[0] || !keys[1] || keys[0] === keys[1] ||
            !answers[0] || !answers[1] || keys.some(k => !allowedKeys.has(k))) {
          return json({ error: "Two different security questions and answers are required." }, 400);
        }
        const a0 = passwordHash(answers[0]), a1 = passwordHash(answers[1]);
        u.securityQuestions = [
          { key: keys[0], answerHash: a0.hash, answerSalt: a0.salt },
          { key: keys[1], answerHash: a1.hash, answerSalt: a1.salt }
        ];
        await save(d);
        return json({ ok: true, configured: true });
      }
      if (m === "POST" && /^\/api\/admin\/students\/[^/]+\/reset-password$/.test(p)) {
        const id = decodeURIComponent(p.split("/")[4]);
        const u = d.users.find(v => v.id === id);
        if (!u) return json({ error: "Student not found." }, 404);
        const x = await readJSON(request);
        const answers = Array.isArray(x.answers) ? x.answers.map(v => cleanString(v, 300).trim().toLowerCase()) : [];
        const password = String(x.password || "");
        if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
        if (!Array.isArray(u.securityQuestions) || u.securityQuestions.length !== 2) {
          return json({ error: "Security questions are not configured for this student." }, 400);
        }
        const verified = u.securityQuestions.every((q, i) =>
          hashMatches(answers[i] || "", q.answerSalt, q.answerHash)
        );
        if (!verified) return json({ error: "Security answers do not match the student's verification records." }, 401);
        if (u.authUserId) {
          try { await supabaseUpdateUser(u.authUserId, { password }); }
          catch { return json({ error: "The password could not be updated in the authentication service." }, 400); }
        }
        const ph = passwordHash(password);
        u.passwordHash = ph.hash;
        u.passwordSalt = ph.salt;
        revokeStudentTokens(u);
        await save(d);
        return json({ ok: true, message: "Password reset successfully." });
      }

      if (m === "POST" && p === "/api/admin/students/registrations") {
        const x = await readJSON(request);
        const studentId = cleanString(x.studentId, 120);
        const u = d.users.find(v => String(v.id) === studentId);
        if (!u) return json({ error: "Student not found." }, 404);
        const subjectIds = Array.isArray(x.subjectIds) ? [...new Set(x.subjectIds.map(v => cleanString(v, 80)).filter(Boolean))] : [];
        const activeSubjects = new Map((d.subjects || []).filter(s => s.active !== false).map(s => [String(s.id), s.name]));
        const names = subjectIds.map(id => activeSubjects.get(id)).filter(Boolean);
        if (names.length !== subjectIds.length) return json({ error: "One or more selected subjects are unavailable." }, 400);
        const validated = validateSelectedSubjects(names);
        if (validated.error) return json({ error: validated.error }, 400);
        u.selectedSubjects = validated.subjects;
        await save(d);
        return json({ ok: true, student: publicUser(u), subjectIds: validated.subjects.map(name => (d.subjects.find(s => s.name === name) || {}).id).filter(Boolean) });
      }

      if (m === "POST" && p === "/api/admin/reset-platform") {
        const x = await readJSON(request);
        if (x.confirm !== "RESET PLATFORM") return json({ error: "Enter RESET PLATFORM to confirm this destructive action." }, 400);

        const uploadedKeys = new Set();
        const collectUploadKeys = value => {
          if (typeof value === "string") {
            if (value.startsWith("uploads/")) uploadedKeys.add(value);
            if (value.includes("/api/files/")) {
              try { const key = decodeURIComponent(value.split("/api/files/").pop() || ""); if (key.startsWith("uploads/")) uploadedKeys.add(key); } catch {}
            }
            return;
          }
          if (Array.isArray(value)) { for (const item of value) collectUploadKeys(item); return; }
          if (value && typeof value === "object") for (const child of Object.values(value)) collectUploadKeys(child);
        };
        collectUploadKeys(d);
        await Promise.allSettled([...(d.users || []).map(u => u.authUserId).filter(Boolean).map(id => supabaseDeleteUser(id))]);
        await Promise.allSettled([...uploadedKeys].map(async key => {
          await deleteFile(key).catch(() => {});
          await store().delete(`${key}.meta`).catch(() => {});
        }));

        const fresh = normalise(clone(seed));
        fresh.settings.contentPackVersion = CONTENT_PACK.version;
        fresh.settings.topicMigrationVersion = 1;
        fresh.settings.explanationMigrationVersion = 1;
        fresh._revision = Number(d._revision || 0) + 1;
        fresh._saveId = crypto.randomUUID();
        fresh.savedAt = new Date().toISOString();
        await store().setJSON("data", fresh);
        DATA_CACHE = clone(fresh);
        DATA_CACHE_AT = Date.now();
        return json({ ok: true, message: "Platform reset completed. Core subjects were restored.", deletedStudents: (d.users || []).length, deletedFiles: uploadedKeys.size, revision: fresh._revision });
      }

      if (m === "GET" && p === "/api/admin/subjects") {
        return json((d.subjects || []).slice().sort((x, y) =>
          Number(x.position || 0) - Number(y.position || 0) || String(x.name).localeCompare(String(y.name))
        ));
      }
      if (m === "POST" && p === "/api/admin/subjects") {
        const x = await readJSON(request);
        const name = cleanString(x.name, 80).replace(/\s+/g, " ").trim();
        const icon = cleanString(x.icon, 8) || "📘";
        const position = Number.isFinite(Number(x.position)) ? Number(x.position) : d.subjects.length;
        if (!name) return json({ error: "Subject name is required." }, 400);
        if (d.subjects.some(s => String(s.name).toLowerCase() === name.toLowerCase())) {
          return json({ error: "That subject already exists." }, 409);
        }
        const subject = {
          id: crypto.randomUUID(), name, icon, position, active: x.active !== false,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        d.subjects.push(subject);
        SUBJECTS = d.subjects.filter(s => s.active !== false).map(s => s.name);
        if (!SUBJECTS.includes(REQUIRED_REGISTRATION_SUBJECT)) SUBJECTS.push(REQUIRED_REGISTRATION_SUBJECT);
        await save(d);
        return json(subject, 201);
      }
      if (m === "PATCH" && /^\/api\/admin\/subjects\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop());
        const x = await readJSON(request);
        const subject = d.subjects.find(s => s.id === id);
        if (!subject) return json({ error: "Subject not found." }, 404);
        const oldName = subject.name;
        if (x.name !== undefined) {
          const name = cleanString(x.name, 80).replace(/\s+/g, " ").trim();
          if (!name) return json({ error: "Subject name is required." }, 400);
          if (String(subject.name).toLowerCase() === "use of english" && name.toLowerCase() !== "use of english") {
            return json({ error: "Use of English is a required core subject and cannot be renamed." }, 400);
          }
          if (d.subjects.some(s => s.id !== id && String(s.name).toLowerCase() === name.toLowerCase())) {
            return json({ error: "That subject already exists." }, 409);
          }
          subject.name = name;
        }
        if (x.icon !== undefined) subject.icon = cleanString(x.icon, 8) || "📘";
        if (x.position !== undefined && Number.isFinite(Number(x.position))) subject.position = Number(x.position);
        if (x.active !== undefined) {
          if (String(subject.name).toLowerCase() === "use of english" && x.active === false) return json({ error: "Use of English is compulsory and cannot be archived." }, 400);
          subject.active = !!x.active;
        }
        subject.updatedAt = new Date().toISOString();
        if (oldName !== subject.name) {
          for (const u of d.users) if (Array.isArray(u.selectedSubjects)) u.selectedSubjects = u.selectedSubjects.map(s => s === oldName ? subject.name : s);
          for (const n of d.notes) if (n.subject === oldName) n.subject = subject.name;
          for (const c of d.collections) if (c.subject === oldName || String(c.subjectId) === String(subject.id)) c.subject = subject.name;
          for (const q of d.questionBank) if (q.subject === oldName) q.subject = subject.name;
          for (const t of d.tests) {
            if (t.subject === oldName) t.subject = subject.name;
            if (Array.isArray(t.questions)) for (const q of t.questions) if (q?.subject === oldName) q.subject = subject.name;
            if (Array.isArray(t.questionPool)) for (const q of t.questionPool) if (q?.subject === oldName) q.subject = subject.name;
            if (Array.isArray(t.sections)) for (const sec of t.sections) {
              if (sec?.subject === oldName) sec.subject = subject.name;
              if (Array.isArray(sec?.questions)) for (const q of sec.questions) if (q?.subject === oldName) q.subject = subject.name;
            }
          }
          for (const r of d.results) if (r.subject === oldName) r.subject = subject.name;
          for (const topic of d.topics) if (topic.subject === oldName) topic.subject = subject.name;
          for (const set of d.questionSets) {
            if (set.subject === oldName) set.subject = subject.name;
            if (Array.isArray(set.sections)) for (const sec of set.sections) if (sec.subject === oldName) sec.subject = subject.name;
          }
          for (const h of d.practiceHistory) if (h.subject === oldName) h.subject = subject.name;
          for (const report of d.questionReports) if (report.subject === oldName) report.subject = subject.name;
          for (const duel of d.duels) {
            if (duel.subject === oldName) duel.subject = subject.name;
            if (Array.isArray(duel.questions)) for (const q of duel.questions) if (q?.subject === oldName) q.subject = subject.name;
          }
        }
        SUBJECTS = d.subjects.filter(s => s.active !== false).map(s => s.name);
        if (!SUBJECTS.includes(REQUIRED_REGISTRATION_SUBJECT)) SUBJECTS.push(REQUIRED_REGISTRATION_SUBJECT);
        await save(d);
        return json(subject);
      }

      if (m === "GET" && p === "/api/admin/collections") {
        const subjectId = cleanString(url.searchParams.get("subject") || "", 80);
        return json((d.collections || []).filter(c => !subjectId || String(c.subjectId) === String(subjectId))
          .sort((a,b) => Number(a.position||0) - Number(b.position||0)));
      }
      if (m === "GET" && /^\/api\/admin\/collections\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop());
        const c = d.collections.find(v => v.id === id);
        if (!c) return json({ error: "Collection not found." }, 404);
        const items = (Array.isArray(c.items) ? c.items : []).map((it, i) => {
          const material = it.materialId ? d.notes.find(n => n.id === it.materialId) : null;
          const quiz = it.quizId ? (d.tests.find(t => t.id === it.quizId) || d.questionSets.find(q => q.id === it.quizId)) : null;
          const title = cleanString(it.title || it.titleOverride || material?.title || quiz?.title || "Untitled item", 200);
          return { ...it, id: it.id || crypto.randomUUID(), position: Number.isFinite(Number(it.position)) ? Number(it.position) : i, title, titleOverride: cleanString(it.titleOverride || "", 200) };
        });
        return json({ collection: { ...c, items } });
      }
      if (m === "POST" && p === "/api/admin/collections") {
        const x = await readJSON(request);
        const subjectId = cleanString(x.subjectId, 80);
        const subject = d.subjects.find(s => s.id === subjectId && s.active !== false);
        const name = cleanString(x.name, 160).replace(/\s+/g, " ").trim();
        if (!subject || !name) return json({ error: "Subject and collection name are required." }, 400);
        const c = {
          id: crypto.randomUUID(), subjectId: subject.id, subject: subject.name, name,
          description: cleanString(x.description, 800),
          sort_mode: ["manual", "alphabetical", "newest"].includes(String(x.sortMode)) ? String(x.sortMode) : "manual",
          published: x.published !== false,
          position: d.collections.filter(v => v.subjectId === subject.id).length,
          items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        };
        d.collections.push(c);
        await save(d);
        return json(c, 201);
      }
      if (m === "PATCH" && /^\/api\/admin\/collections\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop());
        const c = d.collections.find(v => v.id === id);
        if (!c) return json({ error: "Collection not found." }, 404);
        const x = await readJSON(request);
        if (x.name !== undefined) c.name = cleanString(x.name, 160).replace(/\s+/g, " ").trim() || c.name;
        if (x.description !== undefined) c.description = cleanString(x.description, 800);
        if (x.sortMode !== undefined) c.sort_mode = ["manual", "alphabetical", "newest"].includes(String(x.sortMode)) ? String(x.sortMode) : c.sort_mode || "manual";
        if (x.published !== undefined) c.published = !!x.published;
        if (Array.isArray(x.items)) c.items = x.items.map((it, i) => ({
          id: it.id || crypto.randomUUID(), type: it.type === "cbt" ? "cbt" : "material",
          materialId: it.materialId || null, quizId: it.quizId || null,
          title: cleanString(it.title || it.titleOverride || "", 200),
          titleOverride: cleanString(it.titleOverride || it.title || "", 200),
          position: Number.isFinite(Number(it.position)) ? Number(it.position) : i
        }));
        c.updatedAt = new Date().toISOString();
        await save(d);
        return json(c);
      }
      if (m === "DELETE" && /^\/api\/admin\/collections\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop()), i = d.collections.findIndex(v => v.id === id);
        if (i < 0) return json({ error: "Collection not found." }, 404);
        d.collections.splice(i, 1);
        await save(d);
        return json({ ok: true, id });
      }

      if (m === "GET" && p === "/api/admin/materials") {
        const subjectId = cleanString(url.searchParams.get("subject") || "", 80);
        const subject = subjectId ? d.subjects.find(s => s.id === subjectId) : null;
        const rows = subjectId && subject ? d.notes.filter(n => n.subject === subject.name) : d.notes;
        return json(rows);
      }
      if (m === "POST" && p === "/api/admin/materials") {
        const x = await readJSON(request);
        const subject = d.subjects.find(s => s.id === cleanString(x.subjectId,80));
        const title = cleanString(x.title, 200);
        if (!subject || !title) return json({ error:"Subject and material title are required." }, 400);
        const attachments = normaliseAttachments((Array.isArray(x.files) ? x.files : []).map(f => ({
          key: f.filePath || f.fileKey || f.key, fileName:f.fileName, contentType:f.contentType, size:f.sizeBytes || f.size
        })).filter(f => f.key));
        const n = {
          id: crypto.randomUUID(), title, subject: subject.name, topic: cleanString(x.topic,200),
          body: richBody(x.body,4e4), format:"html", attachments,
          fileUrl: attachments[0]?.url || "", fileKey: attachments[0]?.key || "", fileName: attachments[0]?.fileName || "",
          published: !!x.published, access:x.access === "activated" ? "activated" : "all",
          date:new Date().toISOString(), createdAt:new Date().toISOString()
        };
        d.notes.unshift(n);
        const notices = n.published ? buildPublishNotifications(d, {type:"new-learning-material",title:"New Learning Material",message:"New learning material has been uploaded. Tap to view it.",url:`/materials.html?id=${encodeURIComponent(n.id)}`,eventKey:`publish:material:${n.id}`}) : [];
        if (notices.length) d.notifications.unshift(...notices);
        await save(d);
        if (notices.length) { try { const removed = await sendWebPushes(d, notices); if (removed) await save(d); } catch {} }
        return json(n,201);
      }
      if (m === "PATCH" && /^\/api\/admin\/materials\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop()), n = d.notes.find(v => v.id === id);
        if (!n) return json({ error:"Material not found." },404);
        const x = await readJSON(request);
        if (x.title !== undefined) n.title=cleanString(x.title,200)||n.title;
        if (x.topic !== undefined) n.topic=cleanString(x.topic,200);
        if (x.body !== undefined) { n.body=richBody(x.body,4e4); n.format="html"; }
        if (x.published !== undefined) n.published=!!x.published;
        if (x.access !== undefined) n.access=x.access==="activated"?"activated":"all";
        if (x.subjectId) { const s=d.subjects.find(v=>v.id===x.subjectId); if(s)n.subject=s.name; }
        n.updatedAt=new Date().toISOString();
        await save(d);
        return json(n);
      }

      if (m === "POST" && p === "/api/admin/upload/sign") {
        const x=await readJSON(request);
        const fileName=(cleanString(x.fileName,180)||"file").replace(/[^a-zA-Z0-9._() \-]/g,"_");
        const size=Number(x.size)||0;
        if(size<0||size>700*1024) return json({error:"Direct upload signing is limited to 700 KB; use the chunked upload flow for larger files."},413);
        const path=`uploads/${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${fileName}`;
        const ticket=crypto.randomBytes(24).toString("base64url");
        await store().setJSON(`upload-ticket/${ticket}`, {path,fileName,contentType:cleanString(x.contentType,160)||guessContentType(fileName)||"application/octet-stream",size,expiresAt:Date.now()+5*60*1000});
        return json({signedUrl:`/api/admin/upload/direct?ticket=${encodeURIComponent(ticket)}`,path});
      }

      
      if (m === "GET" && p === "/api/admin/notifications") {
        const unreadOnly = url.searchParams.get("unread") === "1";
        const mine = d.notifications.filter((n) => n.userId === "admin" && (!unreadOnly || !n.read)).sort((x, y) => String(y.createdAt || "").localeCompare(String(x.createdAt || ""))).slice(0, 100);
        return json({ items: mine, unread: mine.filter((n) => !n.read).length });
      }
      if (m === "POST" && p === "/api/admin/notifications/read") {
        const x = await readJSON(request);
        const ids = Array.isArray(x.ids) ? new Set(x.ids.map(String)) : null;
        for (const n of d.notifications) if (n.userId === "admin" && (!ids || ids.has(String(n.id)))) n.read = true;
        await save(d);
        return json({ ok: true });
      }
      if (m === "GET" && p === "/api/admin/topics") {
        const subject=cleanString(url.searchParams.get("subject")||"",80);
        const wanted=String(subject||"").trim().replace(/\s+/g," ").toLowerCase();
        return json(d.topics.filter(t=>!subject||!t.subject||String(t.subject).trim().replace(/\s+/g," ").toLowerCase()===wanted).map(t=>publicTopic(t,d)));
      }
      if (m === "POST" && p === "/api/admin/topics") {
        const x=await readJSON(request), subject=cleanString(x.subject,80), name=cleanString(x.name,200).replace(/\s+/g," ").trim();
        if(!SUBJECTS.includes(subject))return json({error:"Choose a valid subject."},400);
        if(!name)return json({error:"Topic name is required."},400);
        if(d.topics.some(t=>topicKey(t.subject,t.name)===topicKey(subject,name)))return json({error:"That topic already exists in this subject."},409);
        const t={id:crypto.randomUUID(),subject,name,slug:name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
        d.topics.push(t); await save(d); return json(publicTopic(t,d),201);
      }
      if (m === "PATCH" && /^\/api\/admin\/topics\/[^/]+$/.test(p)) {
        const id=decodeURIComponent(p.split("/").pop()), x=await readJSON(request), t=d.topics.find(v=>v.id===id);
        if(!t)return json({error:"Topic not found."},404);
        const name=cleanString(x.name,200).replace(/\s+/g," ").trim();
        if(!name)return json({error:"Topic name is required."},400);
        if(d.topics.some(v=>v.id!==id&&topicKey(v.subject,v.name)===topicKey(t.subject,name)))return json({error:"That topic already exists in this subject."},409);
        const oldName=t.name; t.name=name; t.slug=name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""); t.updatedAt=new Date().toISOString();
        d.questionBank.filter(q=>q.topicId===id).forEach(q=>q.topic=name);
        await save(d); return json(publicTopic(t,d));
      }
      if (m === "DELETE" && /^\/api\/admin\/topics\/[^/]+$/.test(p)) {
        const id=decodeURIComponent(p.split("/").pop()), t=d.topics.find(v=>v.id===id); if(!t)return json({error:"Topic not found."},404);
        let fallback=d.topics.find(v=>v.subject===t.subject&&/uncategorized/i.test(v.name));
        if(!fallback){fallback={id:crypto.randomUUID(),subject:t.subject,name:"Uncategorized / Topic Not Assigned",slug:"uncategorized-topic-not-assigned",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};d.topics.push(fallback);}
        d.questionBank.filter(q=>q.topicId===id).forEach(q=>{q.topicId=fallback.id;q.topic=fallback.name;});
        d.topics=d.topics.filter(v=>v.id!==id); await save(d); return json({ok:true, reassignedTo:fallback.id});
      }
      if (m === "POST" && /^\/api\/admin\/question-bank\/[^/]+\/topic$/.test(p)) {
        const id=decodeURIComponent(p.split("/")[4]), x=await readJSON(request), q=d.questionBank.find(v=>v.id===id);
        if(!q)return json({error:"Question not found."},404);
        const t=topicFor(d,x.topicId,q.subject); if(!t)return json({error:"Choose a topic belonging to this question's subject."},400);
        q.topicId=t.id;q.topic=t.name;await save(d);return json(q);
      }
      if (m === "GET" && p === "/api/admin/question-reports") {
        const status=cleanString(url.searchParams.get("status")||"",40), subject=cleanString(url.searchParams.get("subject")||"",80), term=cleanString(url.searchParams.get("q")||"",120).toLowerCase();
        let rows=d.questionReports.map(r=>reportPublic(r,d));
        if(status)rows=rows.filter(r=>r.status===status); if(subject)rows=rows.filter(r=>r.subject===subject);
        if(term)rows=rows.filter(r=>[r.questionText,r.studentName,r.studentUsername,r.reason,r.details,r.topic].some(v=>String(v||"").toLowerCase().includes(term)));
        return json(rows);
      }
      if (m === "PATCH" && /^\/api\/admin\/question-reports\/[^/]+$/.test(p)) {
        const id=decodeURIComponent(p.split("/").pop()), x=await readJSON(request), r=d.questionReports.find(v=>v.id===id);
        if(!r)return json({error:"Report not found."},404);
        if(!["Pending","Reviewed","Resolved","Dismissed"].includes(x.status))return json({error:"Invalid report status."},400);
        r.status=x.status;r.reviewedAt=new Date().toISOString();r.reviewedBy="admin";await save(d);return json(reportPublic(r,d));
      }

      if (m === "POST" && p === "/api/admin/activate-product") {
        const x = await readJSON(request), productKey = cleanString(x.productKey, 120).toUpperCase();
        if (!productKey) return json({ error: "Enter a product key." }, 400);
        const u = d.users.find(v => String(v.productKey || "").toUpperCase() === productKey);
        if (!u) return json({ error: "No student account was found for that product key." }, 404);
        if (u.activated) return json({ error: "This account is already activated." }, 409);
        u.activated = true;
        u.activatedAt = new Date().toISOString();
        const activationNotification = {
          id: crypto.randomUUID(), userId: u.id, type: "account-activation",
          title: "Account activated ✓",
          message: "Your Gifted Brainz EduSpace account has been activated. You can now access resources reserved for activated students.",
          url: "/account.html", createdAt: new Date().toISOString(), read: false
        };
        d.notifications.unshift(activationNotification);
        await save(d);
        try {
          const removed = await sendWebPushes(d, [activationNotification]);
          if (removed) await save(d);
        } catch {}
        return json({ ok:true, activated:true, studentName:u.name, username:u.username, deviceId:u.deviceId||"", productKey:u.productKey||productKey, activatedAt:u.activatedAt, user:publicUser(u), message:"Account activated successfully." });
      }
      if (m === "POST" && p === "/api/admin/deactivate-product") {
        const x = await readJSON(request), productKey = cleanString(x.productKey, 120).toUpperCase();
        if (!productKey) return json({ error: "Enter a product key." }, 400);
        const u = d.users.find(v => String(v.productKey || "").toUpperCase() === productKey);
        if (!u) return json({ error: "No student account was found for that product key." }, 404);
        if (!u.activated) return json({ error: "This account is already inactive." }, 409);
        u.activated = false;
        u.deactivatedAt = new Date().toISOString();
        const notice = { id: crypto.randomUUID(), userId: u.id, type: "account-deactivated", title: "Account deactivated", message: "Your Gifted Brainz EduSpace account has been deactivated. Contact the coordinator if you need assistance.", url: "/account.html", createdAt: new Date().toISOString(), read: false };
        d.notifications.unshift(notice);
        revokeStudentTokens(u);
        await save(d);
        try { const removed = await sendWebPushes(d, [notice]); if (removed) await save(d); } catch {}
        return json({ ok:true, activated:false, studentName:u.name, username:u.username, deviceId:u.deviceId||"", productKey:u.productKey||productKey, deactivatedAt:u.deactivatedAt, user:publicUser(u), message:"Account deactivated successfully." });
      }
      if (m === "POST" && p === "/api/admin/ai/check-questions") {
        if (!rateLimit(request,"admin-ai-check",20,9e5)) return json({error:"Too many AI quality-check requests. Try again later."},429);
        const x=await readJSON(request), subject=cleanString(x.subject,80), questions=Array.isArray(x.questions)?x.questions.slice(0,50):[];
        if(!SUBJECTS.includes(subject)||!questions.length)return json({error:"A valid subject and at least one question are required."},400);
        const prompt=`Audit these ${questions.length} draft multiple-choice questions for ${subject} as a strict senior examination editor. Silently reason through every question and, for numerical or scientific items, recompute the answer independently before judging it. Return ONLY a JSON array with one object per question: {index,valid,issues:[string],correctAnswerConfidence:"high|medium|low",calculationCheck:"pass|fail|not-applicable",ambiguityCheck:"pass|fail",duplicateRisk:"low|medium|high",suggestion:string}. Verify that exactly one option is defensibly correct, the keyed answer matches the verified solution, distractors are plausible but wrong, explanations actually justify the answer, the wording is unambiguous, the topic and difficulty fit, grammar is sound, and the supplied set has no duplicates or near-duplicates. Do not rewrite the questions.`;
        const payload=JSON.stringify(questions.map((q,i)=>({index:i,q:q.q,options:q.options,answer:q.answer,explanation:q.explanation,topic:q.topic,difficulty:q.difficulty})));
        const text=await callConfiguredAI([{role:"system",content:"You are Gifted Brainz AI Quality Checker, a meticulous senior examination editor. Think silently, verify computations independently, and never approve a question merely because it sounds plausible. Return only the requested JSON."},{role:"user",content:prompt+"\nDRAFTS:\n"+payload}],{temperature:0.03,maxTokens:10000});
        let checks=extractJSON(text); if(!Array.isArray(checks))checks=checks?.checks; if(!Array.isArray(checks))throw new Error("AI returned an invalid quality-check report.");
        return json({checks:checks.slice(0,questions.length),checked:Math.min(checks.length,questions.length)});
      }
      if (m === "POST" && p === "/api/admin/ai/generate-questions") {
        if (!rateLimit(request, "admin-ai", 20, 9e5)) return json({ error: "Too many AI generation requests. Try again later." }, 429);
        const x = await readJSON(request), subject = cleanString(x.subject,80), topic = cleanString(x.topic,200), count=Math.min(50,Math.max(1,Number(x.count)||10));
        const difficulty=cleanString(x.difficulty,40)||"mixed", exam=cleanString(x.exam,80)||"UTME/JAMB", objective=cleanString(x.objective,500);
        if(!SUBJECTS.includes(subject)) return json({error:"Choose a valid subject."},400);
        const prompt=`Generate ${count} high-quality four-option multiple-choice questions for ${exam}. Subject: ${subject}. Topic: ${topic||"broad syllabus coverage"}. Difficulty: ${difficulty}. Learning objective: ${objective||"assess genuine understanding"}. Silently reason through the content before writing. For every numerical/scientific item, independently solve and verify the result. Build plausible distractors from common misconceptions rather than random wrong answers. Match Nigerian secondary-school terminology and exam conventions where applicable. Avoid trick questions, unsupported facts, duplicates, ambiguous stems, overlapping options, and clues to the answer. Return ONLY a JSON array. Each item must have q (string), options (exactly 4 strings), answer (0-3), explanation (string), topic (string), difficulty (easy|moderate|hard|very-hard), learningObjective (string). Ensure exactly one unambiguously correct answer and that the explanation agrees with the keyed answer. Do not include markdown.`;
        const text=await callConfiguredAI([{role:"system",content:"You are Gifted Brainz AI, a meticulous Nigerian examination question writer. Think silently before producing the JSON, verify every answer and explanation, and prioritize factual correctness, unambiguous wording and curriculum fit over speed."},{role:"user",content:prompt}],{temperature:0.10,maxTokens:12000});
        let rows=extractJSON(text); if(!Array.isArray(rows)) rows=rows.questions;
        if(!Array.isArray(rows)) throw new Error("AI returned an invalid question list.");
        const questions=[]; const seenKeys=new Set(); let duplicatesDropped=0;
        for(const row of rows.slice(0,count)){
          const q=normaliseQuestion({q:row.q,options:row.options,answer:Number(row.answer),explanation:row.explanation,subject,topic:row.topic||topic,type:"mcq"});
          const err=validateQuestionForSubject(q,subject); if(err) continue;
          const key=questionKey(q);
          if(key && seenKeys.has(key)){ duplicatesDropped++; continue; }
          if(key) seenKeys.add(key);
          questions.push(q);
        }
        return json({questions,generated:questions.length,duplicatesDropped,needsReview:questions.length!==count,warning:"AI-generated questions must be reviewed by the administrator before publishing."});
      }
      if (m === "GET" && p === "/api/admin/overview") {
        const avg = d.results.length ? Math.round(d.results.reduce((s, r) => s + r.score, 0) / d.results.length) : 0;
        return json({
          students: d.users.length,
          activeStudents: d.users.filter(u => u.status === "active").length,
          activatedStudents: d.users.filter(u => u.activated === true).length,
          inactiveStudents: d.users.filter(u => u.status !== "active").length,
          deactivatedStudents: d.users.filter(u => u.status !== "active").length,
          questionBank: d.questionBank.length,
          tests: d.tests.length,
          publishedTests: d.tests.filter((x) => x.published).length,
          notes: d.notes.length,
          announcements: d.announcements.length,
          results: d.results.length,
          averageScore: avg,
          pendingApprovals: 0,
          feedback: d.feedback.length,
          storage: storageReport(),
          rating: (() => {
            const r = d.feedback.filter((f) => Number(f.rating) > 0);
            return r.length ? Math.round(r.reduce((s, f) => s + Number(f.rating), 0) / r.length * 10) / 10 : 0;
          })()
        });
      }
      if (m === "GET" && p === "/api/admin/feedback") {
        const rated = d.feedback.filter((f) => Number(f.rating) > 0);
        const average = rated.length ? Math.round(rated.reduce((s, f) => s + Number(f.rating), 0) / rated.length * 10) / 10 : 0;
        return json({
          items: d.feedback,
          summary: {
            average,
            total: rated.length,
            complaints: d.feedback.filter((f) => f.kind === "complaint").length,
            unresolved: d.feedback.filter((f) => !f.resolved).length,
            breakdown: [5, 4, 3, 2, 1].map((star) => ({ star, count: rated.filter((f) => Number(f.rating) === star).length }))
          }
        });
      }
      if (m === "PATCH" && /^\/api\/admin\/feedback\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop());
        const f = d.feedback.find((v) => v.id === id);
        if (!f) return json({ error: "Feedback not found." }, 404);
        const x = await readJSON(request);
        let replyNotification = null;
        if (x.resolved !== void 0) f.resolved = !!x.resolved;
        if (x.reply !== void 0) {
          const reply = cleanString(x.reply, 2e3);
          f.reply = reply;
          if (reply) {
            replyNotification = {
              id: crypto.randomUUID(),
              userId: f.userId,
              type: "feedback-reply",
              title: "The admin replied to your feedback",
              message: reply.slice(0, 180),
              url: "/feedback.html",
              createdAt: (/* @__PURE__ */ new Date()).toISOString(),
              read: false
            };
            d.notifications.unshift(replyNotification);
          }
        }
        await save(d);
        if (replyNotification) {
          const removed = await sendWebPushes(d, [replyNotification]);
          if (removed) await save(d);
        }
        return json(f);
      }
      if (m === "DELETE" && /^\/api\/admin\/feedback\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop());
        const i = d.feedback.findIndex((v) => v.id === id);
        if (i < 0) return json({ error: "Feedback not found." }, 404);
        d.feedback.splice(i, 1);
        await save(d);
        return json({ ok: true, id });
      }
      if (m === "GET" && p === "/api/admin/students") {
        const agg = /* @__PURE__ */ new Map();
        for (const r of d.results) {
          const a0 = agg.get(r.userId) || { sum: 0, n: 0, last: "" };
          a0.sum += Number(r.score) || 0;
          a0.n++;
          if (String(r.date || "") > String(a0.last || "")) a0.last = r.date;
          agg.set(r.userId, a0);
        }
        return json(d.users.map((u) => {
          const a0 = agg.get(u.id) || { sum: 0, n: 0, last: "" };
          const pu = publicUser(u);
          const subjectIds = (pu.selectedSubjects || [])
            .map(name => d.subjects.find(s => s.name === name)?.id)
            .filter(Boolean);
          return { ...pu, subjectIds, tests: a0.n, average: a0.n ? Math.round(a0.sum / a0.n) : 0, last: a0.last };
        }));
      }
      if (m === "GET" && /^\/api\/admin\/students\/[^/]+\/progress$/.test(p)) {
        const u = d.users.find((u2) => u2.id === p.split("/")[4]);
        if (!u) return json({ error: "Student not found." }, 404);
        const allowedSubjects = studentSubjects(u);
        const results = d.results.filter((r) => { const t = d.tests.find(t2 => t2.id === r.testId); const visible = resultVisibilityFor(d, r); return r.userId === u.id && allowedSubjects.includes(r.subject) && visible; });
        const bySubject = allowedSubjects.map((s) => {
          const rr = results.filter((r) => r.subject === s);
          return {
            subject: s,
            tests: rr.length,
            average: rr.length ? Math.round(rr.reduce((x, r) => x + r.score, 0) / rr.length) : 0,
            best: rr.length ? Math.max(...rr.map((r) => r.score)) : 0
          };
        });
        return json({
          student: publicUser(u),
          joined: u.joined || "",
          tests: results.length,
          average: results.length ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length) : 0,
          best: results.length ? Math.max(...results.map((r) => r.score)) : 0,
          bySubject,
          results: results.map((r) => ({ id: r.id, testTitle: r.testTitle, subject: r.subject, score: r.score, correct: r.correct, wrong: r.wrong, unanswered: r.unanswered, date: r.date }))
        });
      }
      if (m === "PATCH" && /^\/api\/admin\/students\/[^/]+$/.test(p)) {
        const x = await readJSON(request), u = d.users.find((u2) => u2.id === p.split("/").pop());
        if (!u) return json({ error: "Student not found." }, 404);
        // Any of these changes must take effect immediately rather than when
        // the student's current token happens to expire.
        if (x.status !== void 0) {
          const nextStatus = x.status === "suspended" ? "suspended" : "active";
          if (nextStatus !== u.status) {
            revokeStudentTokens(u);
            const notice = {
              id: crypto.randomUUID(), userId: u.id, type: nextStatus === "active" ? "account-reactivated" : "account-deactivated",
              title: nextStatus === "active" ? "Account reactivated" : "Account deactivated",
              message: nextStatus === "active" ? "Your Gifted Brainz EduSpace account has been reactivated." : "Your Gifted Brainz EduSpace account has been deactivated. Contact the coordinator if you need assistance.",
              url: "/account.html", createdAt: new Date().toISOString(), read: false
            };
            d.notifications.unshift(notice);
            try { const removed = await sendWebPushes(d, [notice]); if (removed) await save(d); } catch {}
          }
          u.status = nextStatus;
        }
        if (x.password !== void 0) {
          if (String(x.password).length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
          if (u.authUserId) { try { await supabaseUpdateUser(u.authUserId, { password: String(x.password) }); } catch { return json({ error: "The password could not be updated in the authentication service." }, 400); } }
          const ph = passwordHash(x.password);
          u.passwordHash = ph.hash;
          u.passwordSalt = ph.salt;
          revokeStudentTokens(u);
        }
        // Subject assignment is administrator-controlled: only this route (not the
        // student's own PATCH /api/me) is allowed to change selectedSubjects.
        if (x.selectedSubjects !== void 0) {
          const subjectCheck = validateSelectedSubjects(x.selectedSubjects);
          if (subjectCheck.error) return json({ error: subjectCheck.error }, 400);
          u.selectedSubjects = subjectCheck.subjects;
        }
        await save(d);
        return json(publicUser(u));
      }
      if (m === "DELETE" && /^\/api\/admin\/students\/[^/]+$/.test(p)) {
        const id = p.split("/").pop(), i = d.users.findIndex((u) => u.id === id);
        if (i < 0) return json({ error: "Student not found." }, 404);
        const [removedUser] = d.users.splice(i, 1);
        d.results = d.results.filter((r) => r.userId !== id);
        await save(d);
        // Free the username/email reservations so the details can be registered
        // again, and drop the one-attempt claims tied to the deleted account.
        await releaseUserUniqueKeys(removedUser);
        return json({ ok: true, id });
      }
      if (m === "POST" && /^\/api\/admin\/tests\/[^/]+\/release-results$/.test(p)) {
        const id = decodeURIComponent(p.split("/")[4]);
        const t = d.tests.find(v => v.id === id);
        if (!t) return json({ error: "CBT not found." }, 404);
        const alreadyReleased = t.resultReleased === true;
        t.resultVisibility = "held"; t.resultReleased = true; t.resultReleasedAt = t.resultReleasedAt || new Date().toISOString();
        const resultRows = d.results.filter(r => r.testId === id);
        const pendingRows = resultRows.filter(r => r.resultReleased !== true);
        for (const r of pendingRows) { r.resultReleased = true; r.resultVisibility = "held"; r.passMark = Number(r.passMark)||Number(t.passMark)||50; r.passed = Number(r.score)>=r.passMark;
          const notice = { id: crypto.randomUUID(), userId: r.userId, type: "result-released", title: "Result released", message: `Your result for ${t.title} is now available in Gifted Brainz EduSpace.`, url: "/dashboard.html", createdAt: new Date().toISOString(), read: false };
          d.notifications.unshift(notice);
          try { const removed = await sendWebPushes(d, [notice]); if (removed) {} } catch {}
        }
        await save(d);
        return json({ ok:true, testId:id, released:true, notified:pendingRows.length, alreadyReleased });
      }
      if (m === "GET" && p === "/api/admin/results") return json(d.results.map((r) => {
        const u = d.users.find((u2) => u2.id === r.userId);
        return { ...r, studentName: u?.name || "Deleted student", studentUsername: u?.username || "", studentWhatsApp: u?.whatsapp || "" };
      }));
      if (m === "GET" && p === "/api/admin/notes") return json(d.notes);
      if (m === "POST" && p === "/api/admin/notes") {
        const x = await readJSON(request), title = cleanString(x.title, 200), subject = cleanString(x.subject, 80);
        if (!title || !SUBJECTS.includes(subject)) return json({ error: "Title and subject are required." }, 400);
        const attachments = normaliseAttachments(x.attachments && x.attachments.length ? x.attachments : x.fileKey ? [{ key: x.fileKey, fileName: x.fileName, contentType: x.contentType }] : []);
        const n = {
          id: crypto.randomUUID(),
          title,
          subject,
          topic: cleanString(x.topic, 200),
          body: richBody(x.body, 4e4),
          format: "html",
          attachments,
          fileUrl: attachments[0]?.url || "",
          fileKey: attachments[0]?.key || "",
          fileName: attachments[0]?.fileName || "",
          published: !!x.published,
          access: x.access === "activated" ? "activated" : "all",
          date: (/* @__PURE__ */ new Date()).toISOString(),
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        d.notes.unshift(n);
        const notePublishNotices = n.published ? buildPublishNotifications(d, { type:"new-learning-material", title:"New Learning Material", message:"New learning material has been uploaded. Tap to view it.", url:`/materials.html?id=${encodeURIComponent(n.id)}`, eventKey:`publish:material:${n.id}` }) : [];
        if (notePublishNotices.length) d.notifications.unshift(...notePublishNotices);
        await save(d);
        if (notePublishNotices.length) { try { const removed=await sendWebPushes(d,notePublishNotices); if(removed) await save(d); } catch {} }
        return json(n);
      }
      if (m === "PATCH" && /^\/api\/admin\/notes\/[^/]+$/.test(p)) {
        const x = await readJSON(request), n = d.notes.find((n2) => n2.id === p.split("/").pop());
        const wasPublished = !!n?.published;
        if (!n) return json({ error: "Material not found." }, 404);
        if (typeof x.published === "boolean") n.published = x.published;
        if (x.access !== void 0) n.access = x.access === "activated" ? "activated" : "all";
        if (x.title !== void 0) n.title = cleanString(x.title, 200) || n.title;
        if (x.topic !== void 0) n.topic = cleanString(x.topic, 200);
        if (x.subject !== void 0 && SUBJECTS.includes(x.subject)) n.subject = x.subject;
        if (x.body !== void 0) {
          n.body = richBody(x.body, 4e4);
          n.format = "html";
        }
        n.bodyFormat = n.format;
        if (x.attachments !== void 0) {
          const old = n.attachments || [];
          n.attachments = normaliseAttachments(x.attachments);
          n.fileUrl = n.attachments[0]?.url || "";
          n.fileKey = n.attachments[0]?.key || "";
          n.fileName = n.attachments[0]?.fileName || "";
          const keep = new Set(n.attachments.map((f) => f.key));
          for (const f of old) if (f.key && !keep.has(f.key)) await deleteFile(f.key);
        }
        const notePublishNotices = (!wasPublished && !!n.published) ? buildPublishNotifications(d, { type:"new-learning-material", title:"New Learning Material", message:"New learning material has been uploaded. Tap to view it.", url:`/materials.html?id=${encodeURIComponent(n.id)}`, eventKey:`publish:material:${n.id}` }) : [];
        if (notePublishNotices.length) d.notifications.unshift(...notePublishNotices);
        await save(d);
        if (notePublishNotices.length) { try { const removed=await sendWebPushes(d,notePublishNotices); if(removed) await save(d); } catch {} }
        return json(n);
      }
      if (m === "DELETE" && /^\/api\/admin\/notes\/[^/]+$/.test(p)) {
        const id = p.split("/").pop(), i = d.notes.findIndex((n) => n.id === id);
        if (i < 0) return json({ error: "Material not found." }, 404);
        const [removed] = d.notes.splice(i, 1);
        await save(d);
        for (const f of removed.attachments || []) await deleteFile(f.key);
        if (removed.fileKey && !(removed.attachments || []).some((f) => f.key === removed.fileKey)) await deleteFile(removed.fileKey);
        return json({ ok: true, id });
      }
      if (m === "POST" && p === "/api/admin/upload/init") {
        const x = await readJSON(request);
        const safe = (cleanString(x.fileName || x.name, 180) || "file").replace(/[^a-zA-Z0-9._() \-]/g, "_") || "file";
        const uploadId = crypto.randomUUID();
        const key = `uploads/${Date.now()}-${crypto.randomBytes(8).toString("hex")}-${safe}`;
        const declaredSize = Number(x.size);
        if (!Number.isFinite(declaredSize) || declaredSize < 0 || declaredSize > 2 * 1024 * 1024 * 1024)
          return json({ error: "File size must be between 0 and 2 GB." }, 413);
        const chunkSize = Math.min(MAX_CHUNK, Math.max(1, Number(x.chunkSize) || 1024 * 1024));
        const declaredType = cleanString(x.contentType || x.type, 160);
        const guessed = declaredType || guessContentType(safe);
        await store().setJSON(`sessions/${uploadId}`, {
          key,
          fileName: safe,
          contentType: guessed || "application/octet-stream",
          size: declaredSize,
          chunkSize,
          received: 0,
          parts: 0,
          created: Date.now()
        });
        return json({ uploadId, key, chunkSize });
      }
      if (m === "POST" && p === "/api/admin/upload/chunk") {
        const isBinary = (request.headers.get("content-type") || "").toLowerCase().startsWith("application/octet-stream");
        let x, bytes;
        if (isBinary) {
          x = {
            uploadId: request.headers.get("x-upload-id") || "",
            index: request.headers.get("x-chunk-index") || ""
          };
          bytes = await readRawBody(request);
        } else {
          // Keep accepting the JSON/base64 format for older deployed clients.
          x = await readJSON(request);
          bytes = Buffer.from(String(x.data || ""), "base64");
        }
        const s = await store().get(`sessions/${String(x.uploadId || "").replace(/[^a-zA-Z0-9-]/g, "")}`, { type: "json" });
        if (!s) return json({ error: "Upload session not found. Please start the upload again." }, 404);
        if (!s.created || Date.now() - s.created > 60 * 60 * 1e3) {
          await store().delete(`sessions/${String(x.uploadId || "").replace(/[^a-zA-Z0-9-]/g, "")}`).catch(() => {
          });
          return json({ error: "Upload session expired. Please start the upload again." }, 410);
        }
        const index = Number(x.index);
        if (!Number.isInteger(index) || index < 0) return json({ error: "Invalid chunk index." }, 400);
        if (!bytes.length) return json({ error: "Chunk data is required." }, 400);
        if (bytes.length > MAX_CHUNK) return json({ error: "Chunk too large." }, 413);
        await store().set(`${s.key}.part.${index}`, bytes);
        const seen = Array.isArray(s.chunkSizes) ? s.chunkSizes : [];
        seen[index] = bytes.length;
        const received = seen.reduce((t, n) => t + (Number(n) || 0), 0);
        await store().setJSON(`sessions/${String(x.uploadId).replace(/[^a-zA-Z0-9-]/g, "")}`, { ...s, chunkSizes: seen, received, parts: Math.max(Number(s.parts) || 0, index + 1) });
        return json({ ok: true, index, size: bytes.length, received });
      }
      if (m === "POST" && p === "/api/admin/upload/complete") {
        const x = await readJSON(request);
        const id = String(x.uploadId || "").replace(/[^a-zA-Z0-9-]/g, "");
        const s = await store().get(`sessions/${id}`, { type: "json" });
        if (!s) return json({ error: "Upload session not found. Please start the upload again." }, 404);
        const parts = Number(x.parts);
        if (!Number.isInteger(parts) || parts < 0 || parts > 4096) return json({ error: "Invalid upload." }, 400);
        if (Date.now() - Number(s.created || 0) > 60 * 60 * 1e3) {
          await store().delete(`sessions/${id}`).catch(() => {
          });
          return json({ error: "Upload session expired. Please start the upload again." }, 410);
        }
        const declaredSize = Number(s.size) || 0;
        const sizes = Array.isArray(s.chunkSizes) ? s.chunkSizes : [];
        for (let i = 0; i < parts; i++) {
          if (!Number.isFinite(Number(sizes[i])) || Number(sizes[i]) <= 0) {
            const part = await store().get(`${s.key}.part.${i}`, { type: "arrayBuffer" });
            if (!part) return json({ error: `Upload is incomplete: chunk ${i + 1} is missing. Please try the upload again.` }, 409);
            sizes[i] = part.byteLength;
          }
        }
        const actualSize = sizes.slice(0, parts).reduce((t, n) => t + (Number(n) || 0), 0);
        if (declaredSize && actualSize !== declaredSize)
          return json({ error: `The upload did not finish cleanly (expected ${declaredSize} bytes, received ${actualSize}). Please check your connection and upload the file again.` }, 409);
        await store().setJSON(`${s.key}.meta`, { fileName: s.fileName, contentType: s.contentType, parts, size: actualSize || declaredSize, chunkSize: Number(s.chunkSize) || 1024 * 1024 });
        await store().delete(`sessions/${id}`).catch(() => {
        });
        return json({ fileKey: s.key, fileUrl: "/api/files/" + encodeURIComponent(s.key), fileName: s.fileName, contentType: s.contentType, kind: mediaKind(s.contentType, s.fileName), parts, size: actualSize || declaredSize });
      }
      if (m === "GET" && p === "/api/admin/question-bank") {
        const subject = cleanString(url.searchParams.get("subject") || "", 80);
        return json(d.questionBank.filter((q) => !subject || q.subject === subject));
      }
      if (m === "GET" && /^\/api\/admin\/question-bank\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop());
        const q = d.questionBank.find((item) => String(item.id) === String(id));
        return q ? json(q) : json({ error: "Question not found." }, 404);
      }
      if (m === "POST" && p === "/api/admin/question-bank") {
        const x = await readJSON(request);
        if (!SUBJECTS.includes(x.subject)) return json({ error: "Choose a valid subject." }, 400);
        const qError = validateQuestionForSubject(x, x.subject);
        if (qError) return json({ error: qError }, 400);
        if (d.questionBank.some((q) => q.subject === x.subject && questionKey(q) === questionKey(x))) return json({ error: "That question already exists in this subject's question bank." }, 409);
        if (x.topicId) {
          const t = topicFor(d, x.topicId, x.subject);
          if (!t) return json({ error: "Choose a topic belonging to the selected subject." }, 400);
          x.topicId = t.id; x.topic = t.name;
        }
        const q = normaliseQuestion({ ...x, id: crypto.randomUUID(), subject: x.subject, topicId: x.topicId || "", topic: x.topic || "Uncategorized / Topic Not Assigned" });
        d.questionBank.unshift({ ...q, subject: x.subject });
        await save(d);
        return json(d.questionBank[0]);
      }
      if (m === "PATCH" && /^\/api\/admin\/question-bank\/[^/]+$/.test(p)) {
        const id = p.split("/").pop(), x = await readJSON(request), q = d.questionBank.find((q2) => q2.id === id);
        if (!q) return json({ error: "Question not found." }, 404);
        const subject = x.subject !== void 0 ? x.subject : q.subject;
        if (!SUBJECTS.includes(subject)) return json({ error: "Unknown subject." }, 400);
        const candidate = { ...q, ...x, subject, id: q.id };
        const qError = validateQuestionForSubject(candidate, subject);
        if (qError) return json({ error: qError }, 400);

        if (d.questionBank.some((other) => other.id !== q.id && other.subject === subject && questionKey(other) === questionKey(candidate))) return json({ error: "That question already exists in this subject's question bank." }, 409);
        if (x.topicId !== undefined) {
          const t = topicFor(d, x.topicId, subject);
          if (!t) return json({ error: "Choose a topic belonging to the selected subject." }, 400);
          candidate.topicId = t.id;
          candidate.topic = t.name;
        }
        const next = normaliseQuestion(candidate);
        Object.assign(q, next);
        q.subject = subject;
        await save(d);
        return json(q);
      }
      if (m === "POST" && p === "/api/admin/question-bank/clear") {
        const x = await readJSON(request), subject = cleanString(x.subject,80), confirmPhrase = cleanString(x.confirmPhrase || "",120);
        if (!SUBJECTS.includes(subject)) return json({ error:"Choose a valid subject to clear." },400);
        const expectedPhrase = `CLEAR ${subject.toUpperCase()}`;
        if (confirmPhrase !== expectedPhrase) return json({ error:`Type ${expectedPhrase} exactly to confirm this deletion. Nothing was deleted.` },400);
        const removed = d.questionBank.filter(q=>q.subject===subject);
        d.questionBank = d.questionBank.filter(q=>q.subject!==subject);
        await save(d);
        for(const q of removed) if(q.image?.key) await deleteFile(q.image.key);
        return json({ok:true,subject,removed:removed.length,message:`${subject} question bank cleared. Other subjects were not changed.`});
      }
      if (m === "DELETE" && /^\/api\/admin\/question-bank\/[^/]+$/.test(p)) {
        const id = p.split("/").pop(), i = d.questionBank.findIndex((q) => q.id === id);
        if (i < 0) return json({ error: "Question not found." }, 404);
        const subject = d.questionBank[i].subject;
        const [removed] = d.questionBank.splice(i, 1);
        await save(d);
        if (removed.image?.key) await deleteFile(removed.image.key);
        return json({ ok: true, id });
      }
      if (m === "POST" && p === "/api/admin/tests/import") {
        const x = await readJSON(request);
        if (!SUBJECTS.includes(x.subject)) return json({ error: "Choose a valid subject before importing." }, 400);
        const buffer = await readStoredFile(x.fileKey);
        const parts = await extractDocumentParts(buffer, x.fileName, x.contentType);
        const { questions: parsed, report, assets } = parseExtractedQuestions(parts.text, parts.assets, x.subject);
        if (!parsed.length) return json({
          error: "No multiple-choice questions could be confidently extracted. Make sure the document contains numbered questions and recognizable A–D/A–E options; source A–E questions are automatically converted to A–D.",
          extraction: extractionReport(report, [])
        }, 422);
        await persistImportedImageAssets(parsed, assets, x.fileName || "import");
        let importTopic = null;
        if (x.topicId) {
          importTopic = topicFor(d, x.topicId, x.subject);
          if (!importTopic) return json({ error: "Choose a topic belonging to the selected subject." }, 400);
        }
        const questions = parsed.map(q => ({ ...normaliseQuestion(q), subject: x.subject, topicId: importTopic?.id || q.topicId || "", topic: importTopic?.name || q.topic || "Uncategorized / Topic Not Assigned" }));
        return json({ questions, needsReview: questions.filter(q => q.needsReview).length, extraction: extractionReport(report, questions) });
      }
      if (m === "POST" && p === "/api/admin/question-bank/import") {
        const x = await readJSON(request);
        if (!SUBJECTS.includes(x.subject)) return json({ error: "Choose a valid subject before importing." }, 400);
        const buffer = await readStoredFile(x.fileKey);
        const parts = await extractDocumentParts(buffer, x.fileName, x.contentType);
        const { questions: parsed, report, assets } = parseExtractedQuestions(parts.text, parts.assets, x.subject);
        if (!parsed.length) return json({
          error: "No four-option questions could be confidently extracted. Make sure the document contains numbered questions, A\u2013D options and, ideally, an answer key.",
          extraction: extractionReport(report, [])
        }, 422);
        const currentCount = d.questionBank.filter((q) => q.subject === x.subject).length;
        const room = Math.max(parsed.length, 1000);
        const added = [];
        const selected = [];
        for (const parsedQuestion of parsed.slice(0, room)) {
          const qError = validateQuestionForSubject(parsedQuestion, x.subject);
          if (qError) continue;
          if (d.questionBank.some((q) => q.subject === x.subject && questionKey(q) === questionKey(parsedQuestion))) continue;
          selected.push(parsedQuestion);
        }
        let importTopic = null;
        if (x.topicId) {
          importTopic = topicFor(d, x.topicId, x.subject);
          if (!importTopic) return json({ error: "Choose a topic belonging to the selected subject." }, 400);
        }
        await persistImportedImageAssets(selected, assets, x.fileName || "import");
        for (const parsedQuestion of selected) {
          added.push({
            ...normaliseQuestion({
              ...parsedQuestion,
              subject: x.subject,
              topicId: importTopic?.id || parsedQuestion.topicId || "",
              topic: importTopic?.name || parsedQuestion.topic || "Uncategorized / Topic Not Assigned"
            }),
            subject: x.subject,
            topicId: importTopic?.id || parsedQuestion.topicId || "",
            topic: importTopic?.name || parsedQuestion.topic || "Uncategorized / Topic Not Assigned",
            source: cleanString(x.fileName, 500) || "Imported document",
            importedAt: (/* @__PURE__ */ new Date()).toISOString()
          });
        }
        if (!added.length) {
          // Extraction succeeded, but every parsed question was already present in the
          // selected subject's question bank. Do not report this as an extraction failure.
          await deleteFile(x.fileKey);
          const extraction = extractionReport(report, []);
          extraction.quality = "fair";
          extraction.verdict = "Questions extracted — no new questions added ✅";
          extraction.summary = `${parsed.length} question${parsed.length === 1 ? "" : "s"} were successfully extracted, but all of them already exist in the ${x.subject} question bank. Nothing new was added.`;
          extraction.duplicates = parsed.length;
          return json({ count: 0, questions: [], needsReview: 0, extraction });
        }
        d.questionBank.unshift(...added);
        await save(d);
        await deleteFile(x.fileKey);
        const extraction = extractionReport(report, added);
        return json({ count: added.length, questions: added, needsReview: extraction.needsReview, extraction });
      }
      if (p === "/api/admin/question-bank/import-link")
        return json({ error: "Importing questions from a link is no longer supported. Please upload the document instead." }, 410);
      if (m === "GET" && p === "/api/admin/tests") {
        // The management list only ever renders title/subject/counts/status
        // (see the assessment-row template) - it never reads question or
        // section content. Sending every question, option and explanation
        // of every test on every list load (and this list is re-fetched
        // after almost every admin action) was pure wasted payload; a
        // specific test's full content is now fetched only when it's
        // actually opened, via GET /api/admin/tests/:id below.
        return json(d.tests.map((t) => {
          const { questions, sections, ...rest } = t;
          return { ...rest, questionCount: Array.isArray(questions) ? questions.length : 0, sectionCount: Array.isArray(sections) ? sections.length : 0 };
        }));
      }
      if (m === "GET" && /^\/api\/admin\/tests\/[^/]+$/.test(p)) {
        const t = d.tests.find((t2) => t2.id === p.split("/").pop());
        if (!t) return json({ error: "Assessment not found." }, 404);
        return json(t);
      }
      if (m === "PATCH" && /^\/api\/admin\/tests\/[^/]+$/.test(p)) {
        const id = decodeURIComponent(p.split("/").pop());
        const x = await readJSON(request);
        const t = d.tests.find(v => v.id === id);
        const wasPublished = !!t?.published;
        if (!t) return json({ error: "CBT not found." }, 404);
        if (x.title !== void 0) t.title = cleanString(x.title, 200) || t.title;
        if (x.duration !== void 0) {
          const n = Number(x.duration);
          if (!Number.isFinite(n) || n < 1) return json({ error: "Duration must be a positive number of minutes." }, 400);
          t.duration = Math.min(240, n);
        }
        if (x.published !== void 0) t.published = !!x.published;
        if (x.access !== void 0) t.access = x.access === "activated" ? "activated" : "all";
        if (x.instructions !== void 0) t.instructions = richBody(x.instructions, 12000);
        if (x.oneAttempt !== void 0) t.oneAttempt = x.oneAttempt !== false;
        if (x.resultVisibility !== void 0) t.resultVisibility = x.resultVisibility === "held" ? "held" : "immediate";
        if (x.resultReleased !== void 0) t.resultReleased = !!x.resultReleased;
        if (x.passMark !== void 0) { const n=Number(x.passMark); if(!Number.isFinite(n)||n<0||n>100)return json({error:"Pass mark must be between 0 and 100."},400); t.passMark=n; }
        if (x.studentFields !== void 0) t.studentFields = normaliseStudentFields(x.studentFields);
        if (x.sections !== void 0) t.sections = Array.isArray(x.sections) ? x.sections.slice(0, 50).map(sec => ({ id: cleanString(sec.id, 80) || crypto.randomUUID(), title: cleanString(sec.title, 160) || "Section", instructions: richBody(sec.instructions || "", 4000) })) : [];
        if (x.shuffleQuestions !== void 0) t.shuffleQuestions = x.shuffleQuestions !== false;
        if (x.shuffleOptions !== void 0) t.shuffleOptions = x.shuffleOptions !== false;
        if (Array.isArray(x.questions)) {
          const questions = x.questions.map(q => normaliseQuestion(q));
          const err = validateQuestionSet(questions, t.subject);
          if (err) return json({ error: err }, 400);
          t.questions = questions;
        }
        if (Array.isArray(x.questionPool)) {
          const pool = x.questionPool.map(q => normaliseQuestion(q));
          const err = validateQuestionSet(pool, t.subject);
          if (err) return json({ error: err }, 400);
          t.questionPool = pool;
          const requested = Math.max(1, Number(x.questionPoolCount) || t.questionPoolCount || pool.length);
          t.questionPoolCount = Math.min(requested, pool.length);
        }
        if (Array.isArray(x.questionPoolTopicIds)) {
          t.questionPoolTopicIds = [...new Set(x.questionPoolTopicIds.map(String))];
        }
        if (x.randomizeQuestionPool !== void 0) t.randomizeQuestionPool = !!x.randomizeQuestionPool;
        const publishNotices = (!wasPublished && !!t.published) ? buildPublishNotifications(d, { type:"new-cbt", title:"New CBT Available", message:"A new CBT has been published. Tap to view and take the CBT.", url:`/cbt.html?id=${encodeURIComponent(t.id)}`, eventKey:`publish:cbt:${t.id}` }) : [];
        if (publishNotices.length) d.notifications.unshift(...publishNotices);
        await save(d);
        if (publishNotices.length) { try { const removed=await sendWebPushes(d,publishNotices); if(removed) await save(d); } catch {} }
        return json(t);
      }
      if (m === "POST" && p === "/api/admin/tests") {
        const x = await readJSON(request);
        if (!cleanString(x.title, 200) || !SUBJECTS.includes(x.subject)) return json({ error: "A valid title and subject are required." }, 400);
        const questions = Array.isArray(x.questions) ? x.questions.map(q => normaliseQuestion(q)) : [];
        const pool = Array.isArray(x.questionPool) ? x.questionPool.map(q => normaliseQuestion(q)) : [];
        if (!questions.length && !pool.length) return json({ error: "Add at least one question before saving the CBT." }, 400);
        if (questions.length) { const err = validateQuestionSet(questions, x.subject); if (err) return json({ error: err }, 400); }
        if (pool.length) { const err = validateQuestionSet(pool, x.subject); if (err) return json({ error: err }, 400); }
        const requiredDuration = Number.isFinite(Number(x.duration)) && Number(x.duration) > 0 ? Math.min(240, Number(x.duration)) : (x.subject === "Mathematics" ? 50 : 40);
        const rawRequestedCount = Number(x.questionPoolCount) || 1;
        const topicIds = Array.isArray(x.questionPoolTopicIds) ? [...new Set(x.questionPoolTopicIds.map(String))] : [];
        if (pool.length && topicIds.length === 1 && rawRequestedCount > 40) return json({ error: "A single topic can contribute a maximum of 40 questions to a CBT." }, 400);
        const requestedCount = pool.length ? Math.min(Math.max(1, rawRequestedCount), pool.length) : questions.length;
        const t = {
          id: crypto.randomUUID(),
          title: cleanString(x.title, 200),
          subject: x.subject,
          duration: requiredDuration,
          published: !!x.published,
          access: x.access === "activated" ? "activated" : "all",
          instructions: richBody(x.instructions || "", 12000),
          oneAttempt: x.oneAttempt !== false,
          resultVisibility: x.resultVisibility === "held" ? "held" : "immediate",
          resultReleased: x.resultVisibility === "held" ? !!x.resultReleased : true,
          passMark: Number.isFinite(Number(x.passMark)) ? Math.min(100, Math.max(0, Number(x.passMark))) : 50,
          studentFields: normaliseStudentFields(x.studentFields),
          sections: Array.isArray(x.sections) ? x.sections.slice(0, 50).map(sec => ({ id: cleanString(sec.id, 80) || crypto.randomUUID(), title: cleanString(sec.title, 160) || "Section", instructions: richBody(sec.instructions || "", 4000) })) : [],
          shuffleQuestions: x.shuffleQuestions !== false,
          shuffleOptions: x.shuffleOptions !== false,
          questions: questions.length ? questions : pool.slice(0, requestedCount),
          questionPool: pool.length ? pool : [],
          questionPoolCount: pool.length ? requestedCount : questions.length,
          questionPoolTopicIds: pool.length ? topicIds : [],
          randomizeQuestionPool: pool.length ? x.randomizeQuestionPool !== false : false
        };
        d.tests.unshift(t);
        const newPublishNotices = t.published ? buildPublishNotifications(d, { type:"new-cbt", title:"New CBT Available", message:"A new CBT has been published. Tap to view and take the CBT.", url:`/cbt.html?id=${encodeURIComponent(t.id)}`, eventKey:`publish:cbt:${t.id}` }) : [];
        if (newPublishNotices.length) d.notifications.unshift(...newPublishNotices);
        await save(d);
        if (newPublishNotices.length) { try { const removed=await sendWebPushes(d,newPublishNotices); if(removed) await save(d); } catch {} }
        return json(t, 201);
      }
      if (m === "GET" && p === "/api/admin/question-sets") return json(d.questionSets);
      if (m === "POST" && p === "/api/admin/question-sets") {
        const x = await readJSON(request), title = cleanString(x.title, 200);
        if (!title) return json({ error: "A set title is required." }, 400);
        const inputSections = Array.isArray(x.sections) ? x.sections : [];
        if (!inputSections.length) return json({ error: "Add at least one subject section." }, 400);
        const sections = [];
        for (const sec of inputSections) {
          const subject = cleanString(sec.subject, 80);
          if (!SUBJECTS.includes(subject)) return json({ error: `Unknown subject: ${subject}.` }, 400);
          let questions = Array.isArray(sec.questions) ? sec.questions : [];
          if (sec.pullFromBank) {
            const topicIds = Array.isArray(sec.topicIds) ? [...new Set(sec.topicIds.map(String))] : [];
            const validTopics = topicIds.length ? d.topics.filter(t => t.subject === subject && topicIds.includes(String(t.id))) : [];
            if (topicIds.length && validTopics.length !== topicIds.length) return json({ error: `${subject}: one or more selected topics are invalid.` }, 400);
            const pool = shuffleCopy(d.questionBank.filter(q => q.subject === subject && q.type === "mcq" && Array.isArray(q.options) && q.options.length === 4 && (!topicIds.length || topicIds.includes(String(q.topicId || "")))));
            const take = Math.min(Math.max(1, Number(sec.pullFromBank) || 1), pool.length);
            if (take < Math.max(1, Number(sec.pullFromBank) || 1)) return json({ error: `${subject}: only ${pool.length} eligible question(s) are available in the selected question-bank pool.` }, 400);
            const sectionMarks = Number.isFinite(Number(sec.marksPerQuestion)) && Number(sec.marksPerQuestion) > 0 ? Number(sec.marksPerQuestion) : 1;
            questions = [...questions, ...pool.slice(0, take).map(q => ({ ...q, marks: sectionMarks }))];
          }
          const error = validateQuestionSet(questions, subject);
          if (error) return json({ error: `${subject}: ${error}` }, 400);
          sections.push({ subject, marksPerQuestion: Number.isFinite(Number(sec.marksPerQuestion)) && Number(sec.marksPerQuestion) > 0 ? Number(sec.marksPerQuestion) : 1, questions: questions.map(q => ({ ...normaliseQuestion(q), subject })) });
        }
        const set = { id: crypto.randomUUID(), title, duration: Number.isFinite(Number(x.duration)) && Number(x.duration) > 0 ? Math.min(240, Number(x.duration)) : 0, published: !!x.published, access: x.access === "activated" ? "activated" : "all", shuffleQuestions: x.shuffleQuestions !== false, shuffleOptions: x.shuffleOptions !== false, passMark: Number.isFinite(Number(x.passMark)) ? Math.min(100,Math.max(0,Number(x.passMark))) : 50, oneAttempt:x.oneAttempt!==false, resultVisibility:x.resultVisibility === "held" ? "held":"immediate", resultReleased:x.resultVisibility === "held" ? !!x.resultReleased:true, studentFields:normaliseStudentFields(x.studentFields), sections };
        d.questionSets.unshift(set); await save(d); return json(set);
      }
      if (m === "GET" && /^\/api\/admin\/question-sets\/[^/]+$/.test(p)) { const id=p.split("/").pop(), set=d.questionSets.find(s=>s.id===id); return set?json(set):json({error:"Question set not found."},404); }
      if (m === "PATCH" && /^\/api\/admin\/question-sets\/[^/]+$/.test(p)) {
        const x=await readJSON(request), set=d.questionSets.find(s=>s.id===p.split("/").pop()); if(!set) return json({error:"Question set not found."},404);
        if(x.title!==void 0) set.title=cleanString(x.title,200)||set.title; if(x.published!==void 0) set.published=!!x.published; if(x.access!==void 0)set.access=x.access==="activated"?"activated":"all"; if(x.passMark!==void 0){const n=Number(x.passMark);if(!Number.isFinite(n)||n<0||n>100)return json({error:"Pass mark must be between 0 and 100."},400);set.passMark=n;} if(x.oneAttempt!==void 0)set.oneAttempt=x.oneAttempt!==false; if(x.resultVisibility!==void 0)set.resultVisibility=x.resultVisibility==="held"?"held":"immediate"; if(x.resultReleased!==void 0)set.resultReleased=!!x.resultReleased; if(x.studentFields!==void 0)set.studentFields=normaliseStudentFields(x.studentFields); if(x.duration!==void 0){const n=Number(x.duration);if(!Number.isFinite(n)||n<0)return json({error:"Duration must be 0 or a positive number of minutes."},400);set.duration=Math.min(240,n)}
        if(Array.isArray(x.sections)){ const rebuilt=[]; for(const sec of x.sections){const subject=cleanString(sec.subject,80); if(!SUBJECTS.includes(subject)) return json({error:`Unknown subject: ${subject}.`},400); const qs=Array.isArray(sec.questions)?sec.questions:[]; const err=validateQuestionSet(qs,subject); if(err)return json({error:`${subject}: ${err}`},400); const marksPerQuestion=Number.isFinite(Number(sec.marksPerQuestion))&&Number(sec.marksPerQuestion)>0?Number(sec.marksPerQuestion):1; rebuilt.push({subject,marksPerQuestion,questions:qs.map(q=>({...normaliseQuestion(q),subject}))});} set.sections=rebuilt; }
        await save(d); return json(set);
      }
      if (m === "DELETE" && /^\/api\/admin\/question-sets\/[^/]+$/.test(p)) { const id=p.split("/").pop(),i=d.questionSets.findIndex(s=>s.id===id); if(i<0)return json({error:"Question set not found."},404); d.questionSets.splice(i,1); await save(d); return json({ok:true,id}); }
      if (m === "POST" && /^\/api\/admin\/question-sets\/[^/]+\/release-results$/.test(p)) { const id=decodeURIComponent(p.split("/")[4]),set=d.questionSets.find(v=>v.id===id);if(!set)return json({error:"Question set not found."},404);set.resultVisibility="held";const pending=d.results.filter(r=>r.questionSetId===id&&r.resultReleased!==true);set.resultReleased=true;set.resultReleasedAt=set.resultReleasedAt||new Date().toISOString();for(const r of pending){r.resultReleased=true;r.resultVisibility="held";const notice={id:crypto.randomUUID(),userId:r.userId,type:"result-released",title:"Result released",message:`Your result for ${set.title} is now available in Gifted Brainz EduSpace.`,url:"/dashboard.html",createdAt:new Date().toISOString(),read:false};d.notifications.unshift(notice);try{await sendWebPushes(d,[notice])}catch{}}await save(d);return json({ok:true,released:true,notified:pending.length}); }
      if (m === "GET" && p === "/api/admin/announcements") return json(d.announcements);
      if (m === "POST" && p === "/api/admin/announcements") {
        const x = await readJSON(request);
        const body = richBody(x.body, 4e4);
        const media = normaliseAttachments(x.media && x.media.length ? x.media : x.attachments);
        if (!cleanString(x.title, 200) || !body.replace(/<[^>]*>/g, "").trim() && !media.length)
          return json({ error: "A title and either a message or an attached picture/video are required." }, 400);
        const a2 = {
          id: crypto.randomUUID(),
          title: cleanString(x.title, 200),
          body,
          format: "html",
          media,
          published: !!x.published,
          date: (/* @__PURE__ */ new Date()).toISOString(),
          createdAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        a2.attachments = a2.media;
        a2.bodyFormat = a2.format;
        d.settings.deletedAnnouncementIds = (d.settings.deletedAnnouncementIds || []).filter((v) => String(v) !== String(a2.id));
        d.announcements.unshift(a2);
        await save(d);
        return json(a2);
      }
      if (m === "PATCH" && /^\/api\/admin\/announcements\/[^/]+$/.test(p)) {
        const x = await readJSON(request), a2 = d.announcements.find((a3) => a3.id === p.split("/").pop());
        if (!a2) return json({ error: "Announcement not found." }, 404);
        d.settings.deletedAnnouncementIds = (d.settings.deletedAnnouncementIds || []).filter((v) => String(v) !== String(a2.id));
        if (typeof x.published === "boolean") a2.published = x.published;
        if (x.title !== void 0) a2.title = cleanString(x.title, 200) || a2.title;
        if (x.body !== void 0) {
          a2.body = richBody(x.body, 4e4);
          a2.format = "html";
        }
        if (x.media !== void 0 || x.attachments !== void 0) {
          const old = Array.isArray(a2.media) && a2.media.length ? a2.media : Array.isArray(a2.attachments) ? a2.attachments : [];
          a2.media = normaliseAttachments(x.media !== void 0 ? x.media : x.attachments);
          const keep = new Set(a2.media.map((f) => f.key));
          for (const f of old) if (f.key && !keep.has(f.key)) await deleteFile(f.key);
        }
        a2.attachments = a2.media;
        a2.bodyFormat = a2.format;
        await save(d);
        return json(a2);
      }
      if (m === "DELETE" && /^\/api\/admin\/announcements\/[^/]+$/.test(p)) {
        const id = p.split("/").pop(), i = d.announcements.findIndex((a2) => a2.id === id);
        if (i < 0) return json({ error: "Announcement not found." }, 404);
        const [removed] = d.announcements.splice(i, 1);
        d.settings.deletedAnnouncementIds = Array.isArray(d.settings.deletedAnnouncementIds) ? d.settings.deletedAnnouncementIds : [];
        if (!d.settings.deletedAnnouncementIds.includes(String(id))) d.settings.deletedAnnouncementIds.push(String(id));
        if (d.settings.deletedAnnouncementIds.length > 5e3) d.settings.deletedAnnouncementIds = d.settings.deletedAnnouncementIds.slice(-5e3);
        await save(d);
        for (const f of removed.media || removed.attachments || []) await deleteFile(f.key);
        return json({ ok: true, id });
      }
      if (m === "GET" && p === "/api/admin/leaderboard") {
        return json({
          generalResetAt: d.settings.leaderboardResetAt || null,
          subjectResetAt: d.settings.subjectLeaderboardResetAt || {},
          // The recorded reset events, so the admin screen can audit what was
          // cleared and when. This previously returned the all-time result
          // count, which is a different number entirely.
          history: Array.isArray(d.settings.leaderboardResetHistory) ? d.settings.leaderboardResetHistory : [],
          totalStoredResults: d.results.length
        });
      }
      if (m === "POST" && p === "/api/admin/leaderboard/reset") {
        const x = await readJSON(request);
        const subject = cleanString(x.subject || "", 60);
        if (subject && !SUBJECTS.includes(subject)) return json({ error: "Unknown subject." }, 400);
        const now = (/* @__PURE__ */ new Date()).toISOString();
        if (subject) d.settings.subjectLeaderboardResetAt[subject] = now;
        else d.settings.leaderboardResetAt = now;
        d.settings.leaderboardResetHistory = Array.isArray(d.settings.leaderboardResetHistory) ? d.settings.leaderboardResetHistory : [];
        d.settings.leaderboardResetHistory.unshift({ subject: subject || null, at: now });
        d.settings.leaderboardResetHistory = d.settings.leaderboardResetHistory.slice(0, 100);
        await save(d);
        return json({ ok: true, subject: subject || null, resetAt: now, message: subject ? `${subject} leaderboard cleared. Student CBT records were not deleted.` : "General leaderboard cleared. Student CBT records were not deleted." });
      }
      return json({ error: "Admin endpoint not found." }, 404);
    }
    return json({ error: "API endpoint not found." }, 404);
  } catch (e) {
    console.error("API failure", p, e);
    const requestId = crypto.randomUUID();
    if (e?.authConfiguration) {
      return json({ error: "Student authentication is not configured. Set AUTH_SECRET on the Student Portal server.", code: "AUTH_NOT_CONFIGURED", requestId, retryable: false }, 503);
    }
    if (e?.storageUnavailable) {
      return json({
        error: API_ERROR.CENTRAL_DATABASE,
        code: "CENTRAL_DATABASE_UNAVAILABLE",
        requestId,
        retryable: true,
        storage: storageReport()
      }, 503);
    }
    if (e?.badRequest) {
      return json({ error: e?.message || "Invalid request.", requestId, retryable: false }, 400);
    }
    return json({
      error: "The server could not complete that request. Please try again.",
      requestId,
      retryable: true
    }, 500);
  }
}

/* The default export is the platform-agnostic request handler. EdgeOne Node
 * Function entry points (node-functions/api/*.js) bind the request context and
 * then delegate to it, and the in-app runtime updater validates that a
 * published api-core.js still exposes it.
 */
export default handler;
export { handler };
