import fs from 'fs';
import path from 'path';
const dbFile = path.join(process.cwd(), 'data/db.json');
const db = JSON.parse(fs.readFileSync(dbFile, 'utf-8'));
const projectId = db.siteConfig?.gitcodeProjectId;
const token = db.siteConfig?.gitcodeToken;
const headers = {};
if (token) headers['PRIVATE-TOKEN'] = token;

async function test() {
  const url = `https://api.gitcode.com/api/v5/repos/${projectId}/repository/tree?recursive=true`;
  console.log('Fetching:', url);
  const res = await fetch(url, { headers });
  console.log('Status:', res.status);
  if (!res.ok) { console.log(await res.text()); return; }
  const data = await res.json();
  console.log('Data length:', data.length);
  if (data.length > 0) {
    console.log('Sample:', data.find(f => f.path && (f.path.includes('.png') || f.path.includes('.jpg'))));
  }
}
test();
