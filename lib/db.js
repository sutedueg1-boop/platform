// ============================================================
// lib/db.js — SQLite-backed storage engine
// ============================================================
// كل بيانات التطبيق (تصاريح، بلاغات، موظفين، تدريب، جزاءات، فحص شهري...)
// كانت مخزّنة في ملفات JSON منفصلة تحت data/. هذا الملف يستبدل تلك الملفات
// بقاعدة بيانات SQLite حقيقية (ملف واحد: data/app.db) مع نفس واجهة
// read()/write() تمامًا، حتى لا يحتاج server.js لأي تغيير في منطق الأعمال —
// فقط استبدال طريقة التخزين. كل "مجموعة" (collection) تُخزَّن كصف واحد في
// جدول collections، بقيمتها الكاملة كنص JSON — تمامًا كما كانت الملفات، لكن
// الآن داخل معاملات ACID حقيقية بدل fs.writeFileSync الخام (الذي كان عرضة
// لفقد بيانات عند انقطاع الكتابة في منتصف الطريق). 11 سبتمبر 2026.
'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'app.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS collections (
    name       TEXT PRIMARY KEY,
    data       TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

const _upsertStmt = db.prepare(`
  INSERT INTO collections (name, data, updated_at) VALUES (@name, @data, @updated_at)
  ON CONFLICT(name) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
`);
const _selectStmt = db.prepare('SELECT data, updated_at FROM collections WHERE name = ?');
const _existsStmt = db.prepare('SELECT 1 FROM collections WHERE name = ?');
const _metaStmt = db.prepare('SELECT updated_at FROM collections WHERE name = ?');

// ── رقم نسخة لكل مجموعة + كاش للنص الخام (22 سبتمبر 2026) ─────────
// الشاشات المفتوحة بتسأل على التصاريح/البلاغات كل 3-5 ثواني. قبل كده كل
// سؤال كان بيقرا المجموعة كلها من SQLite (مجموعة storage لوحدها 5 ميجا =
// ~45ms قراية + ~20ms فك) حتى لو مفيش أي تغيير. دلوقتي:
//   • version(): رقم رخيص جدًا بيتغير مع أي كتابة — السيرفر بيستخدمه كـ ETag
//     ويرد 304 فورًا من غير ما يقرا البيانات أصلاً.
//   • read(): النص الخام بيتحفظ في الذاكرة مع رقم نسخته، فالقراية بتبقى
//     JSON.parse بس. كل قراية بترجع نسخة جديدة مستقلة (مفيش object مشترك
//     ممكن يتعدّل بالغلط) — نفس سلوك قبل كده بالظبط.
// الكاش بيتأكد من updated_at في كل قراية، فحتى لو حاجة كتبت في القاعدة من
// برّه الـ store (سكريبت ترحيل مثلاً) الكاش مش هيرجّع بيانات قديمة.
const BOOT_ID = Date.now().toString(36);
const _writeCounters = new Map(); // name -> عدد الكتابات من وقت تشغيل السيرفر
const _rawCache = new Map();      // name -> { updatedAt, data }
function _bump(name) { _writeCounters.set(name, (_writeCounters.get(name) || 0) + 1); }

/**
 * makeStore — يُنشئ زوج read()/write() لمجموعة بيانات واحدة، بنفس شكل
 * makeJsonListStore القديم القائم على الملفات، لكن بتخزين SQLite حقيقي.
 * @param {string} name — اسم فريد للمجموعة (مثال: 'hazards', 'employees')
 * @param {Array|Object} defaultValue — القيمة الافتراضية إذا لم توجد بعد
 */
function makeStore(name, defaultValue) {
  const defaultJson = JSON.stringify(defaultValue === undefined ? [] : defaultValue);
  return {
    read() {
      const meta = _metaStmt.get(name);
      if (!meta) { _rawCache.delete(name); return JSON.parse(defaultJson); }
      let entry = _rawCache.get(name);
      if (!entry || entry.updatedAt !== meta.updated_at) {
        const row = _selectStmt.get(name);
        if (!row) return JSON.parse(defaultJson);
        entry = { updatedAt: row.updated_at, data: row.data };
        _rawCache.set(name, entry);
      }
      try {
        return JSON.parse(entry.data);
      } catch (err) {
        console.error(`[DB] Corrupt data for collection "${name}", returning default:`, err);
        return JSON.parse(defaultJson);
      }
    },
    write(value) {
      try {
        const data = JSON.stringify(value);
        const updatedAt = new Date().toISOString();
        _upsertStmt.run({ name, data, updated_at: updatedAt });
        _rawCache.set(name, { updatedAt, data });
        _bump(name);
        return true;
      } catch (err) {
        _rawCache.delete(name);
        console.error(`[DB] Write failed for collection "${name}":`, err);
        return false;
      }
    },
    exists() {
      return !!_existsStmt.get(name);
    },
    /** رقم بيتغير مع أي تعديل في المجموعة — رخيص جدًا (من غير قراية البيانات) */
    version() {
      const meta = _metaStmt.get(name);
      return `${BOOT_ID}.${_writeCounters.get(name) || 0}.${meta ? meta.updated_at : '0'}`;
    }
  };
}

/** نسخة احتياطية كاملة: يرجع كل الجداول كـ JSON واحد قابل لإعادة الاستيراد. */
function exportAll() {
  const rows = db.prepare('SELECT name, data, updated_at FROM collections').all();
  const out = {};
  rows.forEach(r => {
    try { out[r.name] = JSON.parse(r.data); } catch (e) { out[r.name] = null; }
  });
  return { exportedAt: new Date().toISOString(), collections: out };
}

/** استرجاع نسخة احتياطية كاملة — يستبدل كل مجموعة موجودة في النسخة بمحتواها. */
function importAll(backupObj) {
  if (!backupObj || typeof backupObj !== 'object' || !backupObj.collections) {
    throw new Error('صيغة ملف النسخة الاحتياطية غير صالحة');
  }
  const names = Object.keys(backupObj.collections);
  const tx = db.transaction((entries) => {
    entries.forEach(([name, value]) => {
      _upsertStmt.run({ name, data: JSON.stringify(value), updated_at: new Date().toISOString() });
    });
  });
  tx(names.map(n => [n, backupObj.collections[n]]));
  // الاسترجاع بيغيّر كل حاجة: نفضي الكاش ونغيّر أرقام النسخ
  names.forEach(n => { _rawCache.delete(n); _bump(n); });
  return { restored: names.length, names };
}

module.exports = { db, makeStore, exportAll, importAll, DB_PATH };
