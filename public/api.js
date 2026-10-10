/* ------------------------------------------------------------------
   Gifted Brainz EduSpace — API client.

   Why this file is defensive: the portal runs on serverless functions, so
   transient gateway failures and mobile-network drops can happen. Requests
   use a bounded timeout and retry only transient gateway errors. Structured
   API errors (including storage/configuration failures) are surfaced directly
   instead of being mislabeled as a generic server wake-up.
------------------------------------------------------------------- */
window.GB = (() => {
  // Session user is populated only from the server-validated HttpOnly-cookie session.
  // Keep an explicit nullable binding so callers can safely ask for it while auth is loading.
  let sessionUser = null;
  let authPromise = null;

  // Student authentication is carried only by the server-issued HttpOnly gb_session cookie.
  // The browser never reads or stores an authentication token.
  const token = () => Boolean(window.__GB_SESSION_USER);

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const TIMEOUT = 12000;      // default API timeout; upload requests use a longer window
  const RETRIES = 3;          // retry brief gateway/serverless wake-up failures
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Tiny tab-local cache for safe, idempotent reads. Without this, every page
  // navigation re-fetches things like the subject catalog and dashboard stats
  // from scratch even when the student was on that same data seconds ago.
  // Any write (non-GET request) clears the whole cache immediately, so a
  // change is always reflected on the very next read - this only removes
  // *repeated* reads of data that hasn't changed, never serves something
  // stale after an edit.
  const GET_CACHE_TTL = 3000;
  const readCache = new Map();
  const pendingReads = new Map();
  const cloneData = data => {
    try { return typeof structuredClone === "function" ? structuredClone(data) : JSON.parse(JSON.stringify(data)); }
    catch { return data; }
  };
  const cacheableRead = (url, method) => {
    if (method !== "GET") return false;
    const u = String(url || "");
    // Deliberately narrow: idempotent, non-personal-action resource reads
    // only. Never cache auth/session, submissions, duels, notifications,
    // files or anything the student is actively acting on.
    return /^\/api\/(subjects|dashboard|tests|question-bank\/topics|leaderboard|materials)(?:[/?]|$)/i.test(u);
  };
  const invalidateReads = () => { readCache.clear(); };

  class NetworkError extends Error {}

  async function once(url, options = {}) {
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs) > 0 ? Math.min(55000, Number(options.timeoutMs)) : TIMEOUT;
    const fetchOptions = { ...options };
    delete fetchOptions.timeoutMs;
    delete fetchOptions.retryAttempts;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...fetchOptions, credentials: "include", signal: controller.signal, cache: "no-store" });
    } catch (e) {
      // Aborts, DNS failures and dropped connections all land here.
      throw new NetworkError(
        e && e.name === "AbortError"
          ? "The server is taking too long to respond. Please try again."
          : "Could not reach the Gifted Brainz server. Check your internet connection and try again."
      );
    } finally { clearTimeout(timer); }
  }

  const api = async (url, options = {}) => {
    const headers = { ...(options.headers || {}) };
    const method = String(options.method || "GET").toUpperCase();
    const useCache = cacheableRead(url, method) && options.cache !== "no-store";
    const cacheKey = useCache ? String(url) : "";
    if (useCache) {
      const hit = readCache.get(cacheKey);
      if (hit && (Date.now() - hit.at) < GET_CACHE_TTL) return cloneData(hit.data);
      readCache.delete(cacheKey);
      if (pendingReads.has(cacheKey)) return cloneData(await pendingReads.get(cacheKey));
    }

    const execute = async () => {
    // Retrying a write that the server may already have processed can create a
    // duplicate account, a duplicate submission or a double-counted duel
    // answer, so only reads and idempotent writes are retried. Uploads stay
    // retryable because each chunk is addressed by index and simply overwrites
    // itself.
    const unsafe = ["/submit", "/answer", "/register", "/duel/", "/feedback"].some(part => String(url).includes(part));
    const requestedAttempts = Number(options.retryAttempts);
    const attempts = Number.isInteger(requestedAttempts) && requestedAttempts > 0 && requestedAttempts <= 5
      ? requestedAttempts
      : (method === "GET" || method === "HEAD" ? RETRIES : 1);

    let lastError = null;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await wait(200 * attempt);
      let r;
      try {
        r = await once(url, { ...options, headers });
      } catch (e) { lastError = e; continue; }

      // Distinguish a transient gateway failure from a function that is
      // actually running and returning a structured 503 (for example, a
      // missing production storage configuration). The old code treated every
      // 503 as a generic "server is waking up" message, which hid the real
      // cause and made diagnosis unnecessarily difficult.
      let data = {};
      const type = r.headers.get("content-type") || "";
      if ([502, 504, 522, 524].includes(r.status)) {
        lastError = new NetworkError("The server is temporarily unavailable. Retrying automatically…");
        continue;
      }
      if (r.status === 503 && type.includes("application/json")) {
        try { data = await r.json(); } catch { data = {}; }
        // A structured 503 is an intentional API response (for example a
        // missing production storage configuration), not a cold-start signal.
        // Do not spend three more round trips retrying a deterministic error.
        throw Error(data.error || "The server is temporarily unavailable. Please check diagnostics.");
      }

      if (r.status === 503) {
        throw Error("The server is temporarily unavailable. Open /diagnostics.html for details.");
      }

      if (type.includes("application/json")) {
        try { data = await r.json(); } catch { data = {}; }
      } else {
        // Anything that is not JSON on an /api/ route means the request never
        // reached the API function: the host answered with a web page instead.
        // The usual cause is a deploy that published the static files but not
        // the serverless function (a drag-and-drop deploy does not build
        // functions), in which case /api/* falls through to the 404 page or to
        // the single-page fallback. Reporting that plainly — on a 200 as well
        // as on an error — stops a broken deploy from looking like a wrong
        // password, and stops a fallback page from being mistaken for a
        // successful login.
        const text = await r.text().catch(() => "");
        const looksLikeHtml = text.trim().startsWith("<");
        if (looksLikeHtml || !r.ok) {
          data = {
            error: looksLikeHtml
              ? "The API is not responding on this site: the server returned a web page instead of data. The serverless function was not published with this deploy. Open /diagnostics.html for details."
              : (text || "Request failed."),
            apiMissing: looksLikeHtml
          };
          if (looksLikeHtml) throw Error(data.error);
        }
      }

      if (r.status === 401) {
        const path = location.pathname;
        // Say why the student is back on the sign-in screen. Without this the
        // bounce looks exactly like "the login page just refreshed".
        if (!path.endsWith("login.html") && !path.endsWith("register.html") && path !== "/")
          location = "/login.html?session=expired";
      }
      if (!r.ok) throw Error(data.error || `Request failed (${r.status}).`);
      if (data && data.user && typeof data.user === "object" && (data.user.id || data.user.username || data.user.email)) {
        sessionUser = data.user;
        window.__GB_SESSION_USER = sessionUser;
      }
      return data;
    }
    throw lastError || new NetworkError("Could not reach the Gifted Brainz server. Please try again.");
    };

    if (useCache) {
      const pending = execute().then(data => { readCache.set(cacheKey, { at: Date.now(), data: cloneData(data) }); return data; }).finally(() => pendingReads.delete(cacheKey));
      pendingReads.set(cacheKey, pending);
      return cloneData(await pending);
    }
    const result = await execute();
    if (method !== "GET" && method !== "HEAD") invalidateReads();
    return result;
  };

  function showAuthGuardMessage(message) {
    const banner = document.getElementById("networkBanner");
    if (banner) {
      banner.textContent = message;
      banner.classList.add("show");
      banner.setAttribute("role", "alert");
      return;
    }
    // Pages without the shared banner should still expose a visible, accessible
    // failure state rather than silently leaving an authenticated route blank.
    let box = document.getElementById("gbAuthGuardError");
    if (!box) {
      box = document.createElement("div");
      box.id = "gbAuthGuardError";
      box.style.cssText = "position:fixed;inset:16px 16px auto 16px;z-index:99999;padding:14px 16px;border:1px solid #b3261e;border-radius:12px;background:#fff5f4;color:#7b1c17;font:600 15px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px rgba(0,0,0,.12)";
      document.body.prepend(box);
    }
    box.textContent = message;
  }

  // Page-level authentication guard. Protected pages must ask the server for
  // the current HttpOnly-cookie session rather than trusting browser storage.
  // Calls during page startup share one in-flight validation request, preventing
  // subject-dependent UI from racing ahead of authentication. A structured 503
  // clears the shared promise so a later user action can retry a recovered backend.
  const requireAuth = () => {
    if (authPromise) return authPromise;
    authPromise = (async () => {
      try {
        const r = await once("/api/auth/session", { method: "GET" });
        let data = {};
        const type = r.headers.get("content-type") || "";
        if (type.includes("application/json")) data = await r.json().catch(() => ({}));
        if (r.status === 503) {
          sessionUser = null;
          delete window.__GB_SESSION_USER;
          authPromise = null;
          showAuthGuardMessage(data?.error || "Unable to connect to the central database. Please try again.");
          return false;
        }
        if (!r.ok || !data?.authenticated) {
          sessionUser = null;
          delete window.__GB_SESSION_USER;
          if (!location.pathname.endsWith("login.html") && !location.pathname.endsWith("register.html") && location.pathname !== "/")
            location = "/login.html?session=expired";
          return false;
        }
        sessionUser = data.user || null;
        window.__GB_SESSION_USER = sessionUser;
        return true;
      } catch {
        sessionUser = null;
        delete window.__GB_SESSION_USER;
        authPromise = null;
        return false;
      }
    })();
    return authPromise;
  };

  // Used by the sign-in screens to say precisely what is wrong.
  const health = async () => {
    try { const r = await once("/api/health", { method: "GET" }); return r.ok; }
    catch { return false; }
  };

  const logout = () => {
    // Ask the server to clear the download cookie; keepalive lets the request
    // survive the navigation that follows.
    try { fetch("/api/auth/logout", { method: "POST", credentials: "include", keepalive: true }).catch(() => {}); } catch {}
    try {
      fetch("/api/files/ticket", { method: "DELETE", credentials: "include", keepalive: true }).catch(() => {});
      ticketIssuedAt = 0;
    } catch {}
    location = "/";
  };

  // Phones frequently report an empty MIME type for camera videos, so the
  // extension is sent along and the server works the real type out.
  const guessType = name => {
    const e = String(name || "").toLowerCase().split(".").pop();
    return ({ mp4: "video/mp4", m4v: "video/x-m4v", mov: "video/quicktime", webm: "video/webm",
      "3gp": "video/3gpp", mkv: "video/x-matroska", avi: "video/x-msvideo",
      mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav", ogg: "audio/ogg", aac: "audio/aac",
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
      pdf: "application/pdf" }[e]) || "";
  };


  const upload = async (file, onProgress) => {
    if (!file) return {};
    const report=(v)=>{ if(onProgress) onProgress(v); };
    report(0);
    try{
      const contentType = file.type || guessType(file.name);
      const CHUNK = 512 * 1024;
      const init = await api("/api/admin/upload/init", {
        method: "POST", timeoutMs: 55000, retryAttempts: 1, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, contentType, size: file.size, chunkSize: CHUNK })
      });
      const actualChunk = Math.min(CHUNK, Math.max(64 * 1024, Number(init.chunkSize) || CHUNK));
      let index = 0, sent = 0;
      for (let off = 0; off < file.size; off += actualChunk, index++) {
        let bytes;
        try {
          bytes = new Uint8Array(await file.slice(off, off + actualChunk).arrayBuffer());
        } catch (readErr) {
          // Some browsers can invalidate a File reference after it was selected
          // (especially files exposed through Downloads/cloud providers).
          // Fall back to FileReader, which reacquires the bytes through the
          // browser's file-reading path instead of failing the whole import.
          bytes = await new Promise((resolve, reject) => {
            try {
              const reader = new FileReader();
              reader.onload = () => resolve(new Uint8Array(reader.result));
              reader.onerror = () => reject(reader.error || readErr || new Error("The selected file could not be read."));
              reader.onabort = () => reject(new Error("Reading the selected file was aborted."));
              reader.readAsArrayBuffer(file.slice(off, off + actualChunk));
            } catch (e) { reject(e || readErr); }
          });
        }
        // Makers Node Functions have a 1 MB request-body limit. JSON/base64 is
        // used deliberately here because some mobile/browser gateways can
        // expose a binary fetch body as empty, producing "Chunk data is
        // required." The 512 KiB binary payload remains safely below the limit
        // after base64 expansion and JSON overhead.
        let binary="";
        const step=0x8000;
        for(let i=0;i<bytes.length;i+=step){
          binary += String.fromCharCode(...bytes.subarray(i, Math.min(i+step, bytes.length)));
        }
        const data=btoa(binary);
        await api("/api/admin/upload/chunk", {
          method: "POST", timeoutMs: 55000, retryAttempts: 2, headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: init.uploadId, index, data })
        });
        sent += bytes.length;
        report(Math.min(98, Math.round(sent / Math.max(1, file.size) * 98)));
      }
      const done = await api("/api/admin/upload/complete", {
        method: "POST", timeoutMs: 55000, retryAttempts: 1, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: init.uploadId, parts: index })
      });
      report(100);
      return { ...done, contentType: done.contentType || contentType, size: file.size };
    }catch(err){
      throw err;
    }
  };
  /* ----------------------------------------------------------------
     Download tickets.

     The browser loads media itself (<img>, <video>, download anchors) and
     cannot attach an Authorization header, so file requests are authorised by
     a short-lived HttpOnly cookie that the server issues from the current API
     token. The API token itself is never placed in a URL: such URLs are kept
     in browser history, are copied whenever a link is shared, and are commonly
     written to access logs, yet they would grant full account access until
     they expired.
  ---------------------------------------------------------------- */
  const TICKET_REFRESH_MS = 20 * 60 * 1000;   // the cookie itself lasts 30 minutes
  let ticketIssuedAt = 0;
  let ticketInFlight = null;

  const ticketFresh = () => ticketIssuedAt > 0 && (Date.now() - ticketIssuedAt) < TICKET_REFRESH_MS;

  const ensureFileTicket = (force = false) => {
    if (!token()) return Promise.resolve(false);
    if (!force && ticketFresh()) return Promise.resolve(true);
    if (ticketInFlight) return ticketInFlight;
    ticketInFlight = once("/api/files/ticket", {
      method: "POST",
      credentials: "same-origin"
    }).then(r => {
      if (!r.ok) return false;
      ticketIssuedAt = Date.now();
      return true;
    }).catch(() => false).finally(() => { ticketInFlight = null; });
    return ticketInFlight;
  };

  const fileUrl = (url, opts = {}) => {
    if (!url) return "";
    // Fire-and-forget: the ticket is normally already valid, and any media
    // element that renders before the first ticket arrives is recovered by the
    // error handler below.
    ensureFileTicket();
    const u = new URL(url, location.origin);
    if (opts.inline) u.searchParams.set("inline", "1");
    return u.pathname + u.search;
  };

  // Re-issue the ticket and reload file media that failed while no valid ticket
  // was present, so a slow first load repairs itself.
  const refreshFileMedia = async () => {
    const ok = await ensureFileTicket(true);
    if (!ok) return;
    const selector = 'img[src*="/api/files/"], video[src*="/api/files/"], source[src*="/api/files/"]';
    for (const el of document.querySelectorAll(selector)) {
      const src = el.getAttribute("src");
      if (!src) continue;
      el.setAttribute("src", src.includes("?") ? `${src}&r=${Date.now()}` : `${src}?r=${Date.now()}`);
    }
  };

  if (token()) {
    ensureFileTicket();
    // Media load failures do not bubble, so listen during the capture phase.
    window.addEventListener("error", event => {
      const el = event && event.target;
      if (!el || !(el instanceof HTMLImageElement || el instanceof HTMLVideoElement)) return;
      if (!String(el.currentSrc || el.src || "").includes("/api/files/")) return;
      if (el.dataset.gbRetried === "1") return;
      el.dataset.gbRetried = "1";
      void refreshFileMedia();
    }, true);
  }

  const DL_DB = "gbMaterialDownloads";
  const DL_STORE = "handles";
  const openDownloadDb = () => new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("Persistent download tracking is not supported in this browser."));
    const req = indexedDB.open(DL_DB, 1);
    req.onupgradeneeded = () => { try { req.result.createObjectStore(DL_STORE); } catch {} };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("Unable to open download storage."));
  });
  const putDownloadHandle = async (key, handle) => {
    if (!key || !handle || !window.indexedDB) return false;
    try {
      const db = await openDownloadDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(DL_STORE, "readwrite");
        tx.objectStore(DL_STORE).put(handle, key);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
      });
      db.close();
      return true;
    } catch { return false; }
  };
  const getDownloadHandle = async key => {
    if (!key || !window.indexedDB) return null;
    try {
      const db = await openDownloadDb();
      const handle = await new Promise((resolve, reject) => {
        const tx = db.transaction(DL_STORE, "readonly");
        const req = tx.objectStore(DL_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return handle;
    } catch { return null; }
  };
  const materialDownloadExists = async key => {
    const handle = await getDownloadHandle(key);
    if (!handle) return false;
    try {
      const perm = handle.queryPermission ? await handle.queryPermission({ mode: "read" }) : "prompt";
      if (perm === "denied") return false;
      await handle.getFile();
      return true;
    } catch { return false; }
  };

  const download = async (url, fileName, onProgress, options = {}) => {
    if (!url) return { saved: false };
    const report = (value, label) => { try { if (typeof onProgress === "function") onProgress(Math.max(0, Math.min(100, Math.round(value))), label || ""); } catch {} };
    report(0, "Starting download…");

    // Ask for the save location while the original click still has user
    // activation. The resulting file handle is retained in IndexedDB only
    // after the complete download succeeds.
    let writable = null;
    let targetHandle = null;
    let persistent = false;
    const persistKey = String(options.persistKey || "");
    const directoryKey = String(options.directoryKey || "");
    if (options.persistent && persistKey && directoryKey && window.showDirectoryPicker) {
      let dir = await getDownloadHandle(directoryKey);
      try { if (dir && dir.queryPermission && await dir.queryPermission({ mode: "readwrite" }) === "denied") dir = null; } catch { dir = null; }
      if (!dir) {
        dir = await window.showDirectoryPicker({ mode: "readwrite" });
        await putDownloadHandle(directoryKey, dir);
      }
      targetHandle = await dir.getFileHandle(fileName || "download", { create: true });
      writable = await targetHandle.createWritable();
      persistent = true;
    } else if (options.persistent && persistKey && window.showSaveFilePicker) {
      const pickerTypes = (() => {
        const ext = extensionForFile(fileName, options.contentType || "application/octet-stream");
        const type = options.contentType && options.contentType !== "application/octet-stream" ? options.contentType : "";
        return type ? [{ description: "Material file", accept: { [type]: [ext] } }] : undefined;
      })();
      targetHandle = await window.showSaveFilePicker({ suggestedName: fileName || "download", types: pickerTypes });
      writable = await targetHandle.createWritable();
      persistent = true;
    }

    const ticketOk = await ensureFileTicket(true);
    if (!ticketOk) {
      if (writable) { try { await writable.abort(); } catch {} }
      throw new Error("Your session has expired. Please sign in again.");
    }
    const src = fileUrl(url, { inline: false });

    let total = 0;
    let type = "application/octet-stream";
    try {
      const head = await fetch(src, { method: "HEAD", credentials: "same-origin", cache: "no-store" });
      if (!head.ok) throw new Error(`File request failed (${head.status}).`);
      total = Number(head.headers.get("content-length") || 0);
      type = head.headers.get("content-type") || options.contentType || type;
      if (!total) {
        const probe = await fetch(src, { credentials: "same-origin", cache: "no-store", headers: { Range: "bytes=0-0" } });
        if (!probe.ok && probe.status !== 206) throw new Error(`File request failed (${probe.status}).`);
        const cr = probe.headers.get("content-range") || "";
        const match = cr.match(/\/([0-9]+)$/);
        total = match ? Number(match[1]) : 0;
      }
      if (!total) throw new Error("The file size could not be determined.");

      const CHUNK = 4 * 1024 * 1024;
      const parts = persistent ? null : [];
      report(0, "Downloading…");
      for (let start = 0; start < total; start += CHUNK) {
        const end = Math.min(total - 1, start + CHUNK - 1);
        const r = await fetch(src, { credentials: "same-origin", cache: "no-store", headers: { Range: `bytes=${start}-${end}` } });
        if (!r.ok && r.status !== 206) throw new Error(`File request failed (${r.status}).`);
        if (r.status !== 206 && total > CHUNK) throw new Error("The file server did not honour the range request.");
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!bytes.byteLength) throw new Error("The server returned an empty file chunk.");
        if (writable) await writable.write(bytes); else parts.push(bytes);
        const received = Math.min(total, start + bytes.byteLength);
        report(received / total * 100, `${Math.round(received / total * 100)}% downloaded`);
      }

      if (writable) {
        await writable.close();
        if (targetHandle && persistKey) await putDownloadHandle(persistKey, targetHandle);
        report(100, "Download complete");
        return { saved: true, persistent: true };
      }

      report(100, "Download complete");
      const blob = new Blob(parts, { type });
      const objectUrl = URL.createObjectURL(blob);
      try {
        const a = document.createElement("a");
        a.href = objectUrl; a.download = fileName || "download"; a.rel = "noopener";
        document.body.appendChild(a); a.click(); a.remove();
      } finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 1000); }
      return { saved: true, persistent: false };
    } catch (e) {
      if (writable) { try { await writable.abort(); } catch {} }
      throw e;
    }
  };

  // Fetch an authenticated stored file as a local Blob URL. This is used for
  // question images because browser <img src="/api/files/..."> loads can race
  // the download-ticket cookie or be handled differently by a gateway. The
  // client-side fetch path always sends the cookie and can use the same bounded
  // 4-MB ranges as downloads, so the image arrives reliably in the CBT.
  const fileBlobUrl = async (url, options = {}) => {
    if (!url) throw new Error("Question image URL is missing.");
    const ticketOk = await ensureFileTicket(true);
    if (!ticketOk) throw new Error("Your session has expired. Please sign in again.");
    const src = fileUrl(url, { inline: true });
    const head = await fetch(src, { method: "HEAD", credentials: "same-origin", cache: "no-store" });
    if (!head.ok) throw new Error(`Question image request failed (${head.status}).`);
    let total = Number(head.headers.get("content-length") || 0);
    const type = head.headers.get("content-type") || options.contentType || "application/octet-stream";
    const CHUNK = 4 * 1024 * 1024;
    const parts = [];
    if (!total) {
      const probe = await fetch(src, { credentials: "same-origin", cache: "no-store", headers: { Range: "bytes=0-0" } });
      if (!probe.ok && probe.status !== 206) throw new Error(`Question image request failed (${probe.status}).`);
      const cr = probe.headers.get("content-range") || "";
      const m = cr.match(/\/(\d+)$/);
      total = m ? Number(m[1]) : 0;
      if (total && probe.status === 206) parts.push(new Uint8Array(await probe.arrayBuffer()));
      else if (!total) parts.push(new Uint8Array(await probe.arrayBuffer()));
    }
    if (!total) {
      const r = await fetch(src, { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) throw new Error(`Question image request failed (${r.status}).`);
      return URL.createObjectURL(await r.blob());
    }
    let received = parts.length ? parts[0].byteLength : 0;
    for (let start = received; start < total; start += CHUNK) {
      const end = Math.min(total - 1, start + CHUNK - 1);
      const r = await fetch(src, { credentials: "same-origin", cache: "no-store", headers: { Range: `bytes=${start}-${end}` } });
      if (!r.ok && r.status !== 206) throw new Error(`Question image request failed (${r.status}).`);
      if (r.status !== 206 && total > CHUNK) throw new Error("The file server did not honour the image range request.");
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!bytes.byteLength) throw new Error("The server returned an empty question image.");
      parts.push(bytes);
      received += bytes.byteLength;
    }
    return URL.createObjectURL(new Blob(parts, { type }));
  };

  const extensionForFile = (name, type) => {
    const m = String(name || "").match(/(\.[A-Za-z0-9]{1,8})$/);
    if (m) return m[1];
    const map = { "application/pdf": ".pdf", "text/plain": ".txt", "application/zip": ".zip", "application/msword": ".doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx" };
    return map[String(type || "").toLowerCase()] || ".bin";
  };

  const del = url => api(url, { method: "DELETE" });

  return { api, esc, token, requireAuth, getSessionUser:()=>sessionUser || window.__GB_SESSION_USER || null, logout, upload, fileUrl, fileBlobUrl, download, materialDownloadExists, putDownloadHandle, del, health, ensureFileTicket, refreshFileMedia };
})();
