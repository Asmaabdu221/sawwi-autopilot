#!/usr/bin/env node
/**
 * سوّي — WF2 · المحتوى اليومي (الجزء المحلي)
 *
 * يستخدم اشتراك Claude عبر `claude -p` — بلا أي مفتاح API.
 * لا ينشر شيئًا. ينتج الحزمة ويرسلها لك على تيليجرام عبر n8n.
 *
 * التدفق:
 *   ① يسأل n8n: ما موعد اليوم؟ وأي فكرة من البنك تناسبه؟
 *   ② claude يحوّل الفكرة إلى حزمة كاملة (نص صوتي · ٣ خطّافات · مشاهد · ٦ كابشنات · غلاف)
 *   ③ يرسل الحزمة إلى n8n: حارس البراند ← أرشفة ← تيليجرام
 *
 * التشغيل:  node wf2-daily.mjs [--dry-run] [--idea IDEA-0004]
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CONFIG = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'));

const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const DRY_RUN = args.includes('--dry-run');
const FORCE_IDEA = argVal('--idea', '');

const log = (...m) => console.log(new Date().toISOString().slice(11, 19), ...m);

function resolveClaudeBin() {
  if (CONFIG.claudeBin && existsSync(CONFIG.claudeBin)) return CONFIG.claudeBin;
  const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, 'npm') : null;
  const c = npmRoot && join(npmRoot, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
  return c && existsSync(c) ? c : 'claude';
}
const CLAUDE_BIN = resolveClaudeBin();

const base = CONFIG.ingestWebhook.replace(/\/[^/]+$/, '');
const SLOT_URL = CONFIG.wf2SlotWebhook || `${base}/wf2-slot`;
const PKG_URL = CONFIG.wf2PackageWebhook || `${base}/wf2-package`;

// ─────────────────────── مخطط الحزمة ───────────────────────
const SCHEMA = {
  type: 'object',
  required: ['meta', 'video', 'captions', 'visual'],
  properties: {
    meta: {
      type: 'object',
      required: ['title', 'cta_stage', 'production_mode'],
      properties: {
        title: { type: 'string' },
        cta_stage: { type: 'string', enum: ['وعي', 'حفظ', 'تأهيل', 'قائمة', 'بيع'] },
        production_mode: { type: 'string', enum: ['بدون ظهور', 'ظهور على الكاميرا', 'صوت + شاشة'] },
      },
    },
    video: {
      type: 'object',
      required: ['hooks', 'script', 'scenes', 'result', 'verdict'],
      properties: {
        hooks: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' } },
        script: { type: 'string' },
        duration_sec: { type: 'integer' },
        scenes: {
          type: 'array', minItems: 4,
          items: {
            type: 'object', required: ['t', 'action', 'on_screen'],
            properties: { t: { type: 'string' }, action: { type: 'string' }, on_screen: { type: 'string' } },
          },
        },
        result: {
          type: 'object', required: ['before', 'after', 'chip'],
          properties: { before: { type: 'string' }, after: { type: 'string' }, chip: { type: 'string' } },
        },
        verdict: { type: 'string' },
      },
    },
    captions: {
      type: 'object',
      required: ['tiktok', 'instagram', 'youtube_shorts', 'snapchat', 'linkedin', 'x'],
      properties: {
        tiktok: { $ref: '#/$defs/cap' },
        instagram: { $ref: '#/$defs/cap' },
        youtube_shorts: {
          type: 'object', required: ['title', 'text', 'hashtags', 'cta'],
          properties: { title: { type: 'string' }, text: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' } },
        },
        snapchat: { $ref: '#/$defs/cap' },
        linkedin: {
          type: 'object', required: ['text', 'en_version', 'hashtags', 'cta'],
          properties: { text: { type: 'string' }, en_version: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' } },
        },
        x: { $ref: '#/$defs/cap' },
      },
    },
    visual: {
      type: 'object', required: ['cover_text', 'cover_number'],
      properties: { cover_text: { type: 'string' }, cover_number: { type: 'string' } },
    },
  },
  $defs: {
    cap: {
      type: 'object', required: ['text', 'hashtags', 'cta'],
      properties: { text: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } }, cta: { type: 'string' } },
    },
  },
};

// ─────────────────────── الأمر ───────────────────────
function buildPrompt(slot, idea, recent) {
  const recentLines = (recent || []).slice(-14).map((p) => `- ${p.title} (${p.hook})`).join('\n') || 'لا منشورات سابقة.';
  return `أنت مخرج المحتوى في «سوّي» — منصة سعودية تعلّم الذكاء الاصطناعي العملي. الشعار: خلّ الذكاء الاصطناعي يسوّيها.

الجمهور: نورة، ٢٩ سنة، أخصائية موارد بشرية في شركة متوسطة بالرياض. تفرز سِيَرًا ذاتية، تكتب إعلانات وظيفية، تجهّز تقرير حضور أسبوعي، وترد على نفس الأسئلة كل يوم. اكتب لها هي.

موعد اليوم:
- التاريخ: ${slot.date} (${slot.weekday})
- الركيزة: ${slot.pillar}
- السلسلة: ${slot.series}
- مرحلة الـCTA: ${slot.cta_stage}
- وضع الإنتاج: ${slot.production_mode}
- يوم لينكدإن: ${slot.linkedin_day ? 'نعم' : 'لا'}

الفكرة المختارة من بنك الأفكار (${idea.id} · حالتها ${idea.status}):
- الزاوية: ${idea.sawwi_angle}
- المثال السعودي: ${idea.saudi_example}
- الخطّاف المقترح: ${idea.hook}
- تحتاج تجربة فعلية: ${idea.needs_experiment}${idea.experiment_note ? ` — ${idea.experiment_note}` : ''}

آخر منشوراتنا (لا تكررها):
${recentLines}

قوانين لا تُكسر:
١. كل منشور ينتهي بشيء مبني يشتغل أو خطوة تُطبَّق اليوم. رأي أو خبر أو قائمة أدوات مرفوض.
٢. رقم ملموس إجباري (دقائق، ساعات، ريالات، عدد) في النص الصوتي وفي كل كابشن.
٣. مثال سعودي إجباري: خطاب رسمي، واتساب الأعمال، فاتورة، عرض مناقصة، طلب إجازة، دوام، فرز سِيَر.
٤. ممنوع التخويف من فقدان الوظيفة، ولا تلميحًا.
٥. الصراحة جزء من المنتج: إن كانت التجربة نصف ناجحة قُلها، والفشل يُنشر مثل النجاح.
٦. CTA واحد فقط في كل منصة.
٧. لا تنقل أخبارًا.
٨. كل مصطلح إنجليزي يُشرح في نفس السطر أو يُستبدل بعربي.

كلمات محظورة تمامًا: ثورة · سيقضي على وظيفتك · بيأخذ وظيفتك · أسرار · ربح سريع · دخل بدون مجهود · ستغيّر حياتك · أفضل ١٠ أدوات · مجانًا ١٠٠٪ · الكل لازم يتعلم الآن · لا تفوّت · خرافي · جنوني · مذهل.

بنية الفيديو في ٤٥ ثانية:
٠-٣ الخطّاف بلا ترحيب ولا مقدمة · ٣-٨ الرهان «جرّبت كذا وشفت وش يصير» · ٨-٣٠ البناء على الشاشة · ٣٠-٤٠ النتيجة مع رقاقة الوقت وشريط قبل ثم بعد · ٤٠-٤٥ الحكم الصريح ثم CTA واحد.
أعطِ ثلاثة خطّافات مختلفة، كل واحد اثنتا عشرة كلمة كحد أقصى.
scenes: خمسة مشاهد على الأقل تغطي المدى الزمني كاملًا، وفي كل مشهد النص الظاهر على الشاشة.
result.chip: رقاقة النتيجة بأرقام واضحة مثل «٣ ساعات ← ١٢ دقيقة».
${idea.needs_experiment === 'نعم' ? 'هذه الفكرة تحتاج تجربة فعلية: اكتب الأرقام كقيم متوقعة يملؤها المستخدم بعد التجربة، ولا تدّعِ أنها نتيجة مؤكدة.' : ''}

الكابشنات ستة مستقلة، وممنوع النسخ واللصق بينها:
- تيك توك: ٣٠٠ حرف كحد أقصى، أول سطرين هما كل شيء، ٣-٥ هاشتاقات عربية.
- إنستقرام: ٤٠٠ حرف كحد أقصى، أول ١٢٥ حرفًا تُقرأ قبل «المزيد»، ٥-٨ هاشتاقات.
- يوتيوب شورتس: العنوان ١٠٠ حرف كحد أقصى وهو الخطّاف نفسه، وصف قصير، ٣ هاشتاقات.
- سناب: نص شاشة قصير جدًا، بلا هاشتاقات، نبرة أقرب وأشخص.
- لينكدإن: ٧٠٠ إلى ١٣٠٠ حرف بزاوية صاحب القرار (التكلفة ووقت الفريق والعملية)، وأول ثلاثة أسطر تُقرأ قبل See more، مع نسخة إنجليزية مهنية مختصرة في en_version.
- إكس: ٢٨٠ حرفًا كحد أقصى، أقوى جملة من النص الصوتي، ٠-٢ هاشتاق.

البصريات: cover_text أربع كلمات كحد أقصى · cover_number رقم واحد للرقاقة الزعفرانية.

أنتج حزمة اليوم كاملة.`;
}

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
    const k = setTimeout(() => child.kill('SIGTERM'), 8 * 60_000);
    child.on('close', (code) => {
      clearTimeout(k);
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`));
      try {
        const d = JSON.parse(out);
        if (d.is_error) return reject(new Error(`claude error: ${d.result}`));
        if (!d.structured_output) return reject(new Error('لم يرجع مخرَجًا منظَّمًا'));
        resolve({ pkg: d.structured_output, estCost: d.total_cost_usd ?? 0 });
      } catch (e) { reject(new Error(`تعذّر تحليل مخرَج claude: ${e.message}`)); }
    });
    child.on('error', reject);
  });
}

// ─────────────────────────── main ───────────────────────────
(async () => {
  log('بدء WF2 — إنتاج حزمة اليوم' + (DRY_RUN ? ' (تجربة جافة)' : ''));

  const url = FORCE_IDEA ? `${SLOT_URL}?idea=${encodeURIComponent(FORCE_IDEA)}` : SLOT_URL;
  const sr = await fetch(url, { headers: { [CONFIG.authHeader]: CONFIG.authSecret } });
  if (!sr.ok) throw new Error(`تعذّر جلب موعد اليوم: ${sr.status} ${await sr.text()}`);
  const slotData = await sr.json();

  if (!slotData.idea) {
    log('لا توجد فكرة مناسبة في البنك اليوم.');
    log(`البنك: ${slotData.bank_total ?? 0} فكرة · معتمدة: ${slotData.approved_count ?? 0} · جديدة: ${slotData.new_count ?? 0}`);
    log('اعتمد أفكارًا في الجدول (status = approved) ثم أعد التشغيل.');
    return;
  }

  const { slot, idea, recent } = slotData;
  log(`اليوم: ${slot.weekday} · ${slot.pillar} · ${slot.series}`);
  log(`الفكرة: ${idea.id} — ${String(idea.hook).slice(0, 60)}`);

  const { pkg, estCost } = await runClaude(buildPrompt(slot, idea, recent));
  log('✓ أُنتجت الحزمة — إرسالها للحارس والأرشفة');

  if (DRY_RUN) { console.log(JSON.stringify(pkg, null, 1)); return; }

  const pr = await fetch(PKG_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8', [CONFIG.authHeader]: CONFIG.authSecret },
    body: JSON.stringify({ slot, idea_id: idea.id, package: pkg }),
  });
  const res = await pr.json().catch(() => ({}));
  if (!pr.ok) throw new Error(`فشل الإرسال: ${pr.status} ${JSON.stringify(res)}`);

  log(res.guard_status === 'pass'
    ? `✅ اجتازت الحارس — وصلتك الحزمة على تيليجرام (${res.post_id || ''})`
    : `⚠️ لم تجتز الحارس — وصلك تقرير الأسباب على تيليجرام`);
  log(`(تقدير مكافئ API: $${estCost.toFixed(3)} — غير مفوتر، من حصة الاشتراك)`);
})().catch((e) => { console.error('فشل WF2:', e.message); process.exit(1); });
