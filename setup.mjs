#!/usr/bin/env node
/**
 * سوّي أوتوبايلوت — المثبّت التفاعلي
 *
 * يفحص المتطلبات، يبني دماغ براندك، ويجهّز الإعدادات.
 * لا يطلب منك مفتاح Anthropic — يستخدم اشتراك Claude عندك.
 *
 * التشغيل:  node setup.mjs
 */

import { createInterface } from 'node:readline/promises';
import { spawn, execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const rl = createInterface({ input: process.stdin, output: process.stdout });

const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', red: '\x1b[31m', c: '\x1b[36m' };
const ok = (m) => console.log(`${C.g}✓${C.r} ${m}`);
const warn = (m) => console.log(`${C.y}!${C.r} ${m}`);
const bad = (m) => console.log(`${C.red}✗${C.r} ${m}`);
const head = (m) => console.log(`\n${C.b}${C.c}${m}${C.r}\n${'─'.repeat(58)}`);

// إن أُغلق الإدخال (Ctrl+C أو تشغيل غير تفاعلي) نكمل بالقيم الافتراضية بدل التجمّد
let inputClosed = false;
rl.on('close', () => { inputClosed = true; });

const prompt = async (text, def) => {
  if (inputClosed) return '';
  const answer = await Promise.race([
    rl.question(text),
    new Promise((res) => rl.once('close', () => res(null))),
  ]);
  if (answer === null) {
    console.log(`\n${C.y}!${C.r} انتهى الإدخال — أكمل بالقيم الافتراضية.`);
    return '';
  }
  return String(answer).trim();
};

const ask = async (q, def = '') => {
  const a = await prompt(`${q}${def ? ` ${C.dim}[${def}]${C.r}` : ''}: `, def);
  return a || def;
};
const yes = async (q, def = true) => {
  const a = (await prompt(`${q} ${C.dim}(${def ? 'ن/l' : 'y/N'})${C.r}: `, def)).toLowerCase();
  if (!a) return def;
  return ['y', 'yes', 'ن', 'نعم'].includes(a);
};

const run = (cmd, args) => new Promise((res) => {
  execFile(cmd, args, { timeout: 20000, windowsHide: true }, (e, out) => res(e ? null : String(out).trim()));
});

// ───────────────────── ١ · المتطلبات ─────────────────────
head('١ · فحص المتطلبات');

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 20) ok(`Node.js ${process.versions.node}`);
else { bad(`Node.js ${process.versions.node} — يلزم 20 أو أحدث. نزّله من nodejs.org`); process.exit(1); }

function findClaude() {
  const isWin = platform() === 'win32';
  const cands = [
    process.env.APPDATA && join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', isWin ? 'claude.exe' : 'claude'),
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude',
    join(homedir(), '.local', 'bin', 'claude'),
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

let claudeBin = findClaude();
if (claudeBin) ok(`Claude Code — ${claudeBin}`);
else {
  const which = await run(platform() === 'win32' ? 'where' : 'which', ['claude']);
  if (which) { claudeBin = which.split('\n')[0].trim(); ok(`Claude Code — ${claudeBin}`); }
  else {
    bad('Claude Code غير مثبّت.');
    console.log(`${C.dim}  ثبّته بـ:  npm install -g @anthropic-ai/claude-code${C.r}`);
    console.log(`${C.dim}  ثم سجّل الدخول باشتراكك:  claude${C.r}`);
    process.exit(1);
  }
}

if (process.env.ANTHROPIC_API_KEY) {
  warn('ANTHROPIC_API_KEY مضبوط في بيئتك — سيُستخدم بدل اشتراكك وقد تُحاسَب عليه.');
  warn('احذفه إن أردت الاعتماد على الاشتراك فقط.');
} else ok('لا مفتاح API — سيُستخدم اشتراك Claude (بلا تكلفة إضافية)');

const credFile = join(homedir(), '.claude', '.credentials.json');
if (existsSync(credFile)) ok('تسجيل دخول Claude موجود');
else warn('لم أجد تسجيل دخول Claude — شغّل الأمر `claude` مرة وسجّل دخولك، ثم أعد هذا المثبّت.');

// ───────────────────── ٢ · هوية البراند ─────────────────────
head('٢ · دماغ براندك');
console.log(`${C.dim}هذه الإجابات تُبنى منها هوية المحتوى. خذ وقتك — كلما دقّت، دقّ الناتج.${C.r}\n`);

const brandName = await ask('اسم براندك');
const brandPromise = await ask('وعدك في جملة واحدة (شعارك اللفظي)');
const persona = await ask('صف جمهورك الأول بجملة (الاسم، العمر، الوظيفة، المدينة)');
const personaPain = await ask('ما أكثر مهمة تستهلك وقته يوميًا؟');
const dialect = await ask('لهجة الفيديو', 'سعودية بيضاء');
const country = await ask('السياق المحلي (الدولة/السوق)', 'السعودية');
const banned = await ask('كلمات تمنعها (افصل بفاصلة)', 'ثورة, ربح سريع, أسرار, ستغيّر حياتك');

head('٣ · مراجعك');
console.log(`${C.dim}قنوات يوتيوب تستلهم منها. نأخذ بنيتها وأفكارها ونكيّفها — لا ننسخها.${C.r}`);
console.log(`${C.dim}احصل على معرّف القناة: افتح القناة ← عرض مصدر الصفحة ← ابحث عن externalId${C.r}\n`);

const sources = [];
for (let i = 1; i <= 3; i++) {
  const id = await ask(`معرّف القناة ${i} ${C.dim}(UC... أو اتركه فارغًا للتخطي)${C.r}`);
  if (!id) break;
  const name = await ask(`  اسمها`, `مرجع ${i}`);
  const role = (await yes(`  هل هي مرجعك الأساسي؟`, i === 1)) ? 'primary' : 'gap';
  sources.push({ id: `src${i}`, name, type: 'youtube', ref: id, role, maxIdeas: role === 'primary' ? 3 : 1 });
}
if (!sources.length) {
  warn('بلا مراجع لن يلتقط النظام أفكارًا. أضفها لاحقًا في scripts/sources.json');
}

// ───────────────────── ٤ · كتابة الملفات ─────────────────────
head('٤ · كتابة الإعدادات');

mkdirSync(join(HERE, 'brain'), { recursive: true });
mkdirSync(join(HERE, 'scripts'), { recursive: true });

const core = `# ${brandName} — نواة البراند
> المصدر الوحيد للحقيقة. كل وكيل وسكربت يقرأ هذا الملف أولًا.

## الوعد
${brandPromise}

## الجمهور الأول
${persona}

**أكثر ما يستهلك وقته:** ${personaPain}

اكتب له هو. إذا لم يشعر أن الجملة تخصه — الجملة خطأ.

## النبرة
- الفيديو: ${dialect}
- السياق المحلي: ${country} — كل مثال أجنبي يُستبدل بمعادل محلي
- جمل قصيرة · «جرّبت» لا «يقولون» · رقم حقيقي في كل منشور

## كلمات محظورة
${banned.split(',').map((w) => w.trim()).filter(Boolean).map((w) => `- ${w}`).join('\n')}

## قواعد لا تُكسر
1. كل منشور ينتهي بشيء مبني يشتغل أو خطوة تُطبَّق اليوم.
2. رقم ملموس إجباري (دقائق · ساعات · مبالغ · عدد).
3. مثال محلي إجباري من ${country}.
4. لا تخويف من فقدان الوظيفة.
5. الصراحة: الفشل يُنشر مثل النجاح.
6. دعوة واحدة فقط لكل منصة.
7. لا نقل أخبار.
8. كل مصطلح إنجليزي يُشرح في نفس السطر.

---
_أُنشئ بواسطة مثبّت سوّي أوتوبايلوت. عدّله بحرية — هو ملفك._
`;
writeFileSync(join(HERE, 'brain', '00-brand-core.md'), core, 'utf8');
ok('brain/00-brand-core.md');

const refDoc = `# المراجع — التكييف لا النسخ

## القاعدة الحاكمة
استفد من محتوى المرجع وأفكاره وبنيته وأساليبه كمادة مصدرية، ثم كيّفها مع ${brandName} وجمهورك في ${country}.
**لا تنسخ النصوص حرفيًا. ولا تستبعد فكرة لمجرد أنها محتوى المرجع.**

## اختبار التكييف — ثلاثة أسئلة
1. هل الرقم من تجربتك أنت؟ (لا نتائج مستعارة)
2. هل المثال من سوق ${country} فعلًا؟
3. هل يفهمها جمهورك بلا خلفية تقنية؟

إذا مرّت الثلاثة — صارت فكرتك.

## المصادر
${sources.length ? sources.map((s) => `- **${s.name}** \`${s.ref}\` — ${s.role === 'primary' ? 'مرجع أساسي (موضوع وأسلوب)' : 'كشف فجوة (ما هو مشبع)'}`).join('\n') : '_لم تُضف مصادر بعد._'}

## استثناء واحد
لا تنقل أخبارًا. هذا يكسر التموضع.
`;
writeFileSync(join(HERE, 'brain', '04-references.md'), refDoc, 'utf8');
ok('brain/04-references.md');

writeFileSync(join(HERE, 'scripts', 'sources.json'), JSON.stringify(sources, null, 2) + '\n', 'utf8');
ok('scripts/sources.json');

const secret = 'wh_' + randomBytes(24).toString('base64url');
const cfg = {
  _note: 'لا تشارك هذا الملف — فيه سرّ الـwebhook. ولا يحتاج أي مفتاح Anthropic.',
  brandName,
  model: 'sonnet',
  claudeBin,
  mode: 'local',
  contextWebhook: 'http://localhost:5678/webhook/sawwi/wf1-context',
  ingestWebhook: 'http://localhost:5678/webhook/sawwi/wf1-ideas',
  wf2SlotWebhook: 'http://localhost:5678/webhook/sawwi/wf2-slot',
  wf2PackageWebhook: 'http://localhost:5678/webhook/sawwi/wf2-package',
  authHeader: 'x-sawwi-key',
  authSecret: secret,
  sheetId: '',
  googleKeyPath: '',
  telegramChatId: '',
};
writeFileSync(join(HERE, 'scripts', 'config.json'), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
ok('scripts/config.json — وسرّ webhook وُلِّد لك');

// ───────────────────── ٥ · الخطوة التالية ─────────────────────
head('٥ · جاهز');

console.log(`براندك: ${C.b}${brandName}${C.r}`);
console.log(`المراجع: ${sources.length}`);
console.log(`الوضع: ${C.b}محلي${C.r} — بلا Docker ولا n8n\n`);

console.log(`${C.b}جرّب الآن:${C.r}`);
console.log(`  ${C.c}node scripts/wf1-ideas.mjs --days 14 --limit 2 --dry-run${C.r}`);
console.log(`  ${C.dim}يلتقط فيديوهين ويطبع الأفكار دون حفظ — لترى الجودة أولًا.${C.r}\n`);

console.log(`${C.b}للنظام الكامل${C.r} (Google Sheets + n8n + تيليجرام):`);
console.log(`  اقرأ ${C.c}SETUP-FULL.md${C.r} — خطوة بخطوة بالصور.\n`);

console.log(`${C.dim}تذكير: هذا النظام يستخدم اشتراك Claude عندك. لا رصيد مدفوع ولا مفتاح API.${C.r}`);

rl.close();
