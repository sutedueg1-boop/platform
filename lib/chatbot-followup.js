// ============================================================
// lib/chatbot-followup.js — الشات بوت بيكمّل النموذج بالسؤال
// ============================================================
// بعد ما يفتحلك تصريح أو بلاغ ويملا اللي فهمه، الخانات اللي فضلت فاضية
// مش بتتساب — بيسأل عنها واحدة واحدة، وكل إجابة بتتحط في خانتها فورًا:
//
//   انت: عايز تصريح حفر في الكافتيريا عشان مواسير الصرف أنا ومدحت
//   هو : فتحتلك تصريح حفر وملّيت الوصف والأسماء. ناقص مكان العمل — اختار رقم:
//        1) Administration  2) all factory  3) Maintenance ...
//   انت: 3
//   هو : ✅ مكان العمل: Maintenance. تمام — راجع وابعت.
//
// الحالة بتتخزّن في **الواجهة** مش على السيرفر (نفس فكرة context الموجودة
// أصلاً) — فمفيش أي محادثات متخزّنة على السيرفر، وكل سؤال بيتحقق من
// صلاحية صاحب الجلسة من الأول.
// إضافة 20 سبتمبر 2026.
'use strict';

const kb = require('./chatbot-kb');
const extract = require('./chatbot-extract');
const N = kb.normalizeArabic;

// قايمة أماكن العمل زي ما هي في نموذج التصريح (WORK_LOCATIONS في app.js)
const LOCATIONS = [
  'Administration', 'all factory', 'Maintenance', 'outside',
  'Production - Master Batch', 'Production - Special Compounds',
  'Quality Control', 'R&D', 'Warehouse',
];
const LOCATION_AR = {
  'Administration': 'الإدارة', 'all factory': 'المصنع كله', 'Maintenance': 'الصيانة',
  'outside': 'خارج المصنع', 'Production - Master Batch': 'إنتاج ماستر باتش',
  'Production - Special Compounds': 'إنتاج الخلطات الخاصة', 'Quality Control': 'الجودة',
  'R&D': 'البحث والتطوير', 'Warehouse': 'المخازن',
};

const LIKELIHOOD_LIST = [
  ['1', 'غير ممكن حدوثه'], ['2', 'احتمالية ضئيلة'], ['3', 'احتمالية متوسطة'],
  ['4', 'احتمالية عالية'], ['5', 'أكيدة الحدوث'],
];
const SEVERITY_LIST = [
  ['A', 'بسيط أو إسعاف أولي'], ['B', 'علاج طبي'], ['C', 'إصابة بغياب أقل من 30 يوم'],
  ['D', 'إصابة بغياب 30 يوم أو أكتر'], ['E', 'وفاة'],
];

const numberedList = pairs => pairs.map(([v, label], i) => `${i + 1}) ${label}`).join('\n');

/** بيقرا رقم من إجابة زي "3" أو "رقم 3" أو "التالت" */
function pickIndex(text, max) {
  const t = N(text).trim();
  const digits = t.match(/\d+/);
  if (digits) {
    const n = parseInt(digits[0], 10);
    if (n >= 1 && n <= max) return n - 1;
  }
  const ORD = ['الاول', 'التاني', 'التالت', 'الرابع', 'الخامس', 'السادس', 'السابع', 'التامن', 'التاسع'];
  const idx = ORD.findIndex(o => t.includes(o));
  if (idx >= 0 && idx < max) return idx;
  return -1;
}

// ── تعريف الخانات: إزاي نسأل عنها وإزاي نفهم الإجابة ──
const FIELDS = {
  permit: {
    location: {
      label: 'مكان العمل',
      required: true,
      ask: () => `📍 مكان العمل فين؟ اختار رقم:\n${numberedList(LOCATIONS.map(l => [l, `${LOCATION_AR[l]} (${l})`]))}`,
      parse: (text) => {
        const i = pickIndex(text, LOCATIONS.length);
        if (i >= 0) return LOCATIONS[i];
        const nq = N(text);
        for (const l of LOCATIONS) {
          if (nq.includes(N(l)) || nq.includes(N(LOCATION_AR[l]))) return l;
        }
        // كلمات عامية ("الورشة" → Maintenance) من نفس خريطة الاستخراج
        for (const [key, words] of Object.entries(extract.WORK_LOCATIONS)) {
          if (words.some(w => nq.includes(N(w)))) return key;
        }
        return null;
      },
      confirm: v => `✅ مكان العمل: ${LOCATION_AR[v] || v}`,
    },
    desc: {
      label: 'وصف العملية',
      required: true,
      ask: () => '🔧 هتعملوا إيه بالظبط؟ (وصف العملية — جملة واحدة تكفي)',
      parse: (text) => (String(text).trim().length >= 3 ? String(text).trim() : null),
      confirm: v => `✅ وصف العملية: ${v}`,
    },
    workers: {
      label: 'أسماء القائمين بالعمل',
      required: true,
      ask: () => '👷 مين اللي هيشتغل معاك؟ اكتب الأسماء أو الأكواد الوظيفية (وأنا أحوّل الأكواد لأسماء)',
      parse: (text, ctx) => {
        const employees = safeEmployees(ctx);
        const names = extract.extractWorkers('انا و' + text, employees);
        if (names.length) return names.join('\n');
        const manual = String(text).split(/[,،\n]|\s+و\s+/).map(s => s.trim()).filter(s => s.length >= 3);
        return manual.length ? manual.join('\n') : null;
      },
      confirm: v => `✅ القائمين بالعمل: ${v.split('\n').join('، ')}`,
    },
    equip: {
      label: 'المعدة / الماكينة',
      required: false,
      ask: () => '⚙️ فيه معدة أو ماكينة معيّنة الشغل عليها؟ (لو مفيش اكتب "لأ")',
      parse: (text) => (/^(لا|لأ|مفيش|خلاص|مش موجود)/.test(N(text).trim()) ? '' : String(text).trim()),
      confirm: v => (v ? `✅ المعدة: ${v}` : '✅ تمام، من غير معدة محددة'),
    },
  },

  hazard: {
    desc: {
      label: 'وصف الخطورة',
      required: true,
      ask: () => '⚠️ إيه الخطورة اللي شوفتها بالظبط؟',
      parse: (text) => (String(text).trim().length >= 3 ? String(text).trim() : null),
      confirm: v => `✅ الوصف: ${v}`,
    },
    area: {
      label: 'المكان',
      required: true,
      ask: () => '📍 الخطورة دي فين بالظبط؟ (اسم المكان أو الماكينة)',
      parse: (text) => (String(text).trim().length >= 2 ? String(text).trim() : null),
      confirm: v => `✅ المكان: ${v}`,
    },
    likelihood: {
      label: 'الاحتمالية',
      required: true,
      ask: () => `📊 احتمالية إن الخطر ده يسبب إصابة قد إيه؟\n${numberedList(LIKELIHOOD_LIST)}`,
      parse: (text) => {
        const i = pickIndex(text, 5);
        if (i >= 0) return LIKELIHOOD_LIST[i][0];
        const nq = N(text);
        if (/اكيد|مؤكد/.test(nq)) return '5';
        if (/عالي|كبير/.test(nq)) return '4';
        if (/متوسط/.test(nq)) return '3';
        if (/ضئيل|قليل|بسيط/.test(nq)) return '2';
        return null;
      },
      confirm: v => `✅ الاحتمالية: ${(LIKELIHOOD_LIST.find(x => x[0] === v) || [])[1] || v}`,
    },
    severity: {
      label: 'شدة الإصابة المتوقعة',
      required: true,
      ask: () => `🩹 لو حصلت إصابة، متوقع تكون إيه؟\n${numberedList(SEVERITY_LIST)}`,
      parse: (text) => {
        const i = pickIndex(text, 5);
        if (i >= 0) return SEVERITY_LIST[i][0];
        const nq = N(text).toUpperCase();
        const letter = nq.match(/\b([A-E])\b/);
        if (letter) return letter[1];
        if (/وفاه|موت/.test(N(text))) return 'E';
        if (/كسر|بتر|عجز/.test(N(text))) return 'D';
        if (/مستشفي|غياب/.test(N(text))) return 'C';
        if (/دكتور|علاج/.test(N(text))) return 'B';
        if (/بسيط|خدش|اسعاف/.test(N(text))) return 'A';
        return null;
      },
      confirm: v => `✅ الشدة: ${(SEVERITY_LIST.find(x => x[0] === v) || [])[1] || v}`,
    },
    solution: {
      label: 'الحل المقترح',
      required: false,
      ask: () => '💡 في رأيك إيه الحل؟ (لو مش عارف اكتب "مش عارف")',
      parse: (text) => (/^(مش عارف|لا|لأ|مفيش|معرفش)/.test(N(text).trim()) ? '' : String(text).trim()),
      confirm: v => (v ? `✅ الحل المقترح: ${v}` : '✅ تمام، سيبنا الحل لفريق السلامة'),
    },
  },
};

function safeEmployees(ctx) {
  try { return (ctx && ctx.data && typeof ctx.data.employees === 'function') ? ctx.data.employees() : []; }
  catch (e) { return []; }
}

/** الخانات اللي لسه ناقصة بالترتيب (المطلوبة الأول) */
function missingFields(kind, fill) {
  const defs = FIELDS[kind];
  if (!defs) return [];
  const has = k => fill && String(fill[k] || '').trim().length > 0;
  const req = Object.keys(defs).filter(k => defs[k].required && !has(k));
  const opt = Object.keys(defs).filter(k => !defs[k].required && !has(k));
  return [...req, ...opt];
}

/** أول سؤال بعد فتح النموذج — بيرجّع null لو مفيش حاجة ناقصة */
function firstQuestion(kind, fill) {
  const missing = missingFields(kind, fill);
  if (!missing.length) return null;
  const field = missing[0];
  return {
    field,
    ask: FIELDS[kind][field].ask(),
    pending: { kind, asked: field, remaining: missing.slice(1) },
  };
}

// كلمات إنهاء المحادثة
const CANCEL = /^(خلاص|كفايه|كفايا|بس كده|بطل|سيبك|مش عايز|لاحقا|بعدين|الغاء|كنسل)$/;

/**
 * answerFollowup(text, ctx) → null لو مفيش سؤال معلّق، أو
 * { reply, action:{type:'fill', fill}, followup } لما يكمّل خانة.
 */
function answerFollowup(text, ctx) {
  const pending = ctx && ctx.context && ctx.context.pending;
  if (!pending || !FIELDS[pending.kind]) return null;
  const defs = FIELDS[pending.kind];
  const def = defs[pending.asked];
  if (!def) return null;

  const raw = String(text || '').trim();
  if (CANCEL.test(N(raw))) {
    return { reply: 'تمام، وقفت الأسئلة. كمّل باقي الخانات بنفسك في النموذج وابعت لما تجهز 👍', clearPending: true, source: null };
  }

  const value = def.parse(raw, ctx);
  if (value === null || value === undefined) {
    // إجابة مش مفهومة: لو شكلها سؤال جديد نسيب الموضوع، وإلا نعيد السؤال مرة
    if (/[؟?]$/.test(raw) || raw.length > 120) return null;
    return {
      reply: `مش فاهم الإجابة دي 🤔\n${def.ask()}\n\n(أو اكتب "خلاص" لو عايز تكمّل النموذج بنفسك)`,
      keepPending: true,
      source: null,
    };
  }

  const fill = {};
  if (String(value).length) fill[pending.asked] = value;

  // الخانة اللي بعدها
  const rest = (pending.remaining || []).filter(k => defs[k]);
  const nextField = rest[0];
  const lines = [def.confirm(value)];
  let followup = null;
  if (nextField) {
    lines.push('', defs[nextField].ask());
    followup = { kind: pending.kind, asked: nextField, remaining: rest.slice(1) };
  } else {
    lines.push('', pending.kind === 'permit'
      ? '🎉 تمام — كل الخانات الأساسية اتملت. راجع النموذج، املا قايمة التحقق، وابعت الطلب.'
      : '🎉 تمام — البلاغ جاهز. راجعه وابعته، ولو عندك صورة للخطر ارفعها معاه.');
  }

  return {
    reply: lines.join('\n'),
    action: Object.keys(fill).length ? { type: 'fill', tab: pending.kind === 'permit' ? 'worker' : 'hazardWorker', fill } : null,
    followup,
    source: null,
  };
}

/** بيتأكد إن الـ pending الجاي من الواجهة سليم (مش أي حاجة) */
function sanitizePending(p) {
  if (!p || typeof p !== 'object') return null;
  const defs = FIELDS[p.kind];
  if (!defs || !defs[p.asked]) return null;
  const remaining = Array.isArray(p.remaining) ? p.remaining.filter(k => defs[k]).slice(0, 8) : [];
  return { kind: p.kind, asked: p.asked, remaining };
}

module.exports = { answerFollowup, firstQuestion, missingFields, sanitizePending, FIELDS, LOCATIONS };
