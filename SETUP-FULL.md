<div align="right">

# النظام الكامل — دليل الإعداد

هذا الدليل يضيف فوق المستوى المحلي: **بنك أفكار في Google Sheets** تفتحه من جوالك · **إشعارات تيليجرام** · **أتمتة يومية بـn8n** · **أرشيف المنشورات**.

**الوقت المتوقع:** ٤٥–٦٠ دقيقة أول مرة.
**التكلفة:** صفر. كل شيء مجاني.

</div>

---

## قبل أن تبدأ

| تحتاج | ملاحظة |
|---|---|
| أنهيت المستوى المحلي | `node setup.mjs` ونجحت تجربة `--dry-run` |
| حساب Google | أي حساب Gmail شخصي يكفي |
| Docker Desktop | [docker.com](https://www.docker.com/products/docker-desktop/) — مجاني للأفراد والشركات الصغيرة |
| حساب تيليجرام | اختياري لكنه مفيد |

> **لا تحتاج بطاقة دفع في أي خطوة.** إن طلب منك Google أو Docker تفعيل تجربة مدفوعة — تجاهله.

---

# الجزء ١ · Google Cloud
> **الهدف:** إنشاء «حساب روبوت» (Service Account) يكتب في جدولك نيابة عنك.
> **لماذا لا OAuth؟** لأن توكن OAuth في وضع Testing **ينتهي كل ٧ أيام**، فتتعطل الأتمتة أسبوعيًا. الـService Account لا ينتهي.

### ١.١ أنشئ المشروع
افتح: `https://console.cloud.google.com/projectcreate?hl=en`

1. إن ظهرت **Terms of Service** ← اختر دولتك ← وافق ← **Agree and continue**
2. **Project name:** `content-autopilot`
3. **Create** ← انتظر ١٥ ثانية
4. **مهم:** من الشريط العلوي اختر المشروع الجديد — تأكد أن اسمه ظاهر بجانب شعار Google Cloud

### ١.٢ فعّل الـAPIين — **اثنان لا واحد**
- Sheets API: `https://console.cloud.google.com/apis/library/sheets.googleapis.com?hl=en` ← **ENABLE**
- Drive API: `https://console.cloud.google.com/apis/library/drive.googleapis.com?hl=en` ← **ENABLE**

> ⚠️ **لا تتخطَّ Drive API.** بدونه يفشل n8n في إيجاد الجدول برسائل خطأ مبهمة.

**علامة النجاح:** يظهر زر **DISABLE API** بدل ENABLE.

### ١.٣ أنشئ الـService Account
افتح: `https://console.cloud.google.com/iam-admin/serviceaccounts/create?hl=en`

1. **Service account name:** `content-bot` ← **CREATE AND CONTINUE**
2. **Permissions** ← **اتركها فاضية تمامًا** ← **CONTINUE**
3. **Principals** ← فاضية ← **DONE**

> **لماذا بلا صلاحيات؟** الصلاحيات هنا تعطي وصولًا لمشروع Google Cloud كله. نحن نريد جدولًا واحدًا فقط — وهذا يُعطى بالمشاركة في الخطوة ٢.٢. أقل صلاحية ممكنة.

### ١.٤ نزّل المفتاح
1. اضغط على إيميل الحساب الذي ظهر (`content-bot@...iam.gserviceaccount.com`)
2. تبويب **KEYS** ← **ADD KEY** ← **Create new key** ← **JSON** ← **CREATE**
3. يُنزَّل ملف — **احفظه خارج أي مجلد مزامنة** (لا OneDrive ولا Drive ولا Dropbox)

**اقترح:** `C:\Users\<اسمك>\.secrets\google-key.json`

| ⚠️ | |
|---|---|
| **لا تضعه داخل مجلد المشروع** | قد يُرفع إلى GitHub |
| **لا ترسله لأحد** | هو مفتاح كامل لجدولك |
| **Google لا يعطيك نسخة ثانية** | إن ضاع، احذفه وأنشئ غيره — عادي |

---

# الجزء ٢ · جدول Google

### ٢.١ أنشئ جدولًا فاضيًا
افتح `https://sheets.new` ← سمّه `أرشيف المحتوى` ← **لا تكتب شيئًا بداخله**

### ٢.٢ شاركه مع الروبوت ← **الخطوة التي ينساها الجميع**
1. **Share** ← الصق إيميل الـservice account (`content-bot@...gserviceaccount.com`)
2. الصلاحية: **Editor** — وليس Viewer
3. **أطفئ** ☐ Notify people
4. **Share** ← إن ظهر تحذير أن الإيميل ليس حساب Google ← **Share anyway** (طبيعي)

> بدون هذه الخطوة: `403 — The caller does not have permission`

### ٢.٣ احفظ المعرّف في إعداداتك
انسخ المعرّف من رابط الجدول:
```
https://docs.google.com/spreadsheets/d/  1AbC...xyz  /edit
                                         ^^^^^^^^^^ هذا هو
```
افتح `scripts/config.json` وعبّئ:
```json
{
  "sheetId": "1AbC...xyz",
  "googleKeyPath": "C:/Users/<اسمك>/.secrets/google-key.json"
}
```
> استخدم `/` وليس `\` في المسار.

### ٢.٤ ابنِ الأوراق تلقائيًا
```bash
node scripts/setup-sheet.mjs "C:/Users/<اسمك>/.secrets/google-key.json" "<رابط الجدول>"
```

ينشئ ثلاث أوراق (`ideas` · `posts` · `performance`) بعناوينها، ويجمّد صف العناوين، ويضيف **قائمة منسدلة** لعمود `status`، ويلوّن الحالات، ويحذف الورقة الافتراضية الفاضية.

**علامة النجاح:** `✅ الأوراق الآن: ideas · posts · performance`

---

# الجزء ٣ · n8n على جهازك

### ٣.١ شغّل Docker Desktop
افتحه وانتظر حتى تستقر الأيقونة.

<details>
<summary><b>إن فشل Docker في الإقلاع — اضغط هنا</b></summary>

خلل شائع على Windows: ملفات socket عالقة من انهيار سابق يرفض النظام حذفها. الخطأ يذكر `dockerInference` أو `docker-secrets-engine`.

**الحل:** أغلق Docker تمامًا، ثم في PowerShell:
```powershell
Get-Process | Where-Object { $_.ProcessName -match 'docker' } | Stop-Process -Force
wsl --shutdown
$s = Get-Date -Format 'HHmmss'
Rename-Item "$env:LOCALAPPDATA\Docker\run" "run.stale-$s"
Rename-Item "$env:LOCALAPPDATA\docker-secrets-engine" "secrets.stale-$s"
```
ثم شغّل Docker Desktop من جديد. المجلدات القديمة تُحذف لاحقًا بأمان.
</details>

### ٣.٢ شغّل n8n
```bash
docker compose up -d
```
انتظر ~٣٠ ثانية، ثم تحقق:
```bash
curl http://localhost:5678/healthz
```
يفترض: `{"status":"ok"}`

> n8n مقيّد على `127.0.0.1` — لا يصله أحد من شبكتك ولا من الإنترنت.

### ٣.٣ أنشئ حساب المالك
افتح `http://localhost:5678` ← عبّئ إيميلك واسمك و**كلمة مرور تختارها أنت** ← **Next** ← تجاوز الاستبيان.

---

# الجزء ٤ · الاعتمادات الثلاثة

في n8n: **🏠 Overview ← Credentials ← Add credential**

### ٤.١ Google
ابحث `Google Service Account API`

| الخانة | القيمة |
|---|---|
| Region | اتركها `Global` |
| **Service Account Email** | من ملف JSON: قيمة `client_email` |
| **Private Key** | من ملف JSON: قيمة `private_key` كاملة — من `-----BEGIN PRIVATE KEY-----` إلى `-----END PRIVATE KEY-----` بلا علامتي التنصيص |
| Impersonate a User | مطفأ |

سمِّه: **`Google Sheets — Sawwi`** ← **Save**
**علامة النجاح:** ✅ *Connection tested successfully*

### ٤.٢ Header Auth
ابحث `Header Auth`

| الخانة | القيمة |
|---|---|
| **Name** | `x-sawwi-key` |
| **Value** | قيمة `authSecret` من `scripts/config.json` |

سمِّه: **`Sawwi WF1 Key`** ← **Save** (لا يوجد اختبار اتصال لهذا النوع — طبيعي)

### ٤.٣ تيليجرام (اختياري)
1. في تيليجرام: `@BotFather` ← `/newbot` ← اسم ← اسم مستخدم ينتهي بـ`bot`
2. احفظ التوكن. **افتح بوتك واضغط Start** — بدونها لا يستطيع مراسلتك
3. `@userinfobot` ← يعطيك رقم `Id` ← ضعه في `config.json` تحت `telegramChatId`
4. في n8n: ابحث `Telegram API` ← **Access Token** = التوكن

| ⚠️ خانة **Base URL** | |
|---|---|
| **اتركها فارغة** | أو `https://api.telegram.org` بالضبط |
| **لا تضع رابط بوتك** (`t.me/...`) | خطأ شائع: الطلبات تذهب لصفحة ويب فتفشل **بصمت** بلا رسالة خطأ |

سمِّه: **`Telegram — Sawwi`** ← **Save**

---

# الجزء ٥ · استيراد الـworkflows

### ٥.١ جهّزها بإعداداتك
```bash
node scripts/prepare-workflows.mjs
```
يقرأ معرّفات اعتماداتك من n8n ويحقنها مع معرّف جدولك ومعرّف تيليجرامك، ويكتب النتيجة في `workflows/ready/`.

### ٥.٢ استوردها
```bash
docker cp workflows/ready/. sawwi-n8n:/tmp/wf/
docker exec sawwi-n8n n8n import:workflow --separate --input=/tmp/wf
```

### ٥.٣ انشرها ← **إجباري**
افتح `http://localhost:5678` ← **Overview ← Workflows** ← افتح كل workflow ← زر **Publish** فوق يمين.

| ⚠️ ثلاثة أمور تُربك هنا | |
|---|---|
| **`n8n update:workflow --active=true` لا يكفي** | n8n 2.x يسجّل الـwebhooks من «نسخة منشورة» فقط — والنشر من الواجهة |
| **كل إعادة استيراد تُلغي النشر** | عدّلت شيئًا وأعدت الاستيراد؟ اضغط Publish مرة أخرى |
| **بعد إعادة تشغيل n8n انتظر ~٣٠ ثانية** | التفعيل ليس فوريًا — لا تستعجل وتظن أنه معطّل |

**علامة النجاح:** شارة 🟢 **Published** بجانب اسم الـworkflow في القائمة.

---

# الجزء ٦ · التحقق

```bash
node scripts/preflight.mjs
```
١٢ فحصًا: Node · Claude · غياب مفتاح API · الخلاصات · الـwebhooks · رفض المفتاح الخاطئ · المهمة المجدولة.

ثم اختبار كتابة حقيقي:
```bash
node scripts/preflight.mjs --write
```
يكتب صفًا واحدًا في الجدول ويخبرك لتحذفه.

**لا تكمل قبل أن تنجح الفحوص كلها.**

### أول التقاط
```bash
node scripts/wf1-ideas.mjs --days 14
```
~١٠–١٥ فيديو ← **٢٠–٣٥ فكرة** في بنكك خلال ١٠–٢٠ دقيقة.

افتح الجدول، وضع `approved` على ما يعجبك و`rejected` على ما لا يعجبك.

### أول حزمة
```bash
node scripts/wf2-daily.mjs
```
تصلك على تيليجرام، وتُحفظ في ورقة `posts`. وللحصول على ملف مقروء:
```bash
node scripts/export-post.mjs
```

---

# الجزء ٧ · الجدولة اليومية

<details open>
<summary><b>Windows</b></summary>

```powershell
$dir = "المسار\إلى\المشروع\scripts"
$action   = New-ScheduledTaskAction -Execute "$dir\run-wf1.cmd" -WorkingDirectory $dir
$trigger  = New-ScheduledTaskTrigger -Daily -At "05:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Content Autopilot" -Action $action -Trigger $trigger -Settings $settings -Force
```

`-StartWhenAvailable` مهم: إن كان جهازك مغلقًا الساعة ٥، يشتغل عند أول تشغيل بعدها. ومع نافذة ٧ أيام **لا تضيع فكرة**.
</details>

<details>
<summary><b>macOS / Linux</b></summary>

```bash
crontab -e
# أضف:
0 5 * * * cd /path/to/project && /usr/local/bin/node scripts/wf1-ideas.mjs --days 7 >> scripts/logs/wf1.log 2>&1
```
</details>

> **فعّلها بعد** أن تنجح ٧ حزم متتالية ترضيك. إن كنت تعدّل كل يوم، فالمشكلة في `brain/` لا في الجدولة.

---

# حلول المشاكل

| الخطأ | السبب | الحل |
|---|---|---|
| `404` على الـwebhook | غير منشور، أو n8n لم يكمل الإقلاع | اضغط **Publish** · انتظر ٣٠ ثانية |
| `403` على الـwebhook | سرّ Header Auth مختلف | طابق `authSecret` بين `config.json` وn8n |
| `The caller does not have permission` | الجدول غير مشارَك مع الروبوت | شاركه كـ**Editor** |
| `API has not been used in project` | Sheets أو Drive API غير مفعّل | راجع ١.٢ |
| رسالة تيليجرام لا تصل بلا خطأ | **Base URL** فيها رابط البوت | فرّغها أو ضع `https://api.telegram.org` |
| البوت لا يرسل إطلاقًا | لم تضغط **Start** في محادثته | افتح البوت واضغط Start |
| `Active version not found` | أعدت الاستيراد فأُلغي النشر | اضغط **Publish** |
| Docker لا يقلع | sockets عالقة | انظر الجزء ٣.١ |
| `claude exit 1` | لم تسجّل الدخول | شغّل `claude` مرة وسجّل دخولك |
| تُحاسَب على Anthropic | `ANTHROPIC_API_KEY` مضبوط في بيئتك | احذفه ليُستخدم الاشتراك |
| الأفكار متشابهة | المصنّف يرتد لأوضح مهام جمهورك | وسّع وصف الجمهور في `brain/00-brand-core.md` وارفض المتشابه — البنك يتعلّم من رفضك |

---

<div align="right">

## أين تضع أسرارك

| السرّ | مكانه الصحيح |
|---|---|
| مفتاح Google JSON | مجلد خارج أي مزامنة سحابية |
| توكن تيليجرام | داخل n8n فقط (مشفّر) |
| سرّ الـwebhook | `scripts/config.json` — مستبعد بـ`.gitignore` |
| مفتاح Anthropic | **لا يوجد** — هذا النظام لا يستخدمه |

**قبل أي رفع على GitHub:**
```bash
git status --short
```
تأكد ألا ترى `config.json` ولا أي ملف مفتاح. إن ظهرت، راجع `.gitignore`.

</div>
