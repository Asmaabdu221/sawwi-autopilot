#!/usr/bin/env node
/**
 * سوّي — تصدير حزمة منشور إلى ملف مقروء
 *
 * يسحب المنشور من ورقة posts ويكتبه ملفًا جاهزًا للتصوير والنسخ.
 *
 * التشغيل:
 *   node export-post.mjs              → آخر منشور
 *   node export-post.mjs POST-20260924 → منشور بعينه
 *   node export-post.mjs --all        → كل المنشورات
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'));
const OUT_DIR = join(HERE, '..', 'content');
const KEY_PATH = CONFIG.googleKeyPath || '__GOOGLE_KEY_PATH__';

const arg = process.argv[2] || '';
const ALL = arg === '--all';

// ─────────── المصادقة ───────────
const key = JSON.parse(readFileSync(KEY_PATH, 'utf8'));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = b64({ alg: 'RS256', typ: 'JWT' });
const claim = b64({
  iss: key.client_email,
  scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600,
});
const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key.private_key, 'base64url');
const tok = await (await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
})).json();
if (!tok.access_token) { console.error('❌ تعذّرت المصادقة مع Google'); process.exit(1); }

const res = await (await fetch(
  `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.sheetId}/values/posts!A1:M200`,
  { headers: { authorization: `Bearer ${tok.access_token}` } },
)).json();

const rows = res.values || [];
if (rows.length < 2) { console.log('لا منشورات في الجدول بعد.'); process.exit(0); }
const hdr = rows[0];
const posts = rows.slice(1).map((r) => Object.fromEntries(hdr.map((h, i) => [h, r[i] || ''])));

const targets = ALL ? posts : arg ? posts.filter((p) => p.post_id === arg) : [posts[posts.length - 1]];
if (!targets.length) { console.log(`لم أجد المنشور ${arg}`); process.exit(1); }

mkdirSync(OUT_DIR, { recursive: true });

const cap = (c, label) => {
  if (!c) return `### ${label}\n_غير متوفر_\n`;
  const tags = (c.hashtags || []).join(' ');
  return `### ${label}\n\n${c.title ? `**العنوان:** ${c.title}\n\n` : ''}${c.text || ''}\n\n${tags ? `${tags}\n\n` : ''}${c.cta ? `**الدعوة:** ${c.cta}\n` : ''}`;
};

for (const p of targets) {
  let pkg = {};
  try { pkg = JSON.parse(p.payload || '{}'); } catch { /* payload مقطوع */ }
  const v = pkg.video || {}, caps = pkg.captions || {}, vis = pkg.visual || {};

  const md = [
    `# ${p.title || pkg.meta?.title || p.post_id}`,
    '',
    `**${p.post_id}** · ${p.date} · ${p.pillar} · ${p.series}`,
    `من الفكرة: ${p.idea_id} · الحالة: ${p.status}`,
    '',
    '---',
    '',
    '## ⏱ النتيجة',
    '',
    `| قبل | بعد | الرقاقة |`,
    `|---|---|---|`,
    `| ${v.result?.before || ''} | ${v.result?.after || ''} | **${v.result?.chip || p.chip || ''}** |`,
    '',
    `**الحكم:** ${v.verdict || p.verdict || ''}`,
    '',
    '---',
    '',
    '## 🎣 الخطّافات — اختر واحدًا',
    '',
    ...(v.hooks || [p.hook]).map((h, i) => `${i + 1}. ${h}`),
    '',
    '---',
    '',
    '## 🎙 النص الصوتي',
    '',
    '> سجّله بلهجة سعودية بيضاء · المدة المستهدفة ' + (v.duration_sec || 45) + ' ثانية',
    '',
    v.script || '',
    '',
    '---',
    '',
    '## 🎞 المشاهد',
    '',
    '| الوقت | ماذا يظهر | النص على الشاشة |',
    '|---|---|---|',
    ...(v.scenes || []).map((s) => `| ${s.t} | ${s.action} | ${s.on_screen} |`),
    '',
    '---',
    '',
    '## 🖼 الغلاف',
    '',
    `**النص:** ${vis.cover_text || ''}`,
    `**الرقم في الرقاقة الزعفرانية:** ${vis.cover_number || ''}`,
    '',
    'ألوان البراند: قهوة `#22160F` · زعفران `#F5A524` · هيل `#7DB46C`',
    '',
    '---',
    '',
    '## 📱 الكابشنات',
    '',
    cap(caps.tiktok, 'تيك توك'),
    cap(caps.instagram, 'إنستقرام'),
    cap(caps.youtube_shorts, 'يوتيوب شورتس'),
    cap(caps.snapchat, 'سناب شات'),
    cap(caps.x, 'إكس'),
    '---',
    '',
    '## 💼 لينكدإن',
    '',
    caps.linkedin?.text || '',
    '',
    (caps.linkedin?.hashtags || []).join(' '),
    '',
    '### النسخة الإنجليزية',
    '',
    caps.linkedin?.en_version || '',
    '',
    '---',
    '',
    `_وضع الإنتاج: ${pkg.meta?.production_mode || ''} · مرحلة الدعوة: ${pkg.meta?.cta_stage || ''}_`,
  ].join('\n');

  const file = join(OUT_DIR, `${p.date}-${p.post_id}.md`);
  writeFileSync(file, md, 'utf8');
  console.log('✓', file);
}

console.log(`\nالمجلد: ${OUT_DIR}`);
