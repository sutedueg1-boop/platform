// ============================================================
// lib/chatbot-llm.js — طبقة الذكاء الاصطناعي (آخر طبقة في الشات بوت)
// ============================================================
// الطبقات المحلية (بياناتك، الأرقام، SDS، الهيكل، التعليمات، التنقّل،
// أسئلة المنصة) هي اللي بترد على أغلب الأسئلة، وهي مجانية وبتشتغل من غير
// إنترنت. الطبقة دي بتشتغل **بس** لما كل اللي فوق ميلاقوش إجابة — بتاخد
// نفس المقاطع الموثقة من قاعدة المعرفة وتخلي النموذج يصيغ منها إجابة
// بالعامية، بشرط صارم: ممنوع يخترع أي معلومة مش في المقاطع دي.
//
// 🔌 مزوّدين مدعومين (اختار واحد بس):
//   1) Google Gemini — **مجاني** (من غير فيزا): حط GEMINI_API_KEY في .env
//      المفتاح من: aistudio.google.com/apikey
//   2) Claude (Anthropic) — مدفوع وأقوى: حط ANTHROPIC_API_KEY في .env
//      المفتاح من: console.anthropic.com
//   لو الاتنين موجودين، Claude بياخد الأولوية (أو حدّد CHATBOT_LLM_PROVIDER).
//
// من غير أي مفتاح الطبقة دي "معطّلة بأمان" — الشات بوت بيشتغل عادي
// بالطبقات المحلية من غير أي رسالة خطأ.
//
// 🔒 إيه اللي بيخرج من المصنع لما تتفعّل؟ سؤال المستخدم + مقاطع تعليمات
//    السلامة المطابقة + دور المستخدم وقسمه. **مفيش** أسماء موظفين، ولا
//    أرقام تليفونات، ولا بيانات بلاغات/تصاريح شخصية.
//    ملحوظة مهمة عن Gemini المجاني: جوجل بتقول صراحة إن محتوى النسخة
//    المجانية ممكن يُستخدم في تحسين خدماتهم — عشان كده الطبقة دي متعمدة
//    ما تبعتش أي بيانات شخصية أصلاً.
//
// إضافة 20 سبتمبر 2026.
'use strict';

const TIMEOUT_MS = Number(process.env.CHATBOT_LLM_TIMEOUT_MS || 20000);
const MAX_TOKENS = 800;

// موديلات Gemini بالترتيب — لو الاسم الأول مش متاح على حسابك بنجرّب اللي
// بعده تلقائيًا (أسماء الموديلات بتتغير مع الوقت، فده بيمنع إن الفيتشر
// يقف فجأة بسبب اسم قديم).
// مترتبين بالسرعة الفعلية اللي قِستها على حساب مجاني (20 سبتمبر 2026):
// flash-lite-latest ≈ 0.8ث | 3-flash-preview ≈ 1.1ث | 3.1-flash-lite ≈ 5ث |
// 3.5-flash ≈ 11ث. الأسرع الأول عشان المستخدم ما يستناش في الشات.
// ملحوظة: Google بتشيل أسماء موديلات قديمة من غير سابق إنذار (2.5-flash
// و2.0-flash بقوا 404 فعلاً) — عشان كده فيه اكتشاف تلقائي تحت.
const GEMINI_FALLBACK_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash',
  'gemini-flash-latest',
];
let _discovered = null; // موديلات اتجابت من Google نفسها لما اللي فوق كلهم يفشلوا

/**
 * لو كل الأسماء المحفوظة فشلت، بنسأل Google نفسها عن الموديلات المتاحة
 * للمفتاح ده ونجرّب أخفها. كده الفيتشر ما يقفش تاني لما الأسماء تتغير.
 */
async function discoverGeminiModels(key) {
  if (_discovered) return _discovered;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}&pageSize=100`);
    if (!res.ok) return [];
    const data = await res.json();
    const names = (data.models || [])
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map(m => String(m.name || '').replace('models/', ''))
      // بعيد عن موديلات الصور والصوت والمعاينات التقيلة
      .filter(n => /flash/i.test(n) && !/(image|tts|audio|omni|native|banana)/i.test(n));
    // الـ lite الأول (أسرع وأخف على الحصة المجانية)
    names.sort((a, b) => (/lite/i.test(b) ? 1 : 0) - (/lite/i.test(a) ? 1 : 0));
    _discovered = names.slice(0, 6);
    if (_discovered.length) console.log('[chatbot-llm] موديلات Gemini المكتشفة تلقائيًا: ' + _discovered.join(', '));
    return _discovered;
  } catch (e) {
    return [];
  }
}

let _anthropic = null;
let _geminiModel = null;      // أول موديل اشتغل فعلاً — بنفضل عليه
let _fallbacksUnsupported = false;
let _warned = {};

// ── كاش الردود ────────────────────────────────────────────────────────
// الحصة المجانية محدودة، و٩٥٪ من أسئلة المصنع بتتكرر ("ألبس إيه في
// مخزن الصبغات؟" هيسألها ٥٠ عامل). بنحفظ الرد في الذاكرة فأول واحد بس
// هو اللي بيستهلك من الحصة، والباقي بياخد الرد فورًا (٠ مللي ثانية).
// بيتمسح مع كل إعادة تشغيل للسيرفر — وده مقصود عشان أي تعديل في
// المستندات يظهر من غير ما نضطر نمسح كاش يدوي.
const CACHE_MAX = 500;
const _cache = new Map();
const cacheKey = (kind, a, b) => kind + '|' + String(a).slice(0, 300) + '|' + String(b || '').slice(0, 300);
function cacheGet(key) {
  if (!_cache.has(key)) return null;
  const v = _cache.get(key);
  _cache.delete(key); _cache.set(key, v);  // LRU: المستخدم مؤخرًا يفضل
  return v;
}
function cacheSet(key, val) {
  if (!val) return;
  if (_cache.size >= CACHE_MAX) _cache.delete(_cache.keys().next().value);
  _cache.set(key, val);
}

function warnOnce(key, msg) {
  if (_warned[key]) return;
  _warned[key] = true;
  console.warn('[chatbot-llm] ' + msg);
}

/** أي مزوّد شغّال دلوقتي: 'anthropic' | 'gemini' | null */
function provider() {
  const forced = String(process.env.CHATBOT_LLM_PROVIDER || '').trim().toLowerCase();
  const hasAnthropic = !!String(process.env.ANTHROPIC_API_KEY || '').trim();
  const hasGemini = !!String(process.env.GEMINI_API_KEY || '').trim();
  if (forced === 'gemini') return hasGemini ? 'gemini' : null;
  if (forced === 'anthropic' || forced === 'claude') return hasAnthropic ? 'anthropic' : null;
  if (hasAnthropic) return 'anthropic';
  if (hasGemini) return 'gemini';
  return null;
}

function isConfigured() {
  return provider() !== null;
}

// البرومبت بيتغير حسب وجود مقاطع من مستندات المصنع أو لأ:
//  • فيه مقاطع  → رد من المقاطع بس (صفر اختراع في تفاصيل المصنع).
//  • مفيش مقاطع → مسموح يرد من معرفته العامة في السلامة المهنية، **بس**
//    بعلامة واضحة إن ده رد عام مش من مستندات المصنع، ومن غير ما يخترع أي
//    حاجة خاصة بالمصنع نفسه. من غير ده كان بيرفض يرد على أي سؤال عملي
//    برّه الملفات (زي "الجو حر وأنا شغال في الشمس أعمل إيه؟").
function buildSystemPrompt(hasSources) {
  const base = [
    'انت "مساعد السلامة" — المساعد الرسمي لمنصة السلامة والصحة المهنية في مصنع السويدي بوليمرز.',
    'بتتكلم عامية مصرية بسيطة، وبترد على عمال ومهندسين وإدارة في مصنع بلاستيك وبوليمرات.',
    '',
    'قواعد ثابتة:',
    '• الرد قصير: ٦ سطور كحد أقصى، ونقط لو فيه خطوات.',
    '• في أي موقف خطر حقيقي (حريق، إصابة، تسريب، صعق)، ابدأ بالخطوة العاجلة الأول وبعدين التفاصيل.',
    '• ممنوع تدي بيانات أي موظف، ولا أرقام تليفونات، ولا تخمّن أرقام أو إحصائيات عن المصنع.',
    '• ممنوع تخترع أي حاجة **خاصة بالمصنع**: أسماء أشخاص، أرقام تصاريح، إجراءات داخلية، مواد كيميائية موجودة عندهم، أو أسماء أقسام. اللي من دول مش متأكد منه قول إنه يتأخد من مشرف السلامة.',
    '• ما تقولش إنك ذكاء اصطناعي خارجي ولا تتكلم عن الموديل أو الـ API — انت مساعد المنصة وخلاص.',
    '',
  ];
  if (hasSources) {
    base.push(
      'في المقاطع اللي جوه <المصادر> إجابة للسؤال — اعتمد عليها هي بالذات وصُغها بالعامية،',
      'ومتضيفش تفاصيل مصنع مش موجودة فيها.'
    );
  } else {
    base.push(
      'مفيش مقاطع من مستندات المصنع للسؤال ده. تقدر ترد من معرفتك العامة في السلامة والصحة المهنية',
      '(إسعافات، إجهاد حراري، مهمات وقاية، مخاطر عامة، سلوك آمن...)، بشرطين:',
      '١. ابدأ ردك بالسطر ده بالظبط: "ℹ️ رد عام من قواعد السلامة المهنية — مش من مستندات المصنع."',
      '٢. اقفل ردك بجملة قصيرة إنه يراجع مشرف السلامة لو المطلوب إجراء رسمي داخل المصنع.',
      'ولو السؤال مالوش أي علاقة بالشغل ولا السلامة ولا صحة الناس (رياضة، سياسة، كلام عام)، قول بلطف إن ده برّه نطاقك.'
    );
  }
  return base.join('\n');
}

function buildSourcesBlock(snippets) {
  if (!Array.isArray(snippets) || !snippets.length) {
    return '<المصادر>\n(مفيش مقاطع مطابقة في مصادر المصنع لسؤال المستخدم ده)\n</المصادر>';
  }
  const parts = snippets.slice(0, 5).map((s, i) => {
    const text = String(s.text || '').slice(0, 1800);
    return `[مصدر ${i + 1}] ${s.title || ''}\n(المرجع: ${s.source || 'غير محدد'})\n${text}`;
  });
  return `<المصادر>\n${parts.join('\n\n')}\n</المصادر>`;
}

function buildUserBlock({ question, user, snippets }) {
  const u = user || {};
  const who = [
    u.role === 'worker' ? 'الشخص اللي بيسأل: عامل/مهندس في المصنع.' : 'الشخص اللي بيسأل: من الإدارة (مشرف/مسؤول سلامة).',
    u.department ? `قسمه: ${u.department}.` : '',
  ].filter(Boolean).join(' ');
  return [buildSourcesBlock(snippets), '', who, '', `سؤاله: ${question}`].join('\n');
}

// ── Claude (Anthropic) ────────────────────────────────────────────────
async function askAnthropic(userBlock, systemPrompt) {
  const Anthropic = require('@anthropic-ai/sdk');
  if (!_anthropic) _anthropic = new Anthropic({ maxRetries: 1, timeout: TIMEOUT_MS });
  const params = {
    model: process.env.CHATBOT_LLM_MODEL || 'claude-opus-5',
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    output_config: { effort: process.env.CHATBOT_LLM_EFFORT || 'low' },
    messages: [{ role: 'user', content: userBlock }],
  };
  let message;
  if (_fallbacksUnsupported) {
    message = await _anthropic.messages.create(params);
  } else {
    try {
      message = await _anthropic.beta.messages.create({
        ...params,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError) {
        _fallbacksUnsupported = true;
        warnOnce('fb', 'server-side fallbacks مش مدعومة على الحساب ده — هكمّل من غيرها.');
        message = await _anthropic.messages.create(params);
      } else throw err;
    }
  }
  if (message && message.stop_reason === 'refusal') return '';
  return (message.content || []).filter(b => b && b.type === 'text').map(b => b.text).join('\n').trim();
}

// ── Google Gemini (المجاني) ───────────────────────────────────────────
async function callGemini(model, userBlock, key, systemPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userBlock }] }],
        // الحد أعلى عن Claude لأن موديلات Gemini الجديدة بتستهلك جزء من
        // الحد في التفكير الداخلي، ولو الحد صغير بترجع رد فاضي.
        generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = (data && data.error && data.error.message) || res.statusText;
      return { status: res.status, error: msg, text: '' };
    }
    const cand = (data.candidates || [])[0];
    const text = ((cand && cand.content && cand.content.parts) || [])
      .map(p => p && p.text).filter(Boolean).join('\n').trim();
    return { status: 200, text, finishReason: (cand && cand.finishReason) || '' };
  } finally {
    clearTimeout(timer);
  }
}

async function askGemini(userBlock, systemPrompt) {
  const key = String(process.env.GEMINI_API_KEY || '').trim();
  // الموديل اللي اشتغل قبل كده بييجي الأول، وبعده الباقي كاحتياطي — عشان
  // لو الموديل زحمة دلوقتي (503) نجرّب غيره بدل ما المستخدم ياخد "مش لاقي".
  const preferred = [_geminiModel, process.env.CHATBOT_LLM_MODEL].filter(Boolean);
  let candidates = [...new Set([...preferred, ...GEMINI_FALLBACK_MODELS])];

  for (let round = 0; round < 2; round++) {
  for (const model of candidates) {
    const out = await callGemini(model, userBlock, key, systemPrompt);
    if (out.status === 200) {
      if (out.text) {
        if (_geminiModel !== model) {
          _geminiModel = model;
          console.log(`[chatbot-llm] Gemini شغّال بموديل: ${model}`);
        }
        return out.text;
      }
      // رد فاضي (فلتر أمان مثلاً) — مفيش فايدة من تجربة موديل تاني
      warnOnce('empty', 'Gemini رجّع رد فاضي (finishReason: ' + (out.finishReason || 'غير معروف') + ') — الشات بوت كمّل محليًا.');
      return '';
    }
    // 404 = الموديل مش متاح على حسابك | 503 = زحمة مؤقتة → جرّب اللي بعده
    if (out.status === 404 || out.status === 503 || /not found|not supported|overloaded|high demand/i.test(out.error || '')) continue;
    // 429 = خلصت حصة الموديل ده. كل موديل ليه حصة مستقلة، فبنجرّب اللي
    // بعده بدل ما نستسلم من أول موديل (ده كان بيخلي ٩٠٪ من الأسئلة
    // ترجع للردود المحلية بمجرد ما أول موديل يزحم).
    if (out.status === 429) {
      warnOnce('429', 'حصة الموديل ' + model + ' خلصت — بجرّب موديل تاني.');
      continue;
    }
    if (out.status === 400 || out.status === 403) {
      warnOnce('key', 'مفتاح GEMINI_API_KEY مرفوض أو مش مفعّل: ' + (out.error || '').slice(0, 160));
      return '';
    }
    warnOnce('other', 'Gemini رجّع خطأ ' + out.status + ': ' + String(out.error || '').slice(0, 160));
    return '';
  }
  // كل الأسماء المحفوظة فشلت → نسأل Google عن المتاح فعلاً ونجرّب تاني مرة
  if (round === 0) {
    const found = await discoverGeminiModels(key);
    const fresh = found.filter(m => !candidates.includes(m));
    if (!fresh.length) break;
    candidates = fresh;
    continue;
  }
  break;
  }
  // وصلنا هنا يعني كل الموديلات رجّعت 404 أو 503 — غالبًا زحمة مؤقتة على
  // النسخة المجانية (بتعدي لوحدها)، أو أسماء الموديلات اتغيرت.
  console.warn('[chatbot-llm] كل موديلات Gemini مشغولة أو مش متاحة دلوقتي — الشات بوت كمّل بالردود المحلية. (لو تكرر كتير حدّد موديل في CHATBOT_LLM_MODEL)');
  return '';
}

/**
 * answer({ question, user, snippets }) → { reply, source } | null
 * بترجّع null لو الطبقة مش مفعّلة أو حصل أي خطأ — والشات بوت ساعتها
 * بيكمّل برد "مش لاقي" المحلي المعتاد، فالمستخدم عمره ما يشوف عطل.
 */
async function answer({ question, user, snippets }) {
  const prov = provider();
  if (!prov) return null;
  const q = String(question || '').trim();
  if (!q) return null;

  const userBlock = buildUserBlock({ question: q, user, snippets });
  const key = cacheKey('ans', q, (snippets || []).map(x => x.title).join(','));
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const hasSources = Array.isArray(snippets) && snippets.length > 0;
    const systemPrompt = buildSystemPrompt(hasSources);
    const text = prov === 'gemini' ? await askGemini(userBlock, systemPrompt) : await askAnthropic(userBlock, systemPrompt);
    if (!text) return null;
    const built = {
      reply: text,
      source: hasSources
        ? `${snippets[0].source} (صياغة بمساعدة الذكاء الاصطناعي)`
        : 'قواعد السلامة المهنية العامة — مش من مستندات المصنع',
      suggestions: [],
    };
    cacheSet(key, built);
    return built;
  } catch (err) {
    warnOnce('exc', `طبقة ${prov} فشلت، الشات بوت بيكمّل محليًا: ` + (err && err.message));
    return null;
  }
}

// ── إعادة صياغة الردود الخام ──────────────────────────────────────────
// الطبقات المحلية بترجّع إجابات صحيحة بس شكلها "تفريغ قاعدة بيانات":
// قوايم طويلة، وبنود من أماكن مختلفة مخلوطة، و٣٧ اسم برقم تليفون لكل واحد.
// الدالة دي بتاخد الإجابة الخام وتخلي النموذج يعيد صياغتها بالعامية —
// **من غير ما يضيف أي معلومة من عنده** لأن المصدر قدامه حرفيًا.
// بتترجّع null لو فشلت أو مش مفعّلة → الإجابة الخام بتتعرض زي ما هي.
const POLISH_SYSTEM = [
  'انت "مساعد السلامة" في مصنع السويدي بوليمرز، وبتتكلم عامية مصرية بسيطة مع عمال ومهندسين.',
  'جايلك سؤال مستخدم + "إجابة خام" مستخرجة من مستندات المصنع الرسمية.',
  'شغلتك: تعيد صياغة الإجابة الخام بس. ممنوع منعًا باتًا تضيف أي معلومة مش موجودة فيها.',
  '',
  'قواعد:',
  '• خد من الإجابة الخام اللي يخص سؤال المستخدم بس، واشطب أي بند مالوش علاقة بسؤاله.',
  '• لو الإجابة خطوات إجراء سلامة (زي اللوتو أو تصريح عمل) — سيب كل الخطوات بترتيبها، بسّط صياغتها بس، وما تشيلش ولا خطوة.',
  '• **ممنوع** تختصر التفاصيل اللي جوه الخطوة: أسماء مهمات الوقاية (جوانتي/نظارة/كمامة...)، الأرقام، المسافات، المدد الزمنية، أسماء المعدات — دي تفاصيل سلامة حرجة تتكتب زي ما هي. يعني "التزم بمهمات الوقاية المناسبة" رد ناقص وغلط لو الأصل كان مكتوب فيه أسماء المهمات.',
  '• لو فيها قايمة أسماء أشخاص أطول من ٦ — اذكر العدد الإجمالي وأول ٣ بس، وقول إنه يقدر يسأل عن أي حد بالاسم. وما تكتبش أرقام تليفونات إلا لو سأل عليها صراحة.',
  '• ابدأ بالإجابة على طول — من غير "طبعًا" ولا "حاضر" ولا تكرار السؤال.',
  '• ٧ سطور كحد أقصى.',
].join('\n');

async function polish({ question, answer: rawAnswer, user }) {
  const prov = provider();
  if (!prov) return null;
  if (String(process.env.CHATBOT_LLM_POLISH || '').toLowerCase() === 'off') return null;
  const q = String(question || '').trim();
  const raw = String(rawAnswer || '').trim();
  if (!q || raw.length < 40) return null;

  const pKey = cacheKey('pol', q, raw);
  const pHit = cacheGet(pKey);
  if (pHit) return pHit;

  const block = [
    `سؤال المستخدم: ${q}`,
    (user && user.department) ? `قسمه: ${user.department}` : '',
    '',
    '<الإجابة الخام من مستندات المصنع>',
    raw.slice(0, 4000),
    '</الإجابة الخام>',
  ].filter(Boolean).join('\n');

  try {
    const text = prov === 'gemini'
      ? await askGemini(block, POLISH_SYSTEM)
      : await askAnthropic(block, POLISH_SYSTEM);
    const out = String(text || '').trim();
    // حماية: لو الرد طلع فاضي أو قصير جدًا مقارنة بالأصل، سيب الأصل
    if (!out || out.length < 25) return null;
    cacheSet(pKey, out);
    return out;
  } catch (err) {
    warnOnce('polish', 'إعادة الصياغة فشلت — بنعرض الإجابة الخام: ' + (err && err.message));
    return null;
  }
}

module.exports = { isConfigured, answer, polish, provider };
