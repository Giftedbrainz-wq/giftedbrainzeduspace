import fs from "node:fs";
import path from "node:path";
const root=process.cwd();
const required=["public/index.html", "public/login.html", "public/signup.html", "public/register.html", "node-functions/api/[[default]].js"];
const missing=required.filter(p=>!fs.existsSync(path.join(root,p)));
if(missing.length){console.error("Gifted Brainz deployment check failed. Missing:",missing.join(", "));process.exit(1);}
console.log("Gifted Brainz deployment check passed:",required.join(", "));
