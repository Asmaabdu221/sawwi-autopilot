#!/usr/bin/env node
/**
 * يجهّز ملفات n8n للاستيراد: يحقن معرّف جدولك ومعرّف تيليجرامك ومعرّفات اعتماداتك.
 *
 * التشغيل:  node scripts/prepare-workflows.mjs
 * المخرَج :  workflows/ready/*.json  ← استوردها في n8n
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const WF = join(ROOT, 'workflows');
const OUT = join(WF, 'ready');

const cfgPath = join(HERE, 'config.json');
if (!existsSync(cfgPath)) {
  console.error('❌ لم أجد scripts/config.json — شغّل:  node setup.mjs');
  process.exit(1);
}
const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));

const missing = [];
if (!cfg.sheetId) missing.push('sheetId — معرّف جدول Google (من رابط الجدول)');
if (!cfg.telegramChatId) missing.push('telegramChatId — من @userinfobot (اختياري)');
if (missing.length) {
  console.log('⚠️  ناقص في config.json:');
  for (const m of missing) console.log('   ·', m);
  if (!cfg.sheetId) { console.log('\nمعرّف الجدول إجباري. أضفه ثم أعد التشغيل.'); process.exit(1); }
}

// ── قراءة معرّفات الاعتمادات من n8n ──
const dockerExec = (args) => new Promise((res) => {
  execFile('docker', args, { timeout: 60000, windowsHide: true }, (e, out) => res(e ? null : String(out)));
});

async function readCredentialIds() {
  const container = cfg.n8nContainer || 'sawwi-n8n';
  const exp = await dockerExec(['exec', container, 'n8n', 'export:credentials', '--all', '--output=/tmp/c.json']);
  if (exp === null) return null;
  const out = await dockerExec(['exec', container, 'node', '-e',
    'const c=JSON.parse(require("fs").readFileSync("/tmp/c.json","utf8"));console.log(JSON.stringify(c.map(x=>({id:x.id,name:x.name,type:x.type}))))']);
  await dockerExec(['exec', '-u', 'root', container, 'rm', '-f', '/tmp/c.json']);
  if (!out) return null;
  try { return JSON.parse(out.trim().split('\n').pop()); } catch { return null; }
}

const creds = await readCredentialIds();
const byType = {};
if (creds) {
  for (const c of creds) byType[c.type] = { id: c.id, name: c.name };
  console.log(`✓ قرأت ${creds.length} اعتمادًا من n8n:`);
  for (const c of creds) console.log(`   · ${c.name} (${c.type})`);
} else {
  console.log('⚠️  تعذّرت قراءة الاعتمادات من n8n (هل الحاوية تعمل؟).');
  console.log('   سأجهّز الملفات بدونها — ستختار الاعتمادات يدويًا في كل عقدة.');
}

// ── الحقن ──
mkdirSync(OUT, { recursive: true });
const files = readdirSync(WF).filter((f) => f.endsWith('.json'));
let done = 0;

for (const f of files) {
  const wf = JSON.parse(readFileSync(join(WF, f), 'utf8'));
  let injected = 0;

  const walk = (o) => {
    if (Array.isArray(o)) return o.map(walk);
    if (o && typeof o === 'object') {
      for (const k of Object.keys(o)) o[k] = walk(o[k]);
      return o;
    }
    if (typeof o === 'string') {
      let s = o;
      if (s.includes('__SHEET_ID__')) { s = s.replaceAll('__SHEET_ID__', cfg.sheetId); injected++; }
      if (s.includes('__TELEGRAM_CHAT_ID__') && cfg.telegramChatId) { s = s.replaceAll('__TELEGRAM_CHAT_ID__', cfg.telegramChatId); injected++; }
      return s;
    }
    return o;
  };
  walk(wf);

  for (const node of wf.nodes || []) {
    if (!node.credentials) continue;
    for (const type of Object.keys(node.credentials)) {
      if (byType[type]) { node.credentials[type] = { ...byType[type] }; injected++; }
    }
  }

  wf.active = false;
  writeFileSync(join(OUT, f), JSON.stringify(wf, null, 2), 'utf8');
  console.log(`✓ ${f} — ${injected} قيمة محقونة`);
  done++;
}

console.log(`\nجاهز: ${done} ملف في workflows/ready/`);
console.log('\nالاستيراد:');
console.log(`  docker cp workflows/ready/. ${cfg.n8nContainer || 'sawwi-n8n'}:/tmp/wf/`);
console.log(`  docker exec ${cfg.n8nContainer || 'sawwi-n8n'} n8n import:workflow --separate --input=/tmp/wf`);
console.log('\nثم افتح http://localhost:5678 واضغط Publish على كل workflow.');
console.log('⚠️  كل إعادة استيراد تُلغي النشر — اضغط Publish من جديد بعدها.');
