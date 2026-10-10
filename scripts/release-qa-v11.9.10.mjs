import fs from 'node:fs'; import path from 'node:path';
const root=path.resolve(process.cwd());
const read=(p)=>fs.readFileSync(path.join(root,p),'utf8');
const core=read('node-functions/lib/api-core.js'); const ui=read('public/gb-ui.js'); const cbt=read('public/cbt.html'); const ai=read('public/ai.html'); const reset=read('public/reset.html'); const styles=read('public/styles.css'); const schema=read('supabase/schema.sql'); const admin=fs.readFileSync(path.resolve(root,'../admin/node-functions/api/[[default]].js'),'utf8');
const checks=[
 ['central Supabase store enforced',/Supabase Postgres is required for production data storage/.test(core)],
 ['RLS enabled',/enable row level security/.test(schema)],
 ['HttpOnly session cookie',/HttpOnly; Secure; SameSite=Lax/.test(core)],
 ['Admin health endpoint',/\/api\/admin\/health/.test(core)],
 ['server admin role check',/verifyToken\(bearer\(request\), "admin"\)/.test(core)],
 ['wrong linked-password rejection',/if \(authUserId\) return json\(\{ error: "Invalid username or password\." \}, 401\)/.test(core)],
 ['activation price',/ACTIVATION_PRICE_NAIRA = 3000/.test(core) && /Activate your account for ₦\$\{Number\(price\)\.toLocaleString\("en-NG"\)\}/.test(read('public/cbt.html')) && /Activate your account for ₦\$\{Number\(price\)\.toLocaleString\("en-NG"\)\}/.test(read('public/materials.html'))],
 ['publish notifications',/New CBT Available/.test(core)&&/New Learning Material/.test(core)],
 ['MathJax',/mathjax@3/.test(ui)&&/renderBody/.test(cbt)],
 ['AI central history',/\/api\/ai\/chats/.test(core)&&/\/api\/ai\/chats/.test(ai)],
 ['password recovery session',/auth\/v1\/user/.test(core)&&/access_token/.test(reset)],
 ['global serif typography',/Source Serif 4/.test(styles)&&/Times New Roman/.test(styles)],
 ['no auth local storage',!/(localStorage\.(setItem|getItem|removeItem)|sessionStorage\.(setItem|getItem|removeItem))[^\n]*(token|auth|session)/i.test(read('public/api.js'))],
 ['admin cookie/session',/gb_admin_session/.test(admin)&&/HttpOnly; Secure; SameSite=Lax/.test(admin)],
 ['current version',/11\.9\.10/.test(core)&&/11\.9\.10/.test(read('public/sw.js'))]
];
const bad=checks.filter(([,ok])=>!ok); if(bad.length){console.error(bad.map(([n])=>'FAIL: '+n).join('\n')); process.exit(1)} console.log('PASS: '+checks.length+' release invariants');
