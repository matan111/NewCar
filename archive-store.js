'use strict';
const crypto = require('crypto');

class ArchiveError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
function plateNumber(value) {
  const plate = String(value || '').replace(/[\s-]/g, '');
  if (!/^\d{7,8}$/.test(plate)) throw new ArchiveError('מספר רכב צריך להכיל 7 או 8 ספרות');
  return plate;
}
function text(value, limit = 200) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value))
    throw new ArchiveError('טקסט ארוך מדי או לא תקין');
  return value.trim();
}
function number(value, max, name) {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean' || !/^\d+$/.test(String(value))) throw new ArchiveError(name + ' אינו תקין');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) throw new ArchiveError(name + ' מחוץ לטווח');
  return n;
}
function evidenceDate(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ArchiveError('התאריך צריך להיות בפורמט שנה-חודש-יום');
  const d = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== value || value < '1900-01-01' || d.getTime() > Date.now() + 86400000)
    throw new ArchiveError('תאריך התיעוד אינו תקין');
  return value;
}
function sourceUrl(value) {
  if (!value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password || u.port || u.href.length > 2000 ||
        !u.hostname.includes('.') || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)) throw new Error();
    u.hash = '';
    if (/^(www\.)?yad2\.co\.il$/.test(u.hostname)) {
      u.hostname = 'www.yad2.co.il';
      u.pathname = u.pathname.replace(/^\/item\//, '/vehicles/item/');
      u.search = '';
    }
    return u.href;
  } catch { throw new ArchiveError('יש להזין קישור HTTPS ציבורי תקין'); }
}
function normalize(input, trusted = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ArchiveError('רשומה לא תקינה');
  const sources = trusted ? ['government', 'inventory', 'web_reviewed', 'manual_listing', 'document', 'feed'] : ['manual_listing', 'document', 'feed'];
  const source = input.source || 'manual_listing';
  if (!sources.includes(source)) throw new ArchiveError('סוג מקור לא תקין');
  const url = sourceUrl(input.sourceUrl);
  const date = evidenceDate(input.evidenceDate);
  const dateKind = date ? input.dateKind : 'unknown';
  if (!['unknown', 'published', 'updated', 'test', 'document', 'observed'].includes(dateKind) || (date && dateKind === 'unknown'))
    throw new ArchiveError('יש לציין מה משמעות תאריך התיעוד');
  const out = {
    plate: plateNumber(input.plate), source, sourceUrl: url,
    sourceId: text(url || input.sourceId || '', 2000),
    sourceLabel: text(input.sourceLabel || '', 120),
    evidenceDate: date, dateKind,
    kilometers: number(input.kilometers, 5000000, 'קילומטראז׳'),
    price: number(input.price, 100000000, 'מחיר'),
    year: number(input.year, new Date().getFullYear() + 1, 'שנת ייצור'),
    manufacturer: text(input.manufacturer), model: text(input.model), trim: text(input.trim),
    description: text(input.description, 20000),
    mileageKind: source === 'government' ? 'test' : (input.mileageKind === 'test' ? 'test' : 'declared'),
    identityMethod: text(input.identityMethod || 'user_confirmed', 80)
  };
  if (out.year != null && out.year < 1900) throw new ArchiveError('שנת ייצור לא תקינה');
  if (out.price === 0) throw new ArchiveError('מחיר צריך להיות גדול מאפס או להישאר ריק');
  if (!out.sourceId) throw new ArchiveError('יש להזין קישור למודעה או מזהה מסמך קבוע');
  if (!url && !out.sourceLabel) throw new ArchiveError('יש לציין את מקור התיעוד');
  if (out.kilometers == null && out.price == null && !out.description) throw new ArchiveError('אין ברשומה ק״מ, מחיר או תיאור');
  return out;
}
function dbRun(db, sql, params = []) { return new Promise((resolve, reject) => db.run(sql, params, function(e) { e ? reject(e) : resolve({ id: this.lastID, changes: this.changes }); })); }
function dbAll(db, sql, params = []) { return new Promise((resolve, reject) => db.all(sql, params, (e, rows) => e ? reject(e) : resolve(rows))); }

class ArchiveStore {
  constructor(db) {
    this.db = db;
    db.configure('busyTimeout', 5000);
    this.ready = this.init();
    this.queue = this.ready;
  }
  async init() {
    for (const sql of [
      'PRAGMA journal_mode=WAL',
      `CREATE TABLE IF NOT EXISTS archive_events (id INTEGER PRIMARY KEY, plate TEXT NOT NULL, listingKey TEXT NOT NULL, contentHash TEXT NOT NULL, firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL, createdBy TEXT NOT NULL, data TEXT NOT NULL)`,
      'CREATE INDEX IF NOT EXISTS archive_plate ON archive_events(plate,id)',
      'CREATE INDEX IF NOT EXISTS archive_listing ON archive_events(listingKey,id)',
      `CREATE TABLE IF NOT EXISTS archive_candidates (id INTEGER PRIMARY KEY, plate TEXT NOT NULL, sourceUrl TEXT NOT NULL, data TEXT NOT NULL, foundAt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', eventId INTEGER, UNIQUE(plate,sourceUrl,data))`,
      'CREATE INDEX IF NOT EXISTS archive_candidate_plate ON archive_candidates(plate,status)',
      `CREATE TABLE IF NOT EXISTS archive_search_runs (id INTEGER PRIMARY KEY, plate TEXT NOT NULL, startedAt TEXT NOT NULL, finishedAt TEXT, status TEXT NOT NULL, count INTEGER DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS archive_media (id INTEGER PRIMARY KEY, eventId INTEGER NOT NULL, storedName TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, addedAt TEXT NOT NULL)`
    ]) await dbRun(this.db, sql);
    // A process restart must not leave a search permanently marked as running.
    await dbRun(this.db, "UPDATE archive_search_runs SET status='interrupted', finishedAt=? WHERE status='running'", [new Date().toISOString()]);
  }
  serial(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async ingest(inputs, actor, trusted = false) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 100) throw new ArchiveError('ניתן לייבא בין רשומה אחת ל־100 רשומות בכל פעם');
    const rows = inputs.map(row => normalize(row, trusted));
    return this.serial(async () => {
      await dbRun(this.db, 'BEGIN IMMEDIATE');
      const result = [];
      try {
        for (const data of rows) {
          const key = crypto.createHash('sha256').update(data.plate + '|' + data.source + '|' + data.sourceId).digest('hex');
          const encoded = JSON.stringify(data);
          const hash = crypto.createHash('sha256').update(encoded).digest('hex');
          const [last] = await dbAll(this.db, 'SELECT id,contentHash FROM archive_events WHERE listingKey=? ORDER BY id DESC LIMIT 1', [key]);
          const now = new Date().toISOString();
          if (last && last.contentHash === hash) {
            await dbRun(this.db, 'UPDATE archive_events SET lastSeenAt=? WHERE id=?', [now, last.id]);
            result.push({ id: last.id, created: false });
          } else {
            const inserted = await dbRun(this.db, 'INSERT INTO archive_events(plate,listingKey,contentHash,firstSeenAt,lastSeenAt,createdBy,data) VALUES(?,?,?,?,?,?,?)', [data.plate,key,hash,now,now,actor,encoded]);
            result.push({ id: inserted.id, created: true });
          }
        }
        await dbRun(this.db, 'COMMIT');
        return result;
      } catch (err) { await dbRun(this.db, 'ROLLBACK'); throw err; }
    });
  }
  async history(plate) {
    await this.ready;
    const events = await dbAll(this.db, 'SELECT * FROM archive_events WHERE plate=? ORDER BY id DESC LIMIT 1000', [plate]);
    const media = await dbAll(this.db, 'SELECT m.id,m.eventId FROM archive_media m JOIN archive_events e ON e.id=m.eventId WHERE e.plate=?', [plate]);
    const records = events.map(row => ({ id: row.id, firstSeenAt: row.firstSeenAt, lastSeenAt: row.lastSeenAt, ...JSON.parse(row.data), images: media.filter(m => m.eventId === row.id).map(m => m.id) }));
    const dated = records.filter(r => r.evidenceDate && ['published','updated','test','document'].includes(r.dateKind) && r.kilometers != null).sort((a,b) => a.evidenceDate.localeCompare(b.evidenceDate));
    const warnings = [];
    let previous = null;
    for (const row of dated) {
      if (previous && row.evidenceDate > previous.evidenceDate && row.kilometers < previous.kilometers)
        warnings.push({ type: 'mileage_decrease', earlierId: previous.id, laterId: row.id, from: previous.kilometers, to: row.kilometers, message: 'נמצא ק״מ נמוך מדיווח קודם. ייתכנו טעות במודעה, החלפת לוח שעונים או שיוך שגוי — נדרשת בדיקה.' });
      if (!previous || row.kilometers > previous.kilometers) previous = row;
    }
    const candidates = await dbAll(this.db, "SELECT id,data,foundAt FROM archive_candidates WHERE plate=? AND status='pending' ORDER BY id DESC LIMIT 100", [plate]);
    const [lastSearch] = await dbAll(this.db, 'SELECT startedAt,finishedAt,status,count FROM archive_search_runs WHERE plate=? ORDER BY id DESC LIMIT 1', [plate]);
    return { plate, records, candidates: candidates.map(c => ({ id:c.id, foundAt:c.foundAt, ...JSON.parse(c.data) })), warnings, lastSearch: lastSearch || null, limited: events.length === 1000 };
  }
}
module.exports = { ArchiveStore, ArchiveError, normalize, plateNumber, sourceUrl, evidenceDate, dbRun, dbAll };
