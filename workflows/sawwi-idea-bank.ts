import { workflow, node, trigger, sticky, placeholder, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const contextHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'طلب السياق',
    parameters: {
      httpMethod: 'GET',
      path: 'sawwi/wf1-context',
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      options: {}
    },
    credentials: { httpHeaderAuth: newCredential('Sawwi WF1 Key') },
    position: [0, -260]
  },
  output: [{ headers: {}, query: {}, body: {} }]
});

const readBankForContext = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'قراءة البنك',
    parameters: {
      resource: 'sheet',
      operation: 'read',
      authentication: 'serviceAccount',
      documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__', cachedResultName: 'سوّي — أرشيف المحتوى' },
      sheetName: { __rl: true, mode: 'name', value: 'ideas' },
      options: { returnAllMatches: 'returnAllMatches' }
    },
    credentials: { googleApi: newCredential('Google Sheets — Sawwi') },
    alwaysOutputData: true,
    position: [240, -260]
  },
  output: [{ id: 'IDEA-0001', topic_key: 'فرز-السير-الذاتيه', sawwi_angle: 'زاوية', hook: 'خطاف', status: 'new', source_video_id: 'abc123' }]
});

const buildContext = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'بناء السياق',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const rows = $input.all().map(i => i.json).filter(r => r && r.id);\n" +
        "const known = [];\n" +
        "const corpus = [];\n" +
        "for (const r of rows) {\n" +
        "  if (r.source_video_id) { known.push(String(r.source_video_id)); }\n" +
        "  corpus.push({\n" +
        "    id: r.id,\n" +
        "    topic_key: r.topic_key || '',\n" +
        "    sawwi_angle: r.sawwi_angle || '',\n" +
        "    hook: r.hook || '',\n" +
        "    status: r.status || 'new',\n" +
        "    dedup_tokens: r.dedup_tokens || ''\n" +
        "  });\n" +
        "}\n" +
        "return [{ json: {\n" +
        "  known_video_ids: Array.from(new Set(known)),\n" +
        "  corpus: corpus,\n" +
        "  bank_size: corpus.length,\n" +
        "  served_at: new Date().toISOString()\n" +
        "} }];"
    },
    position: [480, -260]
  },
  output: [{ known_video_ids: ['abc123'], corpus: [{ id: 'IDEA-0001', topic_key: 'فرز-السير-الذاتيه', sawwi_angle: 'زاوية', hook: 'خطاف', status: 'new', dedup_tokens: '' }], bank_size: 1, served_at: '2026-09-20T02:00:00.000Z' }]
});

const respondContext = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'رد السياق',
    parameters: { respondWith: 'firstIncomingItem', options: {} },
    position: [720, -260]
  }
});

const ideasHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'استقبال الأفكار',
    parameters: {
      httpMethod: 'POST',
      path: 'sawwi/wf1-ideas',
      authentication: 'headerAuth',
      responseMode: 'responseNode',
      options: {}
    },
    credentials: { httpHeaderAuth: newCredential('Sawwi WF1 Key') },
    position: [0, 160]
  },
  output: [{ body: { ideas: [{ topic_key: 'فرز-السير-الذاتيه', pillar: 'تعليمي', series: 'خطوة بخطوة', hook: 'خطاف', sawwi_angle: 'زاوية', saudi_example: 'مثال', original_idea: 'الأصل', needs_experiment: 'نعم', effort: 'متوسط', score: 4, source_video_id: 'abc123' }] } }]
});

const readBankForDedup = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'قراءة البنك للمقارنة',
    parameters: {
      resource: 'sheet',
      operation: 'read',
      authentication: 'serviceAccount',
      documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__', cachedResultName: 'سوّي — أرشيف المحتوى' },
      sheetName: { __rl: true, mode: 'name', value: 'ideas' },
      options: { returnAllMatches: 'returnAllMatches' }
    },
    credentials: { googleApi: newCredential('Google Sheets — Sawwi') },
    alwaysOutputData: true,
    position: [240, 160]
  },
  output: [{ id: 'IDEA-0001', topic_key: 'فرز-السير-الذاتيه', sawwi_angle: 'زاوية', hook: 'خطاف', status: 'new' }]
});

const dedupe = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'منع التكرار والترقيم',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const body = $('استقبال الأفكار').first().json.body || {};\n" +
        "const incoming = Array.isArray(body.ideas) ? body.ideas : [];\n" +
        "const bank = $input.all().map(i => i.json).filter(r => r && r.id);\n" +
        "const STOP = new Set(['في','من','على','الى','عن','مع','اللي','عشان','هذا','هذه','ان','او','ما','لا','كل','بعد','قبل','هو','هي','انت','يكون','تكون','الذي','التي','هل','كيف','وش','بدون','الي','ثم','عند','بين','لكن','حتى','كان','عشر','اكثر','اقل']);\n" +
        "function norm(s) {\n" +
        "  return String(s == null ? '' : s)\n" +
        "    .replace(/[\\u064B-\\u0652\\u0670\\u0640]/g, '')\n" +
        "    .replace(/[\\u0623\\u0625\\u0622\\u0671]/g, '\\u0627')\n" +
        "    .replace(/\\u0649/g, '\\u064A')\n" +
        "    .replace(/\\u0629/g, '\\u0647')\n" +
        "    .replace(/\\u0624/g, '\\u0648')\n" +
        "    .replace(/\\u0626/g, '\\u064A')\n" +
        "    .replace(/[^\\u0621-\\u064Aa-zA-Z0-9\\s]/g, ' ')\n" +
        "    .toLowerCase().replace(/\\s+/g, ' ').trim();\n" +
        "}\n" +
        "function toks(s) {\n" +
        "  const out = new Set();\n" +
        "  const parts = norm(s).split(' ');\n" +
        "  for (const w of parts) { if (w.length > 2 && !STOP.has(w)) { out.add(w); } }\n" +
        "  return out;\n" +
        "}\n" +
        "function jac(a, b) {\n" +
        "  if (!a.size || !b.size) { return 0; }\n" +
        "  let inter = 0;\n" +
        "  for (const x of a) { if (b.has(x)) { inter++; } }\n" +
        "  return inter / (a.size + b.size - inter);\n" +
        "}\n" +
        "const bankEntries = bank.map(r => ({\n" +
        "  id: r.id,\n" +
        "  key: norm(r.topic_key),\n" +
        "  set: toks(String(r.topic_key || '') + ' ' + String(r.sawwi_angle || '') + ' ' + String(r.hook || ''))\n" +
        "}));\n" +
        "let maxNum = 0;\n" +
        "for (const r of bank) {\n" +
        "  const m = String(r.id).match(/(\\d+)\\s*$/);\n" +
        "  if (m) { const n = parseInt(m[1], 10); if (n > maxNum) { maxNum = n; } }\n" +
        "}\n" +
        "const now = new Date().toISOString();\n" +
        "const accepted = [];\n" +
        "const rows = [];\n" +
        "let duplicates = 0;\n" +
        "let held = 0;\n" +
        "const dropped = [];\n" +
        "for (const idea of incoming) {\n" +
        "  const key = norm(idea.topic_key);\n" +
        "  const set = toks(String(idea.topic_key || '') + ' ' + String(idea.sawwi_angle || '') + ' ' + String(idea.hook || ''));\n" +
        "  if (!key || set.size === 0) { duplicates++; dropped.push('فكرة بلا مفتاح'); continue; }\n" +
        "  const pool = bankEntries.concat(accepted);\n" +
        "  let best = 0;\n" +
        "  let bestId = '';\n" +
        "  for (const e of pool) {\n" +
        "    if (e.key && e.key === key) { best = 1; bestId = e.id; break; }\n" +
        "    const s = jac(set, e.set);\n" +
        "    if (s > best) { best = s; bestId = e.id; }\n" +
        "  }\n" +
        "  if (best >= 0.55) { duplicates++; dropped.push(String(idea.hook || key).slice(0, 40) + ' ≈ ' + bestId); continue; }\n" +
        "  const status = best >= 0.40 ? 'hold' : 'new';\n" +
        "  if (status === 'hold') { held++; }\n" +
        "  maxNum++;\n" +
        "  const id = 'IDEA-' + String(maxNum).padStart(4, '0');\n" +
        "  accepted.push({ id: id, key: key, set: set });\n" +
        "  rows.push({\n" +
        "    id: id,\n" +
        "    status: status,\n" +
        "    score: idea.score == null ? 3 : idea.score,\n" +
        "    pillar: idea.pillar || '',\n" +
        "    series: idea.series || '',\n" +
        "    hook: idea.hook || '',\n" +
        "    sawwi_angle: idea.sawwi_angle || '',\n" +
        "    saudi_example: idea.saudi_example || '',\n" +
        "    original_idea: idea.original_idea || '',\n" +
        "    needs_experiment: idea.needs_experiment || '',\n" +
        "    experiment_note: idea.experiment_note || '',\n" +
        "    effort: idea.effort || '',\n" +
        "    status_note: status === 'hold' ? ('تشابه ' + Math.round(best * 100) + '% مع ' + bestId) : '',\n" +
        "    topic_key: idea.topic_key || '',\n" +
        "    source_channel: idea.source_channel || '',\n" +
        "    source_title: idea.source_title || '',\n" +
        "    source_url: idea.source_url || '',\n" +
        "    source_published_at: idea.source_published_at || '',\n" +
        "    source_views: idea.source_views == null ? '' : idea.source_views,\n" +
        "    source_video_id: idea.source_video_id || '',\n" +
        "    captured_at: now,\n" +
        "    updated_at: now,\n" +
        "    used_date: '',\n" +
        "    post_id: '',\n" +
        "    dedup_tokens: Array.from(set).join(' ')\n" +
        "  });\n" +
        "}\n" +
        "const top = rows.slice(0, 3).map(r => '• ' + r.hook + '  [' + r.pillar + ' · ' + r.series + ' · ' + r.score + '/5]');\n" +
        "let report = 'بنك الأفكار — ' + now.slice(0, 10) + '\\n';\n" +
        "report += 'وصل ' + incoming.length + ' · أُضيف ' + rows.length + ' · مكرر ' + duplicates + ' · معلّق ' + held + '\\n';\n" +
        "report += 'حجم البنك الآن: ' + (bank.length + rows.length) + '\\n';\n" +
        "if (top.length) { report += '\\n' + top.join('\\n'); }\n" +
        "if (dropped.length) { report += '\\n\\nاستُبعد للتكرار:\\n' + dropped.slice(0, 5).join('\\n'); }\n" +
        "return [{ json: { rows: rows, added: rows.length, duplicates: duplicates, held: held, received: incoming.length, bank_size: bank.length + rows.length, report: report } }];"
    },
    position: [480, 160]
  },
  output: [{ rows: [{ id: 'IDEA-0002', status: 'new', hook: 'خطاف', pillar: 'بزنس', series: 'قبل ← بعد', score: 4 }], added: 1, duplicates: 2, held: 0, received: 3, bank_size: 2, report: 'بنك الأفكار — 2026-09-20' }]
});

const hasNew = ifElse({
  version: 2.2,
  config: {
    name: 'فيه جديد؟',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose' },
        conditions: [{ leftValue: expr('{{ $json.added }}'), operator: { type: 'number', operation: 'gt' }, rightValue: 0 }],
        combinator: 'and'
      }
    },
    position: [720, 160]
  }
});

const explodeRows = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'تفكيك الصفوف',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const rows = $input.first().json.rows || [];\n" +
        "return rows.map(r => ({ json: r }));"
    },
    position: [960, 60]
  },
  output: [{ id: 'IDEA-0002', status: 'new', score: 4, pillar: 'بزنس', series: 'قبل ← بعد', hook: 'خطاف', sawwi_angle: 'زاوية', saudi_example: 'مثال', original_idea: 'الأصل', needs_experiment: 'نعم', experiment_note: 'جرّب', effort: 'متوسط', status_note: '', topic_key: 'مفتاح', source_channel: 'Nate Herk', source_title: 'عنوان', source_url: 'https://youtu.be/x', source_published_at: '2026-09-19T00:00:00Z', source_views: 31013, source_video_id: 'abc123', captured_at: '2026-09-20T02:00:00.000Z', updated_at: '2026-09-20T02:00:00.000Z', used_date: '', post_id: '', dedup_tokens: 'فرز السير' }]
});

const appendBank = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'إضافة للبنك',
    parameters: {
      resource: 'sheet',
      operation: 'append',
      authentication: 'serviceAccount',
      documentId: { __rl: true, mode: 'id', value: '__SHEET_ID__', cachedResultName: 'سوّي — أرشيف المحتوى' },
      sheetName: { __rl: true, mode: 'name', value: 'ideas' },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        schema: [
          { id: 'id', displayName: 'id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'score', displayName: 'score', required: false, defaultMatch: false, display: true, type: 'number', canBeUsedToMatch: false },
          { id: 'pillar', displayName: 'pillar', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'series', displayName: 'series', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'hook', displayName: 'hook', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'sawwi_angle', displayName: 'sawwi_angle', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'saudi_example', displayName: 'saudi_example', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'original_idea', displayName: 'original_idea', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'needs_experiment', displayName: 'needs_experiment', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'experiment_note', displayName: 'experiment_note', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'effort', displayName: 'effort', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'status_note', displayName: 'status_note', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'topic_key', displayName: 'topic_key', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'source_channel', displayName: 'source_channel', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'source_title', displayName: 'source_title', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'source_url', displayName: 'source_url', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'source_published_at', displayName: 'source_published_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'source_views', displayName: 'source_views', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'source_video_id', displayName: 'source_video_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'captured_at', displayName: 'captured_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'updated_at', displayName: 'updated_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'used_date', displayName: 'used_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'post_id', displayName: 'post_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'dedup_tokens', displayName: 'dedup_tokens', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false }
        ]
      },
      options: { handlingExtraData: 'ignoreIt' }
    },
    credentials: { googleApi: newCredential('Google Sheets — Sawwi') },
    position: [1200, 60]
  },
  output: [{ id: 'IDEA-0002' }]
});

const notifyBank = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'ملخّص البنك',
    parameters: {
      resource: 'message',
      operation: 'sendMessage',
      chatId: '__TELEGRAM_CHAT_ID__',
      text: expr("{{ $('منع التكرار والترقيم').first().json.report }}"),
      additionalFields: { appendAttribution: false, disable_web_page_preview: true }
    },
    credentials: { telegramApi: newCredential('Telegram — Sawwi') },
    executeOnce: true,
    onError: 'continueRegularOutput',
    position: [1440, 60]
  },
  output: [{ ok: true }]
});

const respondAdded = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'رد النجاح',
    parameters: {
      respondWith: 'json',
      responseBody: expr("{{ { ok: true, added: $('منع التكرار والترقيم').first().json.added, duplicates: $('منع التكرار والترقيم').first().json.duplicates, held: $('منع التكرار والترقيم').first().json.held, bank_size: $('منع التكرار والترقيم').first().json.bank_size } }}"),
      options: {}
    },
    executeOnce: true,
    position: [1680, 60]
  }
});

const respondNone = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'رد بلا جديد',
    parameters: {
      respondWith: 'json',
      responseBody: expr("{{ { ok: true, added: 0, duplicates: $json.duplicates, held: $json.held, bank_size: $json.bank_size, note: 'كل الأفكار الواردة مكررة' } }}"),
      options: {}
    },
    position: [960, 300]
  }
});

const noteContext = sticky(
  '## الطرف الأول — السياق\nالسكربت المحلي يسأل: وش عندك في البنك؟\nيرجع له معرّفات الفيديوهات المعالَجة (فلا يُعاد تحليلها) ومادة المقارنة (فلا تتكرر الأفكار).\n\nقراءة البنك فيها alwaysOutputData لأن البنك الفارغ حالة صحيحة يجب أن تُجاب لا أن تُسقِط الرد.',
  [contextHook, readBankForContext, buildContext, respondContext],
  { color: 3 }
);

const noteDedup = sticky(
  '## الطرف الثاني — الاستقبال\nالسكربت يرسل الأفكار بعد أن ولّدها claude محليًا على الاشتراك.\n\nمنع التكرار هنا لا في السكربت: n8n هو الكاتب الوحيد للبنك، فلا يحدث تضارب.\nتطبيع عربي (تشكيل · أ إ آ←ا · ى←ي · ة←ه) ثم جاكارد:\n≥ ٠٫٥٥ تُحذف · ٠٫٤٠–٠٫٥٥ تُحفظ hold مع ذكر الشبيه · أقل تُحفظ new.',
  [ideasHook, readBankForDedup, dedupe, hasNew],
  { color: 4 }
);

const noteNoKey = sticky(
  '## لا مفتاح Anthropic في هذا الـworkflow\nالتصنيف يتم على جهازك عبر claude -p باشتراكك.\nn8n لا يستدعي أي نموذج هنا — فقط Sheets وتيليجرام ومنع التكرار.\n\nالسكربت: sawwi-autopilot/scripts/wf1-ideas.mjs',
  [explodeRows, appendBank, notifyBank, respondAdded],
  { color: 5 }
);

export default workflow('sawwi-idea-bank', 'سوّي — بنك الأفكار (WF1)')
  .add(contextHook)
  .to(readBankForContext)
  .to(buildContext)
  .to(respondContext)
  .add(ideasHook)
  .to(readBankForDedup)
  .to(dedupe)
  .to(hasNew
    .onTrue(explodeRows.to(appendBank).to(notifyBank).to(respondAdded))
    .onFalse(respondNone))
  .add(noteContext)
  .add(noteDedup)
  .add(noteNoKey);
