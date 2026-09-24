#!/usr/bin/env node
/**
 * سوّي — WF1 · بنك الأفكار (الجزء المحلي)
 *
 * يشتغل على جهازك بجدولة Windows Task Scheduler.
 * يستخدم اشتراك Claude عبر `claude -p` — بلا أي مفتاح API وبلا أي تكلفة إضافية.
 *
 * التدفق:
 *   ① يسحب سياق البنك من n8n (المعرّفات المعروفة + مادة المقارنة)
 *   ② يقرأ خلاصات RSS للمراجع ويحذف الضجيج ويفلتر
 *   ③ يشغّل claude -p لكل فيديو جديد → أفكار منظَّمة
 *   ④ يرسل الأفكار إلى n8n ليتولى منع التكرار والكتابة في Sheets
 *
 * التشغيل:  node wf1-ideas.mjs [--days 14] [--dry-run] [--limit 3]
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────── الإعدادات ───────────────────────────
const CONFIG = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'));

let SOURCES = [];
try {
  SOURCES = JSON.parse(readFileSync(join(HERE, 'sources.json'), 'utf8'));
} catch {
  console.error('❌ لم أجد scripts/sources.json — شغّل:  node setup.mjs');
  process.exit(1);
}
if (!SOURCES.length) {
  console.error('❌ لا توجد مصادر في scripts/sources.json — أضف قنواتك أو أعد تشغيل setup.mjs');
  process.exit(1);
}

const SKIP_TITLE = /\bnews\b|أخبار|livestream|live stream|podcast|thank you for|subscribers|q&a/i;
const NOISE_LINE = /https?:\/\/|sponsorship|connect with me|my tools|code \w+ for|free month|discount|📧|patreon|newsletter/i;

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const DAYS = Number(argVal('--days', 7));
const LIMIT = Number(argVal('--limit', 6));
const DRY_RUN = args.includes('--dry-run');

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

// ─────────────────────── ① سياق البنك من n8n ───────────────────────
async function fetchBankContext() {
  if (DRY_RUN) return { known_video_ids: [], corpus: [] };
  const res = await fetch(CONFIG.contextWebhook, {
    headers: { [CONFIG.authHeader]: CONFIG.authSecret },
  });
  if (!res.ok) throw new Error(`سياق البنك فشل: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─────────────────────── ② قراءة الخلاصات ───────────────────────
const feedUrl = (s) =>
  s.type === 'youtube'
    ? `https://www.youtube.com/feeds/videos.xml?channel_id=${s.ref}`
    : s.ref;

const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
};

const unescapeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
   .replace(/&#39;/g, "'").replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** يحذف روابط الأفلييت والرعاة ويُبقي الفقرة الشارحة والفصول */
function cleanDescription(raw) {
  const lines = unescapeXml(raw).split('\n');
  const prose = [];
  const chapters = [];
  let inChapters = false;

  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^timestamps?\b/i.test(t)) { inChapters = true; continue; }
    if (inChapters) {
      const m = t.match(/^(\d+:\d+(?::\d+)?)\s+(.+)$/);
      if (m && !/sponsor/i.test(m[2])) chapters.push(m[2].trim());
      continue;
    }
    if (NOISE_LINE.test(t)) continue;
    prose.push(t);
  }
  return { prose: prose.join(' ').slice(0, 1400), chapters };
}

async function readSource(src) {
  const res = await fetch(feedUrl(src), { headers: { 'user-agent': 'sawwi-autopilot/1' } });
  if (!res.ok) { log(`⚠️  ${src.name}: HTTP ${res.status}`); return []; }
  const xml = await res.text();
  const entries = xml.split('<entry>').slice(1);

  return entries.map((e) => {
    const desc = cleanDescription(tag(e, 'media:description'));
    const views = Number((e.match(/<media:statistics views="(\d+)"/) || [])[1] || 0);
    return {
      source_id: src.id,
      source_channel: src.name,
      source_role: src.role,
      max_ideas: src.maxIdeas,
      video_id: tag(e, 'yt:videoId'),
      title: unescapeXml(tag(e, 'media:title')).trim(),
      published_at: tag(e, 'published'),
      views,
      url: `https://www.youtube.com/watch?v=${tag(e, 'yt:videoId')}`,
      prose: desc.prose,
      chapters: desc.chapters,
    };
  });
}

/** كم فكرة نطلب من هذا الفيديو */
function ideasTarget(v) {
  if (v.source_role === 'gap') return 1;
  if (v.chapters.length >= 8 && v.views >= 30000) return 3;
  if (v.chapters.length >= 5) return 2;
  return 1;
}

function filterVideos(all, known) {
  const cutoff = Date.now() - DAYS * 864e5;
  const seen = new Set(known);
  return all.filter((v) => {
    if (!v.video_id || seen.has(v.video_id)) return false;
    if (new Date(v.published_at).getTime() < cutoff) return false;
    if (SKIP_TITLE.test(v.title)) return false;
    if (v.chapters.length === 0 && v.prose.length < 500) return false;
    return true;
  });
}

// ─────────────────────── ③ المصنِّف عبر الاشتراك ───────────────────────
const SCHEMA = {
  type: 'object',
  required: ['ideas'],
  properties: {
    ideas: {
      type: 'array', minItems: 1, maxItems: 3,
      items: {
        type: 'object',
        required: ['topic_key', 'pillar', 'series', 'hook', 'sawwi_angle',
                   'saudi_example', 'original_idea', 'needs_experiment', 'effort', 'score'],
        properties: {
          topic_key:        { type: 'string' },
          pillar:           { type: 'string', enum: ['انتشار', 'بزنس', 'تعليمي'] },
          series:           { type: 'string', enum: ['هل نقدر نخليه يسوّيها؟', 'عطيناه وظيفة', 'لو عندي ___ اليوم', 'قبل ← بعد', 'الحلقة — الدخل', 'خطوة بخطوة'] },
          hook:             { type: 'string' },
          sawwi_angle:      { type: 'string' },
          saudi_example:    { type: 'string' },
          original_idea:    { type: 'string' },
          needs_experiment: { type: 'string', enum: ['نعم', 'لا'] },
          experiment_note:  { type: 'string' },
          effort:           { type: 'string', enum: ['خفيف', 'متوسط', 'ثقيل'] },
          score:            { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
    },
  },
};

function buildPrompt(v, corpus) {
  const avoid = corpus.slice(-60)
    .map((c) => `${c.topic_key} — ${String(c.sawwi_angle).slice(0, 90)}`)
    .join('\n') || 'البنك فارغ — لا قيود.';

  const gapNote = v.source_role === 'gap'
    ? '\n⚠️ هذا مصدر «كشف فجوة» عربي يشرح الأدوات. لا تكرر الشرح — استخرج الزاوية المكتبية الغائبة فقط، أو أعد فكرة واحدة بـ score منخفض إن لم توجد زاوية.'
    : '';

  return `أنت مصنّف أفكار المحتوى في «سوّي» — منصة سعودية تعلّم الذكاء الاصطناعي العملي. الشعار: خلّ الذكاء الاصطناعي يسوّيها.

الجمهور: نورة، ٢٩ سنة، أخصائية موارد بشرية في شركة متوسطة بالرياض. تفرز سِيَرًا ذاتية، تكتب إعلانات وظيفية، تجهّز تقرير حضور أسبوعي، وترد على نفس الأسئلة كل يوم. إذا ما حسّت أن الفكرة تخصها — الفكرة خطأ.

قاعدة المرجع: استفد من محتوى المرجع وأفكاره وبنيته وأساليبه كمادة مصدرية، ثم كيّفها مع سوّي والجمهور السعودي. الموضوع مسموح، الأسلوب يُنقل، البنية تُعاد — النص لا يُنسخ.
استبدال إجباري لكل مثال أجنبي: Gmail ← بريد العمل والخطابات الرسمية · Slack ← واتساب الأعمال · Stripe ← الفواتير · cold email ← لينكدإن والمعارف · PTO ← طلب إجازة · resume screening ← فرز السِيَر.

الركائز: انتشار · بزنس · تعليمي
السلاسل: هل نقدر نخليه يسوّيها؟ · عطيناه وظيفة · لو عندي ___ اليوم · قبل ← بعد · الحلقة — الدخل · خطوة بخطوة

قواعد صارمة:
- الخطّاف ≤ ١٢ كلمة بلهجة سعودية بيضاء، بلا ترحيب ولا مقدمة.
- ممنوع: ثورة · بيأخذ وظيفتك · أسرار · ربح سريع · ستغيّر حياتك · أفضل ١٠ أدوات · خرافي · جنوني · مذهل. وممنوع نقل الأخبار.
- لا تنسب رقمًا أو نتيجة لم نجرّبها. أي فكرة تتطلب بناء شيء أو قياس وقت ⇒ needs_experiment = "نعم" مع experiment_note يقول ما يجب تجربته بالضبط. لا تضع "لا" إلا لفكرة تُروى من خبرة بلا قياس.
- topic_key: عربي، حروف صغيرة، بلا تشكيل، مفصول بشرطات.
- كل فكرة من عنقود فصول مختلف، وبركيزة وسلسلة وجمهور ووعد مختلف. ثلاث صياغات لفكرة واحدة = فشل.

أفكار موجودة في البنك — لا تقترب منها ولا من معناها:
${avoid}

المرجع:
العنوان: ${v.title}
القناة: ${v.source_channel} — ${v.views.toLocaleString('en-US')} مشاهدة — ${v.published_at.slice(0, 10)}
الوصف: ${v.prose}
الفصول: ${v.chapters.join(' | ')}${gapNote}

استخرج ${ideasTarget(v)} فكرة سوّي مختلفة فعلًا.`;
}

/**
 * مسار تنفيذ claude.
 * مهم: نستدعي الملف التنفيذي مباشرة بـ shell:false.
 * تمرير أمر طويل بالعربية عبر صدفة Windows يشوّهه ويُفقد الأعلام،
 * فيرجع نصًّا عاديًا بدل JSON.
 */
function resolveClaudeBin() {
  if (CONFIG.claudeBin) return CONFIG.claudeBin;
  const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null;
  const candidates = [
    npmRoot && join(npmRoot, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude',
    join(process.env.HOME || '', '.local', 'bin', 'claude'),
  ].filter(Boolean);
  for (const c of candidates) { if (existsSync(c)) return c; }
  return 'claude';
}
const CLAUDE_BIN = resolveClaudeBin();

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, [
      '-p', prompt,
      '--model', CONFIG.model || 'sonnet',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(SCHEMA),
    ], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });

    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const killer = setTimeout(() => child.kill('SIGTERM'), 5 * 60_000);

    child.on('close', (code) => {
      clearTimeout(killer);
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`));
      try {
        const d = JSON.parse(out);
        if (d.is_error) return reject(new Error(`claude error: ${d.result}`));
        resolve({ ideas: d.structured_output?.ideas ?? [], estCost: d.total_cost_usd ?? 0 });
      } catch (e) { reject(new Error(`تعذّر تحليل مخرَج claude: ${e.message}`)); }
    });
    child.on('error', reject);
  });
}

// ─────────────────────── ④ الإرسال إلى n8n ───────────────────────
async function sendToBank(ideas) {
  if (DRY_RUN) { console.log(JSON.stringify(ideas, null, 1)); return { dry: true }; }
  const res = await fetch(CONFIG.ingestWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CONFIG.authHeader]: CONFIG.authSecret },
    body: JSON.stringify({ ideas, captured_at: new Date().toISOString() }),
  });
  if (!res.ok) throw new Error(`الإرسال فشل: ${res.status} ${await res.text()}`);
  return res.json().catch(() => ({ ok: true }));
}

// ─────────────────────────── main ───────────────────────────
(async () => {
  log(`بدء WF1 — نافذة ${DAYS} يومًا${DRY_RUN ? ' (تجربة جافة)' : ''}`);

  const bank = await fetchBankContext();
  log(`البنك: ${bank.known_video_ids?.length ?? 0} فيديو معالَج · ${bank.corpus?.length ?? 0} فكرة`);

  const all = (await Promise.all(SOURCES.map(readSource))).flat();
  log(`الخلاصات: ${all.length} عنصرًا`);

  const fresh = filterVideos(all, bank.known_video_ids ?? []).slice(0, LIMIT);
  if (fresh.length === 0) { log('لا جديد اليوم. انتهى بهدوء.'); return; }
  log(`جديد بعد الفلترة: ${fresh.length}`);

  const collected = [];
  let estCost = 0;
  for (const v of fresh) {
    try {
      log(`  ▸ ${v.title.slice(0, 60)} (${ideasTarget(v)} أفكار)`);
      const { ideas, estCost: c } = await runClaude(buildPrompt(v, bank.corpus ?? []));
      estCost += c;
      for (const idea of ideas) {
        collected.push({
          ...idea,
          source_channel: v.source_channel,
          source_title: v.title,
          source_url: v.url,
          source_video_id: v.video_id,
          source_published_at: v.published_at,
          source_views: v.views,
        });
      }
      log(`    ✓ ${ideas.length} فكرة`);
    } catch (e) {
      log(`    ✗ ${e.message}`);
    }
  }

  if (collected.length === 0) { log('لم تُستخرج أي فكرة.'); return; }

  const r = await sendToBank(collected);
  log(`أُرسلت ${collected.length} فكرة إلى البنك. ${r.added != null ? `أُضيفت ${r.added}، كُررت ${r.duplicates ?? 0}.` : ''}`);
  log(`(تقدير مكافئ API: $${estCost.toFixed(3)} — غير مفوتر، يُحتسب من حصة الاشتراك)`);
})().catch((e) => { console.error('فشل WF1:', e.message); process.exit(1); });
