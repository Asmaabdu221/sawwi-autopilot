#!/usr/bin/env node
/**
 * سوّي — فحص الجاهزية
 * يفحص كل حلقة في السلسلة ويقول بالضبط أين تنقطع.
 * لا ينشر شيئًا ولا يكتب في البنك (إلا فحص ٧ الاختياري بعلم منك).
 *
 * التشغيل:  node preflight.mjs            فحص للقراءة فقط
 *           node preflight.mjs --write    يضيف فكرة اختبار واحدة للبنك ثم يخبرك لتحذفها
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WRITE_TEST = process.argv.includes('--write');

const results = [];
const ok   = (n, d) => results.push({ n, s: 'PASS', d });
const bad  = (n, d) => results.push({ n, s: 'FAIL', d });
const skip = (n, d) => results.push({ n, s: 'SKIP', d });

let CONFIG = null;

// ١ — الإعدادات
try {
  CONFIG = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'));
  const missing = ['contextWebhook', 'ingestWebhook', 'authHeader', 'authSecret']
    .filter((k) => !CONFIG[k]);
  if (missing.length) bad('الإعدادات', 'ناقص: ' + missing.join(', '));
  else if (/ضع-هنا/.test(CONFIG.authSecret)) bad('الإعدادات', 'السرّ لم يُولَّد بعد');
  else ok('الإعدادات', `السرّ ${CONFIG.authSecret.length} حرفًا · النموذج ${CONFIG.model}`);
} catch (e) { bad('الإعدادات', e.message); }

// ٢ — لا مفتاح Anthropic في أي مكان
{
  const envKey = process.env.ANTHROPIC_API_KEY;
  const inCfg = CONFIG && JSON.stringify(CONFIG).includes('sk-ant');
  if (envKey) bad('بلا مفتاح API', 'ANTHROPIC_API_KEY مضبوط — احذفه ليُستخدم الاشتراك');
  else if (inCfg) bad('بلا مفتاح API', 'وُجد مفتاح في ملف الإعدادات');
  else ok('بلا مفتاح API', 'لا مفتاح في البيئة ولا في الإعدادات');
}

// ٣ — تنفيذ claude والاشتراك
const claudeBin = CONFIG?.claudeBin && existsSync(CONFIG.claudeBin) ? CONFIG.claudeBin : 'claude';
if (CONFIG?.claudeBin && !existsSync(CONFIG.claudeBin)) {
  bad('ملف claude', `غير موجود: ${CONFIG.claudeBin}`);
} else {
  ok('ملف claude', claudeBin);
}
{
  const cred = join(process.env.USERPROFILE || process.env.HOME || '', '.claude', '.credentials.json');
  if (existsSync(cred)) ok('تسجيل دخول الاشتراك', 'ملف الاعتماد موجود');
  else skip('تسجيل دخول الاشتراك', 'الملف غير موجود — قد يكون في مخزن مفاتيح النظام');
}

function runClaude(prompt, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const c = spawn(claudeBin, ['-p', prompt, '--model', CONFIG?.model || 'sonnet', '--output-format', 'json'],
      { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    const k = setTimeout(() => c.kill('SIGTERM'), timeoutMs);
    c.on('close', (code) => {
      clearTimeout(k);
      try { const d = JSON.parse(out); resolve({ code, result: d.result, isError: d.is_error, model: Object.keys(d.modelUsage || {})[0] }); }
      catch { resolve({ code, raw: out.slice(0, 160) }); }
    });
    c.on('error', (e) => { clearTimeout(k); resolve({ code: -1, err: e.message }); });
  });
}

// ٤ — خلاصات RSS
const FEEDS = {
  'Nate Herk': 'https://www.youtube.com/feeds/videos.xml?channel_id=UC2ojq-nuP8ceeHqiroeKhBA',
  'n8n بالعربي': 'https://www.youtube.com/feeds/videos.xml?channel_id=UCJQIvPjGJ7jvXs_Ij9xE_OA',
  'n8n Central': 'https://www.youtube.com/feeds/videos.xml?channel_id=UCIMOxNc0rn0EeNtmL05nxUw',
};

async function checkFeeds() {
  for (const [name, url] of Object.entries(FEEDS)) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'sawwi-autopilot/1' } });
      if (!r.ok) { bad(`خلاصة ${name}`, `HTTP ${r.status}`); continue; }
      const xml = await r.text();
      const n = (xml.match(/<entry>/g) || []).length;
      const withDesc = (xml.match(/<media:description>/g) || []).length;
      if (n === 0) bad(`خلاصة ${name}`, 'صفر عناصر');
      else ok(`خلاصة ${name}`, `${n} عنصرًا · ${withDesc} بوصف`);
    } catch (e) { bad(`خلاصة ${name}`, e.message); }
  }
}

// ٥ و٦ — webhookا n8n
async function checkWebhooks() {
  if (!CONFIG?.contextWebhook) { skip('webhook السياق', 'بلا إعدادات'); return; }

  // السياق
  try {
    const r = await fetch(CONFIG.contextWebhook, { headers: { [CONFIG.authHeader]: CONFIG.authSecret } });
    const txt = await r.text();
    if (r.status === 404) bad('webhook السياق', '404 — الـworkflow غير مفعّل في n8n');
    else if (r.status === 401 || r.status === 403) bad('webhook السياق', `${r.status} — اعتماد Header Auth غير مضبوط أو السرّ مختلف`);
    else if (!r.ok) bad('webhook السياق', `HTTP ${r.status}: ${txt.slice(0, 140)}`);
    else {
      let d; try { d = JSON.parse(txt); } catch { bad('webhook السياق', 'رد ليس JSON: ' + txt.slice(0, 120)); return checkAuthReject(); }
      if (!Array.isArray(d.known_video_ids) || !Array.isArray(d.corpus)) bad('webhook السياق', 'شكل الرد غير متوقع: ' + txt.slice(0, 140));
      else ok('webhook السياق', `البنك ${d.bank_size ?? d.corpus.length} فكرة · ${d.known_video_ids.length} فيديو معالَج`);
    }
  } catch (e) { bad('webhook السياق', e.message); }

  await checkAuthReject();

  // الاستقبال
  if (!WRITE_TEST) { skip('webhook الاستقبال', 'شغّل بـ --write لاختبار الكتابة'); return; }
  try {
    const probe = {
      ideas: [{
        topic_key: 'فحص-جاهزيه-النظام-' + Date.now(),
        pillar: 'تعليمي', series: 'خطوة بخطوة',
        hook: 'فكرة اختبار من فحص الجاهزية احذفها',
        sawwi_angle: 'صف اختبار للتأكد أن الكتابة في البنك تعمل. احذف هذا الصف.',
        saudi_example: 'لا ينطبق', original_idea: 'فحص جاهزية',
        needs_experiment: 'لا', effort: 'خفيف', score: 1,
        source_channel: 'preflight', source_title: 'فحص الجاهزية',
        source_url: '', source_video_id: 'preflight-' + Date.now(),
        source_published_at: new Date().toISOString(), source_views: 0,
      }],
    };
    const r = await fetch(CONFIG.ingestWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [CONFIG.authHeader]: CONFIG.authSecret },
      body: JSON.stringify(probe),
    });
    const txt = await r.text();
    if (!r.ok) bad('webhook الاستقبال', `HTTP ${r.status}: ${txt.slice(0, 140)}`);
    else ok('webhook الاستقبال', `${txt.slice(0, 120)}  ← احذف صف الاختبار من الجدول`);
  } catch (e) { bad('webhook الاستقبال', e.message); }
}

// السرّ الخاطئ يجب أن يُرفض
async function checkAuthReject() {
  try {
    const r = await fetch(CONFIG.contextWebhook, { headers: { [CONFIG.authHeader]: 'wrong-secret-on-purpose' } });
    if (r.status === 401 || r.status === 403) ok('رفض السرّ الخاطئ', `${r.status} كما يجب`);
    else if (r.status === 404) skip('رفض السرّ الخاطئ', 'الـworkflow غير مفعّل بعد');
    else bad('رفض السرّ الخاطئ', `قَبِل سرًّا خاطئًا! HTTP ${r.status} — الحماية غير مفعّلة`);
  } catch (e) { skip('رفض السرّ الخاطئ', e.message); }
}

// ٧ — المهمة المجدولة
async function checkTask() {
  const { execFile } = await import('node:child_process');
  return new Promise((resolve) => {
    execFile('schtasks', ['/Query', '/TN', 'Sawwi Idea Bank', '/FO', 'LIST'], { encoding: 'utf8' }, (err, stdout) => {
      if (err) { skip('المهمة المجدولة', 'غير موجودة'); return resolve(); }
      const state = (stdout.match(/Status:\s*(.+)/) || stdout.match(/الحالة:\s*(.+)/) || [])[1]?.trim();
      ok('المهمة المجدولة', `موجودة · الحالة: ${state || 'غير معروفة'}`);
      resolve();
    });
  });
}

// ─────────────────────────────────────────
(async () => {
  console.log('\n🔍 فحص جاهزية سوّي أوتوبايلوت — WF1\n' + '─'.repeat(62));

  await checkFeeds();

  const c = await runClaude('أجب بكلمة واحدة فقط: جاهز');
  if (c.code === 0 && !c.isError && String(c.result || '').includes('جاهز')) ok('claude على الاشتراك', `رد: ${c.result} · النموذج ${c.model}`);
  else bad('claude على الاشتراك', c.err || c.raw || `exit ${c.code} · ${c.result}`);

  await checkWebhooks();
  await checkTask();

  const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].length));
  for (const r of results) {
    const icon = r.s === 'PASS' ? '✅' : r.s === 'FAIL' ? '❌' : '⏭️ ';
    console.log(`${icon} ${pad(r.n, 26)} ${r.d}`);
  }

  const fails = results.filter((r) => r.s === 'FAIL').length;
  const skips = results.filter((r) => r.s === 'SKIP').length;
  console.log('─'.repeat(62));
  console.log(fails === 0
    ? `الكل سليم (${results.length - skips} فحصًا${skips ? ` · ${skips} متجاوَز` : ''}). النظام جاهز للتشغيل.`
    : `${fails} فحصًا فاشلًا. أصلحها قبل أي تشغيل فعلي.`);
  process.exit(fails === 0 ? 0 : 1);
})();
