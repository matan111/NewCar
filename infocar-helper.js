'use strict';

const path = require('path');

const PROFILE_FIELDS = Object.freeze(['name', 'taxId', 'address', 'email', 'phone']);
const FIELD_LIMITS = Object.freeze({ name: 160, taxId: 9, address: 300, email: 254, phone: 32 });
const schemaPromises = new WeakMap();

function invalidProfile() {
  const error = new Error('פרטי החשבונית אינם תקינים');
  error.status = 400;
  return error;
}

function validTaxId(value) {
  if (!/^[0-9]{9}$/.test(value) || /^0+$/.test(value)) return false;
  const checksum = [...value].reduce((sum, digit, index) => {
    const product = Number(digit) * (index % 2 === 0 ? 1 : 2);
    return sum + (product > 9 ? product - 9 : product);
  }, 0);
  return checksum % 10 === 0;
}

function normalizeInvoiceProfile(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidProfile();
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw invalidProfile();
  if (Reflect.ownKeys(input).some(key => !PROFILE_FIELDS.includes(key))) throw invalidProfile();

  const profile = {};
  for (const field of PROFILE_FIELDS) {
    const value = Object.prototype.hasOwnProperty.call(input, field) ? input[field] : '';
    if (typeof value !== 'string' || /[<>\u0000-\u001f\u007f]/.test(value)) {
      throw invalidProfile();
    }
    profile[field] = value.trim();
    if (profile[field].length > FIELD_LIMITS[field]) throw invalidProfile();
  }

  if (!profile.name || !profile.address) throw invalidProfile();
  if (profile.taxId && !validTaxId(profile.taxId)) throw invalidProfile();
  if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) throw invalidProfile();
  if (profile.phone && (!/^[+0-9() .-]+$/.test(profile.phone) || !/[0-9]/.test(profile.phone))) throw invalidProfile();
  return profile;
}

function ownerKey(ownerUsername) {
  if (typeof ownerUsername !== 'string' || !ownerUsername.trim() || ownerUsername.length > 200 || /[\u0000-\u001f\u007f]/.test(ownerUsername)) {
    throw new Error('Infocar helper requires an owner username');
  }
  return ownerUsername;
}

function run(db, sql, values = []) {
  return new Promise((resolve, reject) => db.run(sql, values, function (error) {
    if (error) reject(error);
    else resolve();
  }));
}

function get(db, sql, values = []) {
  return new Promise((resolve, reject) => db.get(sql, values, (error, row) => error ? reject(error) : resolve(row)));
}

function ensureSchema(db) {
  if (!schemaPromises.has(db)) {
    const ready = run(db, `CREATE TABLE IF NOT EXISTS infocar_invoice_profiles (
      ownerUsername TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      taxId TEXT NOT NULL,
      address TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )`);
    // Retain the rejection for route handlers without logging private storage errors.
    ready.catch(() => {});
    schemaPromises.set(db, ready);
  }
  return schemaPromises.get(db);
}

function resultFor(row) {
  const profile = Object.fromEntries(PROFILE_FIELDS.map(field => [field, row ? row[field] : '']));
  return { profile, configured: Boolean(row), updatedAt: row ? row.updatedAt : null };
}

async function getInvoiceProfile(db, ownerUsername) {
  const owner = ownerKey(ownerUsername);
  await ensureSchema(db);
  const row = await get(db,
    'SELECT name, taxId, address, email, phone, updatedAt FROM infocar_invoice_profiles WHERE ownerUsername = ?',
    [owner]);
  return resultFor(row);
}

// Used by the owner-protected route and optional explicit local setup. No values are logged.
async function saveInvoiceProfile(db, input, ownerUsername) {
  const owner = ownerKey(ownerUsername);
  const profile = normalizeInvoiceProfile(input);
  const updatedAt = new Date().toISOString();
  await ensureSchema(db);
  await run(db, `INSERT INTO infocar_invoice_profiles (ownerUsername, name, taxId, address, email, phone, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ownerUsername) DO UPDATE SET
      name = excluded.name, taxId = excluded.taxId, address = excluded.address,
      email = excluded.email, phone = excluded.phone, updatedAt = excluded.updatedAt`,
  [owner, ...PROFILE_FIELDS.map(field => profile[field]), updatedAt]);
  return { profile, configured: true, updatedAt };
}

function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
  next();
}

function sameOriginJson(req, res, next) {
  if (req.get('Sec-Fetch-Site') === 'cross-site') {
    return res.status(403).json({ error: 'מקור הבקשה אינו מורשה' });
  }
  const origin = req.get('Origin');
  if (origin) {
    try {
      // The main application also honors this proxy header when issuing secure cookies.
      const protocol = req.secure || req.get('X-Forwarded-Proto') === 'https' ? 'https' : 'http';
      const expected = new URL(protocol + '://' + req.get('Host')).origin;
      const parsed = new URL(origin);
      if (parsed.origin !== origin || parsed.origin !== expected) {
        return res.status(403).json({ error: 'מקור הבקשה אינו מורשה' });
      }
    } catch {
      return res.status(403).json({ error: 'מקור הבקשה אינו מורשה' });
    }
  }
  if (!req.is('application/json')) {
    return res.status(415).json({ error: 'הבקשה חייבת להישלח כ־JSON' });
  }
  next();
}

function mountInfocarHelper(app, { db, ownerUsername, directory = __dirname }) {
  const owner = ownerKey(ownerUsername);
  const ready = ensureSchema(db);
  const requireOwner = (req, res, next) => {
    if (!req.auth || typeof req.auth.user !== 'string' || !req.auth.user) {
      return res.status(401).json({ error: 'נדרשת התחברות למערכת' });
    }
    if (req.auth.user !== owner) {
      return res.status(403).json({ error: 'אין לך הרשאה לבצע פעולה זו' });
    }
    next();
  };
  const json = handler => async (req, res) => {
    try {
      await ready;
      await handler(req, res);
    } catch (error) {
      const invalid = error && error.status === 400;
      res.status(invalid ? 400 : 503).json({ error: invalid ? 'פרטי החשבונית אינם תקינים' : 'פרטי החשבונית אינם זמינים כרגע' });
    }
  };

  app.use(['/api/infocar/invoice-profile', '/infocar-helper.js', '/infocar-chrome', '/api/infocar/chrome-download'], noStore, requireOwner);
  app.get('/infocar-chrome', (req, res) => {
    res.sendFile(path.resolve(directory, 'infocar-chrome.html'), { cacheControl: false });
  });
  app.get('/api/infocar/chrome-download', (req, res) => {
    res.download(path.resolve(directory, 'infocar-chrome.zip'), 'newcar-infocar-chrome.zip', error => {
      if (error && !res.headersSent) res.status(503).json({ error: 'קובץ ההתקנה אינו זמין כרגע' });
    });
  });
  app.get('/api/infocar/invoice-profile', json(async (req, res) => {
    res.json(await getInvoiceProfile(db, owner));
  }));
  app.put('/api/infocar/invoice-profile', sameOriginJson, json(async (req, res) => {
    res.json({ success: true, ...await saveInvoiceProfile(db, req.body, owner) });
  }));
  app.get('/infocar-helper.js', (req, res) => {
    res.sendFile(path.resolve(directory, 'infocar-helper-ui.js'), { cacheControl: false }, error => {
      if (!error || res.headersSent) return;
      res.status(error.status === 404 ? 404 : 503).json({ error: 'עוזר הדוח אינו זמין כרגע' });
    });
  });
  // The application's JSON parser runs before authentication and these routes.
  // Catch its failures here so Express never prints submitted invoice fragments.
  app.use('/api/infocar/invoice-profile', (error, req, res, next) => {
    if (res.headersSent) return next(error);
    noStore(req, res, () => {});
    const status = error && error.type === 'entity.too.large' ? 413 : 400;
    res.status(status).json({ error: 'הבקשה אינה תקינה' });
  });

  return {
    ready,
    getProfile: () => getInvoiceProfile(db, owner),
    saveProfile: profile => saveInvoiceProfile(db, profile, owner)
  };
}

module.exports = { mountInfocarHelper, normalizeInvoiceProfile, saveInvoiceProfile };
