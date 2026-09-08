# NewCar — מערכת ניהול מלאי לסוכנות רכב | מסמך העברה מלא

> **מסמך זה נועד להעברה ל-AI אחר לצורך המשך פיתוח.**
> נכתב על ידי Claude בסיום שלב פיתוח. מכיל: סקירה טכנית, החלטות ולקחים, קוד מקור מלא, ותמליל השיחה.

> ⚠️ **הקובץ מכיל סיסמאות אמיתיות של מערכת חיה.** אין לשתף אותו בפומבי, להעלות ל-GitHub או לצרף למקום ציבורי.

**תאריך הפקה:** 26 באוגוסט 2026
**בעל המערכת:** מתן — "ניו קאר חדרה", סוחר רכב יד שנייה
**שפת ממשק:** עברית, RTL

---

## 1. מה המערכת עושה

מערכת ניהול מלאי לסוכנות רכב יד שנייה, המשלבת נתונים אמיתיים ממאגרי משרד התחבורה הפתוחים (data.gov.il). ארבעה מסכים:

| מסך | תפקיד |
|---|---|
| 🔍 **בדיקת רכב** (ברירת מחדל) | מקלידים מספר רכב ומושכים את כל המידע הזמין ממשרד התחבורה **לפני** קנייה. כולל היסטוריית בעלויות מלאה עם משך זמן בכל יד. |
| 📦 **מלאי הרכבים** | חלוניות נפתחות, סינון (יצרן / מספר רכב / מקוריות / טווח מחיר), מיון (א-ב / מחיר / שנה), ייצוא Excel מעוצב, הדפסת טופס ללקוח |
| 📁 **ארכיון** | רכבים שנמכרו. גישה לבעלים בלבד. |
| ➕ **הוספת רכב** | טופס מלא, מילוי אוטומטי לפי מספר רכב, וייבוא Excel המוני |

**מצב נוכחי בפרודקשן:** 48 רכבים במלאי (4 מהם בארכיון), 1,718,316 רכבים במאגר הקילומטראז' הארצי.

---

## 2. גישה ופרטי התחברות

**כתובת:** https://newcar-production.up.railway.app

| משתמש | סיסמה | תפקיד | הרשאות |
|---|---|---|---|
| `newcar` | `Matantn13` | admin (בעלים) | הכל |
| `david` | `111091` | limited (עובד) | ללא מחיקת רכבים, ללא ארכיון |

האימות הוא **HTTP Basic Auth** על כל האתר (כולל הקבצים הסטטיים). הדפדפן שומר את הפרטים; למעבר בין משתמשים באותו מחשב נדרש חלון פרטי.

### הרצה מקומית

```bash
npm install
node server.js     # http://localhost:3001
```

דורש קובץ `.env` (אינו ב-git):

```
SITE_USERNAME=newcar
SITE_PASSWORD=Matantn13
USER2_USERNAME=david
USER2_PASSWORD=111091
# אופציונלי:
# DB_PATH=/data/cars.db      נתיב ל-DB (בענן: volume קבוע)
# ENABLE_NATIONAL_SYNC=1     מפעיל סריקה ארצית יומית (בענן בלבד)
# PORT=3001
```

---

## 3. ארכיטקטורה

```
car-reception.html   (2,614 שורות)  כל ה-Frontend: HTML + CSS + JS וניל בקובץ אחד. אין build step.
server.js            (772 שורות)    Express + SQLite3 + פרוקסי ל-data.gov.il
cars.db                             SQLite (בענן: /data/cars.db על volume קבוע)
images/newcar-logo.png              לוגו (חולץ מ-PDF, רקע שקוף)
package.json
.env                                סודות (gitignored)
```

**עקרונות שהנחו את הבנייה:**

- **ללא framework וללא build** — הבעלים אינו מתכנת. קובץ אחד שנפתח בדפדפן ועובד.
- **localStorage + Backend במקביל** — הלקוח שומר מקומית וגם מסנכרן לשרת. אם השרת נופל, המערכת ממשיכה לעבוד.
- **`API_URL` נגזר מ-`window.location.origin`** — כך שהאתר עובד גם ב-localhost, גם לפי IP ברשת מקומית, וגם בדומיין הענן, בלי לשנות קוד.

### טבלאות SQLite

| טבלה | תוכן |
|---|---|
| `cars` | המלאי. `sold` / `soldDate` מסמנים ארכיון (מחיקה רכה, לא אמיתית) |
| `km_history` | תמונות קמ מבדיקות ידניות שבוצעו במערכת |
| `national_km_latest` | הקמ האחרון הידוע לכל רכב בישראל (1.7M שורות) — לזיהוי שינויים |
| `national_km_history` | היסטוריית שינויי קמ — הערך המצטבר האמיתי |
| `national_sync_log` | לוג ריצות סריקה (הצלחה / כישלון / כמה נסרק) |
| `scan_page` | טבלת עזר זמנית לטעינה קבוצתית בסריקה |
| `ministry_vehicles` | נתוני דמו — fallback כשאין אינטרנט |

### נקודות API

```
GET    /api/me                      מי מחובר ומה ההרשאות
GET    /api/vehicle/:vin            משיכת נתוני רכב ממשרד התחבורה
GET    /api/cars                    מלאי (מסונן לפי הרשאה)
POST   /api/cars                    הוספה
PUT    /api/cars/:id                עדכון (whitelist שדות)
DELETE /api/cars/:id                מחיקה (admin בלבד)
GET    /api/km-history/:vin         היסטוריית קמ מאוחדת (ידני + ארצי)
POST   /api/national-sync           הפעלת סריקה ארצית ידנית
GET    /api/national-sync/status    מצב הסריקה
GET    /api/export/excel            ייצוא
GET    /api/export/pdf/:id          הדפסה
```

---

## 4. מאגרי משרד התחבורה (data.gov.il)

בסיס: `https://data.gov.il/api/3/action/datastore_search?resource_id=<ID>&filters=<JSON>`

| Resource ID | תוכן | מפתח |
|---|---|---|
| `053cea08-09bc-40ec-8f7a-156f0677aff3` | רכבים פרטיים — יצרן, דגם, שנה, צבע, טסט, בעלות, שילדה | `mispar_rechev` |
| `bb2355dc-9ec7-4f06-9c3f-3344672171da` | היסטוריית בעלויות | `mispar_rechev` |
| `56063a99-8a3e-4ff4-912e-5966c0279bad` | קמ בטסט אחרון (2.45M רשומות) | `mispar_rechev` |
| `142afde2-6228-49f9-8a29-9b6c3a0cbe40` | מפרט WLTP — **נפח מנוע**, רמת גימור, אוטומט | `tozeret_cd` + `degem_cd` |

### מלכודות קריטיות (עלו שעות עבודה)

1. **`mispar_rechev` הוא שדה מספרי.** שליחת מחרוזת (`"60541402"`) מחזירה **HTTP 500**. חובה `Number(plateNumber)`. זה היה באג אמיתי שהתחזה ל"המספר לא קיים".

2. **CORS חוסם קריאה ישירה מהדפדפן** — גם מ-`file://` (origin: null) וגם מ-`localhost`. **חייבים** פרוקסי בשרת. זו הסיבה שהשרת הכרחי ולא רק נוחות.

3. **ה-API נופל לסירוגין.** אותה בקשה בדיוק מחזירה פעם 200 ופעם 500. חובה retry. בסריקה מסיבית הם גם **חוסמים זמנית** ומחזירים דף HTML במקום JSON (`Unexpected token '<'`) — ולכן יש השהיה של שנייה בין דפים ו-retry מדורג עד 2 דקות.

4. **נפח מנוע אינו קיים במאגר הבסיסי** — רק במאגר WLTP, ולפי `tozeret_cd` + `degem_cd`, לא לפי מספר רכב.

5. **רכב שנמצא אצל סוחר מציג `baalut: "סוחר"`** — ערך שאינו ממופה לאף קטגוריית מקוריות. הפתרון: `getConditionFromHistory()` מאתר את הבעלות **הראשונה** (המוקדמת ביותר) שאינה סוחר. הבעלים ביקש במפורש ראשונה ולא אחרונה.

---

## 5. הסריקה הארצית של קילומטראז' — הפיצ'ר המרכזי

**הבעיה:** משרד התחבורה מפרסם רק את הקמ מהטסט **האחרון**. אין היסטוריה. סוחר אינו יכול לזהות מד אוץ מזויף.

**הפתרון:** המערכת סורקת כל יום את כל 2.45 מיליון הרכבים ושומרת רק רכבים שהקמ שלהם **השתנה** — כלומר כל רכב שעבר טסט מאז אתמול. עם הזמן נבנית היסטוריה שאינה קיימת בשום מקום אחר.

**איך זה עובד:**

- כל שעה נבדק אם עברו 22+ שעות מהסריקה המוצלחת האחרונה. הגישה הזאת שורדת רסטארטים ודיפלויים — אין תלות בטיימר רציף.
- 245 דפים על 10,000 רשומות כל אחד, עם השהיה של שנייה בין דפים.
- כתיבה קבוצתית דרך טבלת העזר `scan_page` ואז JOIN — הריצה הראשונה (2.4M רשומות) לוקחת דקות ולא שעות.
- **אידמפוטנטי לחלוטין:** סריקה חוזרת על אותם נתונים מייצרת 0 שורות חדשות. נבדק בפועל.

**הוכחת תקינות מהריצה האמיתית:** ריצה שנכשלה באמצע שמרה 530,536 רכבים. הריצה שאחריה הוסיפה 1,187,780. הסכום: **1,718,316 — בדיוק מספר הרכבים במאגר.** אפס כפילויות למרות חפיפה של 750 אלף רכבים.

**הערה חשובה:** בשלב זה לכל רכב יש נקודת מדידה אחת בלבד, ולכן סקשן ההיסטוריה במסך "בדיקת רכב" עדיין אינו מוצג (הוא דורש 2+ נקודות). הוא יופיע בהדרגה ככל שרכבים יעברו טסט.

---

## 6. הרשאות משתמשים

שני תפקידים. **האכיפה מתבצעת בשרת, לא בממשק** — הסתרת כפתורים היא נוחות בלבד וניתנת לעקיפה.

| פעולה | admin | limited |
|---|---|---|
| צפייה במלאי פעיל | ✅ | ✅ |
| בדיקת רכב, הוספה, עריכה, הדפסה | ✅ | ✅ |
| סימון "נמכר" | ✅ | ✅ |
| מחיקת רכב | ✅ | ❌ 403 |
| ארכיון | ✅ | ❌ לא נשלח אליו כלל מה-API |
| עריכת רכב שנמכר | ✅ | ❌ 403 |

נבדק בפועל בניסיונות עקיפה ישירים מול ה-API — כולם נחסמו.

---

## 7. פריסה (Railway)

| | |
|---|---|
| Project | `newcar` — `42080863-d04f-4ae2-bd4c-83fc7f2c37dd` |
| Service | `b5ef2600-19bf-4bb5-999a-d55ab765f727` |
| Volume | `newcar-volume`, mount ב-`/data`, 500MB |
| פקודת פריסה | `railway up --service <id> --detach` |

**עלות בפועל:** כ-1 עד 1.5 דולר לחודש. פילוח: זיכרון 99%, אחסון 0.5%, תעבורה 0.1%. מסקנה חשובה: **גידול המאגר כמעט אינו משפיע על העלות** — הזיכרון הוא הגורם והוא קבוע.

⚠️ **הבעלים אינו צריך להריץ דבר מקומית.** קיים קובץ `הפעל שרת.bat` מתקופה מוקדמת יותר — שימוש בו יוצר מלאי נפרד שאינו מסתנכרן עם הענן. הומלץ לא להשתמש בו.

---

## 8. לקחים ותקלות שכדאי להכיר

1. **`try/catch` סביב `window.location.href` אינו תופס דבר.** כשל ניווט אינו זורק חריגה. זה שבר את ייצוא ה-Excel בשקט. הפתרון: לבנות את הקובץ ישירות מהמערך בזיכרון.

2. **SheetJS החינמי אינו תומך בעיצוב תאים.** לכן ExcelJS משמש לייצוא (צבעים, הקפאת שורה, autofilter) ו-SheetJS רק לקריאת ייבוא. שם הקובץ הנכון ב-CDN הוא `xlsx.full.min.js` — הגרסה `xlsx.min.js` מחזירה 404.

3. **`autoFilter` ב-ExcelJS** דורש `{from:{row,column}, to:{row,column}}`. ערבוב מחרוזת ואובייקט זורק שגיאת "Out of bounds".

4. **מיגרציות SQLite:** `CREATE TABLE IF NOT EXISTS` יחד עם `ALTER TABLE ADD COLUMN` עטוף בהתעלמות משגיאת "duplicate column". תקלה אמיתית שקרתה: הוספת עמודה ל-`CREATE TABLE` בלי `ALTER` מקביל הפילה את השרת בהפעלה הבאה.

5. **תהליכי רקע של Claude Code מתים בסוף הסשן.** לכן שרת מקומי אינו פתרון אמיתי — זו הסיבה למעבר לענן.

6. **iOS מבצע זום אוטומטי בכל שדה עם `font-size` קטן מ-16px.** תוקן גלובלית. זו הבעיה הכי מציקה במובייל והכי קלה לפספס.

7. **מטמון הדפדפן מטעה בבדיקות.** במהלך פיתוח CSS הדפדפן הגיש גרסה ישנה והבדיקה "נכשלה" ללא סיבה אמיתית. תמיד יש לוודא שהקוד הנבדק אכן נטען.

---

## 9. מה עדיין לא נעשה — כיווני שיפור

הבעלים מעביר את המסמך הזה כדי שתמשיך מכאן. להלן פערים ידועים:

**אבטחה**

- אין הגבלת קצב על ניסיונות התחברות. הסיסמה `111091` היא בת 6 ספרות (מיליון אפשרויות) וניתנת לניחוש שיטתי. הוצע להוסיף חסימה אוטומטית והבעלים בחר להשאיר כפי שהוא — שווה להעלות שוב.
- אין אכיפת HTTPS או ניהול session (Basic Auth בלבד).

**נתונים ופיצ'רים**

- **שדה "מחיר מחירון" וחישובי רווח** — הוצע ולא מומש: פער מול מחיר קנייה, רווח באחוזים, סימון צבעוני לרכבים מתחת/מעל מחירון, וסינון לפיהם.
- אין דוחות או סטטיסטיקות: רווח חודשי, זמן ממוצע במלאי, ביצועים לפי יצרן.
- אין העלאת תמונות לרכב.
- אין ניהול לקוחות או לידים.
- הארכיון אינו שומר את מחיר המכירה בפועל, רק תאריך — ולכן אי אפשר לחשב רווח אמיתי. **זה פער משמעותי.**
- **התראה על טסט שעומד לפוג** — הנתון קיים במערכת ואינו מנוצל.
- ניצול המאגר הארצי: אפשר להתריע בזמן בדיקה "הרכב צבר 45,000 ק"מ בשנה — חריג".

**טכני**

- `car-reception.html` הוא קובץ יחיד בן 2,614 שורות. עובד, אך קשה לתחזוקה.
- אין בדיקות אוטומטיות כלל.
- אין גיבוי אוטומטי של `cars.db`. הוצע גיבוי יומי ל-OneDrive.
- מדד גודל ה-volume ב-Railway מתעדכן באיחור. כשהמאגר יתקרב ל-500MB יש להגדיל ידנית בדשבורד.

---

## 10. קוד מקור מלא

### 10.1 `package.json`

```json
{
  "name": "newcar-app",
  "version": "1.0.0",
  "description": "ניו קאר - מערכת ניהול קבלת רכבים",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "body-parser": "^1.20.2",
    "cors": "^2.8.5",
    "dotenv": "^17.4.2",
    "exceljs": "^4.3.0",
    "express": "^4.18.2",
    "express-basic-auth": "^1.2.1",
    "pdfkit": "^0.13.0",
    "sqlite3": "^5.1.6"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}

```

### 10.2 `server.js`

```javascript
require('dotenv').config();
const express = require('express');
const basicAuth = require('express-basic-auth');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const os = require('os');

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

// Middleware
app.use(basicAuth({
  users: AUTH_USERS,
  challenge: true,
  realm: 'NewCar',
}));
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));
app.get('/', (req, res) => res.redirect('/car-reception.html'));

// API: מי המשתמש המחובר ומה ההרשאות שלו (הממשק מסתיר לפי זה את מה שאסור לו)
app.get('/api/me', (req, res) => {
  const role = roleOf(req);
  res.json({
    user: req.auth ? req.auth.user : '',
    role,
    canDelete: role === 'admin',
    canViewArchive: role === 'admin'
  });
});

// Database initialization
// DB_PATH מאפשר להצביע על דיסק קבוע (למשל volume בענן) בלי לשנות קוד - כברירת מחדל נשאר מקומי כמו קודם
const DB_PATH = process.env.DB_PATH || './cars.db';
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error(err.message);
  else console.log('✓ מחובר ל-Database');
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
      kilometers INTEGER
    )
  `);

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
function getConditionFromHistory(historyRecords) {
  const sortedAsc = [...historyRecords].sort((a, b) => (a.baalut_dt || 0) - (b.baalut_dt || 0));
  const firstNonDealer = sortedAsc.find(r => r.baalut && !r.baalut.includes('סוחר'));
  return firstNonDealer ? mapBaalutToCondition(firstNonDealer.baalut) : '';
}

// מחשב "יד" מתוך היסטוריית העברות הבעלות: סופר שינויי בעלות ייחודיים ומדלג על "סוחר"
function calculateHandNumber(historyRecords) {
  const sorted = [...historyRecords].sort((a, b) => (a.baalut_dt || 0) - (b.baalut_dt || 0));
  const nonDealer = sorted.filter(r => r.baalut && !r.baalut.includes('סוחר'));
  let count = 0;
  let lastBaalut = null;
  nonDealer.forEach(r => {
    if (r.baalut !== lastBaalut) {
      count++;
      lastBaalut = r.baalut;
    }
  });
  return count || '';
}

// שאילתה משולבת מול 4 מאגרי הנתונים הפתוחים הרלוונטיים של משרד התחבורה (data.gov.il):
// 1) רישום בסיסי לפי מספר רכב | 2) מפרט טכני לפי דגם (נפח מנוע, גיר) | 3) היסטוריית בעלויות (למספר יד) | 4) ק"מ בטסט האחרון
async function fetchFromGovApi(plateNumber) {
  const baseUrl = 'https://data.gov.il/api/3/action/datastore_search';

  const vehicleRes = await fetch(`${baseUrl}?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: Number(plateNumber) }))}`);
  const vehicleJson = await vehicleRes.json();
  if (!vehicleJson.success || vehicleJson.result.records.length === 0) return null;
  const vehicle = vehicleJson.result.records[0];

  const data = {
    vin: plateNumber,
    manufacturer: vehicle.tozeret_nm || '',
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
    if (!data.condition) {
      data.condition = getConditionFromHistory(historyRecords);
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

// API: קבל נתונים לפי מספר רכב - קודם ה-API האמיתי של משרד התחבורה (data.gov.il),
// ורק אם זה נכשל (אין אינטרנט וכו') נופלים לבסיס הנתונים המקומי לדוגמה
app.get('/api/vehicle/:vin', async (req, res) => {
  const plateNumber = req.params.vin.trim();

  try {
    const data = await fetchFromGovApi(plateNumber);
    if (data) {
      res.json({ success: true, data, source: 'gov.il' });
      saveKmSnapshot(plateNumber, data);
      return;
    }
  } catch (e) {
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

    res.json({ success: false, message: 'מספר רכב לא נמצא' });
  });
});

// API: היסטוריית קמ לרכב - איחוד של שני מקורות: הסריקה הארצית היומית + תמונות מצב מבדיקות ידניות במערכת.
// כפילויות עוקבות של אותו קמ (רכב שנצפה בשני המקורות) מסוננות
app.get('/api/km-history/:vin', (req, res) => {
  const plateNumber = req.params.vin.trim();
  db.all(
    `SELECT kilometers, checkedAt FROM km_history WHERE vin = ?
     UNION ALL
     SELECT kilometers, seenAt AS checkedAt FROM national_km_history WHERE mispar_rechev = ?
     ORDER BY checkedAt ASC`,
    [plateNumber, Number(plateNumber)],
    (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      const deduped = [];
      for (const row of rows || []) {
        if (deduped.length && Number(deduped[deduped.length - 1].kilometers) === Number(row.kilometers)) continue;
        deduped.push(row);
      }
      res.json(deduped);
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
        const placeholders = chunk.map(() => '(?, ?)').join(',');
        const params = [];
        chunk.forEach(r => params.push(Number(r.mispar_rechev), Number(r.kilometer_test_aharon)));
        db.run(`INSERT INTO scan_page (mispar_rechev, kilometers) VALUES ${placeholders}`, params);
      }

      let changedInPage = 0;
      db.run(
        `INSERT INTO national_km_history (mispar_rechev, kilometers, seenAt)
         SELECT s.mispar_rechev, s.kilometers, ?
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
app.post('/api/national-sync', (req, res) => {
  if (nationalSyncRunning) {
    res.json({ started: false, reason: 'סריקה כבר רצה כרגע' });
    return;
  }
  const maxPages = req.query.pages ? Number(req.query.pages) : null;
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

// API: הוסף רכב למלאי
app.post('/api/cars', (req, res) => {
  const { vin, manufacturer, model, year, color, kilometers, engine, handNumber, trimLevel, transmission, condition, price, testValidUntil, notes } = req.body;

  db.run(
    `INSERT INTO cars (vin, manufacturer, model, year, color, kilometers, engine, handNumber, trimLevel, transmission, condition, price, testValidUntil, notes, addedDate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [vin, manufacturer, model, year, color, kilometers, engine, handNumber, trimLevel, transmission, condition, price, testValidUntil, notes, new Date().toLocaleDateString('he-IL')],
    function (err) {
      if (err) {
        res.status(400).json({ error: err.message });
      } else {
        res.json({ id: this.lastID, success: true });
      }
    }
  );
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
  db.run('DELETE FROM cars WHERE id = ?', [id], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ success: true });
    }
  });
});

// API: עדכון חלקי של רכב קיים - משמש גם לעריכה מלאה וגם לסימון "נמכר"/"החזר למלאי"
// רשימת השדות מוגבלת מראש (whitelist) כדי שלא ניתן יהיה להזריק שמות עמודה שרירותיים ל-SQL
const UPDATABLE_CAR_FIELDS = [
  'vin', 'manufacturer', 'model', 'year', 'color', 'kilometers', 'engine',
  'handNumber', 'trimLevel', 'transmission', 'condition', 'price',
  'testValidUntil', 'notes', 'sold', 'soldDate'
];

app.put('/api/cars/:id', (req, res) => {
  const id = req.params.id;
  const updates = {};
  for (const key of UPDATABLE_CAR_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(req.body, key)) {
      updates[key] = req.body[key];
    }
  }

  const keys = Object.keys(updates);
  if (keys.length === 0) {
    res.status(400).json({ error: 'אין שדות תקינים לעדכון' });
    return;
  }

  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const values = keys.map(k => updates[k]);
  values.push(id);

  const runUpdate = () => {
    db.run(`UPDATE cars SET ${setClause} WHERE id = ?`, values, function (err) {
      if (err) {
        res.status(400).json({ error: err.message });
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
    if (row && Number(row.sold) === 1) {
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
  db.get('SELECT * FROM cars WHERE id = ?', [id], (err, car) => {
    if (err || !car) {
      res.status(404).json({ error: 'רכב לא נמצא' });
      return;
    }

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const filename = `car-${car.id}-${Date.now()}.pdf`;
    const filepath = path.join(__dirname, filename);

    doc.pipe(fs.createWriteStream(filepath));

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
      doc.font('Helvetica-Bold').text(label + ':', 60, { width: 150 });
      doc.font('Helvetica').text(value, 200, doc.y - 14, { width: 300 });
      doc.moveDown(0.5);
    });

    doc.moveDown();
    doc.fontSize(10).text(`תאריך הדפסה: ${new Date().toLocaleDateString('he-IL')}`, { align: 'center' });

    doc.end();

    doc.on('finish', () => {
      res.download(filepath, `car-${car.vin}.pdf`, (err) => {
        if (err) console.error(err);
        fs.unlinkSync(filepath);
      });
    });
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

```

### 10.3 `car-reception.html`

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>ניו קאר - טופס קבלת רכב</title>
  <link rel="icon" type="image/png" href="images/newcar-logo.png">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      background: #f2f3f5;
      min-height: 100vh;
      padding: 20px;
      direction: rtl;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    header {
      text-align: center;
      color: #2d2d2d;
      margin-bottom: 40px;
      padding-top: 20px;
    }

    header h1 {
      font-size: 2.5em;
      margin-bottom: 10px;
    }

    header .app-logo {
      max-width: 280px;
      width: 100%;
      height: auto;
      margin-bottom: 12px;
      filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.12));
    }

    header p {
      font-size: 1.1em;
      color: #666;
    }

    .main-nav {
      display: flex;
      gap: 12px;
      justify-content: center;
      margin-bottom: 30px;
    }

    .main-nav-btn {
      padding: 14px 32px;
      border: none;
      border-radius: 10px;
      background: white;
      color: #333;
      font-size: 1.05em;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
      transition: all 0.2s;
    }

    .main-nav-btn:hover:not(.active) {
      background: #f5f5f5;
    }

    .main-nav-btn.active {
      background: #c0392b;
      color: white;
      box-shadow: 0 4px 14px rgba(192, 57, 43, 0.35);
    }

    .screen {
      display: none;
      margin-bottom: 40px;
    }

    .screen.active {
      display: block;
    }

    #screen-add .form-section {
      max-width: 720px;
      margin: 0 auto;
    }

    .check-results-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 25px;
    }

    @media (max-width: 600px) {
      .check-results-grid {
        grid-template-columns: 1fr;
      }
    }

    .check-result-item {
      background: #f8f9fa;
      border: 1px solid #eee;
      border-radius: 8px;
      padding: 12px 15px;
    }

    .check-result-label {
      font-size: 0.8em;
      color: #888;
      margin-bottom: 4px;
    }

    .check-result-value {
      font-size: 1.05em;
      font-weight: 600;
      color: #333;
    }

    .check-history-title {
      font-size: 1.1em;
      font-weight: 700;
      color: #333;
      margin: 25px 0 12px;
      border-bottom: 2px solid #c0392b;
      padding-bottom: 8px;
    }

    .check-history-timeline {
      position: relative;
      padding-right: 20px;
      border-right: 2px solid #ddd;
    }

    .check-history-entry {
      position: relative;
      padding-bottom: 18px;
    }

    .check-history-entry::before {
      content: '';
      position: absolute;
      right: -26px;
      top: 4px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #c0392b;
    }

    .check-history-entry.dealer::before {
      background: #aaa;
    }

    .check-history-date {
      font-size: 0.85em;
      color: #888;
    }

    .check-history-status {
      font-weight: 600;
      color: #333;
    }

    .filters-bar {
      display: grid;
      grid-template-columns: repeat(5, 1fr) auto;
      gap: 12px;
      align-items: end;
      background: #f8f9fa;
      border: 1px solid #eee;
      border-radius: 10px;
      padding: 15px;
      margin-bottom: 20px;
    }

    @media (max-width: 1100px) {
      .filters-bar {
        grid-template-columns: repeat(3, 1fr);
      }
    }

    @media (max-width: 800px) {
      .filters-bar {
        grid-template-columns: 1fr 1fr;
      }
    }

    .filter-group label {
      font-size: 0.85em;
      margin-bottom: 4px;
    }

    .filter-group-range {
      display: flex;
      gap: 6px;
    }

    .filters-bar select,
    .filters-bar input {
      padding: 9px 10px;
      font-size: 0.95em;
    }

    #inventoryCount {
      color: #666;
      font-size: 0.9em;
      margin-bottom: 15px;
    }

    .form-section, .inventory-section {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    }

    .form-section h2, .inventory-section h2 {
      color: #333;
      margin-bottom: 20px;
      font-size: 1.5em;
      border-bottom: 3px solid #c0392b;
      padding-bottom: 10px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      color: #333;
      font-weight: 600;
      font-size: 0.95em;
    }

    input[type="text"],
    input[type="number"],
    input[type="date"],
    input[type="email"],
    input[type="tel"],
    select,
    textarea {
      width: 100%;
      padding: 12px;
      border: 2px solid #ddd;
      border-radius: 8px;
      font-size: 1em;
      transition: border-color 0.3s;
      font-family: inherit;
    }

    input:focus,
    select:focus,
    textarea:focus {
      outline: none;
      border-color: #c0392b;
      box-shadow: 0 0 0 3px rgba(192, 57, 43, 0.12);
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 15px;
    }

    .form-row.full {
      grid-template-columns: 1fr;
    }

    .form-group.full {
      grid-column: 1 / -1;
    }

    textarea {
      resize: vertical;
      min-height: 80px;
    }

    .btn {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 1em;
      cursor: pointer;
      font-weight: 600;
      transition: all 0.3s;
      display: inline-block;
    }

    .btn-primary {
      background: #c0392b;
      color: white;
    }

    .btn-primary:hover {
      background: #a12e20;
      transform: translateY(-2px);
      box-shadow: 0 5px 15px rgba(192, 57, 43, 0.4);
    }

    .btn-secondary {
      background: #f0f0f0;
      color: #333;
    }

    .btn-secondary:hover {
      background: #e0e0e0;
    }

    .btn-success {
      background: #48bb78;
      color: white;
    }

    .btn-success:hover {
      background: #38a169;
    }

    .btn-danger {
      background: #f56565;
      color: white;
    }

    .btn-danger:hover {
      background: #e53e3e;
    }

    .btn-print {
      background: #4299e1;
      color: white;
    }

    .btn-print:hover {
      background: #3182ce;
    }

    .btn-full {
      width: 100%;
    }

    .button-group {
      display: flex;
      gap: 10px;
      margin-top: 20px;
      flex-wrap: wrap;
    }

    .car-item {
      background: #f8f9fa;
      border: 2px solid #ddd;
      border-radius: 8px;
      padding: 15px;
      margin-bottom: 15px;
      transition: all 0.3s;
    }

    .car-item:hover {
      border-color: #c0392b;
      box-shadow: 0 4px 12px rgba(192, 57, 43, 0.2);
    }

    .car-item-header {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      margin-bottom: 10px;
      gap: 10px;
      cursor: pointer;
    }

    @media (max-width: 700px) {
      .car-item-header {
        grid-template-columns: 1fr;
      }
    }

    .car-item-titlebox {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }

    .car-item-title {
      font-weight: 600;
      color: #333;
      font-size: 1.1em;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .car-item-meta {
      font-size: 0.85em;
      color: #888;
      font-weight: 500;
      padding-right: 22px;
    }

    .car-item-chevron {
      display: inline-block;
      color: #c0392b;
      font-size: 0.8em;
      transition: transform 0.2s;
    }

    .car-item-chevron.open {
      transform: rotate(90deg);
    }

    .car-item-actions {
      display: flex;
      gap: 8px;
    }

    .car-item-actions button {
      padding: 6px 12px;
      font-size: 0.9em;
    }

    .car-details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin-top: 10px;
    }

    .car-detail {
      font-size: 0.9em;
      color: #555;
    }

    .car-detail-label {
      font-weight: 600;
      color: #333;
    }

    .success-message {
      background: #c6f6d5;
      border: 2px solid #48bb78;
      color: #22543d;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: none;
    }

    .success-message.show {
      display: block;
    }

    .error-message {
      background: #fed7d7;
      border: 2px solid #f56565;
      color: #742a2a;
      padding: 15px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: none;
    }

    .error-message.show {
      display: block;
    }

    .empty-state {
      text-align: center;
      color: #999;
      padding: 40px 20px;
    }

    .empty-state svg {
      width: 60px;
      height: 60px;
      margin-bottom: 15px;
      opacity: 0.5;
    }

    .print-section {
      display: none;
      background: white;
      padding: 40px;
      border-radius: 12px;
      margin-top: 40px;
    }

    @media print {
      body {
        background: white;
      }
      .print-section {
        display: block !important;
        box-shadow: none;
      }
      .form-section, .inventory-section, .no-print {
        display: none !important;
      }
      .print-section {
        margin: 0;
        padding: 0;
      }
    }

    .print-header {
      text-align: center;
      margin-bottom: 30px;
      border-bottom: 3px solid #333;
      padding-bottom: 20px;
    }

    .print-header h1 {
      font-size: 2em;
      margin-bottom: 5px;
    }

    .print-header .print-logo {
      max-width: 220px;
      width: 100%;
      height: auto;
      margin-bottom: 8px;
    }

    .print-header p {
      font-size: 1em;
      color: #666;
    }

    @media print {
      .print-header .print-logo {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }

    .print-content {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      margin-bottom: 30px;
    }

    .print-content > div {
      page-break-inside: avoid;
    }

    .print-field {
      margin-bottom: 15px;
    }

    .print-field-label {
      font-weight: 600;
      color: #333;
      font-size: 0.9em;
    }

    .print-field-value {
      font-size: 1.1em;
      color: #666;
      border-bottom: 1px solid #ddd;
      padding-top: 5px;
      min-height: 25px;
    }

    .print-footer {
      margin-top: 40px;
      text-align: center;
      border-top: 1px solid #ddd;
      padding-top: 20px;
      font-size: 0.9em;
      color: #666;
    }

    .tabs {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
      border-bottom: 2px solid #ddd;
    }

    .tab-btn {
      padding: 10px 20px;
      border: none;
      background: transparent;
      cursor: pointer;
      font-size: 1em;
      color: #666;
      border-bottom: 3px solid transparent;
      transition: all 0.3s;
    }

    .tab-btn.active {
      color: #c0392b;
      border-bottom-color: #c0392b;
    }

    .tab-content {
      display: none;
    }

    .tab-content.active {
      display: block;
    }

    .quick-entry-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }

    .quick-entry-table th,
    .quick-entry-table td {
      padding: 10px;
      text-align: right;
      border: 1px solid #ddd;
    }

    .quick-entry-table th {
      background: #f0f0f0;
      font-weight: 600;
    }

    .quick-entry-table input {
      width: 100%;
      padding: 6px;
      border: 1px solid #ddd;
    }

    /* ==================== התאמה למובייל (אייפון/אנדרואיד) ==================== */

    /* חיוני לאייפון: כל שדה קלט חייב להיות לפחות 16px, אחרת iOS מזגזג ומזמזם אוטומטית
       (zoom) בכל לחיצה על שדה ומשאיר את המסך מוגדל. חל בכל הגדלים, לא רק במובייל. */
    input[type="text"],
    input[type="number"],
    input[type="date"],
    input[type="email"],
    input[type="tel"],
    select,
    textarea,
    .filters-bar select,
    .filters-bar input,
    .quick-entry-table input {
      font-size: 16px;
    }

    html {
      /* מונע מ-iOS לנפח טקסט מעצמו כשמסובבים לרוחב */
      -webkit-text-size-adjust: 100%;
    }

    body {
      /* משטח נגיעה נקי בלי ריבוע אפור בלחיצה */
      -webkit-tap-highlight-color: rgba(192, 57, 43, 0.15);
      /* שומר על תוכן מחוץ לאזור ה"מגרעת" והפס התחתון באייפון */
      padding-left: max(20px, env(safe-area-inset-left));
      padding-right: max(20px, env(safe-area-inset-right));
      padding-bottom: max(20px, env(safe-area-inset-bottom));
    }

    @media (max-width: 768px) {
      body {
        /* פחות שוליים = יותר מקום לתוכן במסך צר */
        padding: 12px;
        padding-left: max(12px, env(safe-area-inset-left));
        padding-right: max(12px, env(safe-area-inset-right));
        padding-bottom: max(12px, env(safe-area-inset-bottom));
      }

      header {
        margin-bottom: 20px;
        padding-top: 8px;
      }

      header .app-logo {
        max-width: 190px;
      }

      header p {
        font-size: 0.95em;
      }

      /* ניווט: 2x2 במקום שורה אחת דחוסה שבה הטקסט נשבר לשלוש שורות */
      .main-nav {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-bottom: 20px;
      }

      .main-nav-btn {
        padding: 14px 8px;
        font-size: 0.95em;
        min-height: 52px;
      }

      .form-section,
      .inventory-section {
        padding: 18px 15px;
        border-radius: 10px;
      }

      .form-section h2,
      .inventory-section h2 {
        font-size: 1.25em;
      }

      /* שדות טופס אחד מתחת לשני - שתי עמודות צרות מדי לטלפון */
      .form-row {
        grid-template-columns: 1fr;
        gap: 0;
      }

      .filters-bar {
        grid-template-columns: 1fr;
        padding: 12px;
      }

      /* פרטי רכב בעמודה אחת - קריא יותר מאשר שתי עמודות דחוסות */
      .car-details {
        grid-template-columns: 1fr;
      }

      /* כפתורי פעולה: רשת 2x2 עם שטח נגיעה מלא במקום שורה של כפתורים זעירים */
      .car-item-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        margin-top: 12px;
      }

      .car-item-actions button {
        padding: 12px 8px;
        font-size: 0.9em;
        min-height: 44px;
      }

      /* כפתורים ראשיים ברוחב מלא - קל יותר לפגוע באגודל */
      .button-group {
        flex-direction: column;
      }

      .button-group .btn {
        width: 100%;
      }

      .btn {
        min-height: 46px;
      }

      .car-item-title {
        font-size: 1.05em;
      }

      .check-history-timeline {
        padding-right: 16px;
      }
    }

    /* מסכים צרים במיוחד (אייפונים ישנים/קטנים - 320px). ב-375px ומעלה עדיין נוח בשתי עמודות */
    @media (max-width: 360px) {
      .main-nav-btn {
        font-size: 0.85em;
        padding: 12px 4px;
      }

      .car-item-actions {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js"></script>
  <style>
    .export-btn {
      background: #48bb78;
      color: white;
      padding: 10px 15px;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.9em;
      margin-top: 10px;
    }
    .export-btn:hover {
      background: #38a169;
    }
  </style>

  <!-- API Configuration -->
  <script>
    // Check if backend is available
    // כתובת ה-API נגזרת מהכתובת שממנה נטען הדף עצמו - כך שהאתר יעבוד גם כשניגשים אליו
    // ממחשב אחר ברשת (לפי כתובת ה-IP של המחשב שמריץ את השרת), לא רק מ-localhost
    const API_URL = (window.location.origin && window.location.origin.indexOf('http') === 0)
      ? window.location.origin + '/api'
      : 'http://localhost:3001/api';

    async function checkBackend() {
      try {
        const response = await fetch(API_URL + '/cars', { mode: 'cors' });
        if (response.ok) {
          console.log('✓ Backend מחובר');
          return true;
        }
      } catch (e) {
        console.log('⚠️ Backend לא זמין - משתמש ב-localStorage');
        return false;
      }
    }

    // שולף את המלאי המשותף מהשרת (המקור האמיתי כשכמה מחשבים עובדים על אותו שרת) ומרענן את התצוגה.
    // נכשל בשקט אם אין חיבור לשרת - במקרה כזה ממשיכים לעבוד עם מה שנשמר מקומית (localStorage)
    async function syncFromBackend() {
      try {
        const response = await fetch(`${API_URL}/cars`, { mode: 'cors' });
        if (!response.ok) return false;
        const backendCars = await response.json();
        if (!Array.isArray(backendCars)) return false;
        cars = backendCars;
        saveCars();
        renderInventory();
        renderArchive();
        return true;
      } catch (e) {
        return false;
      }
    }
  </script>

  <div class="container">
    <header class="no-print">
      <img src="images/newcar-logo.png" alt="NEW CAR - הדרך הנכונה לרכב חדש" class="app-logo">
      <p>מערכת ניהול קבלת רכבים</p>
    </header>

    <div class="main-nav no-print">
      <button class="main-nav-btn active" data-screen="screen-check">🔍 בדיקת רכב</button>
      <button class="main-nav-btn" data-screen="screen-inventory">📦 מלאי הרכבים</button>
      <button class="main-nav-btn" data-screen="screen-archive">📁 ארכיון (נמכרו)</button>
      <button class="main-nav-btn" data-screen="screen-add">➕ הוספת רכב</button>
    </div>

    <!-- Screen: Check Vehicle (בדיקת רכב לפני קנייה) -->
    <div id="screen-check" class="screen active no-print">
      <div class="form-section" style="max-width: 750px; margin: 0 auto;">
        <h2>🔍 בדיקת רכב לפני קנייה</h2>
        <p style="color: #666; margin-bottom: 20px;">הכנס מספר רכב וקבל את כל המידע הזמין ממשרד התחבורה - לפני שאתה קונה</p>

        <div class="form-row full">
          <div class="form-group full">
            <label for="checkVin">מספר רכב</label>
            <input type="text" id="checkVin" inputmode="numeric" placeholder="לדוגמה: 12345678">
          </div>
        </div>

        <button class="btn btn-primary btn-full" id="checkVinBtn">🔍 בדוק רכב</button>
        <small id="checkStatus" style="color: #666; display: block; margin-top: 10px; text-align: center;"></small>

        <div id="checkResults" style="display: none; margin-top: 25px;"></div>
      </div>
    </div>

    <!-- Screen: Inventory -->
    <div id="screen-inventory" class="screen no-print">
      <div class="inventory-section">
        <h2>📦 המלאי שלי</h2>

        <div class="filters-bar">
          <div class="filter-group">
            <label for="filterManufacturer">יצרן</label>
            <select id="filterManufacturer">
              <option value="">כל היצרנים</option>
            </select>
          </div>
          <div class="filter-group">
            <label for="filterVin">מספר רכב</label>
            <input type="text" id="filterVin" placeholder="חיפוש לפי מספר רכב">
          </div>
          <div class="filter-group">
            <label for="filterCondition">מקוריות</label>
            <select id="filterCondition">
              <option value="">הכל</option>
              <option value="private">פרטי</option>
              <option value="taxi">מונית</option>
              <option value="rental">השכרה</option>
              <option value="company">חברה</option>
              <option value="lease">ליסינג</option>
              <option value="lease_zero">ליסינג 0 ק"מ</option>
            </select>
          </div>
          <div class="filter-group">
            <label>טווח מחיר (₪) - תקציב</label>
            <div class="filter-group-range">
              <input type="number" id="filterPriceMin" placeholder="מ-" min="0">
              <input type="number" id="filterPriceMax" placeholder="עד" min="0">
            </div>
          </div>
          <div class="filter-group">
            <label for="sortBy">מיין לפי</label>
            <select id="sortBy">
              <option value="manufacturer_asc">יצרן (א-ב)</option>
              <option value="manufacturer_desc">יצרן (ב-א)</option>
              <option value="price_asc">מחיר (נמוך לגבוה)</option>
              <option value="price_desc">מחיר (גבוה לנמוך)</option>
              <option value="year_desc">שנה (חדש לישן)</option>
              <option value="year_asc">שנה (ישן לחדש)</option>
            </select>
          </div>
          <button class="btn btn-secondary" id="clearFiltersBtn">נקה סינון</button>
        </div>

        <p id="inventoryCount"></p>

        <div class="button-group" style="margin-bottom: 20px;">
          <button class="export-btn" id="exportExcelBtn" style="flex: 1;">📥 יצוא ל-Excel</button>
          <button class="btn btn-print" id="enrichAllBtn" style="flex: 1;">🔄 השלם נתונים חסרים לכולם</button>
        </div>
        <div id="inventoryList" class="empty-state">
          <p>אין רכבים ברשימה. התחל בהוספת רכב חדש.</p>
        </div>
      </div>
    </div>

    <!-- Screen: Archive (רכבים שנמכרו) -->
    <div id="screen-archive" class="screen no-print">
      <div class="inventory-section">
        <h2>📁 ארכיון רכבים שנמכרו</h2>

        <div class="form-row full" style="margin-bottom: 15px;">
          <div class="form-group full">
            <label for="archiveSearch">חיפוש בארכיון</label>
            <input type="text" id="archiveSearch" placeholder="חיפוש לפי מספר רכב, יצרן או דגם">
          </div>
        </div>

        <p id="archiveCount"></p>

        <div id="archiveList" class="empty-state">
          <p>אין עדיין רכבים בארכיון. רכבים שיסומנו כ"נמכר" יופיעו כאן.</p>
        </div>
      </div>
    </div>

    <!-- Screen: Add Car -->
    <div id="screen-add" class="screen no-print">
      <!-- Form Section -->
      <div class="form-section">
        <div class="success-message" id="successMsg">✓ הרכב נשמר בהצלחה!</div>
        <div class="error-message" id="errorMsg"></div>

        <div class="tabs">
          <button class="tab-btn active" data-tab="detailed-form">טופס מלא</button>
          <button class="tab-btn" data-tab="quick-entry">כניסה מהירה</button>
          <button class="tab-btn" data-tab="import-excel">📥 ייבוא מ-Excel</button>
        </div>

        <!-- Detailed Form Tab -->
        <div id="detailed-form" class="tab-content active">
          <h2>קבלת רכב</h2>

          <form id="carForm">
            <div class="form-row">
              <div class="form-group">
                <label for="vin">מספר רכב <button type="button" class="btn" id="fetchVinDataBtn" style="padding: 5px 10px; font-size: 0.85em; background: #4299e1; color: white; border: none; border-radius: 5px; cursor: pointer; margin-right: 10px;">🔄 קבל נתונים</button></label>
                <input type="text" id="vin" inputmode="numeric" placeholder="לדוגמה: 12345678">
                <small id="vinStatus" style="color: #666; display: block; margin-top: 5px;"></small>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="manufacturer">*יצרן</label>
                <input type="text" id="manufacturer" placeholder="לדוגמה: BMW">
              </div>
              <div class="form-group">
                <label for="model">*דגם</label>
                <input type="text" id="model" placeholder="לדוגמה: X5">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="year">*שנה</label>
                <input type="number" id="year" min="1990" max="2099" placeholder="2023">
              </div>
              <div class="form-group">
                <label for="color">*צבע</label>
                <input type="text" id="color" placeholder="לדוגמה: שחור מטאליק">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="kilometers">*קילומטר</label>
                <input type="number" id="kilometers" min="0" placeholder="50000">
              </div>
              <div class="form-group">
                <label for="engine">*נפח מנוע (CC)</label>
                <input type="number" id="engine" placeholder="2000">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="handNumber">יד (לא כולל סוחרים)</label>
                <input type="number" id="handNumber" min="1" placeholder="לדוגמה: 2">
              </div>
              <div class="form-group">
                <label for="trimLevel">רמת גימור</label>
                <input type="text" id="trimLevel" placeholder="לדוגמה: EXECUTIVE">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="transmission">*תיבת הילוכים</label>
                <select id="transmission">
                  <option value="">בחר...</option>
                  <option value="manual">ידנית</option>
                  <option value="automatic">אוטומטית</option>
                  <option value="cvt">CVT</option>
                </select>
              </div>
              <div class="form-group">
                <label for="condition">*מקוריות הרכב</label>
                <select id="condition" required>
                  <option value="">בחר...</option>
                  <option value="private">פרטי</option>
                  <option value="taxi">מונית</option>
                  <option value="rental">השכרה</option>
                  <option value="company">חברה</option>
                  <option value="lease">ליסינג</option>
                  <option value="lease_zero">ליסינג 0 ק"מ</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="price">*מחיר נדרש (₪)</label>
                <input type="number" id="price" required min="0" placeholder="50000">
              </div>
              <div class="form-group">
                <label for="testValidUntil">*טסט עד מתי</label>
                <input type="date" id="testValidUntil" required>
              </div>
            </div>

            <div class="form-group full">
              <label for="notes">הערות נוספות</label>
              <textarea id="notes" placeholder="תיאור נוסף של הרכב, פגמים, תכונות מיוחדות וכו׳"></textarea>
            </div>

            <div class="button-group">
              <button type="submit" class="btn btn-primary btn-full" id="submitCarBtn">💾 שמור רכב</button>
              <button type="reset" class="btn btn-secondary btn-full">🔄 נקה טופס</button>
            </div>
            <button type="button" class="btn btn-secondary btn-full" id="cancelEditBtn" style="display: none; margin-top: 10px;">✕ ביטול עריכה</button>
          </form>
        </div>

        <!-- Quick Entry Tab -->
        <div id="quick-entry" class="tab-content">
          <h2>כניסה מהירה</h2>
          <p style="color: #666; margin-bottom: 15px;">הכנס מידע מרובים במהירות</p>
          <table class="quick-entry-table">
            <thead>
              <tr>
                <th>מספר רכב</th>
                <th>יצרן</th>
                <th>דגם</th>
                <th>שנה</th>
                <th>מחיר (₪)</th>
              </tr>
            </thead>
            <tbody id="quickEntryTable">
              <tr>
                <td><input type="text" placeholder="מספר רכב"></td>
                <td><input type="text" placeholder="יצרן"></td>
                <td><input type="text" placeholder="דגם"></td>
                <td><input type="number" placeholder="שנה"></td>
                <td><input type="number" placeholder="מחיר"></td>
              </tr>
            </tbody>
          </table>
          <button class="btn btn-secondary" style="margin-top: 15px; width: 100%;">+ הוסף שורה</button>
        </div>

        <!-- Import from Excel Tab -->
        <div id="import-excel" class="tab-content">
          <h2>ייבוא מ-Excel</h2>
          <p style="color: #666; margin-bottom: 20px;">יבא רשימת רכבים מקובץ Excel</p>

          <div class="form-group full">
            <label for="excelFile">בחר קובץ Excel (.xlsx)</label>
            <input type="file" id="excelFile" accept=".xlsx,.xls" style="padding: 15px; cursor: pointer;">
            <small style="color: #666; display: block; margin-top: 10px;">
              📋 הקובץ צריך להכיל עמודות: מספר רכב, יצרן, דגם, שנה, צבע, קילומטר, מנוע, יד, רמת גימור, גיר, מקוריות, מחיר, טסט עד
            </small>
          </div>

          <div id="importPreview" style="display: none; margin-top: 20px;">
            <h3 style="color: #333; margin-bottom: 15px;">תצוגה מקדימה:</h3>
            <div id="previewTable" style="overflow-x: auto;"></div>
            <div class="button-group" style="margin-top: 20px;">
              <button class="btn btn-primary" id="importConfirmBtn" style="flex: 1;">✓ ייבא הכל</button>
              <button class="btn btn-secondary" id="importCancelBtn" style="flex: 1;">✕ בטל</button>
            </div>
          </div>

          <div id="importStatus" style="display: none; margin-top: 20px;">
            <div id="importMessage" style="padding: 15px; border-radius: 8px; text-align: center; font-weight: 600;"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Print Section -->
    <div class="print-section" id="printSection">
      <div class="print-header">
        <img src="images/newcar-logo.png" alt="NEW CAR" class="print-logo">
        <p>טופס קבלת רכב</p>
      </div>

      <div class="print-content" id="printContent">
        <!-- Will be filled dynamically -->
      </div>

      <div class="print-footer">
        <p>© ניו קאר חדרה - כל הזכויות שמורות</p>
      </div>
    </div>
  </div>

  <script>
    // Car database (in real app, this would be a backend)
    // localStorage יכול להיות חסום בהקשרים מסוימים (תצוגה מקדימה מוטבעת, מדיניות דפדפן וכו') -
    // עוטפים ב-try/catch כדי שהאפליקציה תמשיך לעבוד (בלי שמירה קבועה) במקום לקרוס לגמרי
    let storageAvailable = true;
    function loadCars() {
      try {
        return JSON.parse(localStorage.getItem('carInventory')) || [];
      } catch (e) {
        storageAvailable = false;
        return [];
      }
    }
    function saveCars() {
      try {
        localStorage.setItem('carInventory', JSON.stringify(cars));
      } catch (e) {
        storageAvailable = false;
      }
    }
    let cars = loadCars();
    let editingCarId = null; // כאשר לא null - הטופס במצב "עריכת רכב קיים" ולא "הוספת רכב חדש"

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(tab).classList.add('active');
      });
    });

    // Screen switching (מלאי / הוספת רכב)
    function switchToScreen(screenId) {
      document.querySelectorAll('.main-nav-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.querySelector(`.main-nav-btn[data-screen="${screenId}"]`).classList.add('active');
      document.getElementById(screenId).classList.add('active');
      // מרעננים מהשרת המשותף בכניסה למסכים שמציגים/תלויים במלאי - כדי לראות רכבים שנוספו ממחשבים אחרים
      if (screenId === 'screen-inventory' || screenId === 'screen-archive' || screenId === 'screen-add') {
        syncFromBackend();
      }
    }

    document.querySelectorAll('.main-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchToScreen(btn.getAttribute('data-screen')));
    });

    // Simulated car database for auto-fill (lookup by מספר רכב) - fallback כשאין חיבור לאינטרנט/backend
    // הערה: מספר "יד" אינו חלק מהמאגר הפתוח של משרד התחבורה (מידע פרטי) - כאן זו רק דוגמה לצורך הדגמה
    const carDatabase = {
      '78391203': { manufacturer: 'Mazda', model: '3', year: 2020, engine: 1600, transmission: 'automatic', color: 'לבן', kilometers: 42000, testValidUntil: '2026-11-30', handNumber: 2, trimLevel: 'GT' },
      '12345678': { manufacturer: 'BMW', model: '320i', year: 2018, engine: 1600, transmission: 'automatic', color: 'שחור', kilometers: 95000, testValidUntil: '2026-09-15', handNumber: 1, trimLevel: 'EXECUTIVE' },
      '23456789': { manufacturer: 'Toyota', model: 'Corolla', year: 2019, engine: 1600, transmission: 'automatic', color: 'לבן', kilometers: 45000, testValidUntil: '2026-05-20', handNumber: 2, trimLevel: 'COMFORT' },
      '34567890': { manufacturer: 'Volkswagen', model: 'Golf', year: 2020, engine: 1400, transmission: 'manual', color: 'אדום', kilometers: 32000, testValidUntil: '2027-01-10', handNumber: 1, trimLevel: 'TRENDLINE' },
      '45678901': { manufacturer: 'Volkswagen', model: 'Passat', year: 2015, engine: 2000, transmission: 'automatic', color: 'כסוף', kilometers: 125000, testValidUntil: '2026-07-01', handNumber: 3, trimLevel: 'HIGHLINE' },
      '56789012': { manufacturer: 'Hyundai', model: 'Elantra', year: 2017, engine: 1600, transmission: 'automatic', color: 'ירוק', kilometers: 105000, testValidUntil: '2026-08-01', handNumber: 2, trimLevel: 'PREMIUM' },
    };

    const carForm = document.getElementById('carForm');
    const inventoryList = document.getElementById('inventoryList');
    const inventoryCount = document.getElementById('inventoryCount');
    const successMsg = document.getElementById('successMsg');
    const errorMsg = document.getElementById('errorMsg');
    const filterManufacturer = document.getElementById('filterManufacturer');
    const filterVin = document.getElementById('filterVin');
    const filterCondition = document.getElementById('filterCondition');
    const filterPriceMin = document.getElementById('filterPriceMin');
    const filterPriceMax = document.getElementById('filterPriceMax');
    const sortBy = document.getElementById('sortBy');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');

    // ממלא את רשימת היצרנים בסינון לפי מה שקיים בפועל במלאי הפעיל (לא כולל רכבים שנמכרו)
    function populateManufacturerFilter() {
      const current = filterManufacturer.value;
      const manufacturers = [...new Set(cars.filter(c => !c.sold).map(c => c.manufacturer).filter(Boolean))].sort();
      filterManufacturer.innerHTML = '<option value="">כל היצרנים</option>' +
        manufacturers.map(m => `<option value="${m}">${m}</option>`).join('');
      filterManufacturer.value = manufacturers.includes(current) ? current : '';
    }

    function getFilteredCars() {
      const vinQuery = filterVin.value.trim();
      const priceMin = filterPriceMin.value ? Number(filterPriceMin.value) : null;
      const priceMax = filterPriceMax.value ? Number(filterPriceMax.value) : null;

      const filtered = cars.filter(car => {
        if (car.sold) return false; // רכבים שנמכרו לא מופיעים במלאי הפעיל - הם בארכיון
        if (filterManufacturer.value && car.manufacturer !== filterManufacturer.value) return false;
        if (filterCondition.value && car.condition !== filterCondition.value) return false;
        if (vinQuery && !(car.vin || '').includes(vinQuery)) return false;
        const price = Number(car.price) || 0;
        if (priceMin !== null && price < priceMin) return false;
        if (priceMax !== null && price > priceMax) return false;
        return true;
      });

      return sortCars(filtered);
    }

    // ממיין רשימת רכבים לפי הבחירה ב"מיין לפי" (ברירת מחדל: יצרן א-ב)
    function sortCars(list) {
      const sorted = [...list];
      switch (sortBy.value) {
        case 'manufacturer_desc':
          sorted.sort((a, b) => (b.manufacturer || '').localeCompare(a.manufacturer || '', 'he'));
          break;
        case 'price_asc':
          sorted.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
          break;
        case 'price_desc':
          sorted.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
          break;
        case 'year_desc':
          sorted.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
          break;
        case 'year_asc':
          sorted.sort((a, b) => (Number(a.year) || 0) - (Number(b.year) || 0));
          break;
        case 'manufacturer_asc':
        default:
          sorted.sort((a, b) => (a.manufacturer || '').localeCompare(b.manufacturer || '', 'he'));
      }
      return sorted;
    }

    [filterManufacturer, filterCondition, sortBy].forEach(el => el.addEventListener('change', renderInventory));
    [filterVin, filterPriceMin, filterPriceMax].forEach(el => el.addEventListener('input', renderInventory));
    clearFiltersBtn.addEventListener('click', () => {
      filterManufacturer.value = '';
      filterVin.value = '';
      filterCondition.value = '';
      filterPriceMin.value = '';
      filterPriceMax.value = '';
      sortBy.value = 'manufacturer_asc';
      renderInventory();
    });

    function showMessage(type, message) {
      const msg = type === 'success' ? successMsg : errorMsg;
      msg.textContent = message;
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 3000);
    }

    // Fetch VIN data from ministry of transport database
    const fetchVinDataBtn = document.getElementById('fetchVinDataBtn');
    const vinStatus = document.getElementById('vinStatus');
    const vinInput = document.getElementById('vin');

    function fillVehicleForm(carData) {
      document.getElementById('manufacturer').value = carData.manufacturer || '';
      document.getElementById('model').value = carData.model || '';
      document.getElementById('year').value = carData.year || '';
      document.getElementById('engine').value = carData.engine || '';
      document.getElementById('transmission').value = carData.transmission || 'automatic';
      document.getElementById('color').value = carData.color || '';
      document.getElementById('kilometers').value = carData.kilometers || '';
      if (carData.testValidUntil) {
        document.getElementById('testValidUntil').value = carData.testValidUntil;
      }
      if (carData.handNumber) {
        document.getElementById('handNumber').value = carData.handNumber;
      }
      if (carData.trimLevel) {
        document.getElementById('trimLevel').value = carData.trimLevel;
      }
      if (carData.condition) {
        document.getElementById('condition').value = carData.condition;
      }
      document.getElementById('condition').focus();
    }

    const CONDITION_LABELS = {
      private: 'פרטי',
      taxi: 'מונית',
      rental: 'השכרה',
      company: 'חברה',
      lease: 'ליסינג',
      lease_zero: 'ליסינג 0 ק"מ',
    };
    function getConditionLabel(condition) {
      return CONDITION_LABELS[condition] || condition || '';
    }

    // שדה ה-baalut במשרד התחבורה מציין את סוג הבעלות הרשמי של הרכב (פרטי/ליסינג/השכרה/חברה/מונית)
    // ומתאים ישירות ל"מקוריות הרכב" בטופס - "ליסינג 0 ק"מ" הוא סיווג פנימי שלנו ואינו קיים ב-baalut, לכן תמיד ממופה ל"ליסינג" הרגיל
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

    // תאריך baalut_dt מגיע בפורמט YYYYMM (למשל 202410) - הופך לתצוגה MM/YYYY
    function formatBaalutDate(dt) {
      if (!dt) return '';
      const s = String(dt);
      if (s.length !== 6) return s;
      return `${s.slice(4, 6)}/${s.slice(0, 4)}`;
    }

    // מספור "יד" לכל תחלופת בעלות בהיסטוריה (כולל תחנות אצל סוחר, לתמונה מלאה של מה שעבר על הרכב)
    const HEBREW_HAND_ORDINALS = ['ראשונה', 'שנייה', 'שלישית', 'רביעית', 'חמישית', 'שישית', 'שביעית', 'שמינית', 'תשיעית', 'עשירית'];
    function handOrdinalLabel(n) {
      return HEBREW_HAND_ORDINALS[n - 1] ? `יד ${HEBREW_HAND_ORDINALS[n - 1]}` : `יד מספר ${n}`;
    }

    // מספר חודשים בין שני תאריכי baalut_dt (פורמט YYYYMM, למשל 202410)
    function monthsBetween(fromYYYYMM, toYYYYMM) {
      const fromYear = Math.floor(fromYYYYMM / 100), fromMonth = fromYYYYMM % 100;
      const toYear = Math.floor(toYYYYMM / 100), toMonth = toYYYYMM % 100;
      return (toYear - fromYear) * 12 + (toMonth - fromMonth);
    }

    function currentYYYYMM() {
      const now = new Date();
      return now.getFullYear() * 100 + (now.getMonth() + 1);
    }

    // הופך מספר חודשים לטקסט עברי קריא: "פחות מחודש" / "3 חודשים" / "שנה וחודשיים" / "שנתיים" וכו'
    function formatDuration(months) {
      if (months <= 0) return 'פחות מחודש';
      if (months < 12) {
        return months === 1 ? 'חודש אחד' : `${months} חודשים`;
      }
      const years = Math.floor(months / 12);
      const remainingMonths = months % 12;
      const yearsText = years === 1 ? 'שנה' : years === 2 ? 'שנתיים' : `${years} שנים`;
      if (remainingMonths === 0) return yearsText;
      const monthsText = remainingMonths === 1 ? 'חודש' : `${remainingMonths} חודשים`;
      return `${yearsText} ו-${monthsText}`;
    }

    // כשהרכב רשום כרגע על שם "סוחר" (המצב השכיח ביותר לרכב שנמצא במלאי סוחר) אין ל-baalut הנוכחי
    // מיפוי ל"מקוריות" - במקום זה מחפשים בהיסטוריה את הסיווג הראשון (המקורי) שאינו "סוחר",
    // כלומר מה הרכב היה מלכתחילה (למשל רכב ליסינג שנמכר מאז לפרטי) ולא את הסטטוס האחרון שלו
    function getConditionFromHistory(historyRecords) {
      const sortedAsc = [...historyRecords].sort((a, b) => (a.baalut_dt || 0) - (b.baalut_dt || 0));
      const firstNonDealer = sortedAsc.find(r => r.baalut && !r.baalut.includes('סוחר'));
      return firstNonDealer ? mapBaalutToCondition(firstNonDealer.baalut) : '';
    }

    // מחשב "יד" מתוך היסטוריית העברות הבעלות: סופר שינויי בעלות ייחודיים ומדלג על "סוחר"
    // (רישום זמני אצל סוחר בין בעלים לבעלים אינו נחשב "יד" בפני עצמו)
    function calculateHandNumber(historyRecords) {
      const sorted = [...historyRecords].sort((a, b) => (a.baalut_dt || 0) - (b.baalut_dt || 0));
      const nonDealer = sorted.filter(r => r.baalut && !r.baalut.includes('סוחר'));
      let count = 0;
      let lastBaalut = null;
      nonDealer.forEach(r => {
        if (r.baalut !== lastBaalut) {
          count++;
          lastBaalut = r.baalut;
        }
      });
      return count || '';
    }

    // שאילתה משולבת מול 4 מאגרי הנתונים הפתוחים הרלוונטיים של משרד התחבורה (data.gov.il):
    // 1) רישום בסיסי לפי מספר רכב | 2) מפרט טכני לפי דגם (נפח מנוע, גיר) | 3) היסטוריית בעלויות (למספר יד) | 4) ק"מ בטסט האחרון
    async function fetchFromGovApi(plateNumber) {
      const baseUrl = 'https://data.gov.il/api/3/action/datastore_search';

      const vehicleRes = await fetch(`${baseUrl}?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: Number(plateNumber) }))}`);
      const vehicleJson = await vehicleRes.json();
      if (!vehicleJson.success || vehicleJson.result.records.length === 0) return null;
      const vehicle = vehicleJson.result.records[0];
      console.log('רשומת רישום בסיסית:', vehicle);

      const data = {
        manufacturer: vehicle.tozeret_nm,
        model: vehicle.kinuy_mishari || vehicle.degem_nm,
        year: vehicle.shnat_yitzur,
        color: vehicle.tzeva_rechev,
        testValidUntil: vehicle.tokef_dt ? vehicle.tokef_dt.split('T')[0] : '',
        condition: mapBaalutToCondition(vehicle.baalut),
        engine: '',
        transmission: 'automatic',
        kilometers: '',
        handNumber: '',
        trimLevel: '',
        fuelType: vehicle.sug_delek_nm || '',
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

      // מפרט טכני לפי דגם - נפח מנוע, גיר ורמת גימור
      if (specResult.status === 'fulfilled' && specResult.value.success && specResult.value.result.records.length > 0) {
        const records = specResult.value.result.records;
        const spec = records.find(r => r.shnat_yitzur == vehicle.shnat_yitzur) || records[0];
        console.log('מפרט טכני לפי דגם:', spec);
        data.engine = spec.nefah_manoa || '';
        data.transmission = spec.automatic_ind == 1 ? 'automatic' : 'manual';
        data.trimLevel = spec.ramat_gimur || '';
      }

      // היסטוריית בעלויות - חישוב מספר יד ללא סוחרים, ובנוסף השלמת "מקוריות" אם הרכב רשום כרגע על סוחר
      if (historyResult.status === 'fulfilled' && historyResult.value.success && historyResult.value.result.records.length > 0) {
        const historyRecords = historyResult.value.result.records;
        console.log('היסטוריית בעלויות:', historyRecords);
        data.handNumber = calculateHandNumber(historyRecords);
        if (!data.condition) {
          data.condition = getConditionFromHistory(historyRecords);
        }
        data.ownershipHistory = [...historyRecords].sort((a, b) => (a.baalut_dt || 0) - (b.baalut_dt || 0));
      }

      // קילומטראז' בפועל מהטסט האחרון
      if (kmResult.status === 'fulfilled' && kmResult.value.success && kmResult.value.result.records.length > 0) {
        const km = kmResult.value.result.records[0].kilometer_test_aharon;
        if (km) data.kilometers = km;
      }

      return data;
    }

    // מספרי רכב מוקלדים לפעמים עם מקפים/רווחים (למשל 60-107-703) - מנקים לספרות בלבד לפני חיפוש
    function normalizePlateNumber(value) {
      return (value || '').replace(/\D/g, '');
    }

    // בודק אם מספר רכב כבר קיים במערכת (במלאי הפעיל או בארכיון) - excludeId משמש בעריכה כדי שרכב לא יתנגש עם עצמו
    function findDuplicateVin(vin, excludeId = null) {
      const normalized = normalizePlateNumber(vin);
      if (!normalized) return null;
      return cars.find(c => normalizePlateNumber(c.vin) === normalized && c.id !== excludeId) || null;
    }

    function describeDuplicateCar(car) {
      const name = `${car.manufacturer || ''} ${car.model || ''}`.trim() || 'רכב';
      return car.sold ? `${name} - נמכר וניתן למצוא בארכיון` : `${name} - נמצא במלאי הפעיל`;
    }

    fetchVinDataBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const plateNumber = normalizePlateNumber(vinInput.value);
      if (plateNumber) vinInput.value = plateNumber;

      if (!plateNumber) {
        vinStatus.textContent = '❌ אנא הכנס מספר רכב תחילה';
        vinStatus.style.color = '#e53e3e';
        return;
      }

      const existingCar = findDuplicateVin(plateNumber, editingCarId);
      if (existingCar) {
        vinStatus.textContent = `⚠️ מספר רכב זה כבר קיים במערכת - ${describeDuplicateCar(existingCar)}`;
        vinStatus.style.color = '#e53e3e';
        return;
      }

      vinStatus.textContent = '🔄 מחפש במשרד התחבורה...';
      vinStatus.style.color = '#4299e1';

      // 1. נסה מול ה-Backend המקומי (אם פעיל)
      try {
        const response = await fetch(`${API_URL}/vehicle/${plateNumber}`);
        const result = await response.json();
        if (result.success && result.data) {
          fillVehicleForm(result.data);
          vinStatus.textContent = '✓ הנתונים נשלפו בהצלחה ממשרד התחבורה';
          vinStatus.style.color = '#48bb78';
          return;
        }
      } catch (error) {
        // ה-Backend לא פעיל, ממשיכים לניסיון הבא
        console.log('Backend מקומי לא זמין:', error.message);
      }

      // 2. נסה מול ה-API הפתוח האמיתי של data.gov.il (משרד התחבורה)
      try {
        const govData = await fetchFromGovApi(plateNumber);
        if (govData) {
          fillVehicleForm(govData);

          const missing = [];
          if (!govData.engine) missing.push('נפח מנוע');
          if (!govData.handNumber) missing.push('מספר יד');

          if (missing.length > 0) {
            vinStatus.textContent = `✓ הנתונים נשלפו, אך ${missing.join(' ו')} אינם זמינים - נא למלא ידנית`;
            vinStatus.style.color = '#ed8936';
          } else {
            vinStatus.textContent = '✓ הנתונים נשלפו בהצלחה מאתר משרד התחבורה (data.gov.il)';
            vinStatus.style.color = '#48bb78';
          }
          return;
        } else {
          console.log('data.gov.il: מספר הרכב לא נמצא במאגר הרישום הבסיסי', plateNumber);
        }
      } catch (error) {
        // שגיאת רשת/CORS אמיתית - מתועדת ל-console לצורך אבחון, וממשיכים לבסיס הנתונים המקומי
        console.error('שגיאה בפנייה ל-data.gov.il:', error);
      }

      // 3. Fallback: בסיס נתונים מקומי לדוגמה
      const carData = carDatabase[plateNumber];
      if (carData) {
        fillVehicleForm(carData);
        vinStatus.textContent = '✓ הנתונים נשלפו בהצלחה (בסיס נתונים לדוגמה)';
        vinStatus.style.color = '#48bb78';
      } else {
        vinStatus.textContent = '⚠️ מספר הרכב לא נמצא. ניתן למלא את הפרטים ידנית. (פתח F12 → Console לפרטי שגיאה אם יש)';
        vinStatus.style.color = '#ed8936';
      }
    });

    // מסך "בדיקת רכב לפני קנייה" - מציג את כל המידע הזמין ממשרד התחבורה עבור מספר רכב, בלי להוסיף אותו למלאי
    const checkVinBtn = document.getElementById('checkVinBtn');
    const checkVinInput = document.getElementById('checkVin');
    const checkStatus = document.getElementById('checkStatus');
    const checkResults = document.getElementById('checkResults');

    function renderCheckResults(data, plateNumber) {
      const rows = [
        ['מספר רכב', plateNumber],
        ['יצרן', data.manufacturer],
        ['דגם', data.model],
        ['שנה', data.year],
        ['צבע', data.color],
        ['סוג דלק', data.fuelType],
        ['נפח מנוע', data.engine ? `${data.engine} cc` : ''],
        ['גיר', data.transmission ? (data.transmission === 'manual' ? 'ידנית' : 'אוטומטית') : ''],
        ['רמת גימור', data.trimLevel],
        ['מקוריות (מקורית)', getConditionLabel(data.condition)],
        ['יד (לא כולל סוחרים)', data.handNumber],
        ['קילומטר (בטסט האחרון)', data.kilometers ? `${Number(data.kilometers).toLocaleString('he-IL')} ק"מ` : ''],
        ['טסט בתוקף עד', data.testValidUntil],
        ['מבחן רישוי אחרון', data.lastTestDate],
        ['בעלות נוכחית', data.currentOwnership],
        ['מספר שילדה', data.chassisNumber],
      ].filter(([, value]) => value);

      const gridHtml = rows.map(([label, value]) => `
        <div class="check-result-item">
          <div class="check-result-label">${label}</div>
          <div class="check-result-value">${value}</div>
        </div>
      `).join('');

      let historyHtml = '';
      if (data.ownershipHistory && data.ownershipHistory.length > 0) {
        historyHtml = `
          <div class="check-history-title">📜 כל הידיים שהרכב עבר</div>
          <div class="check-history-timeline">
            ${(() => {
              let handCounter = 0;
              const history = data.ownershipHistory;
              const nowYYYYMM = currentYYYYMM();
              return history.map((h, idx) => {
                const isDealer = h.baalut && h.baalut.includes('סוחר');
                const statusLabel = isDealer ? 'סוחר' : `${handOrdinalLabel(++handCounter)} - ${h.baalut || ''}`;

                const nextEntry = history[idx + 1];
                const endYYYYMM = nextEntry ? nextEntry.baalut_dt : nowYYYYMM;
                const durationText = (h.baalut_dt && endYYYYMM)
                  ? ` (${formatDuration(monthsBetween(h.baalut_dt, endYYYYMM))})`
                  : '';

                return `
                  <div class="check-history-entry${isDealer ? ' dealer' : ''}">
                    <div class="check-history-date">${formatBaalutDate(h.baalut_dt)}</div>
                    <div class="check-history-status">${statusLabel}${durationText}</div>
                  </div>
                `;
              }).join('');
            })()}
          </div>
          <small style="color: #888; display: block; margin-top: 10px;">
            * משרד התחבורה מפרסם רק את הקמ מהטסט האחרון. המערכת שלנו סורקת את המאגר הארצי כל יום
            ובונה היסטוריית קילומטראז' לכל רכב בישראל - ככל שעובר הזמן, יופיעו כאן יותר טסטים.
          </small>
        `;
      }

      checkResults.innerHTML = `
        <div class="check-results-grid">${gridHtml}</div>
        ${historyHtml}
        <div id="ourKmHistory"></div>
        <div class="button-group">
          <button class="btn btn-primary btn-full" id="addCheckedCarBtn">➕ הוסף רכב זה למלאי</button>
        </div>
      `;
      checkResults.style.display = 'block';

      document.getElementById('addCheckedCarBtn').addEventListener('click', () => {
        switchToScreen('screen-add');
        document.getElementById('vin').value = plateNumber;
        fillVehicleForm(data);
        showMessage('success', '✓ הפרטים הועברו לטופס ההוספה - השלם מחיר וטסט ושמור');
      });

      renderOurKmHistory(plateNumber);
    }

    // מציג את היסטוריית הקמ שהמערכת שלנו שמרה עצמאית מבדיקות קודמות של אותו רכב (לא ממשרד התחבורה)
    async function renderOurKmHistory(plateNumber) {
      const container = document.getElementById('ourKmHistory');
      if (!container) return;

      let snapshots = [];
      try {
        const response = await fetch(`${API_URL}/km-history/${plateNumber}`);
        if (response.ok) snapshots = await response.json();
      } catch (e) {
        return; // אין backend זמין - פשוט לא מציגים את הסקשן הזה
      }

      if (!Array.isArray(snapshots) || snapshots.length < 2) return; // צריך לפחות 2 בדיקות כדי שתהיה היסטוריה משמעותית

      const entriesHtml = snapshots.map((s, idx) => {
        const prev = snapshots[idx - 1];
        let deltaText = '';
        if (prev) {
          const delta = Number(s.kilometers) - Number(prev.kilometers);
          deltaText = ` (${delta >= 0 ? '+' : ''}${delta.toLocaleString('he-IL')} ק"מ מהבדיקה הקודמת)`;
        }
        return `
          <div class="check-history-entry">
            <div class="check-history-date">${new Date(s.checkedAt).toLocaleDateString('he-IL')}</div>
            <div class="check-history-status">${Number(s.kilometers).toLocaleString('he-IL')} ק"מ${deltaText}</div>
          </div>
        `;
      }).join('');

      container.innerHTML = `
        <div class="check-history-title">📏 היסטוריית קילומטראז' - בדיקות קודמות שלנו לרכב זה</div>
        <div class="check-history-timeline">${entriesHtml}</div>
      `;
    }

    async function checkVehicle() {
      const plateNumber = normalizePlateNumber(checkVinInput.value);
      checkVinInput.value = plateNumber;

      if (!plateNumber) {
        checkStatus.textContent = '❌ אנא הכנס מספר רכב';
        checkStatus.style.color = '#e53e3e';
        return;
      }

      checkResults.style.display = 'none';
      checkStatus.textContent = '🔄 בודק מול משרד התחבורה...';
      checkStatus.style.color = '#4299e1';
      checkVinBtn.disabled = true;

      const data = await fetchEnrichmentData(plateNumber);

      checkVinBtn.disabled = false;

      if (!data) {
        checkStatus.textContent = '⚠️ מספר הרכב לא נמצא';
        checkStatus.style.color = '#ed8936';
        return;
      }

      checkStatus.textContent = '✓ נמצא מידע על הרכב';
      checkStatus.style.color = '#48bb78';
      renderCheckResults(data, plateNumber);
    }

    checkVinBtn.addEventListener('click', checkVehicle);
    checkVinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        checkVehicle();
      }
    });

    // קורא את כל שדות הטופס לאובייקט אחד - משמש גם בהוספה וגם בעריכה
    function getCarFormFields() {
      return {
        vin: document.getElementById('vin').value,
        manufacturer: document.getElementById('manufacturer').value,
        model: document.getElementById('model').value,
        year: document.getElementById('year').value || new Date().getFullYear(),
        color: document.getElementById('color').value,
        kilometers: document.getElementById('kilometers').value || 0,
        engine: document.getElementById('engine').value || 0,
        handNumber: document.getElementById('handNumber').value || '',
        trimLevel: document.getElementById('trimLevel').value || '',
        transmission: document.getElementById('transmission').value || 'automatic',
        condition: document.getElementById('condition').value,
        price: document.getElementById('price').value,
        testValidUntil: document.getElementById('testValidUntil').value,
        notes: document.getElementById('notes').value,
      };
    }

    // מעדכן את מראה הטופס בהתאם למצב - הוספת רכב חדש מול עריכת רכב קיים
    function updateFormModeUI() {
      const submitBtn = document.getElementById('submitCarBtn');
      const cancelBtn = document.getElementById('cancelEditBtn');
      if (editingCarId) {
        submitBtn.textContent = '💾 עדכן רכב';
        cancelBtn.style.display = 'block';
      } else {
        submitBtn.textContent = '💾 שמור רכב';
        cancelBtn.style.display = 'none';
      }
    }

    // טוען רכב קיים לטופס לעריכה
    function editCar(id) {
      const car = cars.find(c => c.id === id);
      if (!car) return;

      editingCarId = id;
      switchToScreen('screen-add');

      document.getElementById('vin').value = car.vin || '';
      document.getElementById('manufacturer').value = car.manufacturer || '';
      document.getElementById('model').value = car.model || '';
      document.getElementById('year').value = car.year || '';
      document.getElementById('color').value = car.color || '';
      document.getElementById('kilometers').value = car.kilometers || '';
      document.getElementById('engine').value = car.engine || '';
      document.getElementById('handNumber').value = car.handNumber || '';
      document.getElementById('trimLevel').value = car.trimLevel || '';
      document.getElementById('transmission').value = car.transmission || '';
      document.getElementById('condition').value = car.condition || '';
      document.getElementById('price').value = car.price || '';
      document.getElementById('testValidUntil').value = car.testValidUntil || '';
      document.getElementById('notes').value = car.notes || '';

      updateFormModeUI();
      showMessage('success', `✏️ עורך את ${car.manufacturer || ''} ${car.model || ''}`);
    }

    document.getElementById('cancelEditBtn').addEventListener('click', () => {
      editingCarId = null;
      carForm.reset();
      updateFormModeUI();
      switchToScreen('screen-inventory');
    });

    // Form submit - מסתעף בין הוספת רכב חדש לעדכון רכב קיים
    carForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const fields = getCarFormFields();

      if (!fields.condition || !fields.price || !fields.testValidUntil) {
        showMessage('error', '⚠️ אנא מלא את: מקוריות הרכב, מחיר, וטסט עד מתי');
        return;
      }

      if (fields.vin) {
        const duplicate = findDuplicateVin(fields.vin, editingCarId);
        if (duplicate) {
          showMessage('error', `⚠️ מספר רכב ${fields.vin} כבר קיים במערכת - ${describeDuplicateCar(duplicate)}. לא ניתן להוסיף אותו רכב פעמיים`);
          return;
        }
      }

      if (editingCarId) {
        // עדכון רכב קיים
        const car = cars.find(c => c.id === editingCarId);
        if (car) {
          Object.assign(car, fields);
        }
        saveCars();

        try {
          await fetch(`${API_URL}/cars/${editingCarId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields)
          });
        } catch (error) {
          console.log('Backend אינו זמין - עדכון מקומי בלבד');
        }

        editingCarId = null;
        carForm.reset();
        updateFormModeUI();
        showMessage('success', '✓ הרכב עודכן בהצלחה!');
        renderInventory();
        switchToScreen('screen-inventory');
        return;
      }

      // הוספת רכב חדש
      const car = {
        id: Date.now(),
        licensePlate: '', // לא משמש עוד
        ...fields,
        addedDate: new Date().toLocaleDateString('he-IL'),
      };

      try {
        const response = await fetch(`${API_URL}/cars`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(car)
        });

        if (response.ok) {
          const result = await response.json();
          car.id = result.id;
        }
      } catch (error) {
        console.log('Backend אינו זמין - שמירה ב-localStorage');
      }

      cars.push(car);
      saveCars();

      carForm.reset();
      showMessage('success', '✓ הרכב נשמר בהצלחה!');
      renderInventory();
      switchToScreen('screen-inventory');
    });

    // Render inventory
    function renderInventory() {
      populateManufacturerFilter();

      const activeCars = cars.filter(c => !c.sold);

      if (activeCars.length === 0) {
        inventoryList.innerHTML = '<p>אין רכבים ברשימה. התחל בהוספת רכב חדש.</p>';
        inventoryCount.textContent = '';
        return;
      }

      const filteredCars = getFilteredCars();

      inventoryCount.textContent = filteredCars.length === activeCars.length
        ? `סה"כ ${activeCars.length} רכבים`
        : `מציג ${filteredCars.length} מתוך ${activeCars.length} רכבים`;

      if (filteredCars.length === 0) {
        inventoryList.innerHTML = '<p>לא נמצאו רכבים התואמים את הסינון.</p>';
        return;
      }

      inventoryList.innerHTML = filteredCars.map(car => {
        const isOpen = expandedCarIds.has(car.id);
        const metaParts = [];
        if (!isFieldEmpty(car.price)) metaParts.push(`₪${parseInt(car.price).toLocaleString('he-IL')}`);
        if (!isFieldEmpty(car.handNumber)) metaParts.push(`יד ${car.handNumber}`);
        if (!isFieldEmpty(car.kilometers)) metaParts.push(`${parseInt(car.kilometers).toLocaleString('he-IL')} ק״מ`);
        return `
        <div class="car-item">
          <div class="car-item-header" onclick="toggleCarDetails(${car.id})">
            <div class="car-item-titlebox">
              <div class="car-item-title">
                <span class="car-item-chevron${isOpen ? ' open' : ''}" id="chevron-${car.id}">▶</span>
                ${car.manufacturer} ${car.model} • ${car.year}
              </div>
              ${metaParts.length ? `<div class="car-item-meta">${metaParts.join(' • ')}</div>` : ''}
            </div>
            <div class="car-item-actions" onclick="event.stopPropagation()">
              <button class="btn btn-secondary" onclick="editCar(${car.id})">✏️ ערוך</button>
              <button class="btn btn-print" onclick="printCar(${car.id})">🖨️ הדפס</button>
              <button class="btn btn-success" onclick="markAsSold(${car.id})">✅ נמכר</button>
              ${currentUser.canDelete ? `<button class="btn btn-danger" onclick="deleteCar(${car.id})">🗑️ מחק</button>` : ''}
            </div>
          </div>
          <div class="car-details" id="details-${car.id}" style="display: ${isOpen ? 'grid' : 'none'};">
            <div class="car-detail"><span class="car-detail-label">מספר רכב:</span> ${car.vin}</div>
            <div class="car-detail"><span class="car-detail-label">קילומטר:</span> ${car.kilometers} ק״מ</div>
            <div class="car-detail"><span class="car-detail-label">מחיר:</span> ₪${parseInt(car.price).toLocaleString('he-IL')}</div>
            <div class="car-detail"><span class="car-detail-label">מנוע:</span> ${car.engine} cc</div>
            ${car.handNumber ? `<div class="car-detail"><span class="car-detail-label">יד:</span> ${car.handNumber}</div>` : ''}
            ${car.trimLevel ? `<div class="car-detail"><span class="car-detail-label">רמת גימור:</span> ${car.trimLevel}</div>` : ''}
            <div class="car-detail"><span class="car-detail-label">גיר:</span> ${car.transmission === 'manual' ? 'ידנית' : 'אוטומטית'}</div>
            <div class="car-detail"><span class="car-detail-label">צבע:</span> ${car.color}</div>
            <div class="car-detail"><span class="car-detail-label">טסט עד:</span> ${car.testValidUntil}</div>
            ${car.notes ? `<div class="car-detail" style="grid-column: 1/-1;"><span class="car-detail-label">הערות:</span> ${car.notes}</div>` : ''}
            <div class="car-detail" style="grid-column: 1/-1; text-align: center; padding-top: 8px; border-top: 1px solid #e2e2e2;">
              <button class="btn btn-secondary" onclick="enrichCar(${car.id})" id="enrichBtn-${car.id}">🔄 השלם נתונים חסרים</button>
            </div>
          </div>
        </div>
      `;
      }).join('');
    }

    // מצב פתוח/סגור של כרטיסי רכב נשמר בין רינדורים (כדי לא לקפל הכל בטעות בלחיצה על כפתור פנימי)
    const expandedCarIds = new Set();

    function toggleCarDetails(id) {
      const details = document.getElementById(`details-${id}`);
      const chevron = document.getElementById(`chevron-${id}`);
      if (!details) return;
      const willOpen = details.style.display === 'none';
      details.style.display = willOpen ? 'grid' : 'none';
      if (chevron) chevron.classList.toggle('open', willOpen);
      if (willOpen) expandedCarIds.add(id); else expandedCarIds.delete(id);
    }

    // שדה נחשב "חסר" אם הוא ריק, לא מוגדר, או 0 (0 משמש כברירת מחדל לשדות מספריים שלא מולאו)
    function isFieldEmpty(value) {
      return value === undefined || value === null || value === '' || value === 0 || value === '0';
    }

    // ממלא ב-car רק שדות שהיו חסרים (לא דורס נתונים קיימים), ומחזיר כמה שדות מולאו
    function applyMissingFields(car, govData) {
      const fields = ['manufacturer', 'model', 'year', 'color', 'engine', 'transmission', 'kilometers', 'handNumber', 'trimLevel', 'condition', 'testValidUntil'];
      let filledCount = 0;
      fields.forEach(field => {
        if (isFieldEmpty(car[field]) && !isFieldEmpty(govData[field])) {
          car[field] = govData[field];
          filledCount++;
        }
      });
      return filledCount;
    }

    // שולף נתונים ממשרד התחבורה עבור מספר רכב נתון (ללא תלות בטופס - משמש להשלמת נתונים לרכבים קיימים במלאי)
    // אותה שרשרת נפילה כמו כפתור "קבל נתונים" בטופס: Backend מקומי → API אמיתי → בסיס נתונים לדוגמה
    async function fetchEnrichmentData(rawPlateNumber) {
      const plateNumber = normalizePlateNumber(rawPlateNumber);
      if (!plateNumber) return null;

      try {
        const response = await fetch(`${API_URL}/vehicle/${plateNumber}`);
        const result = await response.json();
        if (result.success && result.data) return result.data;
      } catch (error) {
        // Backend לא זמין, ממשיכים ל-API הפתוח
      }

      try {
        const govData = await fetchFromGovApi(plateNumber);
        if (govData) return govData;
      } catch (error) {
        console.error('שגיאה בפנייה ל-data.gov.il (השלמת נתונים):', error);
      }

      return carDatabase[plateNumber] || null;
    }

    // השלמת נתונים חסרים לרכב בודד במלאי
    async function enrichCar(id) {
      const car = cars.find(c => c.id === id);
      if (!car) return;

      if (!car.vin) {
        showMessage('error', '⚠️ לרכב זה אין מספר רכב - לא ניתן לשלוף נתונים');
        return;
      }

      const btn = document.getElementById(`enrichBtn-${id}`);
      if (btn) { btn.disabled = true; btn.textContent = '🔄 שולף...'; }

      const govData = await fetchEnrichmentData(car.vin);

      if (!govData) {
        showMessage('error', `⚠️ לא נמצאו נתונים עבור מספר רכב ${car.vin}`);
        if (btn) { btn.disabled = false; btn.textContent = '🔄 השלם נתונים'; }
        return;
      }

      const filledCount = applyMissingFields(car, govData);
      saveCars();
      renderInventory();

      showMessage('success', filledCount > 0
        ? `✓ הושלמו ${filledCount} שדות עבור ${car.manufacturer || car.vin} ${car.model || ''}`
        : `ℹ️ לא נמצאו שדות חסרים להשלמה עבור ${car.manufacturer || car.vin}`);
    }

    // השלמת נתונים חסרים לכל הרכבים במלאי, אחד אחרי השני
    const enrichAllBtn = document.getElementById('enrichAllBtn');
    let isEnrichingAll = false;

    enrichAllBtn.addEventListener('click', async () => {
      if (isEnrichingAll) return;

      if (cars.length === 0) {
        showMessage('error', '⚠️ אין רכבים במלאי');
        return;
      }

      isEnrichingAll = true;
      enrichAllBtn.disabled = true;

      let totalFilled = 0;
      let carsUpdated = 0;

      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        enrichAllBtn.textContent = `🔄 משלים נתונים... (${i + 1}/${cars.length})`;

        if (!car.vin) continue;

        const govData = await fetchEnrichmentData(car.vin);
        if (govData) {
          const filled = applyMissingFields(car, govData);
          if (filled > 0) {
            totalFilled += filled;
            carsUpdated++;
          }
        }
      }

      saveCars();
      renderInventory();

      enrichAllBtn.disabled = false;
      enrichAllBtn.textContent = '🔄 השלם נתונים חסרים לכולם';
      isEnrichingAll = false;

      showMessage('success', `✓ הושלם! מולאו ${totalFilled} שדות חסרים ב-${carsUpdated} מתוך ${cars.length} רכבים`);
    });

    // Delete car
    function deleteCar(id) {
      if (confirm('אתה בטוח שברצונך למחוק רכב זה לצמיתות?')) {
        cars = cars.filter(car => car.id !== id);
        saveCars();
        try {
          fetch(`${API_URL}/cars/${id}`, { method: 'DELETE' }).catch(() => {});
        } catch (error) { /* Backend לא זמין */ }
        renderInventory();
        renderArchive();
        showMessage('success', '✓ הרכב נמחק');
      }
    }

    // מסמן רכב כנמכר ומעביר אותו לארכיון (לא מוחק - נשאר לתיעוד)
    async function markAsSold(id) {
      const car = cars.find(c => c.id === id);
      if (!car) return;
      if (!confirm(`לסמן את ${car.manufacturer || ''} ${car.model || ''} כנמכר ולהעביר לארכיון?`)) return;

      car.sold = true;
      car.soldDate = new Date().toLocaleDateString('he-IL');
      saveCars();

      try {
        await fetch(`${API_URL}/cars/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sold: 1, soldDate: car.soldDate })
        });
      } catch (error) {
        console.log('Backend אינו זמין - עדכון מקומי בלבד');
      }

      renderInventory();
      renderArchive();
      showMessage('success', '✓ הרכב סומן כנמכר והועבר לארכיון');
    }

    // מחזיר רכב מהארכיון בחזרה למלאי הפעיל
    async function unmarkAsSold(id) {
      const car = cars.find(c => c.id === id);
      if (!car) return;
      if (!confirm(`להחזיר את ${car.manufacturer || ''} ${car.model || ''} למלאי הפעיל?`)) return;

      car.sold = false;
      car.soldDate = '';
      saveCars();

      try {
        await fetch(`${API_URL}/cars/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sold: 0, soldDate: '' })
        });
      } catch (error) {
        console.log('Backend אינו זמין - עדכון מקומי בלבד');
      }

      renderInventory();
      renderArchive();
      showMessage('success', '✓ הרכב הוחזר למלאי הפעיל');
    }

    // Render archive (רכבים שנמכרו)
    const archiveList = document.getElementById('archiveList');
    const archiveCount = document.getElementById('archiveCount');
    const archiveSearch = document.getElementById('archiveSearch');

    function renderArchive() {
      const soldCars = cars.filter(c => c.sold);

      if (soldCars.length === 0) {
        archiveList.innerHTML = '<p>אין עדיין רכבים בארכיון. רכבים שיסומנו כ"נמכר" יופיעו כאן.</p>';
        archiveCount.textContent = '';
        return;
      }

      const query = archiveSearch.value.trim().toLowerCase();
      const filtered = query
        ? soldCars.filter(c =>
            (c.vin || '').toLowerCase().includes(query) ||
            (c.manufacturer || '').toLowerCase().includes(query) ||
            (c.model || '').toLowerCase().includes(query))
        : soldCars;

      archiveCount.textContent = filtered.length === soldCars.length
        ? `סה"כ ${soldCars.length} רכבים בארכיון`
        : `מציג ${filtered.length} מתוך ${soldCars.length} רכבים בארכיון`;

      if (filtered.length === 0) {
        archiveList.innerHTML = '<p>לא נמצאו רכבים התואמים את החיפוש.</p>';
        return;
      }

      // מיון מהחדש לישן לפי תאריך מכירה
      const sorted = [...filtered].sort((a, b) => (b.id || 0) - (a.id || 0));

      archiveList.innerHTML = sorted.map(car => {
        const metaParts = [];
        if (!isFieldEmpty(car.price)) metaParts.push(`₪${parseInt(car.price).toLocaleString('he-IL')}`);
        if (!isFieldEmpty(car.handNumber)) metaParts.push(`יד ${car.handNumber}`);
        if (!isFieldEmpty(car.kilometers)) metaParts.push(`${parseInt(car.kilometers).toLocaleString('he-IL')} ק״מ`);
        return `
        <div class="car-item">
          <div class="car-item-header">
            <div class="car-item-titlebox">
              <div class="car-item-title">${car.manufacturer || ''} ${car.model || ''} • ${car.year || ''}</div>
              ${metaParts.length ? `<div class="car-item-meta">${metaParts.join(' • ')}</div>` : ''}
            </div>
            <div class="car-item-actions">
              <button class="btn btn-print" onclick="printCar(${car.id})">🖨️ הדפס</button>
              <button class="btn btn-secondary" onclick="unmarkAsSold(${car.id})">↩️ החזר למלאי</button>
              <button class="btn btn-danger" onclick="deleteCar(${car.id})">🗑️ מחק לצמיתות</button>
            </div>
          </div>
          <div class="car-details">
            <div class="car-detail"><span class="car-detail-label">מספר רכב:</span> ${car.vin}</div>
            <div class="car-detail"><span class="car-detail-label">נמכר בתאריך:</span> ${car.soldDate || '-'}</div>
            <div class="car-detail"><span class="car-detail-label">מחיר:</span> ₪${parseInt(car.price || 0).toLocaleString('he-IL')}</div>
            <div class="car-detail"><span class="car-detail-label">קילומטר:</span> ${car.kilometers} ק״מ</div>
            <div class="car-detail"><span class="car-detail-label">צבע:</span> ${car.color}</div>
            <div class="car-detail"><span class="car-detail-label">גיר:</span> ${car.transmission === 'manual' ? 'ידנית' : 'אוטומטית'}</div>
            ${car.notes ? `<div class="car-detail" style="grid-column: 1/-1;"><span class="car-detail-label">הערות:</span> ${car.notes}</div>` : ''}
          </div>
        </div>
      `;
      }).join('');
    }

    archiveSearch.addEventListener('input', renderArchive);

    // Print car
    function printCar(id) {
      const car = cars.find(c => c.id === id);
      if (!car) return;

      const printContent = document.getElementById('printContent');
      printContent.innerHTML = `
        <div>
          <div class="print-field">
            <div class="print-field-label">מספר רכב</div>
            <div class="print-field-value">${car.vin}</div>
          </div>
          <div class="print-field">
            <div class="print-field-label">יצרן</div>
            <div class="print-field-value">${car.manufacturer}</div>
          </div>
          <div class="print-field">
            <div class="print-field-label">דגם</div>
            <div class="print-field-value">${car.model}</div>
          </div>
        </div>
        <div>
          <div class="print-field">
            <div class="print-field-label">שנה</div>
            <div class="print-field-value">${car.year}</div>
          </div>
          <div class="print-field">
            <div class="print-field-label">צבע</div>
            <div class="print-field-value">${car.color}</div>
          </div>
          <div class="print-field">
            <div class="print-field-label">קילומטר</div>
            <div class="print-field-value">${car.kilometers} ק״מ</div>
          </div>
          <div class="print-field">
            <div class="print-field-label">נפח מנוע</div>
            <div class="print-field-value">${car.engine} cc</div>
          </div>
          ${car.handNumber ? `
          <div class="print-field">
            <div class="print-field-label">יד</div>
            <div class="print-field-value">${car.handNumber}</div>
          </div>
          ` : ''}
          ${car.trimLevel ? `
          <div class="print-field">
            <div class="print-field-label">רמת גימור</div>
            <div class="print-field-value">${car.trimLevel}</div>
          </div>
          ` : ''}
        </div>
      `;

      const moreContent = document.createElement('div');
      moreContent.style.gridColumn = '1 / -1';
      moreContent.innerHTML = `
        <div class="print-field">
          <div class="print-field-label">תיבת הילוכים</div>
          <div class="print-field-value">${car.transmission === 'manual' ? 'ידנית' : 'אוטומטית'}</div>
        </div>
        <div class="print-field">
          <div class="print-field-label">מקוריות הרכב</div>
          <div class="print-field-value">${getConditionLabel(car.condition)}</div>
        </div>
        <div class="print-field">
          <div class="print-field-label">מחיר נדרש</div>
          <div class="print-field-value">₪${parseInt(car.price).toLocaleString('he-IL')}</div>
        </div>
        <div class="print-field">
          <div class="print-field-label">טסט עד מתי</div>
          <div class="print-field-value">${car.testValidUntil}</div>
        </div>
        ${car.notes ? `
        <div class="print-field">
          <div class="print-field-label">הערות נוספות</div>
          <div class="print-field-value">${car.notes}</div>
        </div>
        ` : ''}
      `;
      printContent.appendChild(moreContent);

      window.print();
    }

    // Excel Import
    const excelFileInput = document.getElementById('excelFile');
    const importPreview = document.getElementById('importPreview');
    const previewTable = document.getElementById('previewTable');
    const importConfirmBtn = document.getElementById('importConfirmBtn');
    const importCancelBtn = document.getElementById('importCancelBtn');
    const importStatus = document.getElementById('importStatus');
    const importMessage = document.getElementById('importMessage');
    let importedData = [];

    excelFileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = new Uint8Array(event.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(sheet);

          if (jsonData.length === 0) {
            showMessage('error', 'הקובץ ריק או לא מכיל נתונים');
            return;
          }

          const parsedRows = jsonData.map((row, idx) => ({
            id: Date.now() + idx,
            vin: (row['מספר רכב'] || row.VIN || row['מספר הרכב'] || '').toString().trim(),
            manufacturer: (row.יצרן || row['Manufacturer'] || '').toString().trim(),
            model: (row.דגם || row['Model'] || '').toString().trim(),
            year: parseInt(row.שנה || row['Year']) || new Date().getFullYear(),
            color: (row.צבע || row['Color'] || '').toString().trim(),
            kilometers: parseInt(row.קילומטר || row['Kilometers']) || 0,
            engine: parseInt(row.מנוע || row['Engine']) || 0,
            handNumber: (row.יד || row['Hand'] || '').toString().trim(),
            trimLevel: (row['רמת גימור'] || row['Trim Level'] || '').toString().trim(),
            transmission: (row.גיר || row['Transmission'] || 'automatic').toString().toLowerCase(),
            condition: (row.מקוריות || row['Condition'] || 'original').toString().toLowerCase(),
            price: parseInt(row.מחיר || row['Price']) || 0,
            testValidUntil: (row['טסט עד'] || row['Test Until'] || row['Test Valid'] || new Date().toISOString().split('T')[0]).toString().trim(),
            notes: (row.הערות || row['Notes'] || '').toString().trim(),
            addedDate: new Date().toLocaleDateString('he-IL'),
          }));

          // מסננים כפילויות: גם מול המלאי הקיים, וגם בין שורות כפולות בתוך הקובץ עצמו
          const seenInBatch = new Set();
          let skippedExisting = 0;
          let skippedInBatch = 0;
          importedData = parsedRows.filter(row => {
            const normalized = normalizePlateNumber(row.vin);
            if (!normalized) return true; // אין מספר רכב - אין מה לבדוק כפילות מולו
            if (findDuplicateVin(normalized)) { skippedExisting++; return false; }
            if (seenInBatch.has(normalized)) { skippedInBatch++; return false; }
            seenInBatch.add(normalized);
            return true;
          });

          if (skippedExisting > 0 || skippedInBatch > 0) {
            const parts = [];
            if (skippedExisting > 0) parts.push(`${skippedExisting} כבר קיימים במערכת`);
            if (skippedInBatch > 0) parts.push(`${skippedInBatch} כפולים בתוך הקובץ`);
            showMessage('error', `⚠️ דולגו ${skippedExisting + skippedInBatch} רכבים (${parts.join(', ')})`);
          }

          if (importedData.length === 0) {
            showMessage('error', '⚠️ כל הרכבים בקובץ כבר קיימים במערכת - אין מה לייבא');
            excelFileInput.value = '';
            return;
          }

          showPreview();
        } catch (error) {
          showMessage('error', '❌ שגיאה בקריאת הקובץ: ' + error.message);
        }
      };
      reader.readAsArrayBuffer(file);
    });

    function showPreview() {
      const tableHTML = `
        <table class="quick-entry-table" style="font-size: 0.9em;">
          <thead>
            <tr>
              <th>יצרן</th>
              <th>דגם</th>
              <th>שנה</th>
              <th>מספר רכב</th>
              <th>קילומטר</th>
              <th>מחיר (₪)</th>
            </tr>
          </thead>
          <tbody>
            ${importedData.map(car => `
              <tr>
                <td>${car.manufacturer || '-'}</td>
                <td>${car.model || '-'}</td>
                <td>${car.year || '-'}</td>
                <td style="font-size: 0.8em; direction: ltr;">${car.vin || '-'}</td>
                <td>${car.kilometers || '0'}</td>
                <td>${car.price ? parseInt(car.price).toLocaleString('he-IL') : '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <p style="margin-top: 15px; color: #666; text-align: center;">
          📊 סה"כ ${importedData.length} רכבים להוספה
        </p>
      `;
      previewTable.innerHTML = tableHTML;
      importPreview.style.display = 'block';
      importStatus.style.display = 'none';
    }

    importConfirmBtn.addEventListener('click', () => {
      const importedCount = importedData.length;
      cars.push(...importedData);
      saveCars();
      renderInventory();

      importPreview.style.display = 'none';
      importStatus.style.display = 'block';
      importMessage.innerHTML = `✓ <strong>הוספה בהצלחה!</strong><br>${importedCount} רכבים נוספו למלאי`;
      importMessage.style.background = '#c6f6d5';
      importMessage.style.color = '#22543d';
      importMessage.style.border = '2px solid #48bb78';

      excelFileInput.value = '';
      importedData = [];

      setTimeout(() => {
        importStatus.style.display = 'none';
        switchToScreen('screen-inventory');
        showMessage('success', `✓ ${importedCount} רכבים נוספו בהצלחה!`);
      }, 2000);
    });

    importCancelBtn.addEventListener('click', () => {
      importPreview.style.display = 'none';
      importStatus.style.display = 'none';
      excelFileInput.value = '';
      importedData = [];
    });

    // צבעי רקע (עדינים) לתא "מקוריות הרכב" בקובץ המיוצא, לפי סוג הבעלות - לסריקה חזותית מהירה
    const CONDITION_FILL_COLORS = {
      private: 'FFDCEEFB',
      taxi: 'FFFFF3CD',
      rental: 'FFFFE5D0',
      company: 'FFE6E1F5',
      lease: 'FFD4EDDA',
      lease_zero: 'FFC3E6CB',
    };

    // Export to Excel (מעוצב) - תמיד מהמלאי המוצג בפועל (cars), לא מה-database בשרת שעלול להיות לא מסונכרן
    const exportExcelBtn = document.getElementById('exportExcelBtn');
    if (exportExcelBtn) {
      exportExcelBtn.addEventListener('click', async () => {
        const carsToExport = cars.filter(c => !c.sold); // המלאי הפעיל בלבד - לא כולל רכבים שנמכרו (ארכיון)
        if (carsToExport.length === 0) {
          showMessage('error', '⚠️ אין רכבים לייצוא');
          return;
        }

        exportExcelBtn.disabled = true;
        const originalBtnText = exportExcelBtn.textContent;
        exportExcelBtn.textContent = '🔄 מייצא...';

        try {
          const workbook = new ExcelJS.Workbook();
          const sheet = workbook.addWorksheet('רכבים', {
            views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }]
          });

          sheet.columns = [
            { header: 'מספר רכב', key: 'vin', width: 16 },
            { header: 'יצרן', key: 'manufacturer', width: 14 },
            { header: 'דגם', key: 'model', width: 14 },
            { header: 'שנה', key: 'year', width: 8 },
            { header: 'צבע', key: 'color', width: 12 },
            { header: 'קילומטר', key: 'kilometers', width: 12 },
            { header: 'מנוע (CC)', key: 'engine', width: 10 },
            { header: 'יד', key: 'handNumber', width: 6 },
            { header: 'רמת גימור', key: 'trimLevel', width: 16 },
            { header: 'גיר', key: 'transmission', width: 12 },
            { header: 'מקוריות הרכב', key: 'condition', width: 14 },
            { header: 'מחיר (₪)', key: 'price', width: 13 },
            { header: 'טסט עד', key: 'testValidUntil', width: 12 },
            { header: 'הערות', key: 'notes', width: 25 },
            { header: 'תאריך הוספה', key: 'addedDate', width: 14 },
          ];

          carsToExport.forEach(car => {
            sheet.addRow({
              vin: car.vin,
              manufacturer: car.manufacturer,
              model: car.model,
              year: car.year,
              color: car.color,
              kilometers: car.kilometers ? Number(car.kilometers) : '',
              engine: car.engine ? Number(car.engine) : '',
              handNumber: car.handNumber,
              trimLevel: car.trimLevel,
              transmission: car.transmission === 'manual' ? 'ידנית' : 'אוטומטית',
              condition: getConditionLabel(car.condition),
              price: car.price ? Number(car.price) : '',
              testValidUntil: car.testValidUntil,
              notes: car.notes,
              addedDate: car.addedDate,
            });
          });

          // כותרת - רקע אדום של המותג, טקסט לבן ומודגש
          const headerRow = sheet.getRow(1);
          headerRow.height = 24;
          headerRow.eachCell(cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC0392B' } };
            cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = {
              top: { style: 'thin', color: { argb: 'FFA12E20' } },
              bottom: { style: 'thin', color: { argb: 'FFA12E20' } },
            };
          });

          // שורות נתונים - פסים מתחלפים לקריאות + מסגרות עדינות
          sheet.eachRow((row, rowNumber) => {
            if (rowNumber === 1) return;
            const isEven = rowNumber % 2 === 0;
            row.eachCell({ includeEmpty: true }, cell => {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'FFF9F1F0' : 'FFFFFFFF' } };
              cell.border = { bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } } };
              cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });

            // הדגשת מחיר - מודגש, ירוק, בפורמט מטבע
            const priceCell = row.getCell('price');
            if (priceCell.value) {
              priceCell.numFmt = '#,##0 "₪"';
              priceCell.font = { bold: true, color: { argb: 'FF1E7A34' } };
            }

            const kmCell = row.getCell('kilometers');
            if (kmCell.value !== '' && kmCell.value != null) kmCell.numFmt = '#,##0';

            // צביעת "מקוריות הרכב" לפי קטגוריה (השורות מתאימות ל-carsToExport לפי אותו סדר הוספה)
            const car = carsToExport[rowNumber - 2];
            const fillColor = car ? CONDITION_FILL_COLORS[car.condition] : null;
            if (fillColor) {
              const conditionCell = row.getCell('condition');
              conditionCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
              conditionCell.font = { bold: true };
            }
          });

          sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

          const buffer = await workbook.xlsx.writeBuffer();
          const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `newcar-inventory-${new Date().toISOString().split('T')[0]}.xlsx`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);

          showMessage('success', `✓ יוצאו ${carsToExport.length} רכבים לקובץ Excel מעוצב`);
        } catch (error) {
          console.error('שגיאה בייצוא ל-Excel:', error);
          showMessage('error', '❌ שגיאה בייצוא לקובץ Excel');
        } finally {
          exportExcelBtn.disabled = false;
          exportExcelBtn.textContent = originalBtnText;
        }
      });
    }

    // Print car with PDF export button
    window.printCarWithPDF = function(id) {
      try {
        // Try backend PDF export
        window.open(`${API_URL}/export/pdf/${id}`, '_blank');
      } catch (error) {
        // Fallback: print to browser
        printCar(id);
      }
    };

    // הרשאות המשתמש המחובר. ברירת מחדל מגבילה - אם השרת לא זמין, לא נחשוף פעולות רגישות בטעות.
    // ההסתרה כאן היא נוחות בלבד; האכיפה האמיתית מתבצעת בשרת
    let currentUser = { user: '', role: 'limited', canDelete: false, canViewArchive: false };

    async function loadPermissions() {
      try {
        const response = await fetch(`${API_URL}/me`);
        if (response.ok) currentUser = await response.json();
      } catch (e) {
        // נשארים עם ברירת המחדל המגבילה
      }
      applyPermissions();
    }

    function applyPermissions() {
      const archiveNavBtn = document.querySelector('.main-nav-btn[data-screen="screen-archive"]');
      if (archiveNavBtn) archiveNavBtn.style.display = currentUser.canViewArchive ? '' : 'none';

      // אם משתמש מוגבל נמצא במקרה במסך הארכיון - מחזירים אותו למסך ברירת המחדל
      if (!currentUser.canViewArchive) {
        const archiveScreen = document.getElementById('screen-archive');
        if (archiveScreen && archiveScreen.classList.contains('active')) switchToScreen('screen-check');
      }

      renderInventory();
      renderArchive();
    }

    // Initialize
    renderInventory();
    renderArchive();
    checkBackend();
    loadPermissions();
    syncFromBackend();
  </script>
</body>
</html>

```
