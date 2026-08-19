const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Database initialization
const db = new sqlite3.Database('./cars.db', (err) => {
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
      transmission TEXT,
      condition TEXT,
      price INTEGER,
      testValidUntil TEXT,
      notes TEXT,
      addedDate TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
      handNumber TEXT
    )
  `);

  // הכנס נתונים ראשוניים לדוגמה (fallback אם אין חיבור לאינטרנט)
  // הערה: מספר "יד" אינו חלק מהמאגר הפתוח האמיתי של משרד התחבורה (מידע פרטי) - כאן זו דוגמה בלבד
  const ministryVehicles = [
    ['78391203', 'Mazda', '3', 2020, 'לבן', 42000, 1600, 'automatic', '2026-11-30', '2'],
    ['12345678', 'BMW', '320i', 2018, 'שחור', 95000, 1600, 'automatic', '2026-09-15', '1'],
    ['23456789', 'Toyota', 'Corolla', 2019, 'לבן', 45000, 1600, 'automatic', '2026-05-20', '2'],
    ['34567890', 'Volkswagen', 'Golf', 2020, 'אדום', 32000, 1400, 'manual', '2027-01-10', '1'],
    ['45678901', 'Volkswagen', 'Passat', 2015, 'כסוף', 125000, 2000, 'automatic', '2026-07-01', '3'],
    ['56789012', 'Hyundai', 'Elantra', 2017, 'ירוק', 105000, 1600, 'automatic', '2026-08-01', '2'],
  ];

  ministryVehicles.forEach(vehicle => {
    db.run(
      `INSERT OR IGNORE INTO ministry_vehicles (vin, manufacturer, model, year, color, kilometers, engine, transmission, testValidUntil, handNumber) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  const vehicleRes = await fetch(`${baseUrl}?resource_id=053cea08-09bc-40ec-8f7a-156f0677aff3&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: plateNumber }))}`);
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
    handNumber: ''
  };

  const [specResult, historyResult, kmResult] = await Promise.allSettled([
    fetch(`${baseUrl}?resource_id=142afde2-6228-49f9-8a29-9b6c3a0cbe40&filters=${encodeURIComponent(JSON.stringify({ tozeret_cd: vehicle.tozeret_cd, degem_cd: vehicle.degem_cd }))}`).then(r => r.json()),
    fetch(`${baseUrl}?resource_id=bb2355dc-9ec7-4f06-9c3f-3344672171da&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: plateNumber }))}`).then(r => r.json()),
    fetch(`${baseUrl}?resource_id=56063a99-8a3e-4ff4-912e-5966c0279bad&filters=${encodeURIComponent(JSON.stringify({ mispar_rechev: plateNumber }))}`).then(r => r.json()),
  ]);

  if (specResult.status === 'fulfilled' && specResult.value.success && specResult.value.result.records.length > 0) {
    const records = specResult.value.result.records;
    const spec = records.find(r => r.shnat_yitzur == vehicle.shnat_yitzur) || records[0];
    data.engine = spec.nefah_manoa || '';
    data.transmission = spec.automatic_ind == 1 ? 'automatic' : 'manual';
  }

  if (historyResult.status === 'fulfilled' && historyResult.value.success && historyResult.value.result.records.length > 0) {
    data.handNumber = calculateHandNumber(historyResult.value.result.records);
  }

  if (kmResult.status === 'fulfilled' && kmResult.value.success && kmResult.value.result.records.length > 0) {
    const km = kmResult.value.result.records[0].kilometer_test_aharon;
    if (km) data.kilometers = km;
  }

  return data;
}

// API: קבל נתונים לפי מספר רכב - קודם מהבסיס המקומי, ואם לא נמצא מנסה את ה-API האמיתי של משרד התחבורה (data.gov.il)
app.get('/api/vehicle/:vin', (req, res) => {
  const plateNumber = req.params.vin.trim();

  db.get(
    'SELECT * FROM ministry_vehicles WHERE vin = ?',
    [plateNumber],
    async (err, row) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      if (row) {
        res.json({ success: true, data: row, source: 'local' });
        return;
      }

      try {
        const data = await fetchFromGovApi(plateNumber);
        if (data) {
          res.json({ success: true, data, source: 'gov.il' });
          return;
        }
      } catch (e) {
        console.error('שגיאה בפנייה ל-data.gov.il:', e.message);
      }

      res.json({ success: false, message: 'מספר רכב לא נמצא' });
    }
  );
});

// API: הוסף רכב למלאי
app.post('/api/cars', (req, res) => {
  const { vin, manufacturer, model, year, color, kilometers, engine, handNumber, transmission, condition, price, testValidUntil, notes } = req.body;

  db.run(
    `INSERT INTO cars (vin, manufacturer, model, year, color, kilometers, engine, handNumber, transmission, condition, price, testValidUntil, notes, addedDate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [vin, manufacturer, model, year, color, kilometers, engine, handNumber, transmission, condition, price, testValidUntil, notes, new Date().toLocaleDateString('he-IL')],
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
  db.all('SELECT * FROM cars ORDER BY createdAt DESC', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json(rows || []);
    }
  });
});

// API: מחק רכב
app.delete('/api/cars/:id', (req, res) => {
  const id = req.params.id;
  db.run('DELETE FROM cars WHERE id = ?', [id], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ success: true });
    }
  });
});

// API: Export ל-Excel
app.get('/api/export/excel', (req, res) => {
  db.all('SELECT * FROM cars ORDER BY createdAt DESC', async (err, rows) => {
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
  console.log(`📊 Database: ./cars.db\n`);
});
