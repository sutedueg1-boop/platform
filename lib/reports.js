// ============================================================
// lib/reports.js — تقرير السلامة الشامل (تابة "التقارير")
// ============================================================
// تقرير نصي كامل (من غير رسومات) عن كل حاجة في المنصة، لنطاق واحد من:
//   • المصنع كله   • قسم معيّن   • موظف معيّن (بالكود)
// ولفترة زمنية (من أول السنة افتراضيًا). بيتطبع بقالب الطباعة الموحّد
// (شعار السويدي بوليمرز) وبيتبعت بالإيميل بنفس الشكل.
//
// الأهداف (التارجت) بتتحسب بنفس دالة لوحة التحكم والشات بوت بالظبط
// (complianceData) — عشان رقم الالتزام في التقرير يطابق الداشبورد.
// إضافة 22 سبتمبر 2026.
'use strict';

const { complianceData, helpers: H } = require('./chatbot-analytics');

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const r1 = v => Math.round((Number(v) || 0) * 10) / 10;
const fmt = v => Number(v || 0).toLocaleString('en-US');
// العدد مع المعدود بصياغة سليمة: ساعة واحدة / ساعتين / 3-10 ساعات / 11+ ساعة
const countAr = (n, one, two, few, many) => {
  const v = Number(n) || 0;
  if (v === 1) return one;
  if (v === 2) return two;
  if (Number.isInteger(v) && v >= 3 && v <= 10) return `${v} ${few}`;
  return `${fmt(v)} ${many}`;
};
const hoursAr = n => countAr(n, 'ساعة واحدة', 'ساعتين', 'ساعات', 'ساعة');
const hazardsAr = n => countAr(n, 'بلاغ واحد', 'بلاغين', 'بلاغات', 'بلاغ');
// مدة الإغلاق: أقل من يوم بتتكتب بالساعات (بدل "0 يوم")
const durationAr = days => {
  if (days === null || days === undefined || !isFinite(days)) return '';
  if (days < 1 / 24) return 'أقل من ساعة';
  if (days < 1) return hoursAr(Math.max(1, Math.round(days * 24)));
  return countAr(r1(days), 'يوم واحد', 'يومين', 'أيام', 'يوم');
};
const ymd = d => {
  const x = new Date(d);
  if (isNaN(x)) return '';
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const deptEq = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** الفترة من الطلب: preset (ytd/month/last_month/quarter/year/last_year) أو from/to */
function parsePeriod(q, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const endOfToday = new Date(y, m, now.getDate(), 23, 59, 59, 999);
  const parseDay = s => {
    const mm = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return mm ? new Date(+mm[1], +mm[2] - 1, +mm[3]) : null;
  };
  const preset = String(q.period || '').trim();
  if (preset === 'custom' || (q.from && q.to && !preset)) {
    const from = parseDay(q.from);
    const toD = parseDay(q.to);
    if (from && toD && from <= toD) {
      const to = new Date(toD.getFullYear(), toD.getMonth(), toD.getDate(), 23, 59, 59, 999);
      return { from, to, key: 'custom', label: `من ${ymd(from)} إلى ${ymd(to)}` };
    }
  }
  if (preset === 'month') return { from: new Date(y, m, 1), to: endOfToday, key: preset, label: `شهر ${MONTHS_AR[m]} ${y}` };
  if (preset === 'last_month') {
    const from = new Date(y, m - 1, 1);
    const to = new Date(y, m, 0, 23, 59, 59, 999);
    return { from, to, key: preset, label: `شهر ${MONTHS_AR[from.getMonth()]} ${from.getFullYear()}` };
  }
  if (preset === 'quarter') {
    const qs = Math.floor(m / 3) * 3;
    return { from: new Date(y, qs, 1), to: endOfToday, key: preset, label: `الربع ${['الأول', 'الثاني', 'الثالث', 'الرابع'][qs / 3]} ${y}` };
  }
  if (preset === 'last_year') return { from: new Date(y - 1, 0, 1), to: new Date(y - 1, 11, 31, 23, 59, 59, 999), key: preset, label: `سنة ${y - 1} كاملة` };
  return { from: new Date(y, 0, 1), to: endOfToday, key: 'ytd', label: `من أول ${y} لحد النهارده` };
}

function inPeriod(rec, period) {
  const d = H.dateOf(rec);
  return !isNaN(d) && d >= period.from && d <= period.to;
}

function readPermits(data) {
  try {
    const v = typeof data.permits === 'function' ? data.permits() : data.permits;
    return Array.isArray(v) ? v : [];
  } catch (e) { return []; }
}

/** بيحدد نطاق التقرير ويتأكد إن القسم/الموظف موجودين فعلاً */
function resolveScope(q, employees) {
  const code = H.normCode(q.emp || q.empCode || '');
  if (code) {
    const emp = employees.find(e => H.normCode(e.empCode || e.code) === code);
    if (!emp) return { error: `الكود الوظيفي ${q.emp || q.empCode} مش موجود في بيانات الموظفين.` };
    return { type: 'employee', code, emp, dept: emp.department || '', label: `الموظف: ${emp.name} (${emp.empCode || code})` };
  }
  const dept = String(q.dept || '').trim();
  if (dept) {
    const real = employees.map(e => String(e.department || '').trim()).find(d => deptEq(d, dept));
    if (!real) return { error: `القسم "${dept}" مش موجود في بيانات الموظفين.` };
    return { type: 'dept', dept: real, label: `قسم: ${real}` };
  }
  return { type: 'factory', dept: '', label: 'المصنع كله' };
}

/** قايمة الأقسام (لفلتر الواجهة) مرتبة بعدد الموظفين */
function listDepartments(data) {
  const m = new Map();
  H.arr(data.employees).forEach(e => {
    const d = String(e.department || '').trim();
    if (d) m.set(d, (m.get(d) || 0) + 1);
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

/**
 * buildSafetyReport({ data, query, generatedBy }) → { error } | report
 * report: { scope, period, generatedBy, generatedAt, kpis, sections-data... }
 */
function buildSafetyReport({ data, query, generatedBy }) {
  const employees = H.arr(data.employees);
  const scope = resolveScope(query || {}, employees);
  if (scope.error) return { error: scope.error };
  const period = parsePeriod(query || {});

  const inDept = rec => scope.type === 'factory' || deptEq(rec.department, scope.dept);
  const isMine = (rec, codeKeys) => codeKeys.some(k => H.normCode(rec[k]) === scope.code);

  // ── الأهداف (نفس حساب الداشبورد) ──
  const comp = complianceData({ data }, { depts: scope.type === 'factory' ? [] : [scope.dept] });
  let compRows = comp.rows;
  if (scope.type === 'employee') compRows = compRows.filter(r => H.normCode(r.emp.empCode || r.emp.code) === scope.code);
  const avgScore = compRows.length ? Math.round(compRows.reduce((s, r) => s + r.score, 0) / compRows.length) : 0;
  const trainOk = compRows.filter(r => r.trainOk).length;
  const hazOk = compRows.filter(r => r.hazOk).length;

  // ترتيب الأقسام (للمصنع كله بس)
  let deptRanking = [];
  if (scope.type === 'factory') {
    const m = new Map();
    comp.rows.forEach(r => {
      const d = String(r.emp.department || 'غير محدد').trim();
      if (!m.has(d)) m.set(d, { name: d, n: 0, score: 0, trainOk: 0, hazOk: 0, pen: 0 });
      const x = m.get(d);
      x.n++; x.score += r.score; x.pen += r.penalties;
      if (r.trainOk) x.trainOk++;
      if (r.hazOk) x.hazOk++;
    });
    deptRanking = [...m.values()]
      .map(x => ({ ...x, avg: Math.round(x.score / x.n) }))
      .sort((a, b) => b.avg - a.avg || b.n - a.n);
  }

  // ── بلاغات الخطورة ──
  const allHaz = H.arr(data.hazards).filter(h => !H.isDeletedRec(h));
  const hazards = allHaz.filter(h => inPeriod(h, period) && (scope.type === 'employee'
    ? (isMine(h, ['empCode']) || (scope.emp && String(h.reporterName || '').trim() === String(scope.emp.name || '').trim()))
    : inDept(h)));
  const hzOpen = hazards.filter(H.HAZ_OPEN);
  const hzDone = hazards.filter(H.HAZ_DONE);
  const hzRejected = hazards.filter(H.HAZ_REJECTED);
  const nowMs = Date.now();
  const hzOverdue = hzOpen.filter(h => nowMs - H.dateOf(h).getTime() > H.HOURS_48)
    .sort((a, b) => H.dateOf(a) - H.dateOf(b));
  const byRisk = { H: 0, M: 0, L: 0, other: 0 };
  hazards.forEach(h => { const r = H.riskOf(h); if (byRisk[r] !== undefined) byRisk[r]++; else byRisk.other++; });
  const hzOpenHigh = hzOpen.filter(h => H.riskOf(h) === 'H');
  const hazByDept = countBy(hazards, h => String(h.department || 'غير محدد').trim());
  // متوسط زمن الإغلاق — من وقت التسجيل الفعلي لوقت الإغلاق الفعلي بس.
  // البلاغات القديمة المستوردة من الإكسيل وقت تسجيلها وإغلاقها نفس اللحظة
  // بالظبط (منتصف ليل يوم البلاغ) فمالهاش زمن إغلاق حقيقي وبتتشال من الحساب.
  const closeDurations = hzDone
    .filter(h => h.resolvedAt && h.submittedAt && h.resolvedAt !== h.submittedAt)
    .map(h => (new Date(h.resolvedAt) - new Date(h.submittedAt)) / 86400000)
    .filter(v => isFinite(v) && v > 0);
  const avgCloseDays = closeDurations.length ? closeDurations.reduce((s, v) => s + v, 0) / closeDurations.length : null;

  // ── تصاريح العمل ──
  const permitsInPeriod = readPermits(data).filter(p => !H.isDeletedRec(p) && !isExcelHeaderRow(p) && inPeriod(p, period));
  const permits = permitsInPeriod.filter(p => (scope.type === 'employee'
    ? isMine(p, ['employeeId', 'empCode'])
    : inDept(p)));
  // التصاريح القديمة المستوردة من الإكسيل متسجلة بالمنطقة (M.B / PVC / MV...)
  // مش بقسم الموظف ومن غير كود — فمش بتدخل في تقرير قسم أو موظف. بنعدّها
  // عشان التقرير يوضّح ده بدل ما القارئ يفتكر إن القسم مالوش تصاريح.
  const inScopeSet = new Set(permits);
  const legacyNotInScope = scope.type === 'factory' ? 0
    : permitsInPeriod.filter(p => p.isImportedLegacy && !inScopeSet.has(p)).length;
  const permitByArea = scope.type === 'factory' ? countBy(permits, p => String(p.department || '').trim() || 'غير محدد') : [];
  const permitByStatus = countBy(permits, p => {
    const s = String(p.status || '');
    if (/^closed/.test(s)) return 'مغلق';
    return H.PERMIT_STATUS_LABEL[s] || (s ? s : 'غير محدد');
  });
  const permitByType = countBy(permits, p => p.typeFullLabel || p.typeLabel || H.PERMIT_TYPE_LABEL[p.typeKey] || 'غير محدد');

  // ── التدريب والتوعية ──
  const trainingsAll = H.arr(data.trainings).filter(t => !H.isDeletedRec(t) && inPeriod(t, period));
  let sessions = 0, hours = 0, attendance = 0;
  const topicCount = new Map();
  const myTrainings = [];
  trainingsAll.forEach(t => {
    const att = (t.attendees || []).filter(a => a && a.verified !== false);
    const relevant = scope.type === 'factory' ? att
      : scope.type === 'dept' ? att.filter(a => deptEq(a.department || deptOfCode(employees, H.attCode(a)), scope.dept))
        : att.filter(a => H.attCode(a) === scope.code);
    if (!relevant.length && scope.type !== 'factory') return;
    sessions++;
    const h = H.trainingHours(t);
    attendance += relevant.length;
    hours += h * relevant.length;
    const topic = String(t.topic || t.title || 'غير محدد').trim();
    topicCount.set(topic, (topicCount.get(topic) || 0) + relevant.length);
    if (scope.type === 'employee') myTrainings.push({ date: t.date, title: t.title || t.topic, trainer: t.trainer, hours: h });
  });
  const topTopics = [...topicCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const belowTraining = compRows.filter(r => !r.trainOk).sort((a, b) => a.hours - b.hours);

  // ── تجارب الطوارئ ──
  const drills = H.arr(data.drills).filter(d => !H.isDeletedRec(d) && inPeriod(d, period));
  const drillRows = drills.map(d => {
    const att = (d.attendees || []).filter(a => a && a.verified !== false);
    const rel = scope.type === 'factory' ? att
      : scope.type === 'dept' ? att.filter(a => deptEq(a.department || deptOfCode(employees, H.attCode(a)), scope.dept))
        : att.filter(a => H.attCode(a) === scope.code);
    return { d, attendees: rel.length, total: att.length };
  }).filter(x => scope.type === 'factory' || x.attendees > 0);

  // ── الجزاءات ──
  const penalties = H.arr(data.penalties).filter(p => p.status !== 'deleted' && p.status !== 'cancelled' && !H.isDeletedRec(p)
    && inPeriod(p, period) && (scope.type === 'employee' ? isMine(p, ['empCode']) : inDept(p)));
  const penByReason = countBy(penalties, p => String(p.reason || 'غير محدد').trim());
  const penByDept = countBy(penalties, p => String(p.department || 'غير محدد').trim());

  // ── الفحص الشهري (للمصنع/القسم) ──
  let inspection = null;
  if (scope.type !== 'employee') {
    const items = H.arr(data.inspectionItems);
    const itemById = new Map(items.map(i => [i.id, i]));
    const sections = new Map(H.arr(data.inspectionSections).map(s => [s.id, s]));
    const recs = H.arr(data.inspectionRecords).filter(r => {
      const d = r.inspectionDate ? new Date(r.inspectionDate) : new Date(r.year, (r.month || 1) - 1, 15);
      if (isNaN(d) || d < period.from || d > period.to) return false;
      if (scope.type === 'dept') {
        const it = itemById.get(r.itemId);
        return it && deptEq(it.department, scope.dept);
      }
      return true;
    });
    const nonConf = recs.filter(r => /غير مطابق|not/i.test(String(r.status || '')));
    const bySection = countBy(nonConf, r => (sections.get(r.sectionId) || {}).name || 'غير محدد');
    inspection = { total: recs.length, ok: recs.length - nonConf.length, nonConf: nonConf.length, bySection, nonConfList: nonConf.slice(0, 25).map(r => ({ r, item: itemById.get(r.itemId), section: sections.get(r.sectionId) })) };
  }

  const report = {
    scope, period,
    generatedBy: generatedBy || '',
    generatedAt: new Date(),
    compliance: { label: comp.label, targetHours: comp.targetHours, targetHazards: comp.targetHazards, employees: compRows.length, avgScore, trainOk, hazOk, rows: compRows, penaltyDeduction: comp.penaltyDeduction },
    deptRanking,
    hazards: { total: hazards.length, open: hzOpen.length, done: hzDone.length, rejected: hzRejected.length, overdue: hzOverdue, openHigh: hzOpenHigh, byRisk, byDept: hazByDept, avgCloseDays, list: hazards },
    permits: { total: permits.length, byStatus: permitByStatus, byType: permitByType, byArea: permitByArea, legacyNotInScope, list: permits },
    trainings: { sessions, hours: r1(hours), attendance, topTopics, below: belowTraining, mine: myTrainings.sort((a, b) => String(b.date).localeCompare(String(a.date))) },
    drills: drillRows,
    penalties: { total: penalties.length, byReason: penByReason, byDept: penByDept, list: penalties },
    inspection,
  };
  report.findings = buildFindings(report);
  return report;
}

function deptOfCode(employees, code) {
  if (!code) return '';
  const e = employees.find(x => H.normCode(x.empCode || x.code) === code);
  return e ? e.department : '';
}

/** صف عناوين الإكسيل اللي دخل بالغلط وقت استيراد التصاريح القديمة ("Department" / "Location") */
function isExcelHeaderRow(p) {
  return Boolean(p && p.isImportedLegacy)
    && /^(department|القسم)$/i.test(String(p.department || '').trim())
    && /^(location|المكان)$/i.test(String(p.location || '').trim());
}

function countBy(list, keyFn) {
  const m = new Map();
  list.forEach(x => { const k = keyFn(x); m.set(k, (m.get(k) || 0) + 1); });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** الملاحظات والتوصيات — نص بيتولد من الأرقام نفسها (مش كلام عام) */
function buildFindings(rep) {
  const out = [];
  const c = rep.compliance;
  const isEmp = rep.scope.type === 'employee';

  if (isEmp) {
    const row = c.rows[0];
    if (row) {
      if (row.trainOk) out.push({ tone: 'good', text: `حقق تارجت التدريب للفترة الحالية (${r1(row.hours)} من ${hoursAr(c.targetHours)}).` });
      else out.push({ tone: 'bad', text: `ناقصه ${r1(Math.max(0, c.targetHours - row.hours))} ساعة تدريب عشان يحقق تارجت ${c.label} (${r1(row.hours)} من ${c.targetHours}).` });
      if (row.hazOk) out.push({ tone: 'good', text: `حقق تارجت بلاغات الخطورة (${row.hazards} من ${c.targetHazards}).` });
      else out.push({ tone: 'warn', text: `ناقصه ${Math.max(0, c.targetHazards - row.hazards)} بلاغ خطورة عشان يحقق التارجت — يُشجَّع على الإبلاغ عن أي مخاطر يلاحظها.` });
      if (row.penalties) out.push({ tone: 'bad', text: `عليه ${row.penalties} جزاء في السنة الحالية — كل جزاء بيخصم ${c.penaltyDeduction} نقطة من درجة الالتزام.` });
      out.push({ tone: row.score >= 80 ? 'good' : row.score >= 50 ? 'warn' : 'bad', text: `درجة الالتزام الإجمالية: ${row.score}%.` });
    }
    return out;
  }

  if (c.employees) {
    const tone = c.avgScore >= 80 ? 'good' : c.avgScore >= 50 ? 'warn' : 'bad';
    out.push({ tone, text: `متوسط درجة الالتزام بالأهداف ${c.avgScore}% — ${fmt(c.trainOk)} موظف من ${fmt(c.employees)} حققوا تارجت التدريب (${pct(c.trainOk, c.employees)}%) و${fmt(c.hazOk)} حققوا تارجت البلاغات (${pct(c.hazOk, c.employees)}%).` });
  }
  if (rep.deptRanking.length >= 3) {
    const low = rep.deptRanking.filter(d => d.n >= 3).slice(-3).reverse();
    if (low.length && low[0].avg < 50) {
      out.push({ tone: 'bad', text: `أقل الأقسام التزامًا: ${low.map(d => `${d.name} (${d.avg}%)`).join('، ')} — يُقترح جدولة محاضرات توعية مخصّصة لهم ومتابعة شهرية.` });
    }
    const top = rep.deptRanking.filter(d => d.n >= 3).slice(0, 3);
    if (top.length) out.push({ tone: 'good', text: `أعلى الأقسام التزامًا: ${top.map(d => `${d.name} (${d.avg}%)`).join('، ')}.` });
  }
  const hz = rep.hazards;
  if (hz.overdue.length) out.push({ tone: 'bad', text: `في ${fmt(hz.overdue.length)} بلاغ خطورة مفتوح من أكتر من 48 ساعة من غير إغلاق — يُقترح تصعيدها للصيانة ومتابعة أقدمها فورًا.` });
  if (hz.openHigh.length) out.push({ tone: 'bad', text: `${fmt(hz.openHigh.length)} بلاغ عالي الخطورة لسه مفتوح — أولوية قصوى للمعالجة.` });
  if (hz.total && !hz.open) out.push({ tone: 'good', text: `كل بلاغات الخطورة في الفترة دي (${fmt(hz.total)}) اتقفلت.` });
  if (hz.avgCloseDays !== null) out.push({ tone: hz.avgCloseDays <= 3 ? 'good' : 'warn', text: `متوسط زمن إغلاق البلاغ: ${durationAr(hz.avgCloseDays)}.` });
  if (rep.inspection && rep.inspection.nonConf) {
    const topSec = rep.inspection.bySection[0];
    out.push({ tone: 'warn', text: `الفحص الشهري: ${fmt(rep.inspection.nonConf)} بند غير مطابق من ${fmt(rep.inspection.total)}${topSec ? ` — أكترهم في "${topSec[0]}" (${topSec[1]})` : ''}.` });
  }
  const pen = rep.penalties;
  if (pen.total && pen.byReason.length) out.push({ tone: 'warn', text: `أكتر سبب للجزاءات: "${pen.byReason[0][0]}" (${pen.byReason[0][1]} من ${pen.total}) — يُقترح حملة توعية مركّزة على السبب ده.` });
  if (rep.trainings.below.length) out.push({ tone: 'warn', text: `${fmt(rep.trainings.below.length)} موظف لسه تحت تارجت التدريب (${hoursAr(c.targetHours)} لحد ${c.label}).` });
  if (!out.length) out.push({ tone: 'good', text: 'مفيش ملاحظات سلبية في الفترة دي.' });
  return out;
}

// ============================================================
// التحويل لمستند طباعة (قالب lib/print-template.js)
// ============================================================
const toneClass = t => (t === 'good' ? 'good' : t === 'bad' ? 'bad' : 'warn');

/**
 * أهم n ملاحظات: السطر الأول (ملخص الالتزام) بيفضل أول واحد، والباقي
 * بالأهمية — الخطر الأول، بعده التنبيه، وآخرهم الكويس.
 */
function topFindings(findings, n) {
  const list = findings || [];
  if (list.length <= n) return list;
  const rank = { bad: 0, warn: 1, good: 2 };
  const [head, ...rest] = list;
  const sorted = rest
    .map((f, i) => ({ f, i }))
    .sort((a, b) => ((rank[a.f.tone] ?? 1) - (rank[b.f.tone] ?? 1)) || (a.i - b.i))
    .map(x => x.f);
  return [head, ...sorted].slice(0, n);
}
// نص الملاحظات فيه أسماء أقسام إنجليزي وأرقام جوه جمل عربي → bidi بيعزلهم
const { bidi: bidiHtml } = require('./print-template');

/**
 * التقرير المطبوع — مختصر (22 سبتمبر 2026، بطلب صاحب المنصة: "قلل التفاصيل
 * على الآخر وحط الجزاءات ومين خدها"). صفحة أو صفحتين بس: المؤشرات،
 * الالتزام بالأهداف، جدول الجزاءات بالأسماء، أهم الملاحظات، والتوقيعات.
 * البيانات التفصيلية لسه بتتحسب في buildSafetyReport (للملاحظات والإيميل).
 */
function buildReportPrint(rep, extra = {}) {
  const c = rep.compliance;
  const hz = rep.hazards;
  const sections = [];
  const isEmp = rep.scope.type === 'employee';
  const row = isEmp ? c.rows[0] : null;

  // 1) الموظف (لو التقرير لموظف)
  if (isEmp) {
    const e = rep.scope.emp;
    sections.push({
      title: 'بيانات الموظف',
      kind: 'grid',
      rows: [
        ['الاسم', e.name], ['الكود الوظيفي', e.empCode],
        ['القسم', e.department], ['المسمى الوظيفي', e.jobTitle],
      ],
    });
  }

  // 2) المؤشرات الرئيسية — أرقام بس
  sections.push({
    title: 'المؤشرات الرئيسية',
    kind: 'kpis',
    // تقرير القسم: من غير الملحوظة دي "تصاريح العمل = 0" ممكن تتفهم غلط
    note: rep.scope.type === 'dept' && rep.permits.legacyNotInScope ? 'التصاريح القديمة المستوردة من الإكسيل مش داخلة في تقرير القسم.' : '',
    items: [
      { label: isEmp ? 'درجة الالتزام' : 'متوسط الالتزام', value: `${c.avgScore}%` },
      { label: 'بلاغات الخطورة', value: fmt(hz.total) },
      { label: 'بلاغات مفتوحة', value: fmt(hz.open) },
      { label: 'تصاريح العمل', value: fmt(rep.permits.total) },
      { label: isEmp ? 'محاضرات حضرها' : 'المحاضرات', value: fmt(rep.trainings.sessions) },
      { label: 'ساعات التدريب', value: fmt(rep.trainings.hours) },
      { label: 'تجارب الطوارئ', value: fmt(rep.drills.length) },
      { label: 'الجزاءات', value: fmt(rep.penalties.total) },
    ],
  });

  // 3) الالتزام بالأهداف — سطرين
  sections.push({
    title: `الالتزام بالأهداف — ${c.label}`,
    note: `التارجت لحد ${c.label}: ${hoursAr(c.targetHours)} تدريب و${hazardsAr(c.targetHazards)} خطورة لكل موظف — وكل جزاء بيخصم ${c.penaltyDeduction} نقطة.`,
    kind: 'grid',
    rows: isEmp && row ? [
      ['ساعات التدريب', `${r1(row.hours)} من ${c.targetHours}`],
      ['بلاغات الخطورة', `${row.hazards} من ${c.targetHazards}`],
    ] : [
      ['حققوا تارجت التدريب', `${fmt(c.trainOk)} من ${fmt(c.employees)} (${pct(c.trainOk, c.employees)}%)`],
      ['حققوا تارجت البلاغات', `${fmt(c.hazOk)} من ${fmt(c.employees)} (${pct(c.hazOk, c.employees)}%)`],
    ],
  });

  // 4) الجزاءات ومين خدها — الأحدث الأول
  const penList = [...rep.penalties.list].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const PEN_MAX = 60;
  sections.push(penList.length ? {
    title: `الجزاءات (${fmt(penList.length)})${penList.length > PEN_MAX ? ` — آخر ${PEN_MAX}` : ''}`,
    kind: 'table',
    columns: isEmp ? ['#', 'التاريخ', 'السبب'] : ['#', 'الاسم', 'الكود', 'القسم', 'السبب', 'التاريخ'],
    numeric: isEmp ? [0, 1] : [0, 2, 5],
    rows: penList.slice(0, PEN_MAX).map((p, i) => (isEmp
      ? [i + 1, p.date, p.reason]
      : [i + 1, p.empName, p.empCode, p.department, p.reason, p.date])),
  } : { title: 'الجزاءات', kind: 'text', text: 'مفيش جزاءات في الفترة دي.' });

  // 5) أهم الملاحظات — 4 بالكتير
  sections.push({
    title: 'أهم الملاحظات',
    kind: 'bullets',
    items: topFindings(rep.findings, 4).map(f => ({ html: `<span class="dot ${toneClass(f.tone)}">●</span>${bidiHtml(f.text)}` })),
  });

  // 6) التوقيعات
  sections.push({
    title: 'الاعتماد',
    kind: 'signatures',
    slots: isEmp
      ? [{ role: 'الموظف', name: rep.scope.emp.name }, { role: 'مدير القسم', name: '' }, { role: 'مسئول السلامة والصحة المهنية', name: rep.generatedBy }]
      : [{ role: 'أعدّه', name: rep.generatedBy }, { role: 'مدير السلامة والصحة المهنية', name: '' }, { role: 'المدير العام', name: '' }],
  });

  const tone = c.avgScore >= 80 ? 'success' : c.avgScore >= 50 ? 'warning' : 'danger';
  const stamp = new Date(rep.generatedAt);
  return {
    docTitle: 'تقرير السلامة والصحة المهنية',
    pdfNameExtra: `${rep.scope.label} - ${rep.period.label}`,
    title: 'تقرير السلامة والصحة المهنية',
    subtitle: rep.scope.label,
    docNumber: `RPT-${ymd(stamp).replace(/-/g, '')}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}`,
    status: c.employees ? { label: `الالتزام ${c.avgScore}%`, tone } : null,
    meta: [
      ['الفترة', rep.period.label],
      ['النطاق', rep.scope.label],
      ['أعدّه', rep.generatedBy],
    ],
    sections,
    generatedAt: stamp,
    footerNote: 'تقرير صادر من بيانات المنصة الحية وقت الإصدار.',
    autoPrint: extra.autoPrint,
    forEmail: extra.forEmail,
    logoSrc: extra.logoSrc,
  };
}

/** نسخة نصية قصيرة (لجسم الإيميل النصي لبرامج الإيميل اللي مش بتعرض HTML) */
function reportPlainText(rep) {
  const c = rep.compliance;
  const hz = rep.hazards;
  return [
    'تقرير السلامة والصحة المهنية — السويدي للبوليمرات',
    `النطاق: ${rep.scope.label}`,
    `الفترة: ${rep.period.label}`,
    '',
    `الالتزام بالأهداف: ${c.avgScore}%`,
    `بلاغات الخطورة: ${hz.total} (مفتوح ${hz.open} · متأخر ${hz.overdue.length})`,
    `تصاريح العمل: ${rep.permits.total}`,
    `ساعات التدريب: ${rep.trainings.hours}`,
    `الجزاءات: ${rep.penalties.total}`,
    '',
    'الملاحظات:',
    ...rep.findings.map(f => `• ${f.text}`),
  ].join('\n');
}

module.exports = { buildSafetyReport, buildReportPrint, reportPlainText, listDepartments, parsePeriod };
