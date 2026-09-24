import { workflow, node, trigger, sticky, newCredential, ifElse, expr } from '@n8n/workflow-sdk';

const SHEET = '__SHEET_ID__';
const SHEET_NAME = 'سوّي — أرشيف المحتوى';

const slotHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'طلب موعد اليوم',
    parameters: { httpMethod: 'GET', path: 'sawwi/wf2-slot', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: newCredential('Sawwi WF1 Key') },
    position: [0, -280]
  },
  output: [{ query: { idea: '' }, headers: {}, body: {} }]
});

const readIdeas = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'قراءة بنك الأفكار',
    parameters: {
      resource: 'sheet', operation: 'read', authentication: 'serviceAccount',
      documentId: { __rl: true, mode: 'id', value: SHEET, cachedResultName: SHEET_NAME },
      sheetName: { __rl: true, mode: 'name', value: 'ideas' },
      options: { returnAllMatches: 'returnAllMatches' }
    },
    credentials: { googleApi: newCredential('Google Sheets — Sawwi') },
    alwaysOutputData: true,
    position: [240, -280]
  },
  output: [{ id: 'IDEA-0004', status: 'approved', score: 5, pillar: 'بزنس', series: 'قبل ← بعد', hook: 'خطاف', sawwi_angle: 'زاوية', saudi_example: 'مثال', needs_experiment: 'نعم', experiment_note: '' }]
});

const readPosts = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'قراءة المنشورات السابقة',
    parameters: {
      resource: 'sheet', operation: 'read', authentication: 'serviceAccount',
      documentId: { __rl: true, mode: 'id', value: SHEET, cachedResultName: SHEET_NAME },
      sheetName: { __rl: true, mode: 'name', value: 'posts' },
      options: { returnAllMatches: 'returnAllMatches' }
    },
    credentials: { googleApi: newCredential('Google Sheets — Sawwi') },
    alwaysOutputData: true,
    executeOnce: true,
    position: [480, -280]
  },
  output: [{ post_id: 'POST-0001', title: 'عنوان', hook: 'خطاف' }]
});

const pickIdea = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'اختيار فكرة اليوم',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const RIYADH = new Date(Date.now() + 3 * 60 * 60 * 1000);\n" +
        "const date = RIYADH.toISOString().slice(0, 10);\n" +
        "const dow = RIYADH.getUTCDay();\n" +
        "const PLAN = {\n" +
        "  0: { day: 'الأحد', pillar: 'بزنس', series: 'لو عندي ___ اليوم', cta_stage: 'تأهيل', production_mode: 'صوت + شاشة' },\n" +
        "  1: { day: 'الاثنين', pillar: 'انتشار', series: 'عطيناه وظيفة', cta_stage: 'وعي', production_mode: 'بدون ظهور' },\n" +
        "  2: { day: 'الثلاثاء', pillar: 'بزنس', series: 'قبل ← بعد', cta_stage: 'تأهيل', production_mode: 'صوت + شاشة' },\n" +
        "  3: { day: 'الأربعاء', pillar: 'بزنس', series: 'الحلقة — الدخل', cta_stage: 'قائمة', production_mode: 'ظهور على الكاميرا' },\n" +
        "  4: { day: 'الخميس', pillar: 'تعليمي', series: 'خطوة بخطوة', cta_stage: 'حفظ', production_mode: 'صوت + شاشة' },\n" +
        "  5: { day: 'الجمعة', pillar: 'انتشار', series: 'هل نقدر نخليه يسوّيها؟', cta_stage: 'وعي', production_mode: 'بدون ظهور' },\n" +
        "  6: { day: 'السبت', pillar: 'انتشار', series: 'هل نقدر نخليه يسوّيها؟', cta_stage: 'وعي', production_mode: 'ظهور على الكاميرا' }\n" +
        "};\n" +
        "const p = PLAN[dow];\n" +
        "const slot = { date: date, weekday: p.day, pillar: p.pillar, series: p.series, cta_stage: p.cta_stage, production_mode: p.production_mode, linkedin_day: dow === 0 || dow === 1 || dow === 2 };\n" +
        "const ideas = $('قراءة بنك الأفكار').all().map(i => i.json).filter(r => r && r.id);\n" +
        "const posts = $input.all().map(i => i.json).filter(r => r && r.post_id);\n" +
        "const forced = String($('طلب موعد اليوم').first().json.query && $('طلب موعد اليوم').first().json.query.idea || '').trim();\n" +
        "const usable = ideas.filter(r => { const s = String(r.status || 'new').trim(); return s !== 'used' && s !== 'rejected' && s !== 'hold'; });\n" +
        "const score = (r) => {\n" +
        "  let v = Number(r.score) || 3;\n" +
        "  if (String(r.status).trim() === 'approved') { v += 10; }\n" +
        "  if (String(r.pillar).trim() === slot.pillar) { v += 4; }\n" +
        "  if (String(r.series).trim() === slot.series) { v += 3; }\n" +
        "  return v;\n" +
        "};\n" +
        "let chosen = null;\n" +
        "if (forced) { chosen = ideas.find(r => String(r.id).trim() === forced) || null; }\n" +
        "else if (usable.length) { chosen = usable.slice().sort((a, b) => score(b) - score(a))[0]; }\n" +
        "const counts = { approved: 0, 'new': 0, hold: 0, rejected: 0, used: 0 };\n" +
        "for (const r of ideas) { const s = String(r.status || 'new').trim(); if (counts[s] !== undefined) { counts[s]++; } }\n" +
        "return [{ json: {\n" +
        "  slot: slot,\n" +
        "  idea: chosen,\n" +
        "  recent: posts.slice(-14).map(p => ({ title: p.title, hook: p.hook })),\n" +
        "  bank_total: ideas.length,\n" +
        "  approved_count: counts.approved,\n" +
        "  new_count: counts['new'],\n" +
        "  picked_because: chosen ? (forced ? 'محددة يدويًا' : 'الأعلى ملاءمة لركيزة اليوم') : 'لا فكرة صالحة'\n" +
        "} }];"
    },
    position: [720, -280]
  },
  output: [{ slot: { date: '2026-09-23', weekday: 'الأربعاء', pillar: 'بزنس', series: 'الحلقة — الدخل', cta_stage: 'قائمة', production_mode: 'ظهور على الكاميرا', linkedin_day: false }, idea: { id: 'IDEA-0004', hook: 'خطاف', sawwi_angle: 'زاوية', saudi_example: 'مثال', needs_experiment: 'نعم', status: 'approved' }, recent: [], bank_total: 9, approved_count: 1, new_count: 8, picked_because: 'الأعلى ملاءمة لركيزة اليوم' }]
});

const respondSlot = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: { name: 'رد الموعد', parameters: { respondWith: 'firstIncomingItem', options: {} }, position: [960, -280] }
});

const pkgHook = trigger({
  type: 'n8n-nodes-base.webhook',
  version: 2.1,
  config: {
    name: 'استقبال الحزمة',
    parameters: { httpMethod: 'POST', path: 'sawwi/wf2-package', authentication: 'headerAuth', responseMode: 'responseNode', options: {} },
    credentials: { httpHeaderAuth: newCredential('Sawwi WF1 Key') },
    position: [0, 180]
  },
  output: [{ body: { slot: { date: '2026-09-23', pillar: 'بزنس', series: 'قبل ← بعد' }, idea_id: 'IDEA-0004', package: {} } }]
});

const brandGuard = node({
  type: 'n8n-nodes-base.code',
  version: 2,
  config: {
    name: 'حارس البراند',
    parameters: {
      mode: 'runOnceForAllItems',
      language: 'javaScript',
      jsCode:
        "const body = $input.first().json.body || {};\n" +
        "const pkg = body.package || {};\n" +
        "const slot = body.slot || {};\n" +
        "const BANNED = ['ثورة','سيقضي على وظيفتك','بيأخذ وظيفتك','ياخذ وظيفتك','أسرار','ربح سريع','دخل بدون مجهود','ستغيّر حياتك','راح تتغير حياتك','أفضل ١٠ أدوات','أفضل 10 أدوات','مجانًا ١٠٠٪','الكل لازم يتعلم','لا تفوّت','خرافي','جنوني','مذهل'];\n" +
        "const SAUDI = ['خطاب','واتساب','فاتورة','فواتير','مناقصة','مناقصات','إجازة','دوام','سيرة ذاتية','سير ذاتية','سيَر','عرض سعر','موظف','الرياض','السعودي','راتب','رواتب'];\n" +
        "const LIMITS = { tiktok: 300, instagram: 400, snapchat: 300, linkedin: 1300, x: 280 };\n" +
        "const caps = pkg.captions || {};\n" +
        "const vid = pkg.video || {};\n" +
        "const blob = JSON.stringify(pkg);\n" +
        "const checks = [];\n" +
        "const add = (id, name, passed, note) => checks.push({ id: id, name: name, passed: passed, note: note || '' });\n" +
        "const hits = BANNED.filter(w => blob.indexOf(w) !== -1);\n" +
        "add(1, 'الكلمات المحظورة', hits.length === 0, hits.join('، '));\n" +
        "const NUMW = new Set([\"واحد\",\"واحده\",\"اثنين\",\"اثنان\",\"ثنتين\",\"ثلاث\",\"ثلاثه\",\"ثلاثين\",\"ثلاثون\",\"اربع\",\"اربعه\",\"اربعين\",\"اربعون\",\"خمس\",\"خمسه\",\"خمسين\",\"خمسون\",\"ست\",\"سته\",\"ستين\",\"ستون\",\"سبع\",\"سبعه\",\"سبعين\",\"سبعون\",\"ثمان\",\"ثمانيه\",\"ثمانين\",\"ثمانون\",\"تسع\",\"تسعه\",\"تسعين\",\"تسعون\",\"عشر\",\"عشره\",\"عشرين\",\"عشرون\",\"مئه\",\"مايه\",\"مئتين\",\"الف\",\"الفين\",\"نصف\",\"ربع\",\"ثلث\",\"عشرات\",\"مئات\",\"الاف\"]);\n" +
        "const arNorm = (x) => String(x).replace(/[\\u064B-\\u0652\\u0640]/g, \"\").replace(/[\\u0623\\u0625\\u0622]/g, \"\\u0627\").replace(/\\u0629/g, \"\\u0647\").replace(/\\u0649/g, \"\\u064A\");\n" +
        "const scriptTxt = String(vid.script || \"\");\n" +
        "const hasDigit = /[0-9\\u0660-\\u0669]/.test(scriptTxt);\n" +
        "const hasWordNum = arNorm(scriptTxt).split(/[^\\u0621-\\u064A]+/).some(w => NUMW.has(w));\n" +
        "const hasNum = hasDigit || hasWordNum;\n" +
        "add(2, 'الرقم في النص الصوتي', hasNum, hasNum ? '' : 'لا يوجد رقم ملموس — لا أرقامًا ولا كلمات عدد');\n" +
        "const verdict = String(vid.verdict || '').trim();\n" +
        "add(3, 'الحكم الصريح', verdict.length > 0, verdict ? '' : 'لا يوجد حكم');\n" +
        "const saudi = SAUDI.some(w => blob.indexOf(w) !== -1);\n" +
        "add(4, 'السياق السعودي', saudi, saudi ? '' : 'لا يوجد مثال سعودي ملموس');\n" +
        "const fear = /(ياخذ|يأخذ|تخسر|بتفقد) وظيفت|يستبدل(ك| الموظف)/.test(blob);\n" +
        "add(5, 'التخويف من فقدان الوظيفة', !fear, fear ? 'وُجد إيحاء بفقدان الوظيفة' : '');\n" +
        "const hooks = vid.hooks || [];\n" +
        "const longHooks = hooks.filter(h => String(h).trim().split(/\\s+/).length > 12);\n" +
        "add(6, 'طول الخطّاف', hooks.length === 3 && longHooks.length === 0, longHooks.join(' | '));\n" +
        "const noCta = Object.keys(caps).filter(k => !String((caps[k] && caps[k].cta) || '').trim());\n" +
        "add(7, 'وجود CTA', noCta.length === 0, noCta.join('، '));\n" +
        "const chip = String((vid.result && vid.result.chip) || '');\n" +
        "add(8, 'رقاقة النتيجة', /[0-9\\u0660-\\u0669]/.test(chip), chip ? '' : 'رقاقة الوقت فارغة');\n" +
        "const tooLong = Object.keys(LIMITS).filter(k => String((caps[k] && caps[k].text) || '').length > LIMITS[k]);\n" +
        "const ytTitle = String((caps.youtube_shorts && caps.youtube_shorts.title) || '');\n" +
        "if (ytTitle.length > 100) { tooLong.push('youtube_shorts.title'); }\n" +
        "add(9, 'حدود الطول', tooLong.length === 0, tooLong.join('، '));\n" +
        "const cover = String((pkg.visual && pkg.visual.cover_text) || '').trim();\n" +
        "const coverWords = cover ? cover.split(/\\s+/).length : 0;\n" +
        "add(10, 'نص الغلاف أربع كلمات كحد أقصى', coverWords > 0 && coverWords <= 4, cover);\n" +
        "const failed = checks.filter(c => !c.passed);\n" +
        "const status = failed.length === 0 ? 'pass' : 'fail';\n" +
        "const postId = 'POST-' + String(slot.date || '').replace(/-/g, '');\n" +
        "const scenes = (vid.scenes || []).map(s => s.t + ' · ' + s.action + ' — ' + s.on_screen).join('\\n');\n" +
        "let msg = '';\n" +
        "if (status === 'pass') {\n" +
        "  msg += '🎬 حزمة ' + slot.date + ' · ' + slot.weekday + '\\n' + slot.pillar + ' · ' + slot.series + '\\n';\n" +
        "  msg += 'من الفكرة: ' + (body.idea_id || '') + '\\n\\n';\n" +
        "  msg += '📌 ' + (pkg.meta && pkg.meta.title || '') + '\\n\\n';\n" +
        "  msg += '🎣 الخطّافات:\\n' + hooks.map((h, i) => (i + 1) + '. ' + h).join('\\n') + '\\n\\n';\n" +
        "  msg += '⏱ ' + chip + '\\n⚖️ ' + verdict + '\\n\\n';\n" +
        "  msg += '🎙 النص الصوتي:\\n' + (vid.script || '') + '\\n\\n';\n" +
        "  msg += '🎞 المشاهد:\\n' + scenes + '\\n\\n';\n" +
        "  msg += '🖼 الغلاف: ' + cover + ' | الرقم: ' + ((pkg.visual && pkg.visual.cover_number) || '');\n" +
        "} else {\n" +
        "  msg = '⚠️ حزمة ' + slot.date + ' لم تجتز الحارس\\n\\n' + failed.map(c => '❌ ' + c.name + (c.note ? ' — ' + c.note : '')).join('\\n');\n" +
        "}\n" +
        "const capMsg = ['📱 كابشنات ' + slot.date,\n" +
        "  '── تيك توك ──\\n' + ((caps.tiktok && caps.tiktok.text) || '') + '\\n' + (((caps.tiktok && caps.tiktok.hashtags) || []).join(' ')),\n" +
        "  '── إنستقرام ──\\n' + ((caps.instagram && caps.instagram.text) || '') + '\\n' + (((caps.instagram && caps.instagram.hashtags) || []).join(' ')),\n" +
        "  '── يوتيوب شورتس ──\\n' + ytTitle + '\\n' + ((caps.youtube_shorts && caps.youtube_shorts.text) || ''),\n" +
        "  '── سناب ──\\n' + ((caps.snapchat && caps.snapchat.text) || ''),\n" +
        "  '── إكس ──\\n' + ((caps.x && caps.x.text) || '')].join('\\n\\n');\n" +
        "const liMsg = '💼 لينكدإن ' + slot.date + '\\n\\n' + ((caps.linkedin && caps.linkedin.text) || '') + '\\n\\n' + (((caps.linkedin && caps.linkedin.hashtags) || []).join(' ')) + '\\n\\n── EN ──\\n' + ((caps.linkedin && caps.linkedin.en_version) || '');\n" +
        "return [{ json: {\n" +
        "  guard_status: status, checks: checks, failed_count: failed.length,\n" +
        "  post_id: postId, idea_id: body.idea_id || '', slot: slot, package: pkg,\n" +
        "  msg_main: msg.slice(0, 4000), msg_caps: capMsg.slice(0, 4000), msg_li: liMsg.slice(0, 4000),\n" +
        "  row: {\n" +
        "    post_id: postId, date: slot.date || '', day_index: '', pillar: slot.pillar || '', series: slot.series || '',\n" +
        "    title: (pkg.meta && pkg.meta.title) || '', hook: hooks[0] || '', chip: chip, verdict: verdict,\n" +
        "    idea_id: body.idea_id || '', platforms: 'تيك توك، إنستقرام، شورتس، سناب، لينكدإن، إكس',\n" +
        "    status: 'جاهز للتصوير', payload: JSON.stringify(pkg).slice(0, 40000)\n" +
        "  }\n" +
        "} }];"
    },
    position: [240, 180]
  },
  output: [{ guard_status: 'pass', checks: [], failed_count: 0, post_id: 'POST-20260923', idea_id: 'IDEA-0004', slot: {}, package: {}, msg_main: 'نص', msg_caps: 'نص', msg_li: 'نص', row: { post_id: 'POST-20260923', date: '2026-09-23', pillar: 'بزنس', series: 'قبل ← بعد', title: 'عنوان', hook: 'خطاف', chip: '٣ ساعات ← ١٢ دقيقة', verdict: 'ينفع', idea_id: 'IDEA-0004', platforms: 'كل المنصات', status: 'جاهز للتصوير', payload: '{}' } }]
});

const guardGate = ifElse({
  version: 2.2,
  config: {
    name: 'اجتاز الحارس؟',
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
        conditions: [{ leftValue: expr('{{ $json.guard_status }}'), operator: { type: 'string', operation: 'equals' }, rightValue: 'pass' }],
        combinator: 'and'
      }
    },
    position: [480, 180]
  }
});

const savePost = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'أرشفة المنشور',
    parameters: {
      resource: 'sheet', operation: 'append', authentication: 'serviceAccount',
      documentId: { __rl: true, mode: 'id', value: SHEET, cachedResultName: SHEET_NAME },
      sheetName: { __rl: true, mode: 'name', value: 'posts' },
      columns: {
        mappingMode: 'defineBelow',
        value: {
          post_id: expr('{{ $json.row.post_id }}'), date: expr('{{ $json.row.date }}'),
          day_index: expr('{{ $json.row.day_index }}'), pillar: expr('{{ $json.row.pillar }}'),
          series: expr('{{ $json.row.series }}'), title: expr('{{ $json.row.title }}'),
          hook: expr('{{ $json.row.hook }}'), chip: expr('{{ $json.row.chip }}'),
          verdict: expr('{{ $json.row.verdict }}'), idea_id: expr('{{ $json.row.idea_id }}'),
          platforms: expr('{{ $json.row.platforms }}'), status: expr('{{ $json.row.status }}'),
          payload: expr('{{ $json.row.payload }}')
        },
        schema: [
          { id: 'post_id', displayName: 'post_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'date', displayName: 'date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'day_index', displayName: 'day_index', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'pillar', displayName: 'pillar', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'series', displayName: 'series', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'title', displayName: 'title', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'hook', displayName: 'hook', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'chip', displayName: 'chip', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'verdict', displayName: 'verdict', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'idea_id', displayName: 'idea_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'platforms', displayName: 'platforms', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'payload', displayName: 'payload', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false }
        ]
      },
      options: {}
    },
    credentials: { googleApi: newCredential('Google Sheets — Sawwi') },
    onError: 'continueRegularOutput',
    position: [720, 60]
  },
  output: [{ post_id: 'POST-20260923' }]
});

const markUsed = node({
  type: 'n8n-nodes-base.googleSheets',
  version: 4.7,
  config: {
    name: 'تعليم الفكرة مستخدمة',
    parameters: {
      resource: 'sheet', operation: 'update', authentication: 'serviceAccount',
      documentId: { __rl: true, mode: 'id', value: SHEET, cachedResultName: SHEET_NAME },
      sheetName: { __rl: true, mode: 'name', value: 'ideas' },
      columns: {
        mappingMode: 'defineBelow',
        matchingColumns: ['id'],
        value: {
          id: expr("{{ $('حارس البراند').first().json.idea_id }}"),
          status: 'used',
          used_date: expr("{{ $('حارس البراند').first().json.slot.date }}"),
          post_id: expr("{{ $('حارس البراند').first().json.post_id }}"),
          updated_at: expr('{{ $now.toISO() }}')
        },
        schema: [
          { id: 'id', displayName: 'id', required: false, defaultMatch: true, display: true, type: 'string', canBeUsedToMatch: true },
          { id: 'status', displayName: 'status', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'used_date', displayName: 'used_date', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'post_id', displayName: 'post_id', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false },
          { id: 'updated_at', displayName: 'updated_at', required: false, defaultMatch: false, display: true, type: 'string', canBeUsedToMatch: false }
        ]
      },
      options: {}
    },
    credentials: { googleApi: newCredential('Google Sheets — Sawwi') },
    onError: 'continueRegularOutput',
    position: [960, 60]
  },
  output: [{ id: 'IDEA-0004' }]
});

const sendMain = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'إرسال الحزمة',
    parameters: {
      resource: 'message', operation: 'sendMessage', chatId: '__TELEGRAM_CHAT_ID__',
      text: expr("{{ $('حارس البراند').first().json.msg_main }}"),
      additionalFields: { appendAttribution: false, disable_web_page_preview: true }
    },
    credentials: { telegramApi: newCredential('Telegram — Sawwi') },
    executeOnce: true,
    onError: 'continueRegularOutput',
    position: [1200, 60]
  },
  output: [{ ok: true }]
});

const sendCaps = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'إرسال الكابشنات',
    parameters: {
      resource: 'message', operation: 'sendMessage', chatId: '__TELEGRAM_CHAT_ID__',
      text: expr("{{ $('حارس البراند').first().json.msg_caps }}"),
      additionalFields: { appendAttribution: false, disable_web_page_preview: true }
    },
    credentials: { telegramApi: newCredential('Telegram — Sawwi') },
    executeOnce: true,
    onError: 'continueRegularOutput',
    position: [1440, 60]
  },
  output: [{ ok: true }]
});

const sendLinkedin = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'إرسال لينكدإن',
    parameters: {
      resource: 'message', operation: 'sendMessage', chatId: '__TELEGRAM_CHAT_ID__',
      text: expr("{{ $('حارس البراند').first().json.msg_li }}"),
      additionalFields: { appendAttribution: false, disable_web_page_preview: true }
    },
    credentials: { telegramApi: newCredential('Telegram — Sawwi') },
    executeOnce: true,
    onError: 'continueRegularOutput',
    position: [1680, 60]
  },
  output: [{ ok: true }]
});

const respondOk = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'رد الاجتياز',
    parameters: {
      respondWith: 'json',
      responseBody: expr("{{ { ok: true, guard_status: 'pass', post_id: $('حارس البراند').first().json.post_id, idea_id: $('حارس البراند').first().json.idea_id } }}"),
      options: {}
    },
    executeOnce: true,
    position: [1920, 60]
  }
});

const sendFail = node({
  type: 'n8n-nodes-base.telegram',
  version: 1.2,
  config: {
    name: 'تقرير الرفض',
    parameters: {
      resource: 'message', operation: 'sendMessage', chatId: '__TELEGRAM_CHAT_ID__',
      text: expr('{{ $json.msg_main }}'),
      additionalFields: { appendAttribution: false }
    },
    credentials: { telegramApi: newCredential('Telegram — Sawwi') },
    onError: 'continueRegularOutput',
    position: [720, 340]
  },
  output: [{ ok: true }]
});

const respondFail = node({
  type: 'n8n-nodes-base.respondToWebhook',
  version: 1.5,
  config: {
    name: 'رد الرفض',
    parameters: {
      respondWith: 'json',
      responseBody: expr("{{ { ok: true, guard_status: 'fail', failed: $('حارس البراند').first().json.failed_count } }}"),
      options: {}
    },
    position: [960, 340]
  }
});

const noteSlot = sticky(
  '## الطرف الأول — موعد اليوم\nالسكربت المحلي يسأل: أي ركيزة اليوم وأي فكرة تناسبها؟\nالاختيار يفضّل approved ثم الأقرب لركيزة اليوم وسلسلته.\nيتجاهل used و rejected و hold.\n\nيمكن فرض فكرة بعينها: ?idea=IDEA-0004',
  [slotHook, readIdeas, readPosts, pickIdea, respondSlot],
  { color: 3 }
);

const noteGuard2 = sticky(
  '## الطرف الثاني — الحزمة\nclaude ينتجها محليًا على الاشتراك (بلا مفتاح API) ثم يرسلها هنا.\nالحارس يفحص عشر قواعد قبل أن تصلك.\n\n⛔ لا نشر في هذه النسخة — التسليم على تيليجرام فقط، والنشر بيدك.',
  [pkgHook, brandGuard, guardGate],
  { color: 4 }
);

const noteDeliver = sticky(
  '## التسليم\nثلاث رسائل: الحزمة الأساسية · الكابشنات · لينكدإن.\nوتُؤرشف في ورقة posts، وتُعلَّم الفكرة used فلا تتكرر.',
  [savePost, markUsed, sendMain, sendCaps, sendLinkedin, respondOk],
  { color: 5 }
);

export default workflow('sawwi-daily-content-v2', 'سوّي — المحتوى اليومي (WF2)')
  .add(slotHook)
  .to(readIdeas)
  .to(readPosts)
  .to(pickIdea)
  .to(respondSlot)
  .add(pkgHook)
  .to(brandGuard)
  .to(guardGate
    .onTrue(savePost.to(markUsed).to(sendMain).to(sendCaps).to(sendLinkedin).to(respondOk))
    .onFalse(sendFail.to(respondFail)))
  .add(noteSlot)
  .add(noteGuard2)
  .add(noteDeliver);
