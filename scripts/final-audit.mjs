import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root=path.resolve(process.cwd());
const files=[];
function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.name==='node_modules'||ent.name.startsWith('.gifted-brainz-store'))continue;if(ent.isDirectory())walk(p);else files.push(p)}}
walk(root);
const js=files.filter(f=>f.endsWith('.js')&&/node-functions|public/.test(f));
for(const f of js){execFileSync(process.execPath,['--check',f],{stdio:'pipe'});}
const source=files.filter(f=>/\.(js|html|css|sql|md|txt)$/.test(f)).map(f=>[f,fs.readFileSync(f,'utf8')]);
const all=source.map(x=>x[1]).join('\n');
const failures=[];
if(/SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'`][^"'`]+/.test(all)) failures.push('Possible hard-coded Supabase service-role secret');
if(/GROQ_API_KEY\s*=\s*["'`][^"'`]+/.test(all)) failures.push('Possible hard-coded Groq key');
if(/localStorage\.(setItem|removeItem|getItem)\(\s*["'`][^"'`]*(token|auth|session)[^"'`]*["'`]/i.test(all)) failures.push('Authentication token/session appears to use localStorage');
if(/adminToken\([^)]*\).*localStorage/i.test(all)) failures.push('Admin token appears to be browser-persisted');
if(!/HttpOnly; Secure; SameSite=Lax/.test(all)) failures.push('Expected HttpOnly admin/student session cookie attributes not found');
if(!/public\.gb_kv/.test(all)||!/enable row level security/.test(all)) failures.push('Central gb_kv/RLS schema invariant not found');
if(!/New CBT Available/.test(all)||!/New Learning Material/.test(all)) failures.push('Publish notification messages missing');
if(!/Gifted Brainz EduSpace/.test(fs.readFileSync(path.join(root,'EMAIL_SENDER_SETUP_v11.9.12.md'),'utf8'))) failures.push('Password-reset sender documentation is not exact');
if(!/\/api\/admin\/health/.test(fs.readFileSync(path.join(root,'node-functions/lib/api-core.js'),'utf8'))) failures.push('Shared Admin backend health endpoint missing');
if(failures.length){console.error(failures.join('\n'));process.exit(1)}
console.log(`PASS: syntax ${js.length} JS files; security/config invariants verified; publish notification and shared-auth health checks present.`);
