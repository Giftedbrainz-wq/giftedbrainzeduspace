/* ------------------------------------------------------------------
   Gifted Brainz EduSpace — shared portal shell.

   Every student page includes this file. It renders the left-hand menu
   (each entry is an icon *plus its name*), the top bar, the mobile menu
   button, and the helpers used to display rich announcements, media and
   "Show more / Show less" lists.
------------------------------------------------------------------- */
window.GBUI = (() => {



  const SUBJECTS = ["Mathematics", "Use of English", "Physics", "Chemistry", "Biology"];
  const SUBJECT_ICONS = {
    "Mathematics": "➗", "Use of English": "📘", "Physics": "⚡",
    "Chemistry": "🧪", "Biology": "🌿"
  };

  const NAV_GROUPS = [
    { title: "Home", items: [
      { href: "/dashboard.html", icon: "🏠", label: "Dashboard", desc: "Your overview at a glance" }
    ]},
    { title: "Subjects", items: [
      { type: "dropdown", icon: "📚", label: "Subjects", desc: "Choose a subject to study", children: SUBJECTS.map(subject => ({
        href: `/materials.html?subject=${encodeURIComponent(subject)}`,
        icon: SUBJECT_ICONS[subject] || "📗",
        label: subject,
        desc: "Learning materials"
      })) }
    ]},
    { title: "Learn with AI", items: [
      { href: "/ai.html", icon: "🤖", label: "Gifted Brainz AI", desc: "Your personal learning assistant" }
    ]},
    { title: "Practice", items: [
      { href: "/cbt.html", icon: "🎯", label: "CBT Arena", desc: "Mock tests, Question Bank & practice" },
      { href: "/duel.html", icon: "⚔️", label: "1-v-1 Challenge", desc: "Compete head-to-head with another student" }
    ]},
    { title: "Learn", items: [
      { href: "/materials.html", icon: "📚", label: "Learning Materials", desc: "Notes and files by subject" },
      { href: "/announcements.html", icon: "📢", label: "Announcements", desc: "News from Gifted Brainz" },
      { href: "/notifications.html", icon: "🔔", label: "Notifications", desc: "Account, CBT and result updates" }
    ]},
    { title: "Progress", items: [
      { href: "/performance.html", icon: "📈", label: "My Performance", desc: "Scores, progress and corrections" },
      { href: "/leaderboards.html", icon: "🏆", label: "Leaderboards", desc: "Rankings overall and per subject" }
    ]},
    { title: "Support & Account", items: [
      { href: "/feedback.html", icon: "⭐", label: "Feedback & Rating", desc: "Rate the app and send complaints" },
      { href: "/help.html", icon: "🆘", label: "Help & Support", desc: "Talk to us on WhatsApp" },
      { href: "/account.html", icon: "👤", label: "My Account", desc: "Your profile and sign out" },
      { href: "/activation.html", icon: "🔓", label: "Account Activation", desc: "View price and activation status" }
    ]}
  ];
  const NAV = NAV_GROUPS.flatMap(group => group.items);
  const EMOJI = { home:"🏠", cbt:"🎯", materials:"📚", performance:"📈", leaderboard:"🏆", duel:"⚔️", set:"🧩", check:"✅", warning:"⚠️" };

  function setSubjects(rows){
    if(!Array.isArray(rows) || !rows.length) return;
    const clean=rows.map(r=>typeof r==="string"?{name:r,icon:"📘"}:{name:String(r?.name||"").trim(),icon:String(r?.icon||"📘")}).filter(r=>r.name);
    const unique=[...new Map(clean.map(r=>[r.name.toLowerCase(),r])).values()];
    if(!unique.length) return;
    SUBJECTS.splice(0,SUBJECTS.length,...unique.map(r=>r.name));
    Object.keys(SUBJECT_ICONS).forEach(k=>delete SUBJECT_ICONS[k]);
    unique.forEach(r=>SUBJECT_ICONS[r.name]=r.icon);
    const subjectGroup=NAV_GROUPS.find(g=>g.title==="Subjects");
    const item=subjectGroup?.items?.find(x=>x.type==="dropdown");
    if(item){
      item.children=SUBJECTS.map(subject=>({href:`/materials.html?subject=${encodeURIComponent(subject)}`,icon:SUBJECT_ICONS[subject]||"📗",label:subject,desc:"Learning materials"}));
    }
    window.dispatchEvent(new CustomEvent("gb:subjects-updated",{detail:unique}));
  }

  let subjectCatalogPromise=null;
  async function loadSubjectCatalog(){
    if(subjectCatalogPromise) return subjectCatalogPromise;
    subjectCatalogPromise=(async()=>{
      try{
        const rows=await GB?.api?.("/api/subjects");
        if(Array.isArray(rows) && rows.length) setSubjects(rows);
      }catch{}
      return SUBJECTS;
    })();
    try{return await subjectCatalogPromise;}
    finally{subjectCatalogPromise=null;}
  }

  function mySubjects(){
    const u = window.GB?.getSessionUser?.() || window.__GB_SESSION_USER || null;
    const selected = Array.isArray(u?.selectedSubjects) ? u.selectedSubjects.filter(s => SUBJECTS.includes(s)) : [];
    return selected.length ? [...new Set(selected)] : ["Use of English"];
  }

  const esc = v => String(v ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* ------------------------- channel promotion ------------------------ */
  const CHANNEL_URL = "https://whatsapp.com/channel/0029VbC1jX73QxRtsF3Kms3r";
  function channelBanner() {
    return `<a class="channel-banner" href="${CHANNEL_URL}" target="_blank" rel="noopener noreferrer">
      <span class="channel-icon">📱</span><span><b>Follow our WhatsApp Channel</b><small>Tap here — get announcements, updates &amp; learning alerts instantly ✅</small></span><span class="channel-arrow">↗</span>
    </a>`;
  }

  /* ----------------------------- the shell ----------------------------- */
  function shell(opts = {}) {
    const active = opts.active || location.pathname;
    const links = NAV_GROUPS.map(group => `
      <div class="nav-group">
        <div class="nav-group-title">${esc(group.title)}</div>
        ${group.items.map(item => {
          if (item.type === "dropdown" && Array.isArray(item.children)) {
            const childOn = item.children.some(child => location.pathname === "/materials.html" && new URLSearchParams(location.search).get("subject") === child.label);
            return `<div class="nav-dropdown${childOn ? " open-current" : ""}" data-nav-dropdown>
              <button class="nav-dropdown-toggle${childOn ? " active" : ""}" type="button" aria-expanded="${childOn ? "true" : "false"}" aria-controls="navSubjectsMenu">
                <span class="ic" aria-hidden="true">${item.icon}</span>
                <span class="nav-text"><span class="lbl">${esc(item.label)}</span><small>${esc(item.desc)}</small></span>
                <span class="nav-chevron" aria-hidden="true">⌄</span>
              </button>
              <div class="nav-dropdown-menu" id="navSubjectsMenu" ${childOn ? "" : "hidden"}>
                ${item.children.map(child => `<a href="${esc(child.href)}" class="nav-subitem${location.pathname === "/materials.html" && new URLSearchParams(location.search).get("subject") === child.label ? " active" : ""}" aria-label="${esc(child.label)} — ${esc(child.desc)}"><span class="ic" aria-hidden="true">${child.icon}</span><span class="nav-text"><span class="lbl">${esc(child.label)}</span><small>${esc(child.desc)}</small></span></a>`).join("")}
              </div>
            </div>`;
          }
          const on = item.href === active;
          return `<a class="${on ? "active" : ""}" href="${item.href}" aria-label="${esc(item.label)} — ${esc(item.desc)}" ${on ? 'aria-current="page"' : ""}>
            <span class="ic" aria-hidden="true">${item.icon}</span>
            <span class="nav-text"><span class="lbl">${esc(item.label)}</span><small>${esc(item.desc)}</small></span>
          </a>`;
        }).join("")}
      </div>`).join("");


    return `
    <button class="menu-toggle" id="menuToggle" type="button" aria-label="Open navigation menu" aria-controls="sidebar" aria-expanded="false">☰ Menu</button>
    <div class="scrim" id="scrim" hidden></div>
    <aside class="sidebar" id="sidebar">
      <a class="side-brand" href="/dashboard.html">
        <img class="logo-transparent" src="/assets/icon-light.png" alt="Gifted Brainz EduSpace">
        <span>Gifted Brainz<br><small>EduSpace</small></span>
      </a>
      <nav class="sidenav" aria-label="Main menu">${links}</nav>
      <div class="side-foot">Gifted Brainz EduSpace<br>No cramming, just understanding.</div>
    </aside>`;
  }

  function mount(opts = {}) {
    const host = document.getElementById("shell");
    if (!host) return;
    host.classList.add("shell");
    const main = host.querySelector(".main");
    host.insertAdjacentHTML("afterbegin", shell(opts));
    if (main) host.appendChild(main);
    const content = host.querySelector(".content");
    const redrawSubjectMenu = () => {
      const subjectMenu = document.querySelector("#navSubjectsMenu");
      if(!subjectMenu) return;
      const current = new URLSearchParams(location.search).get("subject") || "";
      subjectMenu.innerHTML = SUBJECTS.map(subject => `<a href="/materials.html?subject=${esc(subject)}" class="nav-subitem${current===subject?" active":""}" aria-label="${esc(subject)} — Learning materials"><span class="ic" aria-hidden="true">${SUBJECT_ICONS[subject]||"📗"}</span><span class="nav-text"><span class="lbl">${esc(subject)}</span><small>Learning materials</small></span></a>`).join("");
    };
    window.addEventListener("gb:subjects-updated",redrawSubjectMenu);

    // WhatsApp promotion belongs only on login/registration screens.
    // EduSpace pages should remain focused on learning content.
    void loadSubjectCatalog();

    const sidebar = document.getElementById("sidebar");
    const scrim = document.getElementById("scrim");
    const toggle = document.getElementById("menuToggle");
    const close = () => { sidebar.classList.remove("open"); scrim.hidden = true; };
    toggle?.addEventListener("click", () => {
      const open = !sidebar.classList.contains("open");
      sidebar.classList.toggle("open", open);
      scrim.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
      if (open) sidebar.querySelector("a")?.focus();
    });
    scrim?.addEventListener("click", close);
    sidebar?.addEventListener("click", e => { if (e.target.closest("a")) close(); });
    sidebar?.querySelectorAll("[data-nav-dropdown]").forEach(dropdown => {
      const btn = dropdown.querySelector(".nav-dropdown-toggle");
      const menu = dropdown.querySelector(".nav-dropdown-menu");
      btn?.addEventListener("click", e => {
        e.preventDefault();
        const open = menu?.hidden !== false;
        sidebar.querySelectorAll(".nav-dropdown-menu").forEach(m => { m.hidden = true; });
        sidebar.querySelectorAll(".nav-dropdown-toggle").forEach(b => b.setAttribute("aria-expanded", "false"));
        if (menu) menu.hidden = !open;
        btn.setAttribute("aria-expanded", String(open));
      });
    });
    addEventListener("keydown", e => { if (e.key === "Escape") close(); });

    const who = document.getElementById("who");
    if (who) {
      try {
        const u = window.__GB_SESSION_USER || null;
        if (u?.name) who.textContent = u.name;
      } catch {}
    }
    setTimeout(async()=>{
      try{ await window.GB?.requireAuth?.(); }catch{}
      notificationCenter(); syncGrantedDeviceNotifications();
    },0);
  }

  /* --------------------------- notifications --------------------------- */
  function pushBytes(value){
    const s=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
    const pad=s.length%4?"=".repeat(4-s.length%4):"";
    const raw=atob(s+pad); return Uint8Array.from(raw,c=>c.charCodeAt(0));
  }
  async function enableDeviceNotifications(){
    if(!("Notification" in window)||!("serviceWorker" in navigator)||!("PushManager" in window)) throw new Error("This browser does not support device notifications.");
    const permission=Notification.permission==="granted"?"granted":await Notification.requestPermission();
    if(permission!=="granted") throw new Error("Device notifications are blocked. Allow notifications for this site in your browser settings, then try again.");
    const reg=await navigator.serviceWorker.ready;
    const key=await GB.api("/api/push/public-key");
    let sub=await reg.pushManager.getSubscription();
    if(!sub) sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:pushBytes(key.publicKey)});
    const json=sub.toJSON();
    await GB.api("/api/push/subscribe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(json)});
    return true;
  }
  async function syncGrantedDeviceNotifications(){
    try{
      if(!window.__GB_SESSION_USER || !("Notification" in window) || Notification.permission!=="granted") return false;
      await enableDeviceNotifications();
      return true;
    }catch{return false}
  }
  function notificationCenter(){
    if(document.getElementById("gbNoticeButton")) return;
    const top=document.querySelector(".topbar-right");
    if(!top || !window.__GB_SESSION_USER) return;
    const wrap=document.createElement("div");
    wrap.style="position:relative;display:inline-flex";
    wrap.innerHTML=`<button class="btn light" id="gbNoticeButton" type="button" aria-label="Notifications" style="position:relative">🔔<span id="gbNoticeBadge" style="display:none;position:absolute;top:-5px;right:-5px;min-width:18px;height:18px;padding:0 4px;border-radius:20px;background:#b91c1c;color:#fff;font-size:.68rem;line-height:18px;font-weight:900"></span></button><div id="gbNoticePanel" hidden style="position:absolute;right:0;top:46px;width:min(360px,calc(100vw - 28px));max-height:420px;overflow:auto;background:#fff;border:1px solid rgba(8,45,99,.15);border-radius:16px;box-shadow:0 18px 45px rgba(0,0,0,.18);z-index:5000;padding:10px"></div>`;
    top.prepend(wrap);
    const button=wrap.querySelector("#gbNoticeButton"), panel=wrap.querySelector("#gbNoticePanel"), badge=wrap.querySelector("#gbNoticeBadge");
    let lastIds=new Set(); let first=true;
    function esc2(v){return esc(v)}
    function render(items){
      if(!items.length){panel.innerHTML='<div class="muted" style="padding:16px;text-align:center">No notifications yet.</div>';return}
      panel.innerHTML=`<div style="padding:4px 4px 8px;display:flex;justify-content:space-between;align-items:center"><b>Notifications</b>${("Notification" in window && Notification.permission!=="granted")?'<button type="button" id="gbEnableNotifications" class="btn light" style="font-size:.78rem">Enable device alerts</button>':''}</div>`+items.map(n=>`<button type="button" data-notice-id="${esc2(n.id)}" data-notice-url="${esc2(n.url||"/dashboard.html")}" style="display:block;width:100%;text-align:left;border:0;background:${n.read?'#fff':'#f2f7ff'};padding:12px;border-radius:12px;margin:0 0 6px;cursor:pointer"><b>${esc2(n.title||"Notification")}</b><span style="display:block;color:#425466;font-size:.86rem;margin-top:4px">${esc2(n.message||"")}</span><small style="display:block;color:#7b8794;margin-top:6px">${n.createdAt?new Date(n.createdAt).toLocaleString():""}</small></button>`).join("");
      panel.querySelector("#gbEnableNotifications")?.addEventListener("click",async e=>{e.stopPropagation();const b=e.currentTarget;b.disabled=true;b.textContent="Enabling…";try{await enableDeviceNotifications();b.textContent="Device alerts enabled ✓";await load()}catch(err){b.disabled=false;b.textContent="Enable device alerts";panel.insertAdjacentHTML("afterbegin",`<div class="error" style="padding:8px">${esc2(err.message)}</div>`)}});
    }
    async function load(){
      try{
        const x=await GB.api("/api/notifications"); const items=x.items||[];
        const unread=Number(x.unread)||0; badge.style.display=unread?"inline-block":"none"; if(unread)badge.textContent=unread>99?"99+":String(unread);
        for(const n of items){
          if(!first && !lastIds.has(String(n.id)) && n.type==="update" && "serviceWorker" in navigator){
            try{const reg=await navigator.serviceWorker.ready; await reg.showNotification(n.title||"Gifted Brainz update",{body:n.message||"A new update is available.",icon:"/assets/icon-192.png",badge:"/assets/icon-192.png",data:{url:n.url||"/login.html"}})}catch{}
          }
        }
        lastIds=new Set(items.map(n=>String(n.id))); first=false; render(items);
      }catch{}
    }
    button.addEventListener("click",async e=>{e.stopPropagation();panel.hidden=!panel.hidden;if(!panel.hidden){await load();const unread=(panel.querySelectorAll("button[data-notice-id]").length);if(unread)await GB.api("/api/notifications/read",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})}).catch(()=>{});await load()}});
    panel.addEventListener("click",async e=>{const item=e.target.closest("[data-notice-id]");if(!item)return;const id=item.dataset.noticeId,url=item.dataset.noticeUrl||"/dashboard.html";await GB.api("/api/notifications/read",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:[id]})}).catch(()=>{});location.href=url});
    load();setInterval(load,45000);
  }

  /* ------------------- safe rendering of rich content ------------------- */
  // The server already strips anything unsafe. This is the second line of
  // defence: the markup is rebuilt from an allow-list inside the browser too.
  const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "BR", "P", "DIV",
    "SPAN", "UL", "OL", "LI", "BLOCKQUOTE", "H1", "H2", "H3", "H4", "SUP", "SUB", "CODE", "PRE", "A", "IMG", "VIDEO", "AUDIO", "FIGURE", "FIGCAPTION"]);

  function safeHtml(html) {
    const src = document.createElement("div");
    src.innerHTML = String(html ?? "");
    const out = document.createElement("div");
    walk(src, out);
    return out.innerHTML;
  }

  function walk(from, to) {
    from.childNodes.forEach(node => {
      if (node.nodeType === 3) { to.appendChild(document.createTextNode(node.nodeValue)); return; }
      if (node.nodeType !== 1) return;
      if (!ALLOWED.has(node.tagName)) { walk(node, to); return; }
      const el = document.createElement(node.tagName.toLowerCase());
      if (node.tagName === "A") {
        const href = String(node.getAttribute("href") || "");
        if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(href)) { walk(node, to); return; }
        el.setAttribute("href", href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer nofollow");
      }
      if (["IMG","VIDEO","AUDIO"].includes(node.tagName)) {
        const src = String(node.getAttribute("src") || "");
        if (!/^\/api\/files\//.test(src)) { walk(node, to); return; }
        el.setAttribute("src", src);
        if (node.hasAttribute("alt")) el.setAttribute("alt", String(node.getAttribute("alt") || "").slice(0,200));
        if (node.hasAttribute("loading")) el.setAttribute("loading", "lazy");
        if (node.hasAttribute("controls")) el.setAttribute("controls", "");
        if (node.hasAttribute("playsinline")) el.setAttribute("playsinline", "");
        if (node.hasAttribute("preload")) el.setAttribute("preload", node.getAttribute("preload") === "none" ? "none" : "metadata");
        if (node.hasAttribute("type")) el.setAttribute("type", String(node.getAttribute("type") || "").slice(0,100));
      }
      walk(node, el);
      to.appendChild(el);
    });
  }

  // Older material was stored as plain text: keep the line breaks and make
  // any link inside it clickable, so nothing published before an update is lost.
  function textToHtml(text) {
    const escaped = esc(text);
    const linked = escaped.replace(/((?:(?:https?:\/\/|www\.)[^\s<]+|[a-z0-9.-]+\.(?:com|org|net|ng|edu|gov|co|uk)(?:\/[^\s<]*)?))/gi, url => {
      const clean = url.replace(/[).,;:!?]+$/, "");
      const tail = url.slice(clean.length);
      const href = /^(?:https?:\/\/)/i.test(clean) ? clean : "https://" + clean;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer nofollow">${clean}</a>${tail}`;
    });
    return linked.replace(/\n/g, "<br>");
  }

  function decodeDisplayEntities(value) {
    let out = String(value ?? "");
    for (let pass = 0; pass < 4; pass++) {
      const next = out
        .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_, n) => { const cp=Number(n); return Number.isInteger(cp) ? String.fromCodePoint(cp) : _; })
        .replace(/&#x([0-9a-f]+);/gi, (_, n) => { const cp=parseInt(n,16); return Number.isInteger(cp) ? String.fromCodePoint(cp) : _; });
      if (next === out) break;
      out = next;
    }
    return out;
  }

  function latexReady(value) {
    let out=decodeDisplayEntities(String(value ?? ""));
    // Providers sometimes JSON-escape TeX command slashes. Collapse exactly
    // the duplicated slash before a control word/delimiter; keep real TeX
    // matrix/aligned row breaks ("\\ " and "\\ &") intact.
    for (let pass = 0; pass < 3; pass++) {
      const next = out.replace(/\\\\(?=[A-Za-z\[\]\(\)\.\*\_\`\#\;\,\:\!])/g,"\\");
      if (next === out) break;
      out = next;
    }
    out=out.replace(/frac\(([^()]+)\)\(([^()]+)\)/g,"\\frac{$1}{$2}");
    out=out.replace(/sqrt\(([^()]+)\)/g,"\\sqrt{$1}");
    // \= is not a LaTeX operator; some providers emit it when trying to force a line.
    out=out.replace(/\\=/g,"=");
    return out;
  }
  let gbMathObserver=null;
  let gbMathFallbackUntil=0;
  let gbMathLoadPromise=null;

  function hasUnrenderedMath(root=document.body){
    if(!root) return false;
    const re=/(\\\[|\\\]|\\\(|\\\)|\$\$|\$[^$\n]+\$|\\(?:frac|dfrac|tfrac|sqrt|pm|mp|neq|ne|leq|geq|times|cdot|begin|end|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|int|oint|sum|prod|partial|nabla|infty|approx|propto|rightarrow|leftarrow|Leftrightarrow|Rightarrow|text|operatorname|log|ln|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|lim|det|gcd|binom|mathbb|mathbf|mathrm|mathcal|vec|hat|bar|overline|underline|overrightarrow)\b)/;
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    let node;
    while((node=walker.nextNode())){
      const parent=node.parentElement;
      if(parent && /^(SCRIPT|STYLE|TEXTAREA|PRE|CODE|MJX-CONTAINER|MJX-ASSISTIVE-MML)$/.test(parent.tagName)) continue;
      if(re.test(node.nodeValue||"")) return true;
    }
    return false;
  }

  function fallbackMathTextNodes(root=document.body){
    const re=/\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g;
    const walker=document.createTreeWalker(root||document.documentElement,NodeFilter.SHOW_TEXT);
    const nodes=[];
    let node;
    while((node=walker.nextNode())){
      const parent=node.parentElement;
      if(parent && /^(SCRIPT|STYLE|TEXTAREA|PRE|CODE|MJX-CONTAINER|MJX-ASSISTIVE-MML)$/.test(parent.tagName)) continue;
      const source=node.nodeValue||"";
      re.lastIndex=0;
      if(re.test(source) || /\\(?:frac|dfrac|tfrac|sqrt|pm|mp|neq|ne|leq|geq|times|cdot|begin|end|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega|int|oint|sum|prod|partial|nabla|infty|approx|propto|rightarrow|leftarrow|Leftrightarrow|Rightarrow|log|ln|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|lim|det|gcd|binom|mathbb|mathbf|mathrm|mathcal|vec|hat|bar|overline|underline|overrightarrow|text|operatorname)\b/.test(source)) nodes.push(node);
    }
    for(const textNode of nodes){
      const source=textNode.nodeValue||"";
      re.lastIndex=0;
      const hadDelimiters=re.test(source);
      re.lastIndex=0;
      textNode.nodeValue=hadDelimiters
        ? source.replace(re,(_,display,inline,dollars,plain)=>mathToPlainText(display??inline??dollars??plain??""))
        : mathToPlainText(source);
    }
  }

  /* MathJax's preferences are intentionally in-memory only. This prevents the
     third-party renderer from creating browser storage state; authentication and
     application data remain server-owned. */
  if(!window.GBMathJaxMemoryStorage){
    const values=new Map();
    window.GBMathJaxMemoryStorage=Object.freeze({
      getItem:key=>values.has(String(key))?values.get(String(key)):null,
      setItem:(key,value)=>{values.set(String(key),String(value));},
      removeItem:key=>{values.delete(String(key));}
    });
  }

  function ensureMathJax(){
    if(window.MathJax?.typesetPromise) return Promise.resolve(window.MathJax);
    if(gbMathLoadPromise) return gbMathLoadPromise;
    if(document.getElementById("gb-mathjax")){
      gbMathLoadPromise=Promise.reject(new Error("Math renderer did not initialize."));
      return gbMathLoadPromise;
    }
    window.MathJax={
      tex:{
        packages:{"[+]" : ["ams"]},
        inlineMath:[["\\(","\\)"],["$","$"]],
        displayMath:[["\\[","\\]"],["$$","$$"]],
        processEscapes:true,
        processEnvironments:true
      },
      options:{skipHtmlTags:["script","noscript","style","textarea","pre","code"]},
      chtml:{fontURL:"/vendor/mathjax/output/chtml/fonts/woff-v2"},
      startup:{typeset:false}
    };
    const sc=document.createElement("script");
    sc.id="gb-mathjax";
    sc.async=true;
    sc.src="/vendor/mathjax/tex-mml-chtml.js";
    gbMathLoadPromise=new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(ok,error)=>{
        if(settled)return;
        settled=true;
        clearTimeout(window.__gbMathLoadTimer);
        if(ok){
          resolve(window.MathJax);
        }else{
          gbMathLoadPromise=null;
          sc.remove();
          try{delete window.MathJax;}catch{}
          reject(error||new Error("Math renderer failed to load."));
        }
      };
      window.__gbMathLoadTimer=setTimeout(()=>finish(false,new Error("Math renderer timed out.")),5000);
      sc.onerror=()=>finish(false,new Error("Math renderer failed to load."));
      sc.onload=()=>{
        try{
          const ready=window.MathJax?.startup?.promise;
          Promise.resolve(ready).then(()=>finish(true),err=>finish(false,err));
        }catch(err){ finish(false,err); }
      };
    });
    document.head.appendChild(sc);
    return gbMathLoadPromise;
  }

  async function typesetMath(){
    if(Date.now()<gbMathFallbackUntil){
      fallbackMathTextNodes();
      return;
    }
    gbMathObserver?.disconnect();
    try{
      await ensureMathJax();
      if(!window.MathJax?.typesetPromise) throw new Error("Math renderer unavailable.");
      await window.MathJax.typesetPromise();
      if(hasUnrenderedMath(document.body)){
        fallbackMathTextNodes();
        gbMathFallbackUntil=Date.now()+15000;
      }else{
        gbMathFallbackUntil=0;
      }
    }catch{
      fallbackMathTextNodes();
      gbMathFallbackUntil=Date.now()+15000;
    }finally{
      if(document.documentElement){
        gbMathObserver?.observe(document.documentElement,{subtree:true,childList:true});
      }
    }
  }

  function unescapeMarkdownPunctuationOutsideMath(value) {
    const s=String(value??""); let out="", mode="", i=0;
    while(i<s.length){
      if(!mode && s.startsWith("\\(",i)){mode="paren";out+="\\(";i+=2;continue;}
      if(!mode && s.startsWith("\\[",i)){mode="bracket";out+="\\[";i+=2;continue;}
      if(!mode && s.startsWith("$$",i)){mode="double";out+="$$";i+=2;continue;}
      if(!mode && s[i]==="$"){mode="single";out+="$";i++;continue;}
      if(mode==="paren" && s.startsWith("\\)",i)){mode="";out+="\\)";i+=2;continue;}
      if(mode==="bracket" && s.startsWith("\\]",i)){mode="";out+="\\]";i+=2;continue;}
      if(mode==="double" && s.startsWith("$$",i)){mode="";out+="$$";i+=2;continue;}
      if(mode==="single" && s[i]==="$" && s[i-1]!=="\\"){mode="";out+="$";i++;continue;}
      if(!mode && s[i]==="\\" && ".*_`#".includes(s[i+1]||"")){out+=s[i+1];i+=2;continue;}
      out+=s[i++];
    }
    return out;
  }

  function extractMathSegments(value){
    const s=String(value??"");
    const segments=[];
    let text="", i=0;
    const addText=x=>{ text+=x; };
    while(i<s.length){
      let start=-1, kind="", close="", env="";
      const candidates=[
        [s.indexOf("\\[",i),"display","\\]"],
        [s.indexOf("\\(",i),"inline","\\)"],
        [s.indexOf("$$",i),"double","$$"],
        [s.indexOf("$",i),"single","$"]
      ].filter(x=>x[0]>=0).sort((a,b)=>a[0]-b[0]);
      const begin=s.indexOf("\\begin{",i);
      if(begin>=0 && (!candidates.length || begin<candidates[0][0])){
        const m=/\\begin\{([^{}]+)\}/.exec(s.slice(begin));
        if(m){
          start=begin; kind="environment"; env=m[1]; close=`\\end{${env}}`;
        }
      }else if(candidates.length){
        [start,kind,close]=candidates[0];
        if(kind==="single" && s[start-1]==="\\"){ addText(s.slice(i,start+1)); i=start+1; continue; }
      }
      if(start<0){ addText(s.slice(i)); break; }
      addText(s.slice(i,start));
      let end=-1;
      if(kind==="environment") end=s.indexOf(close,start);
      else {
        let pos=start+close.length;
        while(pos<s.length){
          const found=s.indexOf(close,pos);
          if(found<0) break;
          let slashes=0; for(let k=found-1;k>=0&&s[k]==="\\";k--)slashes++;
          if(slashes%2===0){end=found;break;}
          pos=found+close.length;
        }
      }
      if(end<0){ addText(s.slice(start)); break; }
      const full=s.slice(start,end+close.length);
      const token=`@@GB_MATH_${segments.length}@@`;
      segments.push(full);
      text+=token;
      i=end+close.length;
    }
    return {text,segments};
  }

  // Converts GitHub-style Markdown pipe tables ("| a | b |" rows with a
  // "|---|---|" separator row) into a real, scrollable <table>. Without this,
  // AI-generated comparison/classification/summary tables show up as raw
  // "| ... | ... |" source text instead of a rendered table.
  function isTableSeparatorLine(line){
    const cells=line.trim().replace(/^\||\|$/g,"").split("|");
    return cells.length>0 && cells.every(c=>/^\s*:?-{3,}:?\s*$/.test(c)||/^\s*:?-+:?\s*$/.test(c));
  }
  function splitTableRow(line){
    return line.trim().replace(/^\||\|$/g,"").split("|").map(c=>c.trim());
  }
  function extractMarkdownTables(value){
    const lines=value.split("\n");
    const out=[];
    const tables=[];
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      const next=lines[i+1];
      if(typeof next==="string" && line.includes("|") && isTableSeparatorLine(next) && splitTableRow(next).length>=1){
        const header=splitTableRow(line);
        const rows=[];
        let j=i+2;
        while(j<lines.length && lines[j].trim() && lines[j].includes("|")){
          rows.push(splitTableRow(lines[j]));
          j++;
        }
        const token=`@@GB_TABLE_${tables.length}@@`;
        const theadHtml=`<tr>${header.map(c=>`<th>${esc(c)}</th>`).join("")}</tr>`;
        const tbodyHtml=rows.map(r=>`<tr>${header.map((_,k)=>`<td>${esc(r[k]||"")}</td>`).join("")}</tr>`).join("");
        tables.push(`<div class="gb-table-wrap"><table class="gb-table"><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table></div>`);
        out.push(token);
        i=j-1;
      } else {
        out.push(line);
      }
    }
    return {text:out.join("\n"),tables};
  }

  function markdownTextToHtml(value) {
    const raw=latexReady(value);
    if(!raw.trim()) return "";
    // Protect complete math expressions before HTML escaping and Markdown
    // conversion. This is critical: converting newlines inside \[...\] to
    // <br> splits the expression across DOM text nodes, so MathJax can no
    // longer see the opening and closing delimiters together.
    const {text:tablelessText,tables}=extractMarkdownTables(raw);
    const {text:protectedText,segments}=extractMathSegments(tablelessText);
    let out=esc(protectedText);
    out=unescapeMarkdownPunctuationOutsideMath(out);
    const code=[];
    out=out.replace(/`([^`\n]+)`/g,(_,x)=>{const i=code.push(`<code>${x}</code>`)-1;return `@@GB_CODE_${i}@@`;});
    out=out.replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>");
    out=out.replace(/__([^_\n]+)__/g,"<strong>$1</strong>");
    out=out.replace(/~~([^~\n]+)~~/g,"<s>$1</s>");
    out=out.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g,"<em>$1</em>");
    out=out.replace(/(?<![\w_])_([^_\n]+)_(?![\w_])/g,"<em>$1</em>");
    out=out.replace(/^###\s+(.+)$/gm,"<h3>$1</h3>");
    out=out.replace(/^##\s+(.+)$/gm,"<h2>$1</h2>");
    out=out.replace(/^#\s+(.+)$/gm,"<h1>$1</h1>");
    out=out.replace(/(?:^|<br>)\s*(\d+)[.)]\s+([^<\n]+)/g,(m,n,item)=>`<br><li>${n}. ${item}</li>`);
    out=out.replace(/(?:^|<br>)\s*[-*]\s+([^<\n][^\n]*)/g,(m,item)=>`<br><li>${item}</li>`);
    out=out.replace(/(?:<br><li>.*?<\/li>)+/gs,block=>`<ul>${block.replace(/<br>/g,"")}</ul>`);
    // Convert line breaks only outside protected math tokens.
    out=out.replace(/\n/g,"<br>");
    code.forEach((v,i)=>{out=out.replace(`@@GB_CODE_${i}@@`,v);});
    segments.forEach((math,i)=>{out=out.replace(`@@GB_MATH_${i}@@`,esc(math));});
    tables.forEach((tbl,i)=>{out=out.replace(`<br>@@GB_TABLE_${i}@@<br>`,tbl).replace(`@@GB_TABLE_${i}@@`,tbl);});
    return out;
  }
  function renderBody(value, format) {
    const raw = latexReady(value);
    if (!raw.trim()) return "";
    // Embedded note media is stored as a safe data-gb-file key. Resolve the
    // authenticated file URL at render time so a note never stores an expiring
    // token inside its HTML.
    const mediaReady = raw.replace(/<(img|video|audio)\b([^>]*?)data-gb-file=["']([^"']+)["']([^>]*)>/gi, (all, tag, before, key, after) => {
      const src = GB.fileUrl(`/api/files/${encodeURIComponent(key)}`, { inline: true });
      return `<${tag}${before} src="${esc(src)}"${after}>`;
    });
    if (format === "html" || /<(a|b|i|u|p|div|br|ul|ol|li|strong|em|img|video|audio)\b/i.test(mediaReady)) return safeHtml(mediaReady);
    return safeHtml(markdownTextToHtml(mediaReady));
  }

  /* ---------------------------- media & files --------------------------- */
  function kindOf(f) {
    if (f.kind) return f.kind;
    const t = String(f.contentType || "").toLowerCase(), n = String(f.fileName || "").toLowerCase();
    if (t.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return "image";
    if (t.startsWith("video/") || /\.(mp4|webm|ogv|mov|m4v)$/.test(n)) return "video";
    if (t.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac)$/.test(n)) return "audio";
    if (t === "application/pdf" || /\.pdf$/.test(n)) return "pdf";
    if (t.startsWith("text/") || /\.(txt|md|csv|json)$/.test(n)) return "text";
    return "file";
  }

  const ICON_FOR = { image: "🖼️", video: "🎬", audio: "🎧", pdf: "📄", text: "📃", file: "📎" };

  // Pictures and videos are shown inline; every other type gets a
  // File attachments are download-only in learning materials.
  function media(list) {
    if (!Array.isArray(list) || !list.length) return "";
    return `<div class="media-grid">` + list.map(f => {
      const url = GB.fileUrl(f.url, { inline: true });
      const kind = kindOf(f);
      if (kind === "image") return `<figure class="media"><a href="${esc(url)}" target="_blank" rel="noopener"><img loading="lazy" src="${esc(url)}" alt="${esc(f.fileName || "Announcement picture")}"></a><figcaption>${esc(f.fileName || "")}</figcaption></figure>`;
      if (kind === "video") return `<figure class="media"><video controls playsinline preload="metadata" src="${esc(url)}" type="${esc(f.contentType||"video/mp4")}"></video><figcaption>${esc(f.fileName || "")}</figcaption><a class="muted" href="${esc(url)}" target="_blank" rel="noopener">Open video separately</a></figure>`;
      if (kind === "audio") return `<figure class="media"><audio controls preload="metadata" src="${esc(url)}"></audio><figcaption>${esc(f.fileName || "")}</figcaption></figure>`;
      return fileRow(f);
    }).join("") + `</div>`;
  }

  function fileRow(f) {
    const kind = kindOf(f);
    return `<div class="filerow"><span class="fic">${ICON_FOR[kind] || "📎"}</span>
      <span class="fname">${esc(f.fileName || "Attachment")}</span>
      <span class="factions">
        <button class="btn gold" type="button" data-download-file="${esc(f.url)}" data-download-name="${esc(f.fileName || "")}">Download</button>
      </span></div>`;
  }

  function files(list) {
    if (!Array.isArray(list) || !list.length) return "";
    return `<div class="filelist">${list.map(fileRow).join("")}</div>`;
  }

  /* -------------------------- show more / less -------------------------- */
  // Any list longer than the limit collapses, with a Show more / Show less
  // control so a busy subject never crowds the screen.
  const LIMIT = 5;
  // Preserve Show more / Show less state when a page re-renders its list.
  // Materials, for example, refreshes download status periodically; without
  // this state map every refresh would collapse an open list again.
  const moreState = new Map();
  function collapsible(id, cards, limit = LIMIT) {
    if (!cards.length) { moreState.delete(id); return `<p class="muted">Nothing here yet.</p>`; }
    const head = cards.slice(0, limit).join("");
    if (cards.length <= limit) { moreState.delete(id); return `<div class="list">${head}</div>`; }
    const rest = cards.slice(limit).join("");
    const open = moreState.get(id) === true;
    return `<div class="list">${head}<div class="list more" id="${id}" ${open ? "" : "hidden"}>${rest}</div></div>
      <button class="btn light showmore" type="button" data-more="${id}">${open ? "▴ Show less" : `▾ Show more (${cards.length - limit} more)`}</button>`;
  }

  function showDownloadProgress(name, pct=0) {
    let modal=document.getElementById("gbDownloadProgress");
    if(!modal){
      modal=document.createElement("div"); modal.id="gbDownloadProgress"; modal.className="modal";
      modal.innerHTML=`<div class="modal-box"><div class="section-head"><h2>Downloading material</h2><span id="gbDownloadPct">0%</span></div><p id="gbDownloadName" class="muted"></p><div class="progress" aria-label="Download progress"><i id="gbDownloadBar" style="width:0%"></i></div><p id="gbDownloadStatus" class="muted">Starting download…</p></div>`;
      document.body.appendChild(modal);
    }
    modal.hidden=false; document.body.classList.add("noscroll");
    modal.querySelector("#gbDownloadName").textContent=name; updateDownloadProgress(pct);
  }
  function updateDownloadProgress(pct, label) {
    const modal=document.getElementById("gbDownloadProgress"); if(!modal) return;
    const n=Math.max(0,Math.min(100,Math.round(Number(pct)||0)));
    modal.querySelector("#gbDownloadPct").textContent=`${n}%`;
    modal.querySelector("#gbDownloadBar").style.width=`${n}%`;
    if(label) modal.querySelector("#gbDownloadStatus").textContent=label;
  }
  function finishDownloadProgress(ok, message) {
    const modal=document.getElementById("gbDownloadProgress"); if(!modal) return;
    updateDownloadProgress(ok ? 100 : Number(modal.querySelector("#gbDownloadPct").textContent.replace("%","")) || 0, ok ? "Download complete." : message);
    if(ok) setTimeout(()=>{ modal.hidden=true; document.body.classList.remove("noscroll"); }, 700);
  }

  document.addEventListener("click", e => {
    const dl = e.target.closest("[data-download-file]");
    if (dl) {
      e.preventDefault();
      showDownloadProgress(dl.dataset.downloadName || "Download", pct => updateDownloadProgress(pct));
      GB.download(dl.dataset.downloadFile, dl.dataset.downloadName || "", (pct, label) => updateDownloadProgress(pct, label))
        .then(() => finishDownloadProgress(true))
        .catch(err => finishDownloadProgress(false, err?.message || "Download failed."));
      return;
    }
    const b = e.target.closest("[data-more]");
    if (!b) return;
    const box = document.getElementById(b.dataset.more);
    if (!box) return;
    const open = box.hidden;
    box.hidden = !open;
    moreState.set(b.dataset.more, open);
    b.textContent = open ? "▴ Show less" : `▾ Show more (${box.children.length} more)`;
  });

  function confirmAction(title, message, proceedLabel="Yes, proceed", options={}) {
    const requirePhrase=String(options.requirePhrase||"").trim();
    return new Promise(resolve => {
      const modal=document.createElement("div"); modal.className="modal critical-modal";
      const phraseHtml=requirePhrase?`<div class="field" style="margin-top:12px"><label>Safety confirmation</label><input id="criticalPhrase" type="text" autocomplete="off" spellcheck="false" placeholder="Type ${esc(requirePhrase)} to confirm" aria-describedby="criticalPhraseHelp"><small id="criticalPhraseHelp" class="muted">This extra step helps prevent accidental destructive actions.</small></div>`:"";
      modal.innerHTML=`<div class="modal-box critical-box" role="dialog" aria-modal="true" aria-labelledby="criticalTitle"><div class="section-head"><h2 id="criticalTitle">${esc(title)}</h2><button type="button" class="btn light" data-cancel aria-label="Cancel">✕</button></div><p>${esc(message)}</p>${phraseHtml}<div class="factions" style="justify-content:flex-end"><button class="btn light" type="button" data-cancel>Cancel</button><button class="btn danger" type="button" data-proceed ${requirePhrase?'disabled':''}>${esc(proceedLabel)}</button></div></div>`;
      document.body.appendChild(modal); document.body.classList.add("noscroll");
      const proceed=modal.querySelector("[data-proceed]"), input=modal.querySelector("#criticalPhrase");
      const finish=v=>{modal.remove();document.body.classList.remove("noscroll");resolve(v)};
      if(input){ input.addEventListener("input",()=>{proceed.disabled=input.value.trim()!==requirePhrase}); setTimeout(()=>input.focus(),0); }
      else setTimeout(()=>proceed?.focus(),0);
      modal.addEventListener("click",e=>{
        if(e.target===modal||e.target.closest("[data-cancel]"))finish(false);
        else if(e.target.closest("[data-proceed]") && !proceed.disabled)finish(true);
      });
    });
  }

  function unsavedGuard() {
    let dirty=false;
    const mark=()=>{dirty=true}; const clear=()=>{dirty=false};
    addEventListener("beforeunload",e=>{if(!dirty)return;e.preventDefault();e.returnValue=""});
    return {mark,clear};
  }

  /* ------------------------- grading (score bands) ---------------------- */
  // One place decides the colour, the word, the remark and the emoji so the
  // dashboard, the CBT results page, performance and the admin views agree.
  const BANDS = [
    { min: 0,  max: 39,  band: "red",    word: "Needs work", colour: "#b3261e", soft: "#fdeceb", ink: "#8a1b13",
      emoji: "💪", remark: "Don't be discouraged, you just need work" },
    { min: 40, max: 59,  band: "orange", word: "Fair",       colour: "#e08a00", soft: "#fff3e0", ink: "#8a5000",
      emoji: "🙂", remark: "Fair enough. There is room for improvement" },
    { min: 60, max: 79,  band: "green",  word: "Good",       colour: "#067647", soft: "#e7f6ee", ink: "#04502f",
      emoji: "👍", remark: "Nice attempt. You can do better" },
    { min: 80, max: 100, band: "blue",   word: "Excellent",  colour: "#1454b8", soft: "#e8f0fe", ink: "#123a6b",
      emoji: "🌟", remark: "Excellent. Keep it up" }
  ];

  function GRADE(score) {
    const n = Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
    const b = BANDS.find(x => n >= x.min && n <= x.max) || BANDS[0];
    return { ...b, score: n, text: `${b.remark} ${b.emoji}` };
  }

  // Circular score meter used on the results screen (matches the design).
  function scoreDonut(percent, size = 168) {
    const g = GRADE(percent);
    const r = 52, c = 2 * Math.PI * r, off = c * (1 - g.score / 100);
    return `<svg class="donut" viewBox="0 0 130 130" width="${size}" height="${size}" role="img" aria-label="Score ${g.score} percent">
      <circle class="track" cx="65" cy="65" r="${r}"></circle>
      <circle class="bar score-animated" cx="65" cy="65" r="${r}" stroke="${g.colour}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"></circle>
      <text x="65" y="73" text-anchor="middle" fill="${g.colour}">${g.score}%</text>
    </svg>`;
  }

  function stars(rating, big = false) {
    const n = Math.round(Number(rating) || 0);
    return `<span class="rating-stars${big ? " big" : ""}" aria-label="${n} out of 5 stars">${"★".repeat(Math.min(5, n))}${"☆".repeat(Math.max(0, 5 - n))}</span>`;
  }

  function mathToPlainText(value) {
    let s = latexReady(value).replace(/\\\[|\\\]|\\\(|\\\)|\$\$/g,"");
    // Resolve nested structural expressions from the inside out before any
    // generic command stripping. This preserves cases such as \frac{-b\pm\sqrt{b^2-4ac}}{2a}.
    for (let pass = 0; pass < 6; pass++) {
      const next = s
        .replace(/\\sqrt\s*\[(\d+)\]\s*\{([^{}]*)\}/g, (_, n, x) => n === "3" ? `∛(${x})` : `${n}√(${x})`)
        .replace(/\\sqrt\s*\{([^{}]*)\}/g, "√($1)")
        .replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)");
      if (next === s) break;
      s = next;
    }
    s = s.replace(/\\text\s*\{([^{}]*)\}/g, "$1");
    s = s.replace(/\\(?:left|right)\b/g, "");
    s = s.replace(/\\(?:!|,|;|:|quad|qquad)\b/g, " ");
    s = s.replace(/\\begin\{(?:bmatrix|pmatrix|matrix|Bmatrix|vmatrix|Vmatrix)\}/g, "[");
    s = s.replace(/\\end\{(?:bmatrix|pmatrix|matrix|Bmatrix|vmatrix|Vmatrix)\}/g, "]");
    s = s.replace(/\^+\{([^{}]*)\}/g, "^$1").replace(/_+\{([^{}]*)\}/g, "_$1");
    s = s.replace(/\{([^{}]*)\}/g, "$1");
    s = s.replace(/\\\\/g, "; ").replace(/&/g, " ");
    const greek = {alpha:"α",beta:"β",gamma:"γ",delta:"δ",epsilon:"ε",theta:"θ",lambda:"λ",mu:"μ",pi:"π",sigma:"σ",phi:"φ",omega:"ω",Delta:"Δ",Gamma:"Γ",Lambda:"Λ",Sigma:"Σ",Phi:"Φ",Omega:"Ω"};
    const symbols = {
      pm:"±",mp:"∓",neq:"≠",ne:"≠",le:"≤",leq:"≤",ge:"≥",geq:"≥",
      times:"×",cdot:"·",div:"÷",approx:"≈",propto:"∝",infty:"∞",
      int:"∫",oint:"∮",sum:"Σ",prod:"Π",partial:"∂",nabla:"∇",
      forall:"∀",exists:"∃",rightarrow:"→",leftarrow:"←",Rightarrow:"⇒",
      Leftarrow:"⇐",leftrightarrow:"↔",Leftrightarrow:"⇔",to:"→",
      ast:"*",cdots:"…",ldots:"…",dots:"…",degree:"°"
    };
    s = s.replace(/\\([A-Za-z]+)(?![A-Za-z])/g, (_, name) => greek[name] || symbols[name] || name);
    s = s.replace(/\\([A-Za-z])/g, "$1");
    return s.replace(/\\/g,"").replace(/[ \t]+/g," ").replace(/\n\s*\n\s*\n+/g,"\n\n").trim();
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",ensureMathJax,{once:true}); else ensureMathJax();
  gbMathObserver=new MutationObserver(()=>{clearTimeout(window.__gbMathTimer);window.__gbMathTimer=setTimeout(typesetMath,80)});
  gbMathObserver.observe(document.documentElement,{subtree:true,childList:true});
  return { NAV, SUBJECTS, SUBJECT_ICONS, EMOJI, setSubjects, loadSubjectCatalog, mySubjects, esc, mount, safeHtml, textToHtml, latexReady, markdownTextToHtml, renderBody, mathToPlainText, typesetMath, media, files, fileRow, kindOf, collapsible, confirmAction, unsavedGuard, CHANNEL_URL, GRADE, scoreDonut, stars, showDownloadProgress, updateDownloadProgress, finishDownloadProgress, enableDeviceNotifications, syncGrantedDeviceNotifications };
})();
