# 🚗 ניו קאר חדרה - מערכת ניהול קבלת רכבים

מערכת מקצועית להנהלת מלאי רכבים עבור סוכנויות רכב, כולל:
- ✅ קבלת רכבים אוטומטית מ-משרד התחבורה (VIN)
- ✅ ניהול מלאי מלא
- ✅ ייבוא מ-Excel
- ✅ יצוא ל-Excel ו-PDF
- ✅ הדפסה מקצועית

---

## 🚀 התקנה והפעלה

### **1. התקנת תלויות**
```bash
cd NewCar
npm install
```

### **2. הפעלת ה-Server**
```bash
npm start
```

**Output:**
```
🚗 ניו קאר חדרה - Server פתוח על http://localhost:3001
📊 Database: ./cars.db
```

### **3. פתיחת האפליקציה**
- **עם Backend:** http://localhost:3001/car-reception.html
- **ללא Backend (Offline):** פתח את `car-reception.html` ישירות בדפדפן

---

## 📋 תכונות עיקריות

### ✅ **1. קבלת רכב חכמה**
- הקלד VIN ולחץ "🔄 קבל נתונים"
- המערכת תשלוף אוטומטית:
  - יצרן
  - דגם
  - שנה
  - צבע
  - קילומטר
  - מנוע
  - גיר

### ✅ **2. סוגי רכבים**
- פרטי 🚗
- מונית 🚕
- השכרה 🔄
- חברה 🏢
- ליסינג 💼

### ✅ **3. שדות חובה**
- **VIN** (מספר הרכב)
- **סוג הרכב** (פרטי/מונית/וכו')
- **מחיר נדרש** (₪)
- **טסט עד מתי** (תאריך)

### ✅ **4. שדות אופציוניים**
- יצרן, דגם, שנה (מתמלאים בעצמם)
- צבע, קילומטר, מנוע, גיר
- הערות נוספות

### ✅ **5. ייבוא מ-Excel**
```
העמודות הנדרשות:
- VIN
- יצרן
- דגם
- שנה
- צבע
- קילומטר
- מנוע (CC)
- גיר (manual/automatic)
- סוג רכב (private/taxi/rental/company/lease)
- מחיר
- טסט עד
```

### ✅ **6. יצוא**
- **📥 Excel** - ייצוא כל המלאי לקובץ xlsx
- **📄 PDF** - הדפסה מקצועית של רכב ספציפי

---

## 🗄️ Database

### **Tables:**

#### `cars` - מלאי הרכבים
```sql
CREATE TABLE cars (
  id INTEGER PRIMARY KEY,
  vin TEXT,
  manufacturer TEXT,
  model TEXT,
  year INTEGER,
  color TEXT,
  kilometers INTEGER,
  engine INTEGER,
  transmission TEXT,
  condition TEXT,
  price INTEGER,
  testValidUntil TEXT,
  notes TEXT,
  addedDate TEXT,
  createdAt DATETIME
);
```

#### `ministry_vehicles` - משרד התחבורה
מכיל נתונים של רכבים רשומים:
- VIN, יצרן, דגם, שנה, צבע, קילומטר, מנוע, גיר

---

## 🔧 API Endpoints

### **GET** `/api/vehicle/:vin`
שלוף נתוני רכב מ-משרד התחבורה
```bash
curl http://localhost:3001/api/vehicle/WBADT41492G296706
```

### **POST** `/api/cars`
הוסף רכב חדש
```bash
curl -X POST http://localhost:3001/api/cars \
  -H "Content-Type: application/json" \
  -d '{
    "vin": "VIN123",
    "manufacturer": "BMW",
    ...
  }'
```

### **GET** `/api/cars`
קבל כל הרכבים

### **DELETE** `/api/cars/:id`
מחק רכב

### **GET** `/api/export/excel`
ייצוא ל-Excel

### **GET** `/api/export/pdf/:id`
ייצוא ל-PDF (רכב ספציפי)

---

## 📁 מבנה הקבצים

```
NewCar/
├── car-reception.html      # ה-Frontend (HTML/JS/CSS)
├── server.js              # Backend (Express + SQLite)
├── package.json           # תלויות npm
├── cars.db               # Database (SQLite)
├── README.md             # תיעוד זה
├── images/
│   └── newcar-logo.png   # לוגו החברה
└── ...
```

---

## ⚙️ Offline Mode

אם ה-Backend לא זמין, האפליקציה תעבוד ב-Offline Mode:
- ✅ שמירה ב-localStorage (במחשב)
- ✅ חיפוש VIN מ-בסיס נתונים מקומי
- ✅ הדפסה וייצוא (למחשב)

---

## 🎯 דוגמאות VIN זמינים

```
WBADT41492G296706  - BMW 320i (2018)
JTDKM31A923013432  - Toyota Corolla (2019)
VWVOE69M991024269  - Volkswagen Golf (2020)
WVWZZZ3CZ9E123456  - Volkswagen Passat (2015)
LVVDB4JY9GE033866  - Lada Vesta (2021)
NMTEC6D27LY013476  - Mitsubishi Outlander (2016)
```

---

## 📞 תמיכה

לשאלות או בעיות, אנא בדוק את:
1. האם ה-Server פעיל? (`npm start`)
2. האם Node.js מותקן?
3. בדוק את ה-browser console לשגיאות

---

**נוצר ב-2026 | ניו קאר חדרה** 🚗
