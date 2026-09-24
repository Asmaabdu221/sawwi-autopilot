#!/usr/bin/env node
/**
 * سوّي — تجهيز جدول الأرشيف عبر Service Account
 *
 * يبني داخل جدول فاضٍ شاركته مع الروبوت:
 *   - أوراق ideas · posts · performance بصفوف العناوين
 *   - تجميد صف العناوين وتمييزه
 *   - قائمة منسدلة لعمود status: new · approved · hold · rejected · used
 *   - تلوين الحالات
 * ويحذف الورقة الافتراضية الفاضية (Sheet1 / Sayfa1 / ورقة1).
 *
 * آمن للتكرار: لا يمسح بيانات موجودة، ولا يعيد إنشاء ورقة قائمة.
 * لا يطبع المفتاح الخاص أبدًا.
 *
 * التشغيل:  node setup-sheet.mjs <مسار-مفتاح-JSON> <رابط-الجدول>
 */

import { readFileSync } from 'node:fs';
import { createSign } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [keyPath, sheetUrl] = process.argv.slice(2);
if (!keyPath || !sheetUrl) {
  console.error('الاستخدام: node setup-sheet.mjs <مسار-مفتاح-JSON> <رابط-الجدول>');
  process.exit(1);
}

const idMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || sheetUrl.match(/^([a-zA-Z0-9-_]{30,})$/);
if (!idMatch) { console.error('❌ لم أجد معرّف الجدول في الرابط'); process.exit(1); }
const SHEET_ID = idMatch[1];

const readHeader = (f) => readFileSync(join(HERE, '..', 'sheets', f), 'utf8').trim().split(',');
const TABS = {
  ideas: readHeader('ideas.csv'),
  posts: readHeader('posts.csv'),
  performance: readHeader('performance.csv'),
};
const STATUSES = ['new', 'approved', 'hold', 'rejected', 'used'];
const DEFAULT_TAB_NAMES = /^(sheet ?1|sayfa ?1|(ال)?ورقة ?1|feuille ?1|hoja ?1|tabelle ?1)$/i;

// ─────────────── المصادقة ───────────────
const key = JSON.parse(readFileSync(keyPath, 'utf8'));
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');

async function token() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', typ: 'JWT' });
  const claim = b64({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 900,
  });
  const sig = createSign('RSA-SHA256').update(`${head}.${claim}`).sign(key.private_key, 'base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`رفض Google المفتاح: ${j.error_description || j.error}`);
  return j.access_token;
}

const API = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}`;
let AUTH;

async function call(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${AUTH}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j?.error?.message || r.statusText;
    if (r.status === 403 || r.status === 404) {
      throw new Error(`${r.status} — الروبوت لا يرى الجدول.\n   شارك الجدول مع ${key.client_email} بصلاحية Editor.\n   (${msg})`);
    }
    throw new Error(`${r.status} — ${msg}`);
  }
  return j;
}

const colLetter = (n) => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

// ─────────────── التجهيز ───────────────
(async () => {
  AUTH = await token();
  console.log(`🔑 الروبوت: ${key.client_email}`);

  const meta = await call('GET', '?fields=properties.title,sheets.properties');
  console.log(`📄 الجدول: «${meta.properties.title}»`);

  const existing = Object.fromEntries(meta.sheets.map((s) => [s.properties.title, s.properties]));

  // ١ — إنشاء الأوراق الناقصة
  const toAdd = Object.keys(TABS).filter((t) => !existing[t]);
  if (toAdd.length) {
    const res = await call('POST', ':batchUpdate', {
      requests: toAdd.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })),
    });
    res.replies.forEach((rep) => { existing[rep.addSheet.properties.title] = rep.addSheet.properties; });
    console.log(`➕ أُنشئت: ${toAdd.join(' · ')}`);
  } else {
    console.log('✓ الأوراق الثلاث موجودة مسبقًا');
  }

  // ٢ — صفوف العناوين (فقط إذا كان الصف الأول فاضيًا)
  for (const [tab, headers] of Object.entries(TABS)) {
    const cur = await call('GET', `/values/${encodeURIComponent(tab)}!1:1`);
    const row = cur.values?.[0] || [];
    if (row.length === 0) {
      await call('PUT', `/values/${encodeURIComponent(tab)}!A1?valueInputOption=RAW`, { values: [headers] });
      console.log(`📝 ${tab}: كُتب ${headers.length} عمودًا`);
    } else if (row.join(',') === headers.join(',')) {
      console.log(`✓ ${tab}: العناوين مطابقة`);
    } else {
      console.log(`⚠️  ${tab}: الصف الأول فيه بيانات مختلفة — لم أغيّره. الموجود: ${row.slice(0, 5).join(', ')}…`);
    }
  }

  // ٣ — التنسيق + القائمة المنسدلة + الألوان
  const ideas = existing.ideas;
  const statusCol = TABS.ideas.indexOf('status');
  const requests = [];

  for (const tab of Object.keys(TABS)) {
    const p = existing[tab];
    requests.push(
      { updateSheetProperties: { properties: { sheetId: p.sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      { repeatCell: {
          range: { sheetId: p.sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: {
            backgroundColor: { red: 0x22 / 255, green: 0x16 / 255, blue: 0x0f / 255 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
          } },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
      } },
    );
  }

  requests.push({ setDataValidation: {
    range: { sheetId: ideas.sheetId, startRowIndex: 1, startColumnIndex: statusCol, endColumnIndex: statusCol + 1 },
    rule: {
      condition: { type: 'ONE_OF_LIST', values: STATUSES.map((v) => ({ userEnteredValue: v })) },
      strict: true, showCustomUi: true,
      inputMessage: 'new · approved · hold · rejected · used',
    },
  } });

  // تلوين: approved هيل · hold زعفران فاتح · rejected رمادي · used ضباب
  const colors = {
    approved: { red: 0x7d / 255, green: 0xb4 / 255, blue: 0x6c / 255 },
    hold:     { red: 1, green: 0xe4 / 255, blue: 0xb0 / 255 },
    rejected: { red: 0.85, green: 0.85, blue: 0.85 },
    used:     { red: 0xed / 255, green: 0xf2 / 255, blue: 0xe6 / 255 },
  };
  const statusRange = { sheetId: ideas.sheetId, startRowIndex: 1, startColumnIndex: statusCol, endColumnIndex: statusCol + 1 };

  // لا نكرر قواعد التلوين عند إعادة التشغيل
  const cf = await call('GET', `?fields=sheets(properties.sheetId,conditionalFormats)`);
  const hasCf = (cf.sheets.find((s) => s.properties.sheetId === ideas.sheetId)?.conditionalFormats || []).length > 0;
  if (!hasCf) {
    Object.entries(colors).forEach(([v, c], i) => requests.push({ addConditionalFormatRule: {
      index: i,
      rule: { ranges: [statusRange], booleanRule: {
        condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: v }] },
        format: { backgroundColor: c },
      } },
    } }));
  }

  await call('POST', ':batchUpdate', { requests });
  console.log(`🎨 تجميد العناوين · قائمة منسدلة لعمود status (${colLetter(statusCol)}) · ${hasCf ? 'التلوين موجود مسبقًا' : 'تلوين الحالات'}`);

  // ٤ — حذف الورقة الافتراضية الفاضية
  const after = await call('GET', '?fields=sheets.properties');
  for (const s of after.sheets) {
    const t = s.properties.title;
    if (!DEFAULT_TAB_NAMES.test(t)) continue;
    const v = await call('GET', `/values/${encodeURIComponent(t)}!A1:Z20`);
    if ((v.values || []).length === 0) {
      await call('POST', ':batchUpdate', { requests: [{ deleteSheet: { sheetId: s.properties.sheetId } }] });
      console.log(`🗑️  حُذفت الورقة الافتراضية الفاضية «${t}»`);
    } else {
      console.log(`⚠️  «${t}» فيها بيانات — تركتها`);
    }
  }

  // ٥ — تحقق نهائي
  const final = await call('GET', '?fields=sheets.properties.title');
  const titles = final.sheets.map((s) => s.properties.title);
  const ok = Object.keys(TABS).every((t) => titles.includes(t));
  console.log(`\n${ok ? '✅' : '❌'} الأوراق الآن: ${titles.join(' · ')}`);
  console.log(`   معرّف الجدول: ${SHEET_ID}`);
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
