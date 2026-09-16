require('dotenv').config();
const express = require('express');
const basicAuth = require('express-basic-auth');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const os = require('os');
const crypto = require('crypto');
const multer = require('multer');
const fsp = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

function getLocalNetworkIPs() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results;
}

// הגנת סיסמה על כל האתר - מוגדרת ב-.env
// חובה להגדיר SITE_USERNAME/SITE_PASSWORD; בלעדיהם השרת לא עולה, כדי שלא ייחשף בטעות בלי הגנה
if (!process.env.SITE_USERNAME || !process.env.SITE_PASSWORD) {
  console.error('❌ חסרים SITE_USERNAME / SITE_PASSWORD (קובץ .env). לא ניתן להפעיל את השרת בלי הגנת סיסמה.');
  process.exit(1);
}

// שני סוגי משתמשים:
// admin   - הבעלים. גישה מלאה, כולל מחיקת רכבים וארכיון
// limited - עובד. רואה מלאי פעיל, בודק רכבים, מוסיף ועורך - אבל לא מוחק ולא נכנס לארכיון
const USER_ROLES = { [process.env.SITE_USERNAME]: 'admin' };
const AUTH_USERS = { [process.env.SITE_USERNAME]: process.env.SITE_PASSWORD };

if (process.env.USER2_USERNAME && process.env.USER2_PASSWORD) {
  AUTH_USERS[process.env.USER2_USERNAME] = process.env.USER2_PASSWORD;
  USER_ROLES[process.env.USER2_USERNAME] = 'limited';
}

// עובד נוסף - אותן הרשאות מוגבלות כמו USER2
if (process.env.USER4_USERNAME && process.env.USER4_PASSWORD) {
  AUTH_USERS[process.env.USER4_USERNAME] = process.env.USER4_PASSWORD;
  USER_ROLES[process.env.USER4_USERNAME] = 'limited';
}

function roleOf(req) {
  return (req.auth && USER_ROLES[req.auth.user]) || 'limited';
}

// חוסם פעולות שמורות לבעלים בלבד. חשוב: האכיפה כאן בשרת היא ההגנה האמיתית -
// הסתרת כפתורים בממשק היא נוחות בלבד וניתן לעקוף אותה
function requireAdmin(req, res, next) {
  if (roleOf(req) !== 'admin') {
    res.status(403).json({ error: 'אין לך הרשאה לבצע פעולה זו' });
    return;
  }
  next();
}

// ---------- התחברות נשמרת (session cookie) ----------
// למה זה קיים: אימות HTTP Basic לא נשמר באייפון כשפותחים את האתר מקיצור במסך הבית
// (iOS מריץ אותו בהקשר נפרד), ולכן נדרשה סיסמה בכל כניסה. עוגייה חתומה פותרת את זה -
// מתחברים פעם אחת והחיבור נשמר לשנה. אימות Basic ממשיך לעבוד במקביל (עבור API/סקריפטים).
const SESSION_DAYS = 365;
// סוד החתימה נגזר מהסיסמאות אם לא הוגדר במפורש - כך אין צורך בהגדרה נוספת,
// ושינוי סיסמה מנתק אוטומטית את כל המכשירים המחוברים (תכונה רצויה)
const SESSION_SECRET = process.env.SESSION_SECRET ||
  crypto.createHash('sha256')
    .update('newcar|' + process.env.SITE_PASSWORD + '|' + (process.env.USER2_PASSWORD || ''))
    .digest('hex');

function signSession(username, issuedAt) {
  const payload = Buffer.from(username, 'utf8').toString('base64url') + '.' + issuedAt;
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}

function verifySession(token) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [userB64, issuedAt, mac] = parts;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(userB64 + '.' + issuedAt).digest('base64url');
  // השוואה עמידה בפני מדידת זמן
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const ageMs = Date.now() - Number(issuedAt);
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > SESSION_DAYS * 86400000) return null;
  const username = Buffer.from(userB64, 'base64url').toString('utf8');
  return AUTH_USERS[username] ? username : null;
}

function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function issueSessionCookie(res, req, username) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader('Set-Cookie',
    'nc_session=' + signSession(username, Date.now()) +
    '; Path=/; Max-Age=' + (SESSION_DAYS * 86400) +
    '; HttpOnly; SameSite=Lax' + (secure ? '; Secure' : ''));
}

// בדיקת סיסמה עמידה בפני מדידת זמן
function checkPassword(username, password) {
  const expected = AUTH_USERS[username];
  if (typeof expected !== 'string' || typeof password !== 'string') return false;
  const a = Buffer.from(password), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Middleware
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: false }));

// נגישים בלי אימות: דף ההתחברות, וכן הלוגו/האייקונים/המניפסט.
// האייקונים חייבים להיות פתוחים כי iOS מושך אותם בהוספה למסך הבית, לפני שיש בכלל התחברות,
// וגם דף ההתחברות עצמו מציג את הלוגו. התיקייה מכילה נכסי מיתוג בלבד - אין בה מידע רגיש.
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.get('/manifest.json', (req, res) => res.sendFile(path.join(__dirname, 'manifest.json')));

// קוד המילוי עצמו, מוגש כקובץ JS. הבוקמרקלט רק טוען אותו,
// ולכן תיקונים נכנסים לתוקף מיד בלי התקנה מחדש.
app.get('/api/slika/fill.js', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.type('application/javascript; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  res.sendFile(path.join(__dirname, 'slika-fill.js'));
});

// נקרא מדף INFOCAR ולכן חייב להיות מחוץ לשער האימות: אין שם עוגייה של המערכת.
// ההגנה היא טוקן אישי אקראי (24 בייטים) שמזהה את המשתמש ומחזיר רק את הנתונים שלו.
app.options('/api/slika/pending', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.sendStatus(204);
});

app.get('/api/slika/pending', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  const token = String(req.query.token || '');
  if (token.length < 20) { res.status(400).json({ error: 'טוקן חסר' }); return; }
  db.get('SELECT * FROM slika_profile WHERE fillToken = ?', [token], (err, prof) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    if (!prof) { res.status(403).json({ error: 'טוקן לא מוכר' }); return; }
    db.get('SELECT * FROM slika_pending WHERE username = ?', [prof.username], (e2, pend) => {
      if (e2) { res.status(500).json({ error: e2.message }); return; }
      res.json({
        plate: pend ? pend.plate : '',
        ownerId: pend ? pend.ownerId : '',
        ownerDate: pend ? pend.ownerDate : '',
        authorized: pend && pend.authorized ? 1 : 0,
        mode: pend ? (pend.mode || 'morshe') : 'morshe',
        primeOwner: pend && pend.primeOwner === 0 ? 0 : 1,
        firstName: prof.firstName || '', lastName: prof.lastName || '',
        idNumber: prof.idNumber || '', address: prof.address || '',
        phone: prof.phone || '', email: prof.email || ''
      });
    });
  });
});

app.post('/api/login', (req, res) => {
  const username = String((req.body && req.body.username) || '').trim();
  const password = String((req.body && req.body.password) || '');
  if (!checkPassword(username, password)) {
    res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    return;
  }
  issueSessionCookie(res, req, username);
  res.json({ success: true, user: username, role: USER_ROLES[username] || 'limited' });
});

app.post('/api/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'nc_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ success: true });
});

// שער האימות: קודם עוגייה, ואם אין - נופלים חזרה ל-HTTP Basic (כדי ש-API וסקריפטים ימשיכו לעבוד)
const basicFallback = basicAuth({ users: AUTH_USERS, challenge: true, realm: 'NewCar' });

app.use((req, res, next) => {
  const cookieUser = verifySession(parseCookies(req).nc_session);
  if (cookieUser) {
    req.auth = { user: cookieUser };
    next();
    return;
  }
  // דפדפן שמבקש דף HTML מקבל הפניה לדף התחברות במקום חלונית סיסמה של הדפדפן
  const wantsHtml = (req.headers.accept || '').includes('text/html');
  if (wantsHtml && !req.headers.authorization) {
    res.redirect('/login.html');
    return;
  }
  basicFallback(req, res, next);
});
// (התמונות והמניפסט מוגשים לפני שער האימות - ראו למעלה)
app.get('/car-reception.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'car-reception.html'));
});
app.get('/', (req, res) => res.redirect('/car-reception.html'));

const PLATE_NUMBER_PATTERN = /^[0-9]{7,8}$/;
function isValidPlateNumber(value) {
  return PLATE_NUMBER_PATTERN.test(String(value || '').trim());
}

function isValidRecordId(value) {
  return /^[1-9][0-9]*$/.test(String(value || ''));
}

function containsUnsafeText(value) {
  return typeof value === 'string' && /[<>\u0000]/.test(value);
}

function validateCarPayload(payload) {
  if (!isValidPlateNumber(payload.vin)) return 'מספר רכב לא תקין';
  if (Object.values(payload).some(containsUnsafeText)) return 'הטקסט מכיל תווים שאינם מותרים';
  return null;
}

// API: מי המשתמש המחובר ומה ההרשאות שלו (הממשק מסתיר לפי זה את מה שאסור לו)
app.get('/api/me', (req, res) => {
  const role = roleOf(req);
  res.json({
    user: req.auth ? req.auth.user : '',
    role,
    canDelete: role === 'admin',
    canViewArchive: role === 'admin',
    // סיכום שווי המלאי הכולל הוא מידע עסקי של הבעלים - לא מוצג לעובד
    canViewInventoryValue: role === 'admin'
  });
});

// Database initialization
// DB_PATH מאפשר להצביע על דיסק קבוע (למשל volume בענן) בלי לשנות קוד - כברירת מחדל נשאר מקומי כמו קודם
const DB_PATH = process.env.DB_PATH || './cars.db';

// המסמכים נשמרים ליד ה-DB - כלומר על אותו דיסק קבוע בענן, כך שהם שורדים דיפלויים
const DOCS_DIR = process.env.DOCS_DIR || path.join(path.dirname(path.resolve(DB_PATH)), 'documents');
try { fsp.mkdirSync(DOCS_DIR, { recursive: true }); } catch (e) { console.error('שגיאה ביצירת תיקיית מסמכים:', e.message); }
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error(err.message);
  else console.log('✓ מחובר ל-Database');
});

// Archive transactions use a separate connection and database from inventory sync.
const vehicleArchive = require('./vehicle-archive').mountVehicleArchive(app, {
  sqlite3, dbPath: DB_PATH, inventoryDb: db, requireAdmin, multer
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS cars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vin TEXT UNIQUE,
      manufacturer TEXT,
      model TEXT,
      year INTEGER,
      color TEXT,
      kilometers INTEGER,
      engine INTEGER,
      handNumber TEXT,
      trimLevel TEXT,
      transmission TEXT,
      condition TEXT,
      price INTEGER,
      testValidUntil TEXT,
      notes TEXT,
      leviPrice INTEGER,
      leviModelCode TEXT,
      leviPriceDate TEXT,
      leviUpdatedAt TEXT,
      addedDate TEXT,
      sold INTEGER DEFAULT 0,
      soldDate TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // מיגרציה בטוחה: אם הטבלה כבר קיימת מגרסה קודמת בלי העמודות האלו, מוסיפים אותן
  // (השגיאה "duplicate column" אם העמודה כבר קיימת - תקינה, מתעלמים ממנה)
  db.run(`ALTER TABLE cars ADD COLUMN trimLevel TEXT`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) console.error('שגיאת מיגרציה (cars.trimLevel):', err.message);
  });
  db.run(`ALTER TABLE cars ADD COLUMN sold INTEGER DEFAULT 0`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) console.error('שגיאת מיגרציה (cars.sold):', err.message);
  });
  db.run(`ALTER TABLE cars ADD COLUMN soldDate TEXT`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) console.error('שגיאת מיגרציה (cars.soldDate):', err.message);
  });
  db.run(`ALTER TABLE cars ADD COLUMN leviPrice INTEGER`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) console.error('שגיאת מיגרציה (cars.leviPrice):', err.message);
  });
  db.run(`ALTER TABLE cars ADD COLUMN leviModelCode TEXT`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) console.error('שגיאת מיגרציה (cars.leviModelCode):', err.message);
  });
  db.run(`ALTER TABLE cars ADD COLUMN leviPriceDate TEXT`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) console.error('שגיאת מיגרציה (cars.leviPriceDate):', err.message);
  });
  db.run(`ALTER TABLE cars ADD COLUMN leviUpdatedAt TEXT`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) console.error('שגיאת מיגרציה (cars.leviUpdatedAt):', err.message);
  });

  // משרד התחבורה - בסיס נתונים (מפתח: מספר רכב)
  db.run(`
    CREATE TABLE IF NOT EXISTS ministry_vehicles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vin TEXT UNIQUE,
      manufacturer TEXT,
      model TEXT,
      year INTEGER,
      color TEXT,
      kilometers INTEGER,
      engine INTEGER,
      transmission TEXT,
      testValidUntil TEXT,
      handNumber TEXT,
      trimLevel TEXT
    )
  `);

  db.run(`ALTER TABLE ministry_vehicles ADD COLUMN trimLevel TEXT`, (err) => {
    if (err && !/duplicate column/i.test(err.message)) console.error('שגיאת מיגרציה (ministry_vehicles.trimLevel):', err.message);
  });

  // היסטוריית קמ שנצפתה בבדיקות שביצענו - משרד התחבורה לא חושף היסטוריית טסטים קודמים,
  // אז אנחנו בונים אותה בעצמנו: כל בדיקה מוצלחת של רכב שומרת תמונת מצב (קמ + תאריך)
  db.run(`
    CREATE TABLE IF NOT EXISTS km_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      vin TEXT,
      kilometers INTEGER,
      testValidUntil TEXT,
      lastTestDate TEXT,
      checkedAt TEXT
    )
  `);

  // מאגר קמ ארצי: סריקה יומית של כל מאגר "היסטוריית כלי רכב פרטיים" (data.gov.il, ~2.4 מיליון רכבים).
  // national_km_latest = הקמ האחרון הידוע לכל רכב (לזיהוי שינויים מהיר), national_km_history = צבירת השינויים לאורך זמן.
  // WAL משפר משמעותית ביצועי כתיבה בכמויות (הסריקה מכניסה מיליוני שורות בריצה הראשונה)
  db.run(`PRAGMA journal_mode=WAL`);
  db.run(`
    CREATE TABLE IF NOT EXISTS national_km_latest (
      mispar_rechev INTEGER PRIMARY KEY,
      kilometers INTEGER,
      updatedAt TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS national_km_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mispar_rechev INTEGER,
      kilometers INTEGER,
      seenAt TEXT
    )
  `);
  // תאריך הטסט עצמו, כפי שמשרד התחבורה מדווח. בלעדיו הצגנו את מועד הסריקה שלנו
  // כאילו הוא מועד הטסט - נתון שגוי, וגם גרם לאותו טסט להופיע כמה פעמים.
  db.run('ALTER TABLE national_km_history ADD COLUMN testDate TEXT', (err) => {
    if (err && !String(err.message).includes('duplicate column')) console.error('testDate:', err.message);
  });
  db.run('ALTER TABLE scan_page ADD COLUMN testDate TEXT', (err) => {
    if (err && !String(err.message).includes('duplicate column')) console.error('scan_page.testDate:', err.message);
  });
  db.run(`CREATE INDEX IF NOT EXISTS idx_nkh_rechev ON national_km_history(mispar_rechev)`);
  db.run(`
    CREATE TABLE IF NOT EXISTS national_sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      startedAt TEXT,
      finishedAt TEXT,
      scanned INTEGER,
      changed INTEGER,
      status TEXT,
      error TEXT,
      trigger_type TEXT
    )
  `);
  // טבלת עזר זמנית לטעינת כל דף סריקה - מנוקה בין דפים
  db.run(`
    CREATE TABLE IF NOT EXISTS scan_page (
      mispar_rechev INTEGER,
      kilometers INTEGER,
      testDate TEXT
    )
  `);

  // היסטוריית חיפושים במסך "בדיקת רכב". נשמר מי חיפש, כדי שעובד יראה רק את שלו
  // והבעלים יראה את של כולם.
  db.run(`
    CREATE TABLE IF NOT EXISTS search_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate TEXT NOT NULL,
      username TEXT,
      manufacturer TEXT,
      model TEXT,
      year TEXT,
      found INTEGER DEFAULT 1,
      searchedAt TEXT
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_search_user ON search_history(username, id)');

  // מסמכים מצורפים לרכב (רישיון רכב וכו'). הקבצים עצמם נשמרים על הדיסק
  // ולא בתוך ה-DB, כדי שהמסד יישאר קטן ומהיר לגיבוי.
  db.run(`
    CREATE TABLE IF NOT EXISTS car_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      carId INTEGER NOT NULL,
      fileName TEXT,
      storedName TEXT,
      mimeType TEXT,
      size INTEGER,
      docDate TEXT,
      uploadedAt TEXT
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_docs_car ON car_documents(carId)');

  // ק"מ עדכני - מוזן ידנית ע"י מי שמוסיף את הרכב. שונה מ-kilometers שהוא הק"מ
  // שנרשם בטסט האחרון (יכול להיות בן שנה) ומגיע אוטומטית ממשרד התחבורה.
  // מתי נמדד הקמ הידני - בלי זה אי אפשר לשרטט התקדמות לאורך זמן
  db.run('ALTER TABLE cars ADD COLUMN currentKmDate TEXT', (err) => {
    if (err && !String(err.message).includes('duplicate column')) console.error('currentKmDate:', err.message);
  });
  // רכב שנקנה אך טרם הגיע למגרש. ברירת מחדל 1 - כל הרכבים הקיימים נחשבים שהגיעו.
  db.run('ALTER TABLE cars ADD COLUMN govData TEXT', (err) => {
    if (err && !String(err.message).includes('duplicate column')) console.error('govData:', err.message);
  });
  db.run('ALTER TABLE cars ADD COLUMN govUpdatedAt TEXT', (err) => {
    if (err && !String(err.message).includes('duplicate column')) console.error('govUpdatedAt:', err.message);
  });
  db.run('ALTER TABLE cars ADD COLUMN arrived INTEGER DEFAULT 1', (err) => {
    if (err && !String(err.message).includes('duplicate column')) console.error('arrived:', err.message);
  });
  db.run('ALTER TABLE cars ADD COLUMN currentKm INTEGER', (err) => {
    if (err && !/duplicate column/i.test(err.message)) console.error('שגיאת מיגרציה (cars.currentKm):', err.message);
  });

  // מיגרציה חד-פעמית: רכבים שנשמרו לפני נרמול שמות היצרנים מכילים את ארץ הייצור
  // ("יונדאי קוריאה"). מאחדים אותם לשם המותג כדי שהמלאי והסינון לא יתפצלו.
  db.all('SELECT id, manufacturer FROM cars', (err, rows) => {
    if (err) { console.error('שגיאה בקריאת יצרנים למיגרציה:', err.message); return; }
    let changed = 0;
    (rows || []).forEach(row => {
      const clean = normalizeManufacturer(row.manufacturer);
      if (clean && clean !== row.manufacturer) {
        changed++;
        db.run('UPDATE cars SET manufacturer = ? WHERE id = ?', [clean, row.id]);
      }
    });
    if (changed) console.log(`🔤 אוחדו שמות יצרן ב-${changed} רכבים`);
  });

  // הכנס נתונים ראשוניים לדוגמה (fallback אם אין חיבור לאינטרנט)
  // הערה: מספר "יד" אינו חלק מהמאגר הפתוח האמיתי של משרד התחבורה (מידע פרטי) - כאן זו דוגמה בלבד
  const ministryVehicles = [
    ['78391203', 'Mazda', '3', 2020, 'לבן', 42000, 1600, 'automatic', '2026-11-30', '2', 'GT'],
    ['12345678', 'BMW', '320i', 2018, 'שחור', 95000, 1600, 'automatic', '2026-09-15', '1', 'EXECUTIVE'],
    ['23456789', 'Toyota', 'Corolla', 2019, 'לבן', 45000, 1600, 'automatic', '2026-05-20', '2', 'COMFORT'],
    ['34567890', 'Volkswagen', 'Golf', 2020, 'אדום', 32000, 1400, 'manual', '2027-01-10', '1', 'TRENDLINE'],
    ['45678901', 'Volkswagen', 'Passat', 2015, 'כסוף', 125000, 2000, 'automatic', '2026-07-01', '3', 'HIGHLINE'],
    ['56789012', 'Hyundai', 'Elantra', 2017, 'ירוק', 105000, 1600, 'automatic', '2026-08-01', '2', 'PREMIUM'],
  ];

  ministryVehicles.forEach(vehicle => {
    db.run(
      `INSERT OR REPLACE INTO ministry_vehicles (vin, manufacturer, model, year, color, kilometers, engine, transmission, testValidUntil, handNumber, trimLevel) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      vehicle
    );
  });
});

// שדה ה-baalut במשרד התחבורה מציין את סוג הבעלות הרשמי של הרכב (פרטי/ליסינג/השכרה/חברה/מונית)
// "ליסינג 0 ק"מ" הוא סיווג פנימי שלנו ואינו קיים ב-baalut, לכן תמיד ממופה ל"ליסינג" הרגיל
function mapBaalutToCondition(baalut) {
  if (!baalut) return '';
  const b = baalut.trim();
  if (b.includes('פרטי')) return 'private';
  if (b.includes('מונית')) return 'taxi';
  if (b.includes('השכרה')) return 'rental';
  if (b.includes('ליסינג') || b.includes('החכר')) return 'lease';
  if (b.includes('חברה') || b.includes('ציבורי') || b.includes('משרד')) return 'company';
  return '';
}

// כשהרכב רשום כרגע על שם "סוחר" (המצב השכיח ביותר לרכב שנמצא במלאי סוחר) אין ל-baalut הנוכחי
// מיפוי ל"מקוריות" - במקום זה מחפשים בהיסטוריה את הסיווג הראשון (המקורי) שאינו "סוחר",
// כלומר מה הרכב היה מלכתחילה (למשל רכב ליסינג שנמכר מאז לפרטי) ולא את הסטטוס האחרון שלו
// דירוג לפי השפעה על השווי: מונית והשכרה הכי משמעותיים, אחריהם ליסינג וחברה.
const CONDITION_SEVERITY = { taxi: 5, rental: 4, lease: 3, company: 2, private: 1 };

// המקוריות היא הסיווג המשמעותי ביותר שהרכב עבר אי פעם - לא הסטטוס הנוכחי.
function getConditionFromHistory(historyRecords) {
  let best = '', bestScore = 0;
  (historyRecords || []).forEach(r => {
    if (!r.baalut || r.baalut.includes('סוחר')) return;
    const c = mapBaalutToCondition(r.baalut);
    const score = CONDITION_SEVERITY[c] || 0;
    if (score > bestScore) { bestScore = score; best = c; }
  });
  return best;
}

// מחשב "יד" מתוך היסטוריית העברות הבעלות: סופר שינויי בעלות ייחודיים ומדלג על "סוחר"
// שמות היצרנים במאגר משרד התחבורה כוללים את ארץ הייצור ("יונדאי קוריאה", "יונדאי צ'כיה"),
// ולכן אותו מותג מופיע כמה פעמים ומפצל את המלאי. כאן מאחדים הכל לשם מותג אחד.
// הרשימה ממוינת מהארוך לקצר כדי ש"מרצדס בנץ" ייתפס לפני "מרצדס", וכו'.
const CANONICAL_BRANDS = [
  'אלפא רומיאו', 'מרצדס בנץ', 'מרצדס-בנץ', 'מרוטי סוזוקי', 'סוזוקי-מרוטי',
  'לנד רובר', 'לנדרובר', 'רולס-רויס', 'אסטון מרטין', 'ב מ וו', 'בי ווי די',
  'גרייט וול', 'דאצ\'יה', 'דאציה', 'די אס', 'לינק אנד קו', 'ניאו רכב',
  'קיי גי מוביליט', 'אף אי דאבל יו', 'אס דאבל יו אמ', 'איי אם', 'ג\'י.אמ.סי',
  'ג\'יי.אמ.סי', 'גי.אי.סי', 'גיי.איי.סי', 'דימלרקריזלר', 'האמר', 'פיאט/מדייר',
  'אאודי', 'אודי', 'אוואטר', 'אומודה', 'אופל', 'אורה', 'איווייס', 'איויאיסי',
  'איון', 'איסוזו', 'אקספנג', 'ארקפוקס', 'באייק', 'ביואיק', 'בנטלי',
  'ג\'אקו', 'ג\'אק', 'ג\'יפ', 'גילי', 'דאיון', 'דודג\'', 'דונגפנג', 'דייהטסו',
  'דיפאל', 'הונדה', 'וואי', 'וויה', 'וולבו', 'זיקר', 'טויוטה', 'טסלה',
  'יגואר', 'יודו', 'יונדאי', 'לקסוס', 'ליפמוטור', 'לנצ\'יה', 'מ.ג',
  'מזארטי', 'מזדה', 'מיצובישי', 'מקסוס', 'ניסאן', 'סאאב', 'סאנגיונג',
  'סובארו', 'סוזוקי', 'סיאט', 'סיטרואן', 'סמארט', 'סקודה', 'סקיוול', 'סרס',
  'פאריזון', 'פוטון', 'פולסטאר', 'פולקסווגן', 'פורד', 'פורשה', 'פורתינג',
  'פיאג\'ו', 'פיאט', 'פיג\'ו', 'פיגו', 'פרארי', 'צ\'רי', 'קאדילאק', 'קוואן',
  'קופרה', 'קיה', 'קרייזלר', 'רובר', 'רנו', 'שברולט',
].sort((a, b) => b.length - a.length);

// איחוד וריאציות כתיב ומיזוגי יצרנים לשם אחד
const BRAND_ALIASES = {
  'אודי': 'אאודי',
  'מרצדס-בנץ': 'מרצדס בנץ',
  'סוזוקי-מרוטי': 'סוזוקי',
  'מרוטי סוזוקי': 'סוזוקי',
  'לנדרובר': 'לנד רובר',
  'דאציה': 'דאצ\'יה',
  'פיגו': 'פיג\'ו',
  'ג\'אקו': 'ג\'אק',
  'דימלרקריזלר': 'קרייזלר',
  'פיאט/מדייר': 'פיאט',
};

function normalizeManufacturer(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  for (const brand of CANONICAL_BRANDS) {
    if (s === brand || s.startsWith(brand + ' ') || s.startsWith(brand + '-') || s.startsWith(brand + '_')) {
      return BRAND_ALIASES[brand] || brand;
    }
  }
  return s; // מותג לא מוכר - משאירים כפי שהוא כדי לא לאבד מידע
}

function calculateHandNumber(historyRecords) {
  const sorted = [...historyRecords].sort((a, b) => (a.baalut_dt || 0) - (b.baalut_dt || 0));
  const seen = new Set();
  let count = 0;
  for (const r of sorted) {
    if (!r.baalut || r.baalut.includes('סוחר')) continue;
    const key = String(r.baalut_dt) + '|' + r.baalut;
    if (seen.has(key)) continue;
    seen.add(key);
    count++;
  }
  return count || '';
}

// שאילתה משולבת מול 4 מאגרי הנתונים הפתוחים הרלוונטיים של משרד התחבורה (data.gov.il):
// 1) רישום בסיסי לפי מספר רכב | 2) מפרט טכני לפי דגם (נפח מנוע, גיר) | 3) היסטוריית בעלויות (למספר יד) | 4) ק"מ בטסט האחרון
async function fetchFromGovApi(plateNumber) {
  const baseUrl = 'https://data.gov.il/api/3/action/datastore_search';

  const vehicleRes = await fetch(`${baseUrl}?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: Number(plateNumber) }))}`);
  const vehicleJson = await vehicleRes.json();
  if (!vehicleJson.success) {
    const err = new Error('המאגר הממשלתי החזיר תשובה לא תקינה');
    err.govUnavailable = true;
    throw err;
  }
  if (vehicleJson.result.records.length === 0) {
    // אין התאמה - אבל צריך לוודא שזה באמת רכב שלא קיים, ולא מאגר שרוקן זמנית
    // אצל משרד התחבורה. בדיקה אחת קלה: האם יש במאגר רשומות בכלל.
    try {
      const probeRes = await fetch(`${baseUrl}?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&limit=1`);
      const probeJson = await probeRes.json();
      const empty = !probeJson.success || !probeJson.result || probeJson.result.records.length === 0;
      if (empty) {
        const err = new Error('מאגר הרכבים של משרד התחבורה ריק כרגע');
        err.govUnavailable = true;
        throw err;
      }
    } catch (probeErr) {
      if (probeErr.govUnavailable) throw probeErr;
      // כשל בבדיקה עצמה - לא מסיקים ממנו מסקנה, ממשיכים כרגיל
    }
    return null;
  }
  const vehicle = vehicleJson.result.records[0];

  const data = {
    vin: plateNumber,
    manufacturer: normalizeManufacturer(vehicle.tozeret_nm),
    model: vehicle.kinuy_mishari || vehicle.degem_nm || '',
    year: vehicle.shnat_yitzur || '',
    color: vehicle.tzeva_rechev || '',
    testValidUntil: vehicle.tokef_dt ? vehicle.tokef_dt.split('T')[0] : '',
    condition: mapBaalutToCondition(vehicle.baalut),
    engine: '',
    transmission: 'automatic',
    kilometers: '',
    handNumber: '',
    trimLevel: '',
    fuelType: vehicle.sug_delek_nm || '',
    engineModel: vehicle.degem_manoa || '',
    chassisNumber: vehicle.misgeret || '',
    lastTestDate: vehicle.mivchan_acharon_dt || '',
    currentOwnership: vehicle.baalut || '',
    ownershipHistory: []
  };

  const [specResult, historyResult, kmResult] = await Promise.allSettled([
    fetch(`${baseUrl}?resource_id=142afde2-6228-49f9-8a29-9b6c3a0cbe40&filters=${encodeURIComponent(JSON.stringify({ tozeret_cd: vehicle.tozeret_cd, degem_cd: vehicle.degem_cd }))}`).then(r => r.json()),
    fetch(`${baseUrl}?resource_id=bb2355dc-9ec7-4f06-9c3f-3344672171da&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: Number(plateNumber) }))}`).then(r => r.json()),
    fetch(`${baseUrl}?resource_id=56063a99-8a3e-4ff4-912e-5966c0279bad&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: Number(plateNumber) }))}`).then(r => r.json()),
  ]);

  if (specResult.status === 'fulfilled' && specResult.value.success && specResult.value.result.records.length > 0) {
    const records = specResult.value.result.records;
    const spec = records.find(r => r.shnat_yitzur == vehicle.shnat_yitzur) || records[0];
    data.engine = spec.nefah_manoa || '';
    data.transmission = spec.automatic_ind == 1 ? 'automatic' : 'manual';
    data.trimLevel = spec.ramat_gimur || '';
  }

  if (historyResult.status === 'fulfilled' && historyResult.value.success && historyResult.value.result.records.length > 0) {
    const historyRecords = historyResult.value.result.records;
    data.handNumber = calculateHandNumber(historyRecords);

    // הסטטוס הנוכחי מתאר איך הרכב רשום היום; המקוריות מתארת מה הוא עבר.
    // מעדיפים את ההיסטוריה, ומסמנים כשהיא שונה מהמצב הנוכחי.
    const fromHistory = getConditionFromHistory(historyRecords);
    const currentCondition = mapBaalutToCondition(vehicle.baalut);
    if (fromHistory) {
      data.condition = fromHistory;
      data.conditionWasChanged = !!(currentCondition && fromHistory !== currentCondition);
      data.currentCondition = currentCondition;
    }
    data.ownershipHistory = [...historyRecords].sort((a, b) => (a.baalut_dt || 0) - (b.baalut_dt || 0));
  }

  if (kmResult.status === 'fulfilled' && kmResult.value.success && kmResult.value.result.records.length > 0) {
    const km = kmResult.value.result.records[0].kilometer_test_aharon;
    if (km) data.kilometers = km;
  }

  return data;
}

// שומר תמונת מצב של הקמ הנוכחי לרכב, רק אם הוא שונה מהתמונה האחרונה שנשמרה (כדי לא לצבור כפילויות מבדיקות חוזרות של אותו רכב)
function saveKmSnapshot(vin, data) {
  vehicleArchive.recordGovernment(vin, data).catch(err => console.error('שגיאה בתיעוד ק״מ בארכיון:', err.message));
  if (!data.kilometers) return;
  db.get('SELECT kilometers FROM km_history WHERE vin = ? ORDER BY id DESC LIMIT 1', [vin], (err, lastRow) => {
    if (err) { console.error('שגיאה בקריאת היסטוריית קמ:', err.message); return; }
    if (lastRow && Number(lastRow.kilometers) === Number(data.kilometers)) return;
    db.run(
      'INSERT INTO km_history (vin, kilometers, testValidUntil, lastTestDate, checkedAt) VALUES (?, ?, ?, ?, ?)',
      [vin, data.kilometers, data.testValidUntil || '', data.lastTestDate || '', new Date().toISOString()],
      (insertErr) => { if (insertErr) console.error('שגיאה בשמירת תמונת קמ:', insertErr.message); }
    );
  });
}

// ==================== מחירון לוי יצחק ====================
// האפליקציה הרשמית של לוי יצחק (com.levinew.app) עובדת מול שרת API בכתובת s.leviitzhak.xyz.
// אנחנו עובדים מול אותו שרת בדיוק כמו שהאפליקציה עושה: אימות חד-פעמי ב-SMS (מספר הטלפון של הבעלים),
// ואז כל בדיקת רכב מושכת את מחיר המחירון + היסטוריית בעלויות ישירות לפי מספר רכב.
const LEVI_API_BASE = 'https://s.leviitzhak.xyz';
const LEVI_API_ORIGIN = 'https://levi-itzhak.co.il';

// טבלת אימות: שומרת את טוקן ה-JWT שמתקבל מאימות ה-SMS, כדי לא להתחבר מחדש בכל בדיקה
db.run(`
  CREATE TABLE IF NOT EXISTS levi_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token TEXT,
    phone TEXT,
    expiresAt TEXT,
    savedAt TEXT
  )
`);

// מפענח את תוקף ה-JWT בלי ספריה חיצונית (payload הוא base64url)
function leviTokenExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return payload.exp ? payload.exp * 1000 : null;
  } catch (e) {
    return null;
  }
}

// שולף את הטוקן השמור אם הוא קיים ועדיין בתוקף (עם מרווח ביטחון של 10 דקות)
function getLeviToken() {
  return new Promise((resolve) => {
    db.get('SELECT token, expiresAt FROM levi_auth WHERE id = 1', (err, row) => {
      if (err || !row || !row.token || row.token.startsWith('uuid:')) { resolve(null); return; }
      const expiresAtMs = Date.parse(row.expiresAt || '');
      if (!Number.isFinite(expiresAtMs) || Date.now() > expiresAtMs - 10 * 60 * 1000) {
        resolve(null); // פג תוקף - נדרש חיבור מחדש
        return;
      }
      resolve(row.token);
    });
  });
}

function saveLeviToken(token, phone) {
  const expMs = leviTokenExpiry(token);
  const expiresAt = expMs ? new Date(expMs).toISOString() : null;
  db.run(
    `INSERT INTO levi_auth (id, token, phone, expiresAt, savedAt) VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET token = excluded.token, phone = excluded.phone,
       expiresAt = excluded.expiresAt, savedAt = excluded.savedAt`,
    [token, phone || '', expiresAt, new Date().toISOString()]
  );
}

// קריאה גנרית לשרת לוי יצחק - חובה Origin כי השרת דוחה בקשות בלעדיו
async function leviApiCall(path, body, token) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Origin': LEVI_API_ORIGIN,
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const response = await fetch(`${LEVI_API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });
  return response.json();
}

// קוד הדגם אינו מתועד באופן רשמי ומופיע בגרסאות שונות של תשובת המחירון.
// ברוב התשובות הוא המזהה של subModel; בחלקן הוא ערך ישיר ובחלקן שדה kod/code/id.
function getLeviModelCode(response, car) {
  const search = response.data && response.data.search ? response.data.search : {};
  const subModel = search.subModel;
  const model = search.model || {};

  const subModelValue = (value) => {
    if (typeof value === 'string' || typeof value === 'number') return value;
    if (!value || typeof value !== 'object') return '';
    const keys = ['kod', 'code', 'modelCode', 'model_code', 'id', 'ID', 'value'];
    return keys.map(key => value[key]).find(candidate => candidate !== undefined && candidate !== null && String(candidate).trim() !== '') || '';
  };

  const candidates = [
    car.kod, car.kod_degem, car.modelCode, car.model_code,
    response.data && response.data.kod,
    subModelValue(subModel),
    model.kod, model.code, model.modelCode,
  ];
  const value = candidates.find(candidate => candidate !== undefined && candidate !== null && String(candidate).trim() !== '');
  return value === undefined ? '' : String(value).trim();
}

// מבצע חיפוש יחיד במחירון ומחזיר תוצאה אחידה גם למסך בדיקת רכב וגם לעדכון המלאי.
// כך המחיר שנשמר במלאי תמיד מגיע מהשרת בלבד ולא מערך שהדפדפן יכול לשלוח.
async function getLeviVehicleData(plateNumber) {
  const token = await getLeviToken();
  if (!token) {
    return {
      status: 401,
      payload: { needsAuth: true, error: 'נדרש חיבור למחירון לוי יצחק (אימות SMS חד-פעמי של הבעלים)' }
    };
  }

  try {
    const resp = await leviApiCall('/main/new-get-by-licence-plate/', {
      plate: Number(plateNumber),
      isMotorcycleSearch: false,
    }, token);

    if (resp && resp.error === 'Unauthorized access.') {
      db.run('DELETE FROM levi_auth WHERE id = 1');
      return {
        status: 401,
        payload: { needsAuth: true, error: 'החיבור למחירון פג - נדרש אימות מחדש' }
      };
    }

    if (!resp || resp.status !== 1 || !resp.data || !resp.data.car) {
      return { status: 200, payload: { success: false, message: 'הרכב לא נמצא במחירון לוי יצחק' } };
    }

    const car = resp.data.car;
    const kmInfo = car.kmInfo || {};
    const modelCode = getLeviModelCode(resp, car);
    return {
      status: 200,
      payload: {
        success: true,
        data: {
          plate: plateNumber,
          name: car.name || '',
          manufacturer: car.manufacturerName || '',
          years: car.year || [],
          price: car.price || car.singlePrice || null,
          modelCode,
          // לתצוגת בדיקת רכב: המחירון נכון למועד שבו התוצאה נמשכה מהשירות.
          priceDate: new Date().toISOString().slice(0, 10),
          engineVolume: car.engineVolume || '',
          ramatGimur: car.ramatGimur || [],
          color: kmInfo.color || '',
          lastTestKm: kmInfo.last_test_km || null,
          currentOwner: kmInfo.current_owner || '',
          chassisNumber: kmInfo.vin || '',
          ownershipHistory: car.ownershipHistory || [],
          aliyaDate: car.aliyaDate || '',
        }
      }
    };
  } catch (e) {
    console.error('שגיאה בבדיקת מחירון לוי יצחק:', e.message);
    return { status: 502, payload: { error: 'לא ניתן לפנות לשרת המחירון כרגע' } };
  }
}

// API: שלב 1 של החיבור - שליחת קוד SMS לטלפון של הבעלים (בדיוק כמו מסך הכניסה באפליקציה)
app.post('/api/levi/auth/send-code', requireAdmin, async (req, res) => {
  const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
  if (!/^05[0-9]{8}$/.test(phone)) {
    res.status(400).json({ error: 'מספר טלפון לא תקין - נדרש מספר נייד ישראלי' });
    return;
  }
  try {
    const uuid = crypto.randomUUID();
    const resp = await leviApiCall('/users/send-validation-sms', { phone, uuid });
    if (resp.status === 1) {
      // שומרים את ה-uuid זמנית בשדה token (עם קידומת) - שלב האימות צריך אותו
      db.run(
        `INSERT INTO levi_auth (id, token, phone, expiresAt, savedAt) VALUES (1, ?, ?, NULL, ?)
         ON CONFLICT(id) DO UPDATE SET token = excluded.token, phone = excluded.phone, savedAt = excluded.savedAt`,
        [`uuid:${uuid}`, phone, new Date().toISOString()]
      );
      res.json({ success: true, message: 'קוד אימות נשלח ב-SMS' });
    } else {
      res.status(502).json({ error: resp.msg || 'שליחת הקוד נכשלה - נסה שוב' });
    }
  } catch (e) {
    console.error('שגיאה בשליחת קוד לוי יצחק:', e.message);
    res.status(502).json({ error: 'לא ניתן לפנות לשרת המחירון כרגע' });
  }
});

// API: שלב 2 של החיבור - אימות הקוד שהתקבל ב-SMS וקבלת טוקן
app.post('/api/levi/auth/verify-code', requireAdmin, async (req, res) => {
  const phone = (req.body.phone || '').replace(/[^0-9]/g, '');
  const code = (req.body.code || '').trim();
  if (!/^[0-9]{6}$/.test(code)) {
    res.status(400).json({ error: 'קוד לא תקין - נדרשות 6 ספרות' });
    return;
  }
  db.get('SELECT token FROM levi_auth WHERE id = 1', async (err, row) => {
    const uuid = row && row.token && row.token.startsWith('uuid:') ? row.token.slice(5) : crypto.randomUUID();
    try {
      const resp = await leviApiCall('/users/validate-sms', { uuid, phone, code });
      if (resp.status === 1 && resp.data) {
        const token = typeof resp.data === 'string' ? resp.data : resp.data.token;
        if (!token || !leviTokenExpiry(token)) {
          res.status(502).json({ error: 'התקבל טוקן אימות לא תקין מהמחירון' });
          return;
        }
        saveLeviToken(token, phone);
        res.json({ success: true, message: 'החיבור למחירון לוי יצחק הושלם' });
      } else if (resp.status === 2) {
        res.status(400).json({ error: 'הקוד שהוזן שגוי' });
      } else {
        res.status(400).json({ error: 'הקוד פג תוקף - שלח קוד חדש' });
      }
    } catch (e) {
      console.error('שגיאה באימות קוד לוי יצחק:', e.message);
      res.status(502).json({ error: 'לא ניתן לפנות לשרת המחירון כרגע' });
    }
  });
});

// API: מצב החיבור למחירון (האם יש טוקן בתוקף ומתי הוא פג)
app.get('/api/levi/auth/status', (req, res) => {
  db.get('SELECT phone, expiresAt, savedAt FROM levi_auth WHERE id = 1', async (err, row) => {
    const token = await getLeviToken();
    res.json({
      connected: !!token,
      phone: row ? row.phone : '',
      expiresAt: row ? row.expiresAt : null,
    });
  });
});

// API: בדיקת מחירון לוי יצחק לפי מספר רכב - מחזיר מחיר מחירון, פרטי דגם והיסטוריית בעלויות
app.get('/api/levi/:plate', async (req, res) => {
  const plateNumber = req.params.plate.trim();
  if (!isValidPlateNumber(plateNumber)) {
    res.status(400).json({ error: 'מספר רכב לא תקין' });
    return;
  }

  const result = await getLeviVehicleData(plateNumber);
  res.status(result.status).json(result.payload);
});

// API: קבל נתונים לפי מספר רכב - קודם ה-API האמיתי של משרד התחבורה (data.gov.il),
// ורק אם זה נכשל (אין אינטרנט וכו') נופלים לבסיס הנתונים המקומי לדוגמה
app.get('/api/vehicle/:vin', async (req, res) => {
  const plateNumber = req.params.vin.trim();
  if (!isValidPlateNumber(plateNumber)) {
    res.status(400).json({ error: 'מספר רכב לא תקין' });
    return;
  }

  let govUnavailable = false;
  try {
    const data = await fetchFromGovApi(plateNumber);
    if (data) {
      res.json({ success: true, data, source: 'gov.il' });
      saveKmSnapshot(plateNumber, data);
      recordSearch(req, plateNumber, data);
      return;
    }
  } catch (e) {
    if (e.govUnavailable) govUnavailable = true;
    console.error('שגיאה בפנייה ל-data.gov.il:', e.message);
  }

  db.get('SELECT * FROM ministry_vehicles WHERE vin = ?', [plateNumber], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (row) {
      res.json({ success: true, data: row, source: 'local' });
      return;
    }

    res.json({
      success: false,
      govUnavailable,
      message: govUnavailable
        ? 'מאגר הרכבים של משרד התחבורה אינו זמין כרגע (תקלה אצלם, לא אצלנו). נסו שוב מאוחר יותר.'
        : 'מספר רכב לא נמצא'
    });
  });
});

// API: היסטוריית קמ לרכב - איחוד של שני מקורות: הסריקה הארצית היומית + תמונות מצב מבדיקות ידניות במערכת.
// כפילויות עוקבות של אותו קמ (רכב שנצפה בשני המקורות) מסוננות
app.get('/api/km-history/:vin', (req, res) => {
  const plateNumber = req.params.vin.trim();
  if (!isValidPlateNumber(plateNumber)) {
    res.status(400).json({ error: 'מספר רכב לא תקין' });
    return;
  }
  // קריאת טסט מתוארכת לפי מועד הטסט עצמו (mivchan_acharon_dt), לא לפי מתי שסרקנו אותה.
  // זה גם התאריך הנכון להצגה, וגם המפתח לזיהוי שמדובר באותו טסט שכבר ראינו.
  db.all(
    `SELECT kilometers, checkedAt, lastTestDate AS testDate, 'test' AS source FROM km_history WHERE vin = ?
     UNION ALL
     SELECT kilometers, seenAt AS checkedAt, testDate, 'test' AS source FROM national_km_history WHERE mispar_rechev = ?`,
    [plateNumber, Number(plateNumber)],
    (err, rows) => {
      if (err) { res.status(500).json({ error: err.message }); return; }

      db.get('SELECT currentKm, currentKmDate, createdAt FROM cars WHERE vin = ? ORDER BY id DESC LIMIT 1',
        [plateNumber], (err2, car) => {

        // טסט אחד = שורה אחת. מפתח: תאריך הטסט, ובהיעדרו הקילומטראז'.
        const byTest = new Map();
        for (const r of rows || []) {
          const km = Number(r.kilometers);
          const key = r.testDate ? 'd:' + String(r.testDate).slice(0, 10) : 'k:' + km;
          const existing = byTest.get(key);
          // מעדיפים רשומה שיש לה תאריך טסט אמיתי
          if (!existing || (!existing.testDate && r.testDate)) {
            byTest.set(key, { kilometers: km, testDate: r.testDate || null,
                              checkedAt: r.testDate || r.checkedAt, scannedAt: r.checkedAt,
                              dateIsTestDate: !!r.testDate, source: 'test' });
          }
        }

        const datedKms = new Set(
          Array.from(byTest.values()).filter(r => r.testDate).map(r => r.kilometers)
        );
        const all = Array.from(byTest.values())
          .filter(r => r.testDate || !datedKms.has(r.kilometers));

        if (!err2 && car && Number(car.currentKm) > 0) {
          all.push({
            kilometers: Number(car.currentKm),
            checkedAt: car.currentKmDate || car.createdAt || new Date().toISOString(),
            dateIsTestDate: false,
            source: 'manual'
          });
        }

        all.sort((a, b) => String(a.checkedAt).localeCompare(String(b.checkedAt)));
        res.json(all);
      });
    }
  );
});

// ==================== סריקה ארצית יומית של קמ מכל הטסטים ====================
const NATIONAL_KM_RESOURCE = '56063a99-8a3e-4ff4-912e-5966c0279bad';
const NATIONAL_PAGE_SIZE = 10000;
let nationalSyncRunning = false;

// שליפת דף מהמאגר הממשלתי עם נסיונות חוזרים.
// ה-API שלהם גם נופל עם 500 זמני וגם חוסם זמנית (מחזיר דף HTML) כשמושכים ממנו מהר מדי -
// לכן ההמתנות מדורגות וארוכות (עד 2 דקות), כדי לתת לחסימה זמנית לפוג במקום להיכשל
const RETRY_DELAYS_MS = [5000, 15000, 30000, 60000, 120000];
async function fetchNationalPage(offset, limit) {
  const url = `https://data.gov.il/api/3/action/datastore_search?resource_id=${NATIONAL_KM_RESOURCE}&limit=${limit}&offset=${offset}`;
  let lastError;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const response = await fetch(url);
      const json = await response.json();
      if (json.success) return json.result;
      lastError = new Error('API החזיר success=false');
    } catch (e) {
      lastError = e;
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw new Error(`נכשלה שליפת דף offset=${offset}: ${lastError.message}`);
}

// מחיל דף רשומות על המאגר: שומר להיסטוריה רק רכבים שהקמ שלהם חדש/השתנה, ומעדכן את טבלת ה"אחרון הידוע".
// עובד בכתיבה קבוצתית (טבלת עזר + SQL על סטים) כדי שהריצה הראשונה של 2.4 מיליון רשומות תסתיים בדקות ולא בשעות
function applyNationalPage(records, seenAt) {
  return new Promise((resolve, reject) => {
    const valid = records.filter(r => r.mispar_rechev && Number(r.kilometer_test_aharon) > 0);
    if (valid.length === 0) { resolve(0); return; }

    db.serialize(() => {
      db.run('BEGIN');
      db.run('DELETE FROM scan_page');

      // הכנסה מרובת-שורות בצ'אנקים (מגבלת sqlite היא ~999 פרמטרים לפקודה)
      for (let i = 0; i < valid.length; i += 450) {
        const chunk = valid.slice(i, i + 450);
        const placeholders = chunk.map(() => '(?, ?, ?)').join(',');
        const params = [];
        chunk.forEach(r => params.push(Number(r.mispar_rechev), Number(r.kilometer_test_aharon),
                                       r.mivchan_acharon_dt || null));
        db.run(`INSERT INTO scan_page (mispar_rechev, kilometers, testDate) VALUES ${placeholders}`, params);
      }

      let changedInPage = 0;
      db.run(
        `INSERT INTO national_km_history (mispar_rechev, kilometers, seenAt, testDate)
         SELECT s.mispar_rechev, s.kilometers, ?, s.testDate
         FROM scan_page s
         LEFT JOIN national_km_latest l ON l.mispar_rechev = s.mispar_rechev
         WHERE l.mispar_rechev IS NULL OR l.kilometers != s.kilometers`,
        [seenAt],
        function (err) { if (!err) changedInPage = this.changes; }
      );
      db.run(
        `INSERT INTO national_km_latest (mispar_rechev, kilometers, updatedAt)
         SELECT mispar_rechev, kilometers, ? FROM scan_page WHERE 1
         ON CONFLICT(mispar_rechev) DO UPDATE SET
           kilometers = excluded.kilometers, updatedAt = excluded.updatedAt
         WHERE national_km_latest.kilometers != excluded.kilometers`,
        [seenAt]
      );
      db.run('DELETE FROM scan_page');
      db.run('COMMIT', (err) => {
        if (err) reject(err);
        else resolve(changedInPage);
      });
    });
  });
}

// הסריקה המלאה: עוברת על כל המאגר הממשלתי דף-דף. אידמפוטנטית - ריצה חוזרת על אותם נתונים לא מוסיפה כלום
async function runNationalKmSync(triggerType, maxPages = null) {
  if (nationalSyncRunning) return { ok: false, reason: 'already-running' };
  nationalSyncRunning = true;

  const startedAt = new Date().toISOString();
  const seenAt = startedAt.split('T')[0];
  let scanned = 0, changed = 0;
  console.log(`🛰️ מתחיל סריקה ארצית של קמ טסטים (${triggerType})...`);

  try {
    let offset = 0, total = null, pages = 0;
    while (total === null || offset < total) {
      const result = await fetchNationalPage(offset, NATIONAL_PAGE_SIZE);
      if (total === null) total = result.total;
      if (result.records.length === 0) break;

      changed += await applyNationalPage(result.records, seenAt);
      scanned += result.records.length;
      offset += NATIONAL_PAGE_SIZE;
      pages++;
      if (pages % 25 === 0) console.log(`   ...נסרקו ${scanned.toLocaleString()} מתוך ${total.toLocaleString()}`);
      if (maxPages && pages >= maxPages) break;
      // האטה מכוונת בין דפים - מושכים בנימוס כדי לא להיחסם ע"י שרתי הממשלה (מוסיף ~4 דקות לסריקה מלאה, זניח לריצת לילה)
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    db.run(
      'INSERT INTO national_sync_log (startedAt, finishedAt, scanned, changed, status, error, trigger_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [startedAt, new Date().toISOString(), scanned, changed, 'success', null, triggerType]
    );
    console.log(`✅ סריקה ארצית הסתיימה: ${scanned.toLocaleString()} נסרקו, ${changed.toLocaleString()} שינויים נשמרו`);
    return { ok: true, scanned, changed };
  } catch (e) {
    db.run(
      'INSERT INTO national_sync_log (startedAt, finishedAt, scanned, changed, status, error, trigger_type) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [startedAt, new Date().toISOString(), scanned, changed, 'failed', e.message, triggerType]
    );
    console.error(`❌ סריקה ארצית נכשלה אחרי ${scanned.toLocaleString()} רשומות: ${e.message}`);
    return { ok: false, error: e.message };
  } finally {
    nationalSyncRunning = false;
  }
}

// תזמון יומי: כל שעה בודקים אם עברו 22+ שעות מהסריקה המוצלחת האחרונה, ואם כן מריצים.
// הגישה הזאת שורדת רסטארטים/דיפלויים (אין תלות בשעון פנימי רציף) ולא תלויה באזור זמן.
// מופעל רק כש-ENABLE_NATIONAL_SYNC=1 (מוגדר בענן בלבד) - כדי שהשרת המקומי בעסק לא יוריד 500MB ביום סתם
if (process.env.ENABLE_NATIONAL_SYNC === '1') {
  const checkAndRunSync = () => {
    db.get(`SELECT finishedAt FROM national_sync_log WHERE status = 'success' ORDER BY id DESC LIMIT 1`, (err, row) => {
      if (err) { console.error('שגיאה בבדיקת מועד סריקה אחרון:', err.message); return; }
      const hoursSince = row ? (Date.now() - new Date(row.finishedAt).getTime()) / 3600000 : Infinity;
      if (hoursSince >= 22) runNationalKmSync('scheduled');
    });
  };
  setTimeout(checkAndRunSync, 90 * 1000);            // בדיקה ראשונה 90 שניות אחרי עליית השרת
  setInterval(checkAndRunSync, 60 * 60 * 1000);      // ומאז - כל שעה
  console.log('🗓️ סריקה ארצית יומית של קמ טסטים: פעילה');
}

// API: הפעלה ידנית של הסריקה (רצה ברקע - התשובה חוזרת מיד, מעקב דרך /api/national-sync/status)
app.post('/api/national-sync', requireAdmin, (req, res) => {
  if (nationalSyncRunning) {
    res.json({ started: false, reason: 'סריקה כבר רצה כרגע' });
    return;
  }
  const requestedPages = req.query.pages ? Number(req.query.pages) : null;
  const maxPages = Number.isInteger(requestedPages) && requestedPages > 0 ? requestedPages : null;
  runNationalKmSync('manual', maxPages);
  res.json({ started: true, message: 'הסריקה החלה ברקע' });
});

// API: מצב הסריקה הארצית - ריצות אחרונות + כמה נתונים נצברו
app.get('/api/national-sync/status', (req, res) => {
  db.all(`SELECT * FROM national_sync_log ORDER BY id DESC LIMIT 5`, (err, runs) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    db.get(`SELECT COUNT(*) AS vehicles FROM national_km_latest`, (err2, latestCount) => {
      db.get(`SELECT COUNT(*) AS snapshots FROM national_km_history`, (err3, historyCount) => {
        res.json({
          running: nationalSyncRunning,
          vehiclesTracked: latestCount ? latestCount.vehicles : 0,
          totalSnapshots: historyCount ? historyCount.snapshots : 0,
          recentRuns: runs || []
        });
      });
    });
  });
});

// API: בריאות הסנכרון הארצי. מיועד לבדיקה תכופה מהממשק - מחזיר מעט ובזול.
// הסנכרון אמור לרוץ כל ~22 שעות, אז 48 שעות בלי הצלחה = בעיה אמיתית ולא איחור רגיל.
const SYNC_STALE_HOURS = 48;

app.get('/api/national-sync/health', (req, res) => {
  db.get("SELECT finishedAt FROM national_sync_log WHERE status = 'success' ORDER BY id DESC LIMIT 1", (err, ok) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    db.get("SELECT status, error, finishedAt FROM national_sync_log ORDER BY id DESC LIMIT 1", (err2, last) => {
      if (err2) { res.status(500).json({ error: err2.message }); return; }

      // אם הסנכרון כבוי בשרת הזה (פיתוח מקומי) אין על מה להתריע
      if (process.env.ENABLE_NATIONAL_SYNC !== '1') { res.json({ enabled: false, healthy: true }); return; }

      const hoursSince = ok ? (Date.now() - new Date(ok.finishedAt).getTime()) / 3600000 : Infinity;
      const stale = hoursSince >= SYNC_STALE_HOURS;
      res.json({
        enabled: true,
        healthy: !stale,
        running: nationalSyncRunning,
        lastSuccessAt: ok ? ok.finishedAt : null,
        hoursSinceSuccess: Number.isFinite(hoursSince) ? Math.floor(hoursSince) : null,
        daysSinceSuccess: Number.isFinite(hoursSince) ? Math.floor(hoursSince / 24) : null,
        lastRunFailed: !!(last && last.status === 'failed'),
        lastError: last && last.status === 'failed' ? last.error : null
      });
    });
  });
});

// שולף מחדש ממשרד התחבורה ושומר לרכב, כדי שהנתונים יהיו זמינים
// בכרטיס בלי לחזור לבדיקה בכל פעם.
app.post('/api/cars/:id/gov-refresh', (req, res) => {
  const id = Number(req.params.id);
  db.get('SELECT vin FROM cars WHERE id = ?', [id], async (err, car) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    if (!car || !car.vin) { res.status(404).json({ error: 'רכב לא נמצא' }); return; }
    try {
      const data = await fetchFromGovApi(car.vin);
      if (!data) { res.status(404).json({ error: 'הרכב לא נמצא במאגר' }); return; }
      const now = new Date().toISOString();
      db.run('UPDATE cars SET govData = ?, govUpdatedAt = ? WHERE id = ?',
        [JSON.stringify(data), now, id], (e2) => {
          if (e2) { res.status(500).json({ error: e2.message }); return; }
          res.json({ success: true, govData: data, govUpdatedAt: now });
        });
    } catch (e) {
      if (e.govUnavailable) {
        res.status(503).json({ error: 'מאגר משרד התחבורה אינו זמין כרגע', govUnavailable: true });
      } else {
        res.status(500).json({ error: e.message });
      }
    }
  });
});

// ==================== סליקה (INFOCAR) ====================
// פרטי המורשה הם אישיים לכל משתמש - ההצהרה באתר וכרטיס האשראי הם על שמו,
// ולכן כל משתמש שומר את הפרטים של עצמו ולא רואה של אחרים.
db.run(`CREATE TABLE IF NOT EXISTS slika_profile (
  username TEXT PRIMARY KEY,
  firstName TEXT, lastName TEXT, idNumber TEXT, address TEXT, phone TEXT,
  updatedAt TEXT
)`, (err) => { if (err) console.error('slika_profile:', err.message); });

// תיעוד שאילתות שהוזמנו - כל שאילתה עולה כסף, אין טעם לשלם פעמיים על אותו רכב
db.run(`CREATE TABLE IF NOT EXISTS slika_queries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT NOT NULL,
  ownerId TEXT,
  ownershipStart TEXT,
  result TEXT,
  username TEXT,
  orderedAt TEXT NOT NULL
)`, (err) => { if (err) console.error('slika_queries:', err.message); });

app.get('/api/slika/profile', (req, res) => {
  const user = (req.auth && req.auth.user) || '';
  db.get('SELECT * FROM slika_profile WHERE username = ?', [user], (err, row) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    res.json(row || null);
  });
});

app.post('/api/slika/profile', (req, res) => {
  const user = (req.auth && req.auth.user) || '';
  const b = req.body || {};
  db.run(
    `INSERT INTO slika_profile (username, firstName, lastName, idNumber, address, phone, email, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       firstName=excluded.firstName, lastName=excluded.lastName, idNumber=excluded.idNumber,
       address=excluded.address, phone=excluded.phone, email=excluded.email,
       updatedAt=excluded.updatedAt`,
    [user, String(b.firstName||''), String(b.lastName||''), String(b.idNumber||''),
     String(b.address||''), String(b.phone||''), String(b.email||''), new Date().toISOString()],
    (err) => {
      if (err) { res.status(500).json({ error: err.message }); return; }
      res.json({ success: true });
    }
  );
});

// שאילתות שהוזמנו לרכב מסוים - כדי להתריע לפני תשלום כפול
app.get('/api/slika/queries/:plate', (req, res) => {
  const admin = roleOf(req) === 'admin';
  const user = (req.auth && req.auth.user) || '';
  const where = admin ? 'WHERE plate = ?' : 'WHERE plate = ? AND username = ?';
  const args = admin ? [String(req.params.plate)] : [String(req.params.plate), user];
  db.all('SELECT * FROM slika_queries ' + where + ' ORDER BY id DESC', args, (err, rows) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    res.json(rows || []);
  });
});

app.post('/api/slika/queries', (req, res) => {
  const b = req.body || {};
  if (!b.plate) { res.status(400).json({ error: 'חסר מספר רכב' }); return; }
  db.run(
    'INSERT INTO slika_queries (plate, ownerId, ownershipStart, result, username, orderedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [String(b.plate), String(b.ownerId||''), String(b.ownershipStart||''), String(b.result||''),
     (req.auth && req.auth.user) || '', new Date().toISOString()],
    function (err) {
      if (err) { res.status(500).json({ error: err.message }); return; }
      res.json({ success: true, id: this.lastID });
    }
  );
});

// ---- מילוי אוטומטי של טופס INFOCAR ----
// הסקריפט רץ בדפדפן של המשתמש, בדף שהוא פתח, וממלא שדות טקסט בלבד.
// הוא לא מסמן הצהרות, לא נוגע בתשלום ולא שולח את הטופס - אלה נשארים אצל המשתמש.
db.run('ALTER TABLE slika_profile ADD COLUMN email TEXT', (err) => {
  if (err && !String(err.message).includes('duplicate column')) console.error('email:', err.message);
});
db.run('ALTER TABLE slika_pending ADD COLUMN primeOwner INTEGER DEFAULT 1', (err) => {
  if (err && !String(err.message).includes('duplicate column')) console.error('primeOwner:', err.message);
});
db.run('ALTER TABLE slika_pending ADD COLUMN mode TEXT', (err) => {
  if (err && !String(err.message).includes('duplicate column')) console.error('mode:', err.message);
});
db.run('ALTER TABLE slika_pending ADD COLUMN authorized INTEGER DEFAULT 0', (err) => {
  if (err && !String(err.message).includes('duplicate column')) console.error('authorized:', err.message);
});
db.run('ALTER TABLE slika_pending ADD COLUMN authorizedAt TEXT', (err) => {
  if (err && !String(err.message).includes('duplicate column')) console.error('authorizedAt:', err.message);
});
db.run('ALTER TABLE slika_profile ADD COLUMN fillToken TEXT', (err) => {
  if (err && !String(err.message).includes('duplicate column')) console.error('fillToken:', err.message);
});

// מה שהוכן למילוי הבא, לכל משתמש בנפרד
db.run(`CREATE TABLE IF NOT EXISTS slika_pending (
  username TEXT PRIMARY KEY,
  plate TEXT, ownerId TEXT, ownerDate TEXT, preparedAt TEXT
)`, (err) => { if (err) console.error('slika_pending:', err.message); });

function slikaEnsureToken(username, cb) {
  db.get('SELECT fillToken FROM slika_profile WHERE username = ?', [username], (err, row) => {
    if (err) { cb(err); return; }
    if (row && row.fillToken) { cb(null, row.fillToken); return; }
    const token = require('crypto').randomBytes(24).toString('hex');
    db.run(`INSERT INTO slika_profile (username, fillToken, updatedAt) VALUES (?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET fillToken = excluded.fillToken`,
      [username, token, new Date().toISOString()], (e) => cb(e, token));
  });
}

// מחזיר את הסקריפט האישי (עם הטוקן בתוכו) להעתקה חד-פעמית
app.get('/api/slika/fill-token', (req, res) => {
  slikaEnsureToken((req.auth && req.auth.user) || '', (err, token) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    res.json({ token });
  });
});

// מכין את הרכב הבא למילוי
app.post('/api/slika/prepare', (req, res) => {
  const user = (req.auth && req.auth.user) || '';
  const b = req.body || {};
  if (!b.plate) { res.status(400).json({ error: 'חסר מספר רכב' }); return; }
  const authorized = b.authorized ? 1 : 0;
  const now = new Date().toISOString();
  db.run(`INSERT INTO slika_pending (username, plate, ownerId, ownerDate, authorized, authorizedAt, mode, primeOwner, preparedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(username) DO UPDATE SET plate=excluded.plate, ownerId=excluded.ownerId,
            ownerDate=excluded.ownerDate, authorized=excluded.authorized,
            authorizedAt=excluded.authorizedAt, mode=excluded.mode,
            primeOwner=excluded.primeOwner, preparedAt=excluded.preparedAt`,
    [user, String(b.plate), String(b.ownerId || ''), String(b.ownerDate || ''),
     authorized, authorized ? now : null, String(b.mode || 'morshe'),
     b.primeOwner === 0 ? 0 : 1, now],
    (err) => {
      if (err) { res.status(500).json({ error: err.message }); return; }
      res.json({ success: true });
    }
  );
});

// נקרא מדף INFOCAR, ולכן חייב CORS ואימות בטוקן במקום בעוגייה.
// מחזיר רק את מה שהמשתמש עצמו הכין - הטוקן מזהה אותו.

// ==================== הסכמי מכירה שהונפקו ====================
// שומרים גם את השדות (כדי לשכפל הסכם) וגם את ה-HTML המלא כפי שהודפס.
// ה-HTML חשוב: אם התבנית תשתנה בעתיד, המסמך שנחתם חייב להישאר כפי שהיה.
db.run(`CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT,
  carDesc TEXT,
  buyerName TEXT,
  buyerId TEXT,
  price INTEGER,
  mode TEXT,
  fields TEXT,
  html TEXT,
  username TEXT,
  createdAt TEXT NOT NULL
)`, (err) => { if (err) console.error('שגיאה ביצירת טבלת הסכמים:', err.message); });

app.post('/api/contracts', (req, res) => {
  const b = req.body || {};
  if (!b.html || !b.fields) { res.status(400).json({ error: 'חסרים נתוני הסכם' }); return; }
  db.run(
    'INSERT INTO contracts (plate, carDesc, buyerName, buyerId, price, mode, fields, html, username, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [String(b.plate || ''), String(b.carDesc || ''), String(b.buyerName || ''), String(b.buyerId || ''),
     Math.round(Number(b.price)) || 0, String(b.mode || 'both'),
     JSON.stringify(b.fields), String(b.html), (req.auth && req.auth.user) || '', new Date().toISOString()],
    function (err) {
      if (err) { res.status(500).json({ error: err.message }); return; }
      res.json({ success: true, id: this.lastID });
    }
  );
});

// רשימה. עובד רואה את ההסכמים שהוא הנפיק, הבעלים רואה הכל.
// ה-HTML לא נשלח כאן - הוא כבד, ונטען רק כשפותחים הסכם ספציפי.
app.get('/api/contracts', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const offset = Number(req.query.offset) || 0;
  const admin = roleOf(req) === 'admin';
  const user = (req.auth && req.auth.user) || '';
  const where = admin ? '' : ' WHERE username = ?';
  const args = admin ? [] : [user];

  db.get('SELECT COUNT(*) AS n FROM contracts' + where, args, (e0, cnt) => {
    if (e0) { res.status(500).json({ error: e0.message }); return; }
    db.all(
      'SELECT id, plate, carDesc, buyerName, buyerId, price, mode, username, createdAt FROM contracts' + where +
      ' ORDER BY id DESC LIMIT ? OFFSET ?', args.concat([limit, offset]),
      (err, rows) => {
        if (err) { res.status(500).json({ error: err.message }); return; }
        res.json({ contracts: rows || [], total: cnt ? cnt.n : 0, canDeleteContracts: admin });
      }
    );
  });
});

// פתיחה מחדש של הסכם שהונפק - מחזיר את המסמך כפי שהודפס
app.get('/api/contracts/:id', (req, res) => {
  db.get('SELECT * FROM contracts WHERE id = ?', [Number(req.params.id)], (err, row) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    if (!row) { res.status(404).json({ error: 'הסכם לא נמצא' }); return; }
    if (roleOf(req) !== 'admin' && row.username !== ((req.auth && req.auth.user) || '')) {
      res.status(403).json({ error: 'אין הרשאה' }); return;
    }
    res.json(row);
  });
});

app.delete('/api/contracts/:id', requireAdmin, (req, res) => {
  db.run('DELETE FROM contracts WHERE id = ?', [Number(req.params.id)], function (err) {
    if (err) { res.status(500).json({ error: err.message }); return; }
    res.json({ success: true, deleted: this.changes });
  });
});

// ==================== מחיר מודעות (נרשם ידנית) ====================
// המחיר נצפה ונרשם ע"י המשתמש - המערכת לא פונה לשום אתר חיצוני.
// נשמרת היסטוריה, כדי לראות איך מחירי המודעות לדגם זזים לאורך זמן.
db.run(`CREATE TABLE IF NOT EXISTS market_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plate TEXT NOT NULL,
  price INTEGER NOT NULL,
  listingsSeen INTEGER,
  notes TEXT,
  username TEXT,
  checkedAt TEXT NOT NULL
)`, (err) => { if (err) console.error('שגיאה ביצירת טבלת מחירי מודעות:', err.message); });

// הרישום האחרון לרכב + כמה נרשמו בסך הכל
app.get('/api/market-price/:plate', (req, res) => {
  const plate = String(req.params.plate || '').trim();
  db.get('SELECT * FROM market_prices WHERE plate = ? ORDER BY id DESC LIMIT 1', [plate], (err, latest) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    db.all('SELECT price, checkedAt, listingsSeen FROM market_prices WHERE plate = ? ORDER BY id DESC LIMIT 6', [plate], (err2, history) => {
      res.json({ latest: latest || null, history: history || [] });
    });
  });
});

app.post('/api/market-price', (req, res) => {
  const plate = String(req.body.plate || '').trim();
  const price = Math.round(Number(req.body.price));
  if (!plate) { res.status(400).json({ error: 'חסר מספר רכב' }); return; }
  if (!Number.isFinite(price) || price <= 0) { res.status(400).json({ error: 'מחיר לא תקין' }); return; }

  const seen = Number(req.body.listingsSeen);
  db.run(
    'INSERT INTO market_prices (plate, price, listingsSeen, notes, username, checkedAt) VALUES (?, ?, ?, ?, ?, ?)',
    [plate, price, Number.isFinite(seen) && seen > 0 ? Math.round(seen) : null,
     String(req.body.notes || '').slice(0, 300), (req.auth && req.auth.user) || '', new Date().toISOString()],
    function (err) {
      if (err) { res.status(500).json({ error: err.message }); return; }
      res.json({ success: true, id: this.lastID });
    }
  );
});

// ==================== היסטוריית חיפושים ====================
function recordSearch(req, plate, data) {
  const username = (req.auth && req.auth.user) || '';
  db.run(
    'INSERT INTO search_history (plate, username, manufacturer, model, year, found, searchedAt) VALUES (?, ?, ?, ?, ?, 1, ?)',
    [plate, username, (data && data.manufacturer) || '', (data && data.model) || '', String((data && data.year) || ''), new Date().toISOString()],
    (err) => { if (err) console.error('שגיאה בשמירת היסטוריית חיפוש:', err.message); }
  );
}

// רשימת החיפושים האחרונים. עובד רואה רק את שלו, הבעלים רואה את של כולם.
// מוצגת שורה אחת לכל רכב (החיפוש האחרון), עם מונה כמה פעמים חופש.
app.get('/api/search-history', (req, res) => {
  const isAdmin = roleOf(req) === 'admin';
  const me = (req.auth && req.auth.user) || '';

  // עימוד: מבקשים פריט אחד יותר מהמבוקש, כדי לדעת אם יש עוד בלי שאילתת ספירה נוספת
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  const sql = isAdmin
    ? `SELECT plate, MAX(id) AS lastId, COUNT(*) AS times,
              MAX(searchedAt) AS searchedAt,
              GROUP_CONCAT(DISTINCT username) AS users
       FROM search_history
       GROUP BY plate ORDER BY lastId DESC LIMIT ? OFFSET ?`
    : `SELECT plate, MAX(id) AS lastId, COUNT(*) AS times,
              MAX(searchedAt) AS searchedAt,
              username AS users
       FROM search_history WHERE username = ?
       GROUP BY plate ORDER BY lastId DESC LIMIT ? OFFSET ?`;

  const params = isAdmin ? [limit + 1, offset] : [me, limit + 1, offset];

  db.all(sql, params, (err, allRows) => {
    const hasMore = allRows && allRows.length > limit;
    const rows = hasMore ? allRows.slice(0, limit) : allRows;
    if (err) { res.status(500).json({ error: err.message }); return; }
    if (!rows || !rows.length) { res.json({ isAdmin, items: [], hasMore: false, offset }); return; }

    // מביאים את פרטי הרכב מהרשומה האחרונה של כל מספר רכב
    const ids = rows.map(r => r.lastId);
    db.all('SELECT id, manufacturer, model, year FROM search_history WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids, (e2, details) => {
      if (e2) { res.status(500).json({ error: e2.message }); return; }
      const byId = {};
      (details || []).forEach(d => { byId[d.id] = d; });
      res.json({
        isAdmin,
        hasMore,
        offset,
        items: rows.map(r => {
          const d = byId[r.lastId] || {};
          return {
            plate: r.plate,
            manufacturer: d.manufacturer || '',
            model: d.model || '',
            year: d.year || '',
            times: r.times,
            searchedAt: r.searchedAt,
            users: r.users || '',
          };
        }),
      });
    });
  });
});

// ניקוי ההיסטוריה - לבעלים בלבד
app.delete('/api/search-history', requireAdmin, (req, res) => {
  db.run('DELETE FROM search_history', (err) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    res.json({ success: true });
  });
});

// ==================== מסמכים מצורפים ====================
const ALLOWED_DOC_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 60 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_DOC_TYPES.has(file.mimetype)) {
      cb(new Error('סוג קובץ לא נתמך: ' + file.mimetype));
      return;
    }
    cb(null, true);
  },
});

// שם הקובץ שמשרד התחבורה מפיק מקודד בתוכו את מספר הרכב ואת מועד ההפקה:
//   CarLicense<מספר רכב><17 ספרות של חותמת זמן>.pdf
// לכן אפשר לשייך קובץ שהועלה לרכב הנכון בלי שהמשתמש יקליד דבר.
function parseLicenseFileName(name) {
  const m = String(name || '').match(/CarLicense(\d+)/i);
  if (!m) return null;
  const digits = m[1];
  if (digits.length <= 17) return null;
  const plate = digits.slice(0, digits.length - 17);
  const ts = digits.slice(-17);
  const docDate = ts.slice(0, 4) + '-' + ts.slice(4, 6) + '-' + ts.slice(6, 8);
  return { plate, docDate };
}

function saveDocRecord({ carId, originalName, mimeType, buffer, docDate }, cb) {
  const safeExt = (path.extname(originalName || '') || '').slice(0, 10).replace(/[^.a-zA-Z0-9]/g, '');
  const storedName = Date.now() + '-' + crypto.randomBytes(6).toString('hex') + safeExt;
  fsp.writeFile(path.join(DOCS_DIR, storedName), buffer, (err) => {
    if (err) { cb(err); return; }
    db.run(
      'INSERT INTO car_documents (carId, fileName, storedName, mimeType, size, docDate, uploadedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [carId, originalName || storedName, storedName, mimeType, buffer.length, docDate || '', new Date().toISOString()],
      function (dbErr) { cb(dbErr, dbErr ? null : this.lastID); }
    );
  });
}

// רשימת המסמכים של רכב
app.get('/api/cars/:id/documents', (req, res) => {
  if (!isValidRecordId(req.params.id)) { res.status(400).json({ error: 'מזהה לא תקין' }); return; }
  db.all('SELECT id, fileName, mimeType, size, docDate, uploadedAt FROM car_documents WHERE carId = ? ORDER BY id DESC',
    [req.params.id], (err, rows) => {
      if (err) { res.status(500).json({ error: err.message }); return; }
      res.json(rows || []);
    });
});

// העלאה לרכב מסוים
app.post('/api/cars/:id/documents', docUpload.array('files', 60), (req, res) => {
  if (!isValidRecordId(req.params.id)) { res.status(400).json({ error: 'מזהה לא תקין' }); return; }
  const files = req.files || [];
  if (!files.length) { res.status(400).json({ error: 'לא נשלחו קבצים' }); return; }

  let done = 0, failed = 0;
  files.forEach(f => {
    const parsed = parseLicenseFileName(f.originalname);
    saveDocRecord({
      carId: Number(req.params.id), originalName: f.originalname,
      mimeType: f.mimetype, buffer: f.buffer, docDate: parsed ? parsed.docDate : '',
    }, (err) => {
      if (err) failed++;
      if (++done === files.length) res.json({ success: true, uploaded: files.length - failed, failed });
    });
  });
});

// העלאה מרוכזת: הקבצים משויכים אוטומטית לרכב לפי מספר הרכב שבשם הקובץ
app.post('/api/documents/bulk', docUpload.array('files', 60), (req, res) => {
  const files = req.files || [];
  if (!files.length) { res.status(400).json({ error: 'לא נשלחו קבצים' }); return; }

  db.all('SELECT id, vin, manufacturer, model FROM cars', (err, cars) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    const byPlate = new Map(cars.map(c => [String(c.vin), c]));
    const results = [];
    let pending = files.length;
    const finish = () => { if (--pending === 0) res.json({ results }); };

    files.forEach(f => {
      const parsed = parseLicenseFileName(f.originalname);
      if (!parsed) { results.push({ file: f.originalname, status: 'unmatched', reason: 'לא זוהה מספר רכב בשם הקובץ' }); finish(); return; }
      const car = byPlate.get(parsed.plate);
      if (!car) { results.push({ file: f.originalname, status: 'unmatched', plate: parsed.plate, reason: 'מספר הרכב לא נמצא במלאי' }); finish(); return; }
      saveDocRecord({ carId: car.id, originalName: f.originalname, mimeType: f.mimetype, buffer: f.buffer, docDate: parsed.docDate },
        (saveErr) => {
          results.push(saveErr
            ? { file: f.originalname, status: 'error', reason: saveErr.message }
            : { file: f.originalname, status: 'ok', plate: parsed.plate, carId: car.id, car: (car.manufacturer + ' ' + car.model).trim(), docDate: parsed.docDate });
          finish();
        });
    });
  });
});

// צפייה/הורדה של מסמך
app.get('/api/documents/:docId', (req, res) => {
  if (!isValidRecordId(req.params.docId)) { res.status(400).json({ error: 'מזהה לא תקין' }); return; }
  db.get('SELECT * FROM car_documents WHERE id = ?', [req.params.docId], (err, row) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    if (!row) { res.status(404).json({ error: 'המסמך לא נמצא' }); return; }
    // storedName נוצר על ידנו בלבד; מאמתים בכל זאת שאין בו מעבר תיקיות
    const full = path.join(DOCS_DIR, path.basename(row.storedName));
    if (!fsp.existsSync(full)) { res.status(404).json({ error: 'הקובץ חסר בדיסק' }); return; }
    res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline; filename="' + encodeURIComponent(row.fileName || 'document') + '"');
    fsp.createReadStream(full).pipe(res);
  });
});

// מחיקת מסמך - לבעלים בלבד
app.delete('/api/documents/:docId', requireAdmin, (req, res) => {
  if (!isValidRecordId(req.params.docId)) { res.status(400).json({ error: 'מזהה לא תקין' }); return; }
  db.get('SELECT storedName FROM car_documents WHERE id = ?', [req.params.docId], (err, row) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    if (!row) { res.status(404).json({ error: 'המסמך לא נמצא' }); return; }
    db.run('DELETE FROM car_documents WHERE id = ?', [req.params.docId], (delErr) => {
      if (delErr) { res.status(500).json({ error: delErr.message }); return; }
      try { fsp.unlinkSync(path.join(DOCS_DIR, path.basename(row.storedName))); } catch (e) { /* הרשומה נמחקה, הקובץ היתום לא קריטי */ }
      res.json({ success: true });
    });
  });
});

// API: הוסף רכב למלאי
app.post('/api/cars', (req, res) => {
  const { vin, manufacturer, model, year, color, kilometers, currentKm, engine, handNumber, trimLevel, transmission, condition, price, testValidUntil, notes } = req.body;
  const validationError = validateCarPayload({ vin, manufacturer, model, year, color, kilometers, engine, handNumber, trimLevel, transmission, condition, price, testValidUntil, notes });
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  db.run(
    `INSERT INTO cars (vin, manufacturer, model, year, color, kilometers, currentKm, currentKmDate, engine, handNumber, trimLevel, transmission, condition, price, testValidUntil, notes, arrived, govData, govUpdatedAt, addedDate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [vin, manufacturer, model, year, color, kilometers, currentKm || null,
     currentKm ? new Date().toISOString() : null,
     engine, handNumber, trimLevel, transmission, condition, price, testValidUntil, notes,
     req.body.arrived === 0 || req.body.arrived === false ? 0 : 1,
     req.body.govData || null,
     req.body.govData ? new Date().toISOString() : null,
     new Date().toLocaleDateString('he-IL')],
    function (err) {
      if (err) {
        res.status(400).json({ error: err.message });
      } else {
        res.json({ id: this.lastID, success: true });
      }
    }
  );
});

// API: עדכון מחירון לוי יצחק לרכב במלאי. נשמרים המחיר, קוד הדגם ותאריך המחירון,
// כדי שהמלאי ישקף במדויק מתי נמשכה התוצאה האחרונה.
app.post('/api/cars/:id/levi-price', async (req, res) => {
  const id = req.params.id;
  if (!isValidRecordId(id)) {
    res.status(400).json({ error: 'מזהה רכב לא תקין' });
    return;
  }

  const sql = roleOf(req) === 'admin'
    ? 'SELECT id, vin FROM cars WHERE id = ?'
    : 'SELECT id, vin FROM cars WHERE id = ? AND (sold IS NULL OR sold = 0)';
  db.get(sql, [id], async (err, car) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!car) {
      res.status(404).json({ error: 'רכב לא נמצא' });
      return;
    }
    if (!isValidPlateNumber(car.vin)) {
      res.status(400).json({ error: 'לרכב זה אין מספר רכב תקין לעדכון מחירון' });
      return;
    }

    const leviResult = await getLeviVehicleData(car.vin);
    if (leviResult.status !== 200 || !leviResult.payload.success || !leviResult.payload.data.price) {
      res.status(leviResult.status).json(leviResult.payload);
      return;
    }

    const updatedAt = new Date().toISOString();
    const leviPrice = Number(leviResult.payload.data.price);
    const leviModelCode = leviResult.payload.data.modelCode || '';
    const leviPriceDate = updatedAt.slice(0, 10);
    db.run(
      'UPDATE cars SET leviPrice = ?, leviModelCode = ?, leviPriceDate = ?, leviUpdatedAt = ? WHERE id = ?',
      [leviPrice, leviModelCode, leviPriceDate, updatedAt, id],
      (updateErr) => {
        if (updateErr) {
          res.status(500).json({ error: updateErr.message });
          return;
        }
        res.json({
          success: true,
          price: leviPrice,
          modelCode: leviModelCode,
          priceDate: leviPriceDate,
          updatedAt,
          name: leviResult.payload.data.name || ''
        });
      }
    );
  });
});

// API: קבל כל הרכבים
app.get('/api/cars', (req, res) => {
  // משתמש מוגבל לא מקבל בכלל את הרכבים שנמכרו - הארכיון לא נשלח אליו, לא רק מוסתר בממשק
  const sql = roleOf(req) === 'admin'
    ? 'SELECT * FROM cars ORDER BY createdAt DESC'
    : 'SELECT * FROM cars WHERE sold IS NULL OR sold = 0 ORDER BY createdAt DESC';
  db.all(sql, (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows || []);
    }
  });
});

// API: מחק רכב
app.delete('/api/cars/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (!isValidRecordId(id)) {
    res.status(400).json({ error: 'מזהה רכב לא תקין' });
    return;
  }
  db.run('DELETE FROM cars WHERE id = ?', [id], function (err) {
    if (err) {
      res.status(500).json({ error: err.message });
    } else if (this.changes === 0) {
      res.status(404).json({ error: 'רכב לא נמצא' });
    } else {
      res.json({ success: true });
    }
  });
});

// API: עדכון חלקי של רכב קיים - משמש גם לעריכה מלאה וגם לסימון "נמכר"/"החזר למלאי"
// רשימת השדות מוגבלת מראש (whitelist) כדי שלא ניתן יהיה להזריק שמות עמודה שרירותיים ל-SQL
const UPDATABLE_CAR_FIELDS = [
  'currentKm',
  'vin', 'manufacturer', 'model', 'year', 'color', 'kilometers', 'engine',
  'handNumber', 'trimLevel', 'transmission', 'condition', 'price',
  'testValidUntil', 'notes', 'sold', 'soldDate', 'arrived', 'govData'
];

app.put('/api/cars/:id', (req, res) => {
  const id = req.params.id;
  if (!isValidRecordId(id)) {
    res.status(400).json({ error: 'מזהה רכב לא תקין' });
    return;
  }
  if (roleOf(req) !== 'admin' && (Object.prototype.hasOwnProperty.call(req.body, 'sold') || Object.prototype.hasOwnProperty.call(req.body, 'soldDate'))) {
    res.status(403).json({ error: 'אין לך הרשאה להעביר רכב לארכיון' });
    return;
  }
  const updates = {};
  const allowedFields = roleOf(req) === 'admin'
    ? UPDATABLE_CAR_FIELDS
    : UPDATABLE_CAR_FIELDS.filter(key => key !== 'sold' && key !== 'soldDate');
  for (const key of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      updates[key] = req.body[key];
    }
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    res.status(400).json({ error: 'אין שדות תקינים לעדכון' });
    return;
  }
  if (Object.values(updates).some(containsUnsafeText) || (Object.prototype.hasOwnProperty.call(updates, 'vin') && !isValidPlateNumber(updates.vin))) {
    res.status(400).json({ error: 'נתוני הרכב אינם תקינים' });
    return;
  }

  // שינוי הקמ הידני הוא מדידה חדשה - חותמים אותה בתאריך
  if (Object.prototype.hasOwnProperty.call(updates, 'currentKm') && Number(updates.currentKm) > 0) {
    updates.currentKmDate = new Date().toISOString();
    keys.push('currentKmDate');
  }

  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => updates[k]);
  values.push(id);

  const runUpdate = () => {
    db.run(`UPDATE cars SET ${setClause} WHERE id = ?`, values, function (err) {
      if (err) {
        res.status(400).json({ error: err.message });
      } else if (this.changes === 0) {
        res.status(404).json({ error: 'רכב לא נמצא' });
      } else {
        res.json({ success: true, changes: this.changes });
      }
    });
  };

  if (roleOf(req) === 'admin') {
    runUpdate();
    return;
  }

  // משתמש מוגבל: אסור לו לגעת ברכב שכבר בארכיון (כולל להחזיר אותו למלאי), גם אם ינחש מזהה
  db.get('SELECT sold FROM cars WHERE id = ?', [id], (err, row) => {
    if (err) { res.status(500).json({ error: err.message }); return; }
    if (!row) {
      res.status(404).json({ error: 'רכב לא נמצא' });
      return;
    }
    if (Number(row.sold) === 1) {
      res.status(403).json({ error: 'אין לך הרשאה לערוך רכב שנמכר' });
      return;
    }
    runUpdate();
  });
});

// API: Export ל-Excel
app.get('/api/export/excel', (req, res) => {
  const exportSql = roleOf(req) === 'admin'
    ? 'SELECT * FROM cars ORDER BY createdAt DESC'
    : 'SELECT * FROM cars WHERE sold IS NULL OR sold = 0 ORDER BY createdAt DESC';
  db.all(exportSql, async (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('רכבים');

    // Headers
    worksheet.columns = [
      { header: 'מספר רכב', key: 'vin', width: 20 },
      { header: 'יצרן', key: 'manufacturer', width: 15 },
      { header: 'דגם', key: 'model', width: 15 },
      { header: 'שנה', key: 'year', width: 10 },
      { header: 'צבע', key: 'color', width: 15 },
      { header: 'קילומטר', key: 'kilometers', width: 12 },
      { header: 'מנוע (CC)', key: 'engine', width: 12 },
      { header: 'יד', key: 'handNumber', width: 8 },
      { header: 'רמת גימור', key: 'trimLevel', width: 16 },
      { header: 'גיר', key: 'transmission', width: 12 },
      { header: 'מקוריות הרכב', key: 'condition', width: 14 },
      { header: 'מחיר (₪)', key: 'price', width: 12 },
      { header: 'טסט עד', key: 'testValidUntil', width: 15 },
      { header: 'הערות', key: 'notes', width: 25 },
      { header: 'תאריך הוספה', key: 'addedDate', width: 15 }
    ];

    // Add rows
    rows.forEach(row => {
      worksheet.addRow(row);
    });

    // Style header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF667EEA' } };

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="newcar-inventory.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  });
});

// API: Export ל-PDF (רכב ספציפי)
app.get('/api/export/pdf/:id', (req, res) => {
  const id = req.params.id;
  if (!isValidRecordId(id)) {
    res.status(400).json({ error: 'מזהה רכב לא תקין' });
    return;
  }
  const sql = roleOf(req) === 'admin'
    ? 'SELECT * FROM cars WHERE id = ?'
    : 'SELECT * FROM cars WHERE id = ? AND (sold IS NULL OR sold = 0)';
  db.get(sql, [id], (err, car) => {
    if (err || !car) {
      res.status(404).json({ error: 'רכב לא נמצא' });
      return;
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="car-${car.vin}.pdf"`);
    doc.pipe(res);

    // Header
    doc.fontSize(24).font('Helvetica-Bold').text('ניו קאר חדרה', { align: 'center' });
    doc.fontSize(14).text('טופס קבלת רכב', { align: 'center' });
    doc.moveDown();

    // Car details
    const details = [
      ['יצרן', car.manufacturer],
      ['דגם', car.model],
      ['שנה', car.year],
      ['מספר רכב', car.vin],
      ['צבע', car.color],
      ['קילומטר', `${car.kilometers} קילומטר`],
      ['מנוע', `${car.engine} CC`],
      ['יד', car.handNumber || '-'],
      ['רמת גימור', car.trimLevel || '-'],
      ['גיר', car.transmission === 'manual' ? 'ידנית' : 'אוטומטית'],
      ['מקוריות הרכב', car.condition],
      ['מחיר', `₪${parseInt(car.price).toLocaleString()}`],
      ['טסט עד', car.testValidUntil],
      ['הערות', car.notes || '-']
    ];

    doc.fontSize(12);
    details.forEach(([label, value]) => {
      // כתיבה בשורה אחת מונעת שימוש ב-doc.y בזמן שהמנוע עדיין מחשב גלישת טקסט,
      // מצב שגרם ל-NaN והפיל את השרת בייצוא PDF.
      doc.font('Helvetica').text(`${label}: ${value ?? '-'}`, { width: 515, align: 'right' });
      doc.moveDown(0.25);
    });

    doc.moveDown();
    doc.fontSize(10).text(`תאריך הדפסה: ${new Date().toLocaleDateString('he-IL')}`, { align: 'center' });

    doc.end();
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚗 ניו קאר חדרה - Server פתוח על http://localhost:${PORT}`);
  console.log(`📊 Database: ${DB_PATH}`);
  const ips = getLocalNetworkIPs();
  if (ips.length > 0) {
    console.log(`\nלגישה ממחשבים אחרים באותה רשת (WiFi/רשת משרדית), פתחו בדפדפן שם את הכתובת:`);
    ips.forEach(ip => console.log(`   http://${ip}:${PORT}/car-reception.html`));
  }
  console.log('');
});
