// ============================================================
// lib/chatbot-extract.js — استخراج بيانات التصريح/البلاغ من كلام طبيعي
// ============================================================
// المستخدم بيقول جملة واحدة زي:
//   "هعمل تصريح عمل سخن أنا و5501 وأحمد، هنشتغل في قسم الصيانة، هنغيّر
//    ماسورة على الماكينة التالتة"
// والملف ده بيطلّع منها: نوع التصريح + أسماء القائمين بالعمل (بعد تحويل
// الأكواد لأسماء من قاعدة الموظفين) + مكان العمل + وصف الشغل **من غير**
// جملة النية ("هعمل تصريح...") لأن دي مش وصف عمل.
//
// ونفس الفكرة للبلاغ:
//   "شفت ماسورة مكسورة في مخزن الخامات، خطورتها عالية، ممكن تتحل بتغيير
//    الوصلة" → وصف + مكان + احتمالية/شدة + الحل المقترح.
//
// كله محلي بالكامل (من غير أي API) عشان يشتغل حتى لو الإنترنت واقف.
// إضافة 20 سبتمبر 2026.
'use strict';

const kb = require('./chatbot-kb');
const N = kb.normalizeArabic;

// ── تسامح صور الحروف العربية (إصلاح 20 سبتمبر 2026) ──────────────────
// الطبقات اللي بتقارن بنص *متطبّع* (normalizeArabic) مافيهاش مشكلة، لكن
// التنضيف هنا بيشتغل على النص **الخام** عشان نحافظ على شكل كلام المستخدم
// زي ما هو. النتيجة كانت إن "أنا" بهمزة مش بتطابق "انا" في الأنماط، فجملة
// زي "…عشان مواسير الصرف أنا ومدحت وعمرو" كانت بتسيب أسماء الزمايل جوه
// خانة وصف العملية. flex() بتبني نمط بيقبل كل صور الحرف.
const LETTER_CLASS = {
  'ا': '[اأإآٱ]', 'أ': '[اأإآٱ]', 'إ': '[اأإآٱ]', 'آ': '[اأإآٱ]', 'ٱ': '[اأإآٱ]',
  'ه': '[هة]', 'ة': '[هة]',
  'ي': '[يىئ]', 'ى': '[يىئ]', 'ئ': '[يىئ]',
  'و': '[وؤ]', 'ؤ': '[وؤ]',
};
const escapeRe = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TASHKEEL = '[\\u064B-\\u0652\\u0640]*';

/** flex('انا') → نمط بيطابق انا/أنا/إنا... مع أي تشكيل بينهم */
function flex(text) {
  return String(text).split('').map(ch => {
    if (ch === ' ') return '\\s+';
    return (LETTER_CLASS[ch] || escapeRe(ch));
  }).join(TASHKEEL);
}
/** alt(['انا','احنا']) → "(?:...|...)" جاهزة للتركيب في نمط أكبر */
const alt = words => '(?:' + words.map(flex).join('|') + ')';

// ── أنواع التصاريح: كل الصيغ العامية اللي ممكن حد يقولها ──
// مكتوبة بصيغة منوّنة (normalizeArabic) عشان المقارنة تبقى مباشرة.
// متعمّد إن "سخن" و"ساخن" الاتنين موجودين — العامل بيقول "سخن" أكتر.
const PERMIT_TYPES = {
  hot: ['سخن', 'ساخن', 'سخنه', 'ساخنه', 'شغل بالنار', 'نار', 'حراره', 'لحام', 'لحيم', 'هلحم', 'الحم', 'قطع', 'قطعيه', 'صاروخ', 'جلخ', 'شعله', 'كاويه', 'بلازما'],
  height: ['ارتفاع', 'مرتفع', 'سقاله', 'سقالة', 'سلم', 'شغل فوق', 'طلوع فوق', 'سطح', 'برج', 'رافعه شوكيه عاليه'],
  confined: ['مكان مغلق', 'اماكن مغلقه', 'مغلق', 'مغلقه', 'خزان', 'تنك', 'تانك', 'وعاء', 'منهول', 'صومعه', 'مساحه ضيقه', 'حيز مغلق'],
  excavation: ['حفر', 'حفره', 'خندق', 'تكسير ارضيه', 'هحفر'],
  lifting: ['رفع', 'ونش', 'كرين', 'رافعه', 'كلاب', 'هرفع', 'رفع احمال', 'رفع حمل'],
  loto: ['لوتو', 'loto', 'فصل وعزل', 'عزل الطاقه', 'عزل طاقه', 'فصل التيار', 'عزل كهربا', 'قفل وتعليم'],
  general: ['عام', 'تفريغ', 'نقل خامات', 'شحن'],
};

// ── أماكن العمل في نموذج التصريح (نفس قيم WORK_LOCATIONS في app.js) ──
const WORK_LOCATIONS = {
  'Administration': ['اداره', 'الاداره', 'المبني الاداري', 'ادمن'],
  'all factory': ['المصنع كله', 'كل المصنع', 'المصنع باكمله'],
  'Maintenance': ['صيانه', 'الصيانه', 'ورشه', 'الورشه', 'ميكانيكا', 'كهربا'],
  'outside': ['بره', 'خارج المصنع', 'الساحه الخارجيه'],
  'Production - Master Batch': ['ماستر باتش', 'master batch', 'الماستر'],
  'Production - Special Compounds': ['سبيشال', 'كومباوند', 'compounds', 'الخلطات'],
  'Quality Control': ['جوده', 'الجوده', 'المعمل', 'كنترول'],
  'R&D': ['ابحاث', 'تطوير', 'البحث والتطوير'],
  'Warehouse': ['مخزن', 'المخزن', 'مخازن', 'المخازن', 'الاستور'],
};

// ── أقسام المصنع بالعربي → الاسم الرسمي في قاعدة الموظفين ──
const DEPT_ALIASES = {
  'HSE': ['سلامه', 'السلامه', 'الامن الصناعي', 'اتش اس اي'],
  'Mechanical Maintenance': ['صيانه ميكانيكيه', 'الصيانه الميكانيكيه', 'ميكانيكا', 'الميكانيكا'],
  'Electrical Maintenance': ['صيانه كهربائيه', 'الصيانه الكهربائيه', 'كهربا', 'الكهربا', 'كهرباء'],
  'Preventive Maintenance': ['صيانه وقائيه', 'الصيانه الوقائيه', 'وقائيه'],
  'Quality Control': ['جوده', 'الجوده', 'كنترول', 'ضبط الجوده'],
  'Quality Assurance': ['توكيد الجوده', 'ضمان الجوده'],
  'Warehouse': ['مخزن', 'المخزن', 'مخازن', 'المخازن', 'الاستور'],
  'Production - PVC': ['بي في سي', 'pvc', 'انتاج بي في سي'],
  'Production - Master Batch': ['ماستر باتش', 'master batch', 'الماستر'],
  'Production - Special Compounds': ['سبيشال كومباوند', 'الخلطات الخاصه', 'كومباوند'],
  'Production - Poles': ['اعمده', 'الاعمده', 'بولز'],
  'Logistics': ['لوجستيك', 'اللوجستيك', 'النقل والتخزين'],
  'Transportation': ['نقل', 'النقل', 'المواصلات', 'العربيات'],
  'Housekeeping': ['نظافه', 'النظافه'],
  'Cafeteria': ['كافتيريا', 'البوفيه', 'بوفيه', 'المطعم'],
  'R&D': ['ابحاث', 'البحث والتطوير', 'تطوير'],
  'IT Operations': ['اي تي', 'تكنولوجيا المعلومات', 'الكمبيوتر'],
  'HR Operations': ['موارد بشريه', 'الموارد البشريه', 'شئون العاملين', 'اتش ار'],
  'Administration': ['اداره', 'الاداره'],
  'Technical Office': ['مكتب فني', 'المكتب الفني'],
  'Process': ['بروسيس', 'العمليات الفنيه'],
  'Operations': ['عمليات', 'العمليات'],
};

// ── شدة/احتمالية البلاغ ──
// الاحتمالية 1..5 والشدة A..E زي ما هي في نموذج البلاغ بالظبط.
const LIKELIHOOD_WORDS = [
  { v: '5', words: ['اكيده', 'اكيد يحصل', 'حصل فعلا', 'بيحصل كل يوم', 'مستمر'] },
  { v: '4', words: ['عاليه', 'عالي', 'كبيره جدا', 'وارد جدا', 'متكرر'] },
  { v: '3', words: ['متوسطه', 'متوسط', 'وارد', 'ممكن يحصل'] },
  { v: '2', words: ['ضئيله', 'بسيطه', 'قليله', 'نادر'] },
  { v: '1', words: ['مستحيل', 'غير ممكن'] },
];
const SEVERITY_WORDS = [
  { v: 'E', words: ['وفاه', 'موت', 'يموت', 'قاتل', 'كارثه'] },
  { v: 'D', words: ['اصابه بالغه', 'كسر', 'بتر', 'عجز', 'اصابه خطيره'] },
  { v: 'C', words: ['اصابه متوسطه', 'غياب', 'مستشفي'] },
  { v: 'B', words: ['علاج طبي', 'دكتور', 'عيادة', 'عياده'] },
  { v: 'A', words: ['بسيط', 'بسيطه', 'اسعاف اولي', 'خدش', 'جرح بسيط'] },
];

// كلمات بتوقف جملة الأسماء ("أنا وفلان وفلان هنشتغل...") — أول ما نلاقي
// واحدة منهم نبقى خرجنا من قايمة الأسماء ودخلنا على وصف الشغل.
const CLAUSE_STOP = /(هنشتغل|هشتغل|هنعمل|هعمل|هنقوم|هقوم|هنروح|في قسم|بقسم|في منطقه|علشان|عشان|لاننا|المكان|هنركب|هنغير|هنلحم|هنفك|هنصلح)/;

// ملحوظة: الأنماط اللي تحت مبنية بـ flex/alt عشان تقبل "أنا/انا" و
// "الأكافتريا/الاكافتريا" وأي صورة تانية للحروف — المستخدم بيكتب طبيعي
// والهمزات بتختلف من جملة للتانية.

// جملة النية اللي المفروض **ما تدخلش** في وصف العمل
const INTENT_PREFIX = new RegExp(
  '^\\s*(?:و\\s*)?' +
  '(?:' + alt(['انا', 'احنا']) + '\\s+)?' +
  '(?:' + alt(['لو سمحت', 'من فضلك', 'ممكن']) + '\\s*)?' +
  '(?:' + alt(['انا', 'احنا']) + '\\s+)?' +
  '(?:' + alt(['عايز', 'عاوز', 'عايزين', 'عاوزين', 'محتاج', 'محتاجين', 'نفسي', 'اريد']) + '\\s*)?' +
  '(?:' + alt(['اعمل', 'هعمل', 'نعمل', 'هنعمل', 'اطلع', 'هطلع', 'اخد', 'هاخد', 'افتح', 'هفتح', 'اقدم', 'هقدم', 'اطلب', 'هطلب', 'استخرج']) + '\\s*)?' +
  alt(['تصريح', 'تصاريح']) + '\\s*' +
  '(?:' + alt(['عمل', 'شغل']) + ')?\\s*'
);

// أفعال الشغل الفعلي ("هنغيّر ماسورة") — الوصف الحقيقي بييجي بعد آخر واحد فيهم
const WORK_VERB_WORDS = [
  'هنعمل', 'هعمل', 'هنقوم ب', 'هقوم ب', 'هنشتغل', 'هشتغل', 'هنركب', 'هنغير', 'هنلحم',
  'هنفك', 'هنصلح', 'هنظبط', 'هنحفر', 'هنرفع', 'هننضف', 'هنقطع', 'هنصب', 'هندهن',
  'هننقل', 'هنغسل', 'هنشيل', 'العمل هو', 'الشغل هو',
];
const WORK_VERB_RE = () => new RegExp(alt(WORK_VERB_WORDS), 'g');

// جملة الزمايل ("أنا ومدحت وعمرو") — بتتشال من الوصف لأنها راحت خانة الأسماء
const WORKERS_CLAUSE = () => new RegExp(
  alt(['انا و', 'احنا و', 'ومعايا', 'معايا', 'ومعي', 'معي', 'ومعانا', 'معانا']) +
  '[\\s\\S]{0,120}?(?=' + alt(['هنشتغل', 'هنعمل', 'هعمل', 'في قسم', 'بقسم']) + '|$)',
  'g'
);
const DEPT_CLAUSE = () => new RegExp(
  '(?:' + alt(['في', 'فى', 'ب']) + ')\\s*' + flex('قسم') + '\\s+\\S+(?:\\s+\\S+)?', 'g'
);
const LEADING_PREP = () => new RegExp('^(?:' + alt(['في', 'فى', 'علي', 'على', 'ب', 'بـ']) + ')\\s+');

const norm = s => N(String(s || ''));

// كلمات لوحدها مش وصف عمل ولا وصف خطورة — لو اللي فضل بعد التنضيف واحدة
// منهم بس، نسيب الخانة فاضية أحسن ما نكتب كلمة مالهاش معنى في النموذج.
const JUNK_DESC = new Set([
  'بكره', 'النهارده', 'دلوقتي', 'الصبح', 'بليل', 'امبارح', 'بعد بكره', 'حالا', 'فورا',
  'خطوره', 'خطر', 'بلاغ', 'تصريح', 'شغل', 'عمل', 'حاجه', 'موضوع', 'مشكله', 'كده', 'كذا',
]);

function isJunkDesc(text) {
  const t = norm(text).replace(/[.,،!؟]/g, ' ').trim();
  if (!t) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 3) return false;
  return words.every(w => JUNK_DESC.has(w));
}

/** بيحوّل "5501" لاسم الموظف لو الكود موجود في قاعدة الموظفين */
function codeToName(code, employees) {
  const c = String(code).replace(/^0+/, '');
  const hit = (employees || []).find(e => {
    const ec = String(e.empCode || e.code || '').replace(/^0+/, '');
    return ec === c;
  });
  return hit ? (hit.name || '').trim() : null;
}

/** بيدوّر على اسم موظف حقيقي جوه النص (عشان نكتب الاسم الرسمي مش المختصر) */
function matchEmployeeName(chunk, employees) {
  const nc = norm(chunk).trim();
  if (nc.length < 3) return null;
  let best = null;
  let bestLen = 0;
  for (const e of employees || []) {
    const name = String(e.name || '').trim();
    if (!name) continue;
    const nn = norm(name);
    // الاسم كامل جوه الكلام، أو الكلام جوه الاسم (حد بيقول أول اسمين بس)
    if ((nn.includes(nc) || nc.includes(nn)) && nn.length > bestLen) {
      best = name;
      bestLen = nn.length;
    }
  }
  return best;
}

/**
 * القائمين بالعمل: بيمسك الأكواد (أرقام) والأسماء بعد "أنا و..." / "معايا..."
 * وبيرجّعهم أسماء. الكود اللي مش موجود في قاعدة الموظفين بيترمي (مش بنكتب
 * رقم في خانة أسماء).
 */
function extractWorkers(text, employees) {
  const out = [];
  const seen = new Set();
  const push = name => {
    const n = String(name || '').trim();
    if (!n) return;
    const key = norm(n);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  };

  // 1) كل الأكواد الرقمية في الجملة (3-6 أرقام) → أسماء
  const codes = String(text).match(/\b\d{3,6}\b/g) || [];
  codes.forEach(c => {
    const name = codeToName(c, employees);
    if (name) push(name);
  });

  // 2) الجزء اللي بعد "أنا و" / "معايا" / "مع" لحد أول كلمة توقّف
  const WORKERS_LEAD = new RegExp(alt(['انا و', 'احنا و', 'ومعايا', 'معايا', 'ومعي', 'معي', 'ومعانا', 'معانا', 'مع ']) + '([\\s\\S]{2,120})');
  const m = String(text).match(WORKERS_LEAD);
  if (m) {
    let chunk = m[1];
    const stop = norm(chunk).search(CLAUSE_STOP);
    if (stop > 0) chunk = chunk.slice(0, stop);
    chunk.split(/\s*[,،]\s*|\s+و\s*|\s*&\s*/).forEach(part => {
      const p = part.trim();
      if (!p || /^\d+$/.test(p)) return; // الأكواد اتعملت فوق
      const name = matchEmployeeName(p, employees);
      if (name) push(name);
      else if (/^[ء-ي\s]{4,40}$/.test(p)) push(p); // اسم مش في القاعدة — نكتبه زي ما اتقال
    });
  }
  return out;
}

/** أول مفتاح قيمته موجودة في الكلام (أطول تطابق بيكسب) */
function matchFromMap(nq, map) {
  let best = null;
  let bestLen = 0;
  for (const [key, words] of Object.entries(map)) {
    for (const w of words) {
      const nw = norm(w);
      if (nw.length > bestLen && nq.includes(nw)) { best = key; bestLen = nw.length; }
    }
  }
  return best;
}

function detectPermitType(nq) {
  return matchFromMap(nq, PERMIT_TYPES);
}

/**
 * وصف الشغل: بنشيل جملة النية وجملة الأسماء وجملة القسم، واللي يفضل هو
 * الوصف. لو الجملة كلها كانت نية بس ("عايز أعمل تصريح سخن") بنرجّع فاضي
 * — أحسن بكتير من إننا نحط جملة النية في خانة وصف العملية.
 */
function extractWorkDescription(text) {
  let s = String(text || '').trim();

  // الجزء اللي بعد فعل الشغل هو الوصف الحقيقي. بناخد **آخر** فعل شغل في
  // الجملة مش أول واحد — لأن "هعمل تصريح سخن ... هنغير ماسورة" أول فعل
  // فيها بيوصف التصريح نفسه مش الشغل، والوصف الحقيقي بييجي بعد آخر فعل.
  // (ده كان أهم باج: الوصف كان بياخد الجملة كلها بجملة النية بتاعتها.)
  const WORK_VERB = WORK_VERB_RE();
  let match;
  let best = null;
  WORK_VERB.lastIndex = 0;
  while ((match = WORK_VERB.exec(s)) !== null) {
    const after = s.slice(match.index + match[0].length).trim()
      .replace(LEADING_PREP(), '')
      .trim();
    // "هعمل **تصريح** ..." = كلام عن التصريح نفسه، مش وصف شغل
    if (after.length >= 3 && !/^(?:تصريح|تصاريح|بلاغ)/.test(after) && !isJunkDesc(after)) best = after;
  }
  if (best) return best;

  // مفيش فعل شغل صريح → نشيل جملة النية وجملة الأسماء والقسم
  s = s.replace(INTENT_PREFIX, ' ');
  // نشيل النوع نفسه لو فضل لوحده ("سخن" / "على ارتفاع")
  Object.values(PERMIT_TYPES).flat().forEach(w => {
    s = s.replace(new RegExp('(^|\\s)(' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')(\\s|$)', 'gi'), ' ');
  });
  s = s.replace(WORKERS_CLAUSE(), ' ');
  s = s.replace(/\b\d{3,6}\b/g, ' ');
  s = s.replace(DEPT_CLAUSE(), ' ');
  s = s.replace(/\s{2,}/g, ' ').replace(/^[\s,،.و-]+|[\s,،.-]+$/g, '').trim();

  // "في الكافتيريا **عشان** مواسير الصرف" — اللي بعد "عشان" هو سبب الشغل
  // يعني وصف العملية الحقيقي، واللي قبلها مكان (وهو ليه خانته المستقلة).
  const purpose = s.match(new RegExp(alt(['عشان', 'علشان', 'بسبب', 'من اجل']) + '\\s+([\\s\\S]{3,200})$'));
  if (purpose && purpose[1].trim().length >= 3 && !isJunkDesc(purpose[1])) {
    return purpose[1].trim();
  }
  return (s.length >= 4 && !isJunkDesc(s)) ? s : '';
}

/**
 * extractPermitRequest(text, { employees }) → بيانات نموذج التصريح
 */
function extractPermitRequest(text, opts) {
  const employees = (opts && opts.employees) || [];
  const raw = String(text || '');
  const nq = norm(raw);

  const permitType = detectPermitType(nq) || 'general';
  const workers = extractWorkers(raw, employees);
  const location = matchFromMap(nq, WORK_LOCATIONS);
  const department = matchFromMap(nq, DEPT_ALIASES);
  const description = extractWorkDescription(raw);

  const fill = {};
  if (description) fill.desc = description;
  if (workers.length) fill.workers = workers.join('\n');
  // مكان العمل في النموذج قايمة ثابتة — لو مالقيناش مكان صريح بنجرّب
  // نستنتجه من القسم اللي اتقال (الصيانة → Maintenance وهكذا).
  const loc = location || (department && WORK_LOCATIONS[department] ? department : null);
  if (loc) fill.location = loc;

  return { permitType, fill, workers, department, description };
}

/**
 * extractHazardReport(text, { employees }) → بيانات نموذج البلاغ
 * مثال: "شفت ماسورة مكسورة في مخزن الخامات، خطورتها عالية، ممكن تتحل
 *        بتغيير الوصلة"
 */
// كلمات بتنهي جملة المكان — بنقص عندها بالنص الخام (مش المنوّن) عشان
// الفهارس ما تزحفش (التنوين بيغيّر طول النص فبيبوّظ القص).
const AREA_STOP = new RegExp('(?:\\s|^)و?' + alt(['خطورت', 'خطر', 'ممكن', 'الحل', 'لازم', 'عشان', 'علشان', 'المفروض', 'وارد']));
const SOLUTION_RE = new RegExp(
  '(?:' + alt(['ممكن تتحل', 'ممكن يتحل', 'ممكن نحلها', 'ممكن تتصلح', 'ممكن يتصلح', 'الحل المقترح', 'الحل هو', 'الحل', 'المفروض', 'لازم']) + ')' +
  '\\s*(?:' + alt(['ب', 'بـ', 'عن طريق']) + ')?\\s+([\\s\\S]{3,200})$'
);
const INJURY_RE = new RegExp(
  '(?:' + alt(['ممكن', 'وارد', 'يمكن', 'خايف']) + ')\\s+' +
  '((?:' + flex('حد') + '\\s+)?[يت][\\u0621-\\u064A]+(?:\\s+[\\u0621-\\u064A]+){0,3})'
);
const AREA_PREP_RE = () => new RegExp(
  '(?:^|\\s)(?:' + alt(['في', 'فى', 'عند', 'جنب', 'قدام', 'ورا', 'داخل', 'بمنطقه', 'في منطقه']) + ')\\s+', 'g'
);
const HAZ_DESC_PREFIX = new RegExp(
  '^\\s*(?:و\\s*)?(?:' + alt(['انا']) + '\\s+)?' +
  '(?:' + alt(['شفت', 'شوفت', 'لقيت', 'لاقيت', 'لاحظت', 'فيه', 'في', 'عايز ابلغ عن', 'ابلغ عن', 'بلاغ عن']) + ')\\s+'
);
const HAZ_RISK_WORD = () => new RegExp('و?' + alt(['خطورتها', 'خطورته', 'خطرها', 'خطره']) + '\\s+\\S+', 'g');

/**
 * extractHazardReport(text, { employees }) → بيانات نموذج البلاغ
 * مثال: "شفت ماسورة مكسورة في مخزن الخامات، خطورتها عالية، ممكن تتحل
 *        بتغيير الوصلة"
 */
function extractHazardReport(text, opts) {
  const raw = String(text || '');
  const nq = norm(raw);
  const fill = {};
  let rest = raw;

  // 1) الحل المقترح: "ممكن تتحل بـ..." / "الحل..." / "لازم..."
  const solution = rest.match(SOLUTION_RE);
  if (solution) {
    fill.solution = solution[1].trim().replace(new RegExp('^' + alt(['ب', 'بـ']) + '\\s*'), '').trim();
    rest = rest.slice(0, solution.index).trim();
  }

  // 2) الإصابة المحتملة: "ممكن حد يتصعق" / "ممكن يقع" — مش حل، دي إصابة
  const injury = rest.match(INJURY_RE);
  if (injury && !/يتحل|يتصلح|تتحل|تتصلح/.test(injury[1])) {
    fill.injury = injury[1].trim();
    rest = (rest.slice(0, injury.index) + ' ' + rest.slice(injury.index + injury[0].length)).trim();
  }

  // 3) الخطورة: احتمالية + شدة (اللي مايتقالش بيفضل فاضي عشان هو يختاره)
  const lk = LIKELIHOOD_WORDS.find(x => x.words.some(w => nq.includes(norm(w))));
  const sv = SEVERITY_WORDS.find(x => x.words.some(w => nq.includes(norm(w))));
  if (lk) fill.likelihood = lk.v;
  if (sv) fill.severity = sv.v;

  // 4) المكان: آخر أداة مكان في الجملة ("جنب المكينة التالتة").
  // "في" في أول الجملة معناها "يوجد" مش مكان ("في تسريب زيت...") — فبنتجاهلها.
  const AREA_PREP = AREA_PREP_RE();
  let am;
  let areaStart = -1;
  let areaPrepLen = 0;
  AREA_PREP.lastIndex = 0;
  while ((am = AREA_PREP.exec(rest)) !== null) {
    if (am.index === 0 && /^(?:\s*)(?:في|فى)/.test(am[0])) continue; // "في" الافتتاحية
    areaStart = am.index + am[0].length;
    areaPrepLen = am[0].length;
    break; // أول أداة مكان حقيقية كفاية
  }
  let areaClauseStart = -1;
  if (areaStart > 0) {
    let a = rest.slice(areaStart);
    const stop = a.search(AREA_STOP);
    if (stop > 0) a = a.slice(0, stop);
    a = a.replace(/[,،.]+.*$/s, '').trim();
    if (a.length >= 3 && a.length <= 60) {
      fill.area = a;
      areaClauseStart = areaStart - areaPrepLen;
    }
  }

  // 5) القسم لو اتقال صراحة
  const dept = matchFromMap(nq, DEPT_ALIASES);
  if (dept) fill.dept = dept;

  // 6) الوصف: اللي فضل بعد ما شلنا المكان والحل والخطورة وجملة "أنا شفت"
  let desc = rest;
  if (areaClauseStart > 0) desc = desc.slice(0, areaClauseStart);
  desc = desc
    .replace(HAZ_DESC_PREFIX, '')
    .replace(HAZ_RISK_WORD(), ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,،.و-]+|[\s,،.-]+$/g, '')
    .trim();
  if (desc.length >= 4 && !isJunkDesc(desc)) fill.desc = desc;

  return { fill };
}

module.exports = {
  extractPermitRequest,
  extractHazardReport,
  detectPermitType,
  extractWorkers,
  extractWorkDescription,
  PERMIT_TYPES,
  WORK_LOCATIONS,
  DEPT_ALIASES,
};
