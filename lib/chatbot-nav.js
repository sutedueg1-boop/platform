// ============================================================
// lib/chatbot-nav.js — طبقة التنقّل والإجراءات
// ============================================================
// بتفهم نوعين من الجمل:
//   1) "وديني على تبويب التدريب" / "افتح سجل بلاغاتي" → تنقّل لأي تابة.
//   2) "عايز أطلع تصريح شغل ساخن" / "عايز أبلغ عن تسريب زيت" → بتفتح
//      النموذج الصح، بنوع التصريح الصح، والوصف متملّي من كلام المستخدم.
//
// ليه على السيرفر مش في الواجهة؟ عشان نفس المنطق يخدم الكتابة والصوت
// من مكان واحد، وعشان التصنيف يفضل مربوط بصلاحية المستخدم (العامل عمره
// ما هيتودّي على تابة إدارية والعكس).
//
// مهم: الطبقة دي بترجّع { action } بس — التنفيذ الفعلي في الواجهة
// (switchTab/selectType)، والواجهة نفسها فيها حارس صلاحيات تاني.
// إضافة 20 سبتمبر 2026.
'use strict';

const kb = require('./chatbot-kb');
const extract = require('./chatbot-extract');
const followup = require('./chatbot-followup');
const N = kb.normalizeArabic;

const WORKER = 'worker';
const ADMIN = 'admin';
const BOTH = 'both';

// كل تابة: مفتاحها في switchTab، اسمها للمستخدم، الكلمات اللي بتدل عليها،
// وأدوار مسموح لها بيها (لو مفيش roles يبقى كل التير مسموح).
const TABS = [
  { key: 'dashboard', audience: BOTH, label: 'لوحة التحكم',
    words: ['لوحه التحكم', 'الداشبورد', 'داشبورد', 'dashboard', 'المؤشرات', 'الاحصائيات', 'الرسوم البيانيه'] },

  // ── تابات العامل ──
  { key: 'worker', audience: WORKER, label: 'طلب تصريح عمل',
    words: ['طلب تصريح', 'نموذج طلب', 'تصريح عمل', 'تصاريح العمل', 'التصاريح', 'بيرميت', 'permit'] },
  { key: 'myhistory', audience: WORKER, label: 'سجل تصاريح العمل',
    words: ['سجل تصاريحي', 'سجل تصاريح العمل', 'سجل التصاريح', 'تصاريحي'] },
  { key: 'hazardWorker', audience: WORKER, label: 'الإبلاغ عن خطورة',
    words: ['الابلاغ عن خطوره', 'ابلاغ عن خطوره', 'بلاغ خطوره', 'بلاغ الخطوره', 'هازارد', 'hazard'] },
  { key: 'myhazards', audience: WORKER, label: 'سجل بلاغاتي',
    words: ['سجل بلاغاتي', 'سجل البلاغات', 'بلاغاتي'] },
  { key: 'trainingWorker', audience: WORKER, label: 'التدريب والتوعية',
    words: ['التدريب والتوعيه', 'التدريب', 'المحاضرات', 'محاضراتي', 'التوعيه', 'محاضره'] },
  { key: 'drillWorker', audience: WORKER, label: 'تجارب الطوارئ',
    words: ['تجارب الطوارئ', 'تجربه طوارئ', 'الاخلاء', 'drill'] },
  { key: 'penaltiesWorker', audience: WORKER, label: 'الجزاءات',
    words: ['الجزاءات', 'جزاءاتي', 'الجزاء', 'العقوبات'] },

  // ── تابات الإدارة ──
  { key: 'sup', audience: ADMIN, label: 'تصاريح العمل',
    words: ['تصاريح العمل', 'التصاريح', 'لوحه المشرف', 'مراجعه التصاريح', 'permit'] },
  { key: 'supHazard', audience: ADMIN, label: 'بلاغات الخطورة',
    words: ['بلاغات الخطوره', 'البلاغات', 'الهازارد', 'hazard'] },
  { key: 'trainingAdmin', audience: ADMIN, label: 'إدارة التدريب',
    words: ['اداره التدريب', 'التدريب', 'المحاضرات', 'محاضره'] },
  { key: 'drillAdmin', audience: ADMIN, label: 'تجارب الطوارئ',
    words: ['تجارب الطوارئ', 'الاخلاء', 'drill'] },
  { key: 'penaltiesAdmin', audience: ADMIN, label: 'الجزاءات',
    words: ['الجزاءات', 'العقوبات', 'الجزاء'] },
  { key: 'employees', audience: ADMIN, label: 'الموظفين',
    words: ['الموظفين', 'دليل الموظفين', 'العمال', 'الموظفون'] },
  { key: 'inspections', audience: ADMIN, label: 'الفحص الشهري',
    words: ['الفحص الشهري', 'الفحوصات', 'الفحص'] },
  { key: 'users', audience: ADMIN, label: 'المستخدمين', roles: ['super_admin'],
    words: ['المستخدمين', 'الحسابات', 'اداره المستخدمين', 'اليوزرز'] },
  { key: 'auditlog', audience: ADMIN, label: 'سجل التدقيق', roles: ['super_admin', 'hse_admin'],
    words: ['سجل التدقيق', 'الاوديت', 'audit', 'سجل العمليات'] },
  { key: 'executive', audience: ADMIN, label: 'الشاشة التنفيذية', roles: ['super_admin', 'ceo', 'hse_director'],
    words: ['الشاشه التنفيذيه', 'التنفيذيه', 'executive', 'شاشه الاداره العليا'] },
];

// أفعال التنقّل — لازم واحد منهم (أو كلمة "تبويب/صفحة/شاشة") عشان نعتبر
// الجملة طلب تنقّل. متعمّد إننا مانحطش "اعرض/ورّيني" هنا لأنهم بيستخدموا
// في أسئلة البيانات ("ورّيني البلاغات المفتوحة") واللي المفروض تتجاوب
// بالأرقام مش بفتح تابة.
// مهم: كل فعل مربوط ببداية كلمة `(?:^|\s)` — من غير ده كانت جملة زي
// "**هوصلني** إشعار وأنا قافل التطبيق؟" تتحسب طلب تنقّل لأن جواها "وصلني"،
// فيرد عليها بقايمة التبويبات بدل ما يشرح الإشعارات.
const NAV_VERB = /(?:^|\s)(وديني|ودني|ودينى|اوديني|وصلني|خدني|روحني|روح بيا|نقلني|انقلني|رجعني|ارجعني|افتحلي|فتحلي|افتح|اروح|انتقل|سيبني في|خشني)/;
const NAV_NOUN = /(?:^|\s)(تبويب|التبويب|صفحه|الصفحه|شاشه|الشاشه)/;

// نوايا الإنشاء — "عايز أعمل/أطلع/أقدّم..." وكمان صيغة المستقبل العامية
// ("هعمل"، "هطلع"، "هنشتغل") — دي كانت ناقصة وكانت بتخلي جملة زي
// "هعمل تصريح عمل سخن أنا وفلان" تعدّي على طبقة التعليمات بدل النموذج.
const WANT = /(عايز|عاوز|عايزين|عاوزين|محتاج|محتاجين|نفسي|اريد|ابغي|ممكن|لو سمحت|اعملي|اعمللي)/;
const CREATION_VERB = /(اطلع|هطلع|هنطلع|اخرج|استخرج|اقدم|هقدم|اعمل|هعمل|هنعمل|حعمل|افتح|هفتح|اخد|هاخد|اطلب|هطلب|ابلغ|هبلغ|اسجل|هسجل|هشتغل|هنشتغل|هنقوم)/;
const PERMIT_WORD = /(تصريح|تصاريح|بيرميت|permit)/;
const HAZARD_WORD = /(ابلغ|هبلغ|بلاغ|ابلاغ|اشتكي|خطوره|خطورت|خطر|هازارد|hazard)/;
// إشارات خطر صريحة — دي لوحدها كفاية تفتح نموذج البلاغ من غير فعل نية،
// لأن العامل اللي بيقول "في تسريب زيت" مش هيقول "عايز أبلغ عن..."
const HAZARD_SIGNAL = /(تسريب|حريقه|شراره|سلك مكشوف|زيت علي الارض|مفيش غطا|جسم ساقط|ريحه غاز|رائحه غاز|كهربا مكشوفه|مش امن|في خطر|فيه خطر)/;
// "شفت/لقيت" + حاجة بايظة = بلاغ، حتى لو الكلمة "بلاغ" نفسها ماتقالتش
const HAZARD_OBSERVE = /(شفت|شوفت|لقيت|لاقيت|لاحظت|شايف|في حاجه|فيه حاجه)/;
// ملحوظة: "واقف" و"ناقص" اتشالوا من هنا (22 سبتمبر 2026) — كلمات ليها
// معنيين: "الماكينة واقفة" (عطل) بس كمان "أنا واقف في الشمس" و"ناقصني
// ساعات تدريب". المعنى التاني كان بيفتح بلاغ خطورة غلط.
const HAZARD_DAMAGE = /(مكسور|مكسوره|مخلوع|مقطوع|مكشوف|مكشوفه|تالف|بايظ|باظ|ساقط|واقع|مفكوك|مفكوكه|سايب|متهالك|مصدي|مسرب|تسريب|زلق|شراره|حريق|دخان|ريحه غريبه|مش شغال|مش مثبت|مش مثبته|مش متثبت|مايل|بيهتز|مخلخل|مبلول|فاضيه|منتهي الصلاحيه|مقفول بالغلط)/;

const PERMIT_TYPE_HINTS = {
  hot: ['ساخن', 'لحام', 'قطع', 'شعله', 'لهب', 'جلخ', 'صاروخ', 'حراره'],
  height: ['ارتفاع', 'سقاله', 'سلم', 'سطح', 'عالي', 'برج'],
  confined: ['مغلق', 'مغلقه', 'خزان', 'تانك', 'وعاء', 'منهول', 'صومعه'],
  excavation: ['حفر', 'حفره', 'تربه', 'خندق'],
  lifting: ['رفع', 'ونش', 'كرين', 'رافعه', 'كلاب'],
  loto: ['لوتو', 'loto', 'فصل وعزل', 'عزل الطاقه', 'عزل طاقه', 'فصل الطاقه'],
  general: ['تفريغ', 'نقل خامات'],
};

const PERMIT_TYPE_LABEL = {
  general: 'عام', height: 'ارتفاع', confined: 'أماكن مغلقة',
  excavation: 'حفر', lifting: 'رفع', hot: 'ساخن', loto: 'فصل وعزل',
};

const ADMIN_TIER = ['super_admin', 'hse_admin', 'dept_admin', 'maint_admin', 'ceo', 'hse_director'];
const isAdmin = role => ADMIN_TIER.includes(role);

/** أطول كلمة مطابقة بتكسب — عشان "سجل تصاريحي" ماتضيعش في "تصاريح" */
function matchTab(nq, role) {
  const admin = isAdmin(role);
  let best = null;
  let bestLen = 0;
  for (const tab of TABS) {
    if (tab.audience === WORKER && admin) continue;
    if (tab.audience === ADMIN && !admin) continue;
    if (tab.roles && !tab.roles.includes(role)) continue;
    for (const w of tab.words) {
      const nw = N(w);
      if (nw.length > bestLen && nq.includes(nw)) { best = tab; bestLen = nw.length; }
    }
  }
  return best;
}

function detectPermitType(nq) {
  let best = null;
  let bestLen = 0;
  for (const [key, words] of Object.entries(PERMIT_TYPE_HINTS)) {
    for (const w of words) {
      const nw = N(w);
      if (nw.length > bestLen && nq.includes(nw)) { best = key; bestLen = nw.length; }
    }
  }
  return best;
}

/** التبويبات اللي المستخدم ده مسموحله بيها — بتستخدم في رسالة "قصدك أنهي تبويب؟" */
function allowedTabs(role) {
  const admin = isAdmin(role);
  return TABS
    .filter(t => t.audience === BOTH || (t.audience === ADMIN) === admin)
    .filter(t => !t.roles || t.roles.includes(role));
}

/**
 * answerNav(text, ctx) → null | { reply, action, source, suggestions }
 * action: { type:'navigate', tab, permitType?, prefill? }
 */
function answerNav(text, ctx) {
  const q = String(text || '').trim();
  if (!q) return null;
  const nq = N(q);
  const user = (ctx && ctx.user) || {};
  const admin = isAdmin(user.role);

  const wants = WANT.test(nq);
  const creation = CREATION_VERB.test(nq);
  // "عايز أشوف بلاغاتي" = سؤال عن سجله، مش طلب بلاغ جديد
  const isHistoryQuestion = /سجل|بتاعي|بتاعتي|اللي فاتت|القديمه|بلاغاتي|تصاريحي|جزاءاتي|محاضراتي|اشوف|شوفلي/.test(nq);
  // سؤال شرح ("إزاي أطلع تصريح؟" / "متطلبات تصريح ساخن إيه؟") مش طلب فتح
  // نموذج — سيبه لطبقة إجراءات التصاريح ترد عليه بالخطوات.
  // سؤال شرح أو سؤال افتراضي ("أعمل إيه **لو** لقيت سلك مكشوف؟") — ده طلب
  // معلومة مش بلاغ عن حاجة حصلت فعلاً. الفرق بين الاتنين كلمة "لو".
  // (22 سبتمبر 2026) اتوسّعت بعد باج حقيقي: "لو واقف في الشمس اعمل اي"
  // كانت بتفتح بلاغ خطورة! السببين: كنا بنستثني "لو + كلمات معيّنة" بس،
  // وكنا بندور على "اعمل ايه" والناس بتكتب "اعمل اي" من غير هاء.
  // • أي جملة فيها "لو" (غير "لو سمحت") = سؤال افتراضي، مش بلاغ عن حاجة حصلت.
  // • "اعمل اي/ايه" و"اتصرف ازاي" = بيسأل عن تصرف، مش بيبلّغ.
  const isHowTo = /(ازاي|كيف|ايه خطوات|ايه متطلبات|متطلبات|شروط|اجراءات|خطوات|قايمه التحقق|بتشتغل ازاي)/.test(nq)
    || /(^|\s)لو\s(?!سمحت)/.test(nq)
    || /(اعمل|نعمل|يعمل|اتصرف|نتصرف)\s+(اي|ايه|ازاي)(\s|$|[؟?])/.test(nq)
    || /(ماذا افعل|ايه اللي اعمله|المفروض اعمل|المفروض اعمل ايه|اعمل ايه|اعمل اي$)/.test(nq);

  const employees = (() => {
    try { return (ctx && ctx.data && typeof ctx.data.employees === 'function') ? ctx.data.employees() : []; }
    catch (e) { return []; }
  })();

  // ── 1) نية إنشاء تصريح (للعامل بس — الإدارة بتراجع مش بتقدّم) ──
  if (!admin && !isHowTo && PERMIT_WORD.test(nq) && (wants || creation) && !isHistoryQuestion) {
    const got = extract.extractPermitRequest(q, { employees });
    const filled = [];
    if (got.fill.desc) filled.push('وصف العملية');
    if (got.fill.workers) filled.push(`القائمين بالعمل (${got.fill.workers.split('\n').length})`);
    if (got.fill.location) filled.push('مكان العمل');
    const what = filled.length ? `وملّيتلك: ${filled.join('، ')}.` : '';
    // الخانات الناقصة مش بتتساب — بنسأل عنها واحدة واحدة
    const fq = followup.firstQuestion('permit', got.fill);
    const tail = fq ? `\n\n${fq.ask}` : '\nراجع كل حاجة، املا قايمة التحقق، وابعت الطلب بنفسك.';
    return {
      reply: `📋 تمام — فتحتلك تصريح "${PERMIT_TYPE_LABEL[got.permitType]}" ${what}${tail}`,
      action: { type: 'navigate', tab: 'worker', permitType: got.permitType, fill: got.fill },
      followup: fq ? fq.pending : null,
      source: null,
      suggestions: fq ? [] : [`متطلبات تصريح عمل ${PERMIT_TYPE_LABEL[got.permitType]}`, 'إزاي أطلع تصريح؟'],
    };
  }

  // ── 2) نية الإبلاغ عن خطورة ──
  // جملة قصيرة بتوصف حاجة بايظة من غير ما تسأل = بلاغ، حتى لو مافيهاش
  // "شفت" ولا كلمة "بلاغ" ("السلم مكسور درجة" / "السقالة مش مثبتة" /
  // "الأرضية زلقة"). من غير القاعدة دي كانت بتروح لطبقة SDS وترجع أسماء
  // مواد كيميائية (!) لأن "مثبتة" قريبة من stabilizer. 20 سبتمبر 2026.
  const shortStatement = q.length <= 70 && !/[؟?]/.test(q);
  const hazardIntent = HAZARD_SIGNAL.test(nq)
    || (HAZARD_WORD.test(nq) && (wants || creation))
    || (HAZARD_OBSERVE.test(nq) && HAZARD_DAMAGE.test(nq))
    || (HAZARD_OBSERVE.test(nq) && HAZARD_WORD.test(nq))
    || (HAZARD_DAMAGE.test(nq) && shortStatement);
  if (!admin && !isHowTo && hazardIntent && !isHistoryQuestion) {
    const got = extract.extractHazardReport(q, { employees });
    const labels = { desc: 'وصف الخطورة', area: 'المكان', dept: 'القسم', injury: 'الإصابة المحتملة', solution: 'الحل المقترح', likelihood: 'الاحتمالية', severity: 'الشدة' };
    const filled = Object.keys(got.fill).map(k => labels[k]).filter(Boolean);
    const what = filled.length ? `وملّيتلك: ${filled.join('، ')}.` : '';
    const fq = followup.firstQuestion('hazard', got.fill);
    const tail = fq ? `\n\n${fq.ask}` : '\nراجع اللي اتكتب وابعت البلاغ بنفسك.';
    return {
      reply: `⚠️ تمام — فتحتلك نموذج الإبلاغ عن خطورة ${what}${tail}`,
      action: { type: 'navigate', tab: 'hazardWorker', fill: got.fill },
      followup: fq ? fq.pending : null,
      source: null,
      suggestions: fq ? [] : ['بلاغاتي', 'أعمل إيه لو لقيت سلك مكشوف؟'],
    };
  }

  // ── 3) نية تنقّل صريحة ──
  if (!NAV_VERB.test(nq) && !NAV_NOUN.test(nq)) return null;

  const tab = matchTab(nq, user.role);
  if (!tab) {
    const labels = allowedTabs(user.role).map(t => t.label);
    return {
      reply: `مش عارف قاصد أنهي تبويب بالظبط 🤔\nالتبويبات المتاحة ليك: ${labels.join(' · ')}.\nقولي مثلاً: "وديني على ${labels[1] || labels[0]}".`,
      source: null,
      suggestions: labels.slice(0, 4).map(l => `وديني على ${l}`),
    };
  }

  return {
    reply: `📂 تمام، بفتحلك "${tab.label}" دلوقتي.`,
    action: { type: 'navigate', tab: tab.key },
    source: null,
    suggestions: [],
  };
}

module.exports = { answerNav, allowedTabs, TABS };
