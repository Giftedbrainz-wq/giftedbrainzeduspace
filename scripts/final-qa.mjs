import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const mustContain = [
  ['node-functions/lib/api-core.js', 'AsyncLocalStorage'],
  ['node-functions/lib/api-core.js', 'DATA_CACHE_TTL_MS = 1000'],
  ['node-functions/lib/api-core.js', 'studentName'],
  ['node-functions/lib/api-core.js', 'releaseUserUniqueKeys'],
  ['node-functions/lib/api-core.js', 'whatsapp'],
  ['public/register.html', 'id="whatsapp"'],
  ['public/ai.html', 'api/ai/tutor'],
  ['public/index.html', 'Gifted Brainz EduSpace'],
  ['scripts/load-test.mjs', 'requests'],
];
let failures = 0;
for (const [file, needle] of mustContain) {
  const full = path.join(root, file);
  const ok = fs.readFileSync(full, 'utf8').includes(needle);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file} :: ${needle}`);
  if (!ok) failures++;
}
for (const file of ['node-functions/lib/api-core.js','node-functions/api/index.js','node-functions/api/[[default]].js','node-functions/api/ping.js','scripts/load-test.mjs']) {
  const full = path.join(root,file);
  const text = fs.readFileSync(full,'utf8');
  if (/REQUEST_ENV\s*=|REQUEST_CLIENT_IP\s*=|globalThis\.__gbEnv\s*=|globalThis\.__gbClientIp\s*=/.test(text)) {
    console.log(`FAIL request-global-state ${file}`); failures++;
  } else console.log(`PASS request-global-state ${file}`);
}
const zipSafe = !fs.existsSync(path.join(root,'.env'));
console.log(`${zipSafe?'PASS':'FAIL'} no .env committed in package`); if(!zipSafe) failures++;
process.exit(failures ? 1 : 0);
