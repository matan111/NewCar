'use strict';

// Run with NODE_PATH pointing to the application's existing node_modules.
// These tests use only loopback HTTP and sqlite3 ':memory:' databases.
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const express = require('express');
const sqlite3 = require('sqlite3');
const {
  mountInfocarHelper,
  normalizeInvoiceProfile,
  saveInvoiceProfile,
} = require('./infocar-helper');

const OWNER = 'test-owner';
const PROFILE = Object.freeze({
  name: 'עסק בדיקה',
  taxId: '123456782',
  address: 'רחוב הבדיקה 12',
  email: 'invoice@example.test',
  phone: '+972 (50) 123-4567',
});
const EMPTY_PROFILE = { name: '', taxId: '', address: '', email: '', phone: '' };

function memoryDatabase(t) {
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise((resolve, reject) => {
    db.close(error => error ? reject(error) : resolve());
  }));
  return db;
}

async function startHarness(t, options = {}) {
  const db = options.db || memoryDatabase(t);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '16kb' }));
  app.use((req, res, next) => {
    const user = req.get('x-user');
    if (user) req.auth = { user };
    // A demo user may also carry an admin role in the host application.
    req.userRole = req.get('x-role') || 'user';
    next();
  });
  const mounted = mountInfocarHelper(app, {
    db,
    ownerUsername: options.ownerUsername === undefined ? OWNER : options.ownerUsername,
    directory: options.directory || __dirname,
  });
  await mounted.ready;
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  }));
  const port = server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  function request(route, config = {}) {
    const method = config.method || 'GET';
    const user = config.user === undefined ? OWNER : config.user;
    const headers = { ...config.headers };
    if (user !== null) headers['x-user'] = user;
    let payload = config.body;
    if (payload !== undefined && typeof payload !== 'string') payload = JSON.stringify(payload);
    if (payload !== undefined) {
      if (!Object.keys(headers).some(key => key.toLowerCase() === 'content-type')) {
        headers['Content-Type'] = 'application/json';
      }
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path: route, method, headers }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = JSON.parse(raw); } catch { /* A missing script may return HTML. */ }
          resolve({ status: res.statusCode, headers: res.headers, raw, json });
        });
        res.on('error', reject);
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  return { db, mounted, request, origin, port };
}

function assertNoStore(response) {
  assert.match(response.headers['cache-control'] || '', /(?:^|[,\s])no-store(?:$|[,\s])/i);
}

function assertNotEchoed(response, values) {
  for (const value of values) assert.equal(response.raw.includes(value), false, 'Private input must not appear in an error response');
}

test('normalization trims allowed fields and accepts blank optional values', () => {
  const padded = Object.fromEntries(Object.entries(PROFILE).map(([key, value]) => [key, `  ${value}  `]));
  assert.deepEqual(normalizeInvoiceProfile(padded), PROFILE);
  assert.deepEqual(normalizeInvoiceProfile({ name: '  Business  ', address: '  Test address  ' }), {
    name: 'Business', address: 'Test address', taxId: '', email: '', phone: '',
  });
  assert.deepEqual(normalizeInvoiceProfile({ ...PROFILE, taxId: '', email: ' ', phone: '' }), {
    ...PROFILE, taxId: '', email: '', phone: '',
  });
  assert.equal(padded.name, `  ${PROFILE.name}  `, 'Normalization must not mutate its caller');
});

test('normalization accepts valid field values at their maximum lengths', () => {
  const profile = {
    ...PROFILE,
    name: 'n'.repeat(160),
    address: 'a'.repeat(300),
    email: `${'e'.repeat(241)}@example.test`,
    phone: '1'.repeat(32),
  };
  assert.equal(profile.email.length, 254);
  assert.deepEqual(normalizeInvoiceProfile(profile), profile);
});

test('normalization rejects invalid identity fields, types, and lengths', async t => {
  const invalidProfiles = [
    ['missing name', { ...PROFILE, name: undefined }],
    ['blank name', { ...PROFILE, name: '   ' }],
    ['missing address', { ...PROFILE, address: undefined }],
    ['blank address', { ...PROFILE, address: '  ' }],
    ['long name', { ...PROFILE, name: 'a'.repeat(161) }],
    ['long address', { ...PROFILE, address: 'a'.repeat(301) }],
    ['long email', { ...PROFILE, email: `${'a'.repeat(245)}@example.test` }],
    ['long phone', { ...PROFILE, phone: '1'.repeat(33) }],
    ['invalid email', { ...PROFILE, email: 'missing-at.example.test' }],
    ['invalid phone', { ...PROFILE, phone: 'call-me' }],
    ['phone without digits', { ...PROFILE, phone: '+ ( ) -' }],
    ['short tax identifier', { ...PROFILE, taxId: '12345678' }],
    ['long tax identifier', { ...PROFILE, taxId: '1234567820' }],
    ['tax identifier checksum', { ...PROFILE, taxId: '123456789' }],
    ['all-zero tax identifier', { ...PROFILE, taxId: '000000000' }],
    ['tax identifier letters', { ...PROFILE, taxId: '12345678x' }],
    ['numeric tax identifier', { ...PROFILE, taxId: 123456782 }],
    ['object value', { ...PROFILE, email: { secret: 'private' } }],
    ['null value', { ...PROFILE, phone: null }],
    ['HTML in name', { ...PROFILE, name: '<b>Business</b>' }],
    ['control character in address', { ...PROFILE, address: 'Business\u0000address' }],
  ];
  for (const [label, profile] of invalidProfiles) {
    await t.test(label, () => assert.throws(() => normalizeInvoiceProfile(profile)));
  }
});

test('normalization rejects nonplain input, unknown fields, and prototype pollution', () => {
  for (const value of [null, [], 'profile', 123, new Date(), Object.create(PROFILE)]) {
    assert.throws(() => normalizeInvoiceProfile(value));
  }
  for (const field of ['unknown', 'constructor', 'prototype', '__proto__']) {
    const value = JSON.parse(`{"name":"Business","address":"Test address","${field}":{"polluted":true}}`);
    assert.throws(() => normalizeInvoiceProfile(value));
  }
  assert.equal({}.polluted, undefined);
});

test('new owner profile is empty and private', async t => {
  const harness = await startHarness(t);
  const response = await harness.request('/api/infocar/invoice-profile');
  assert.equal(response.status, 200);
  assert.deepEqual(response.json.profile, EMPTY_PROFILE);
  assert.equal(response.json.configured, false);
  assert.equal(response.json.updatedAt, null);
  assertNoStore(response);
});

test('profile and script routes deny missing authentication, demo admins, and other users', async t => {
  const harness = await startHarness(t);
  for (const user of [null, 'demo', 'limited-user', OWNER.toUpperCase(), `${OWNER}-other`]) {
    for (const [route, method] of [
      ['/api/infocar/invoice-profile', 'GET'],
      ['/api/infocar/invoice-profile', 'PUT'],
      ['/infocar-helper.js', 'GET'],
    ]) {
      const response = await harness.request(route, {
        method, user, headers: { Origin: harness.origin, 'x-role': 'admin' },
        ...(method === 'PUT' ? { body: PROFILE } : {}),
      });
      assert.equal(response.status, user === null ? 401 : 403, `${method} ${route}: ${String(user)}`);
      assertNoStore(response);
      assertNotEchoed(response, [PROFILE.address, PROFILE.email, PROFILE.phone, PROFILE.taxId]);
    }
  }
  assert.deepEqual((await harness.mounted.getProfile()).profile, EMPTY_PROFILE);
});

test('missing owner configuration prevents the helper from mounting', async t => {
  await assert.rejects(startHarness(t, { ownerUsername: '' }), /owner username/);
});

test('valid owner writes survive remounting and remain isolated by owner', async t => {
  const db = memoryDatabase(t);
  const first = await startHarness(t, { db });
  const response = await first.request('/api/infocar/invoice-profile', {
    method: 'PUT', headers: { Origin: first.origin }, body: PROFILE,
  });
  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.deepEqual(response.json.profile, PROFILE);
  assert.equal(response.json.configured, true);
  assert.ok(response.json.updatedAt);
  assertNoStore(response);

  const remounted = await startHarness(t, { db });
  const restored = await remounted.request('/api/infocar/invoice-profile');
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.json.profile, PROFILE);
  assert.equal(restored.json.configured, true);
  assert.equal(restored.json.updatedAt, response.json.updatedAt);
  assertNoStore(restored);

  const secondOwner = await startHarness(t, { db, ownerUsername: 'another-owner' });
  assert.deepEqual((await secondOwner.mounted.getProfile()).profile, EMPTY_PROFILE);
  await secondOwner.mounted.saveProfile({ ...PROFILE, name: 'Another business' });
  assert.equal((await secondOwner.mounted.getProfile()).profile.name, 'Another business');
  assert.deepEqual((await first.mounted.getProfile()).profile, PROFILE);
});

test('direct save uses the same validation and safely stores SQL punctuation', async t => {
  const db = memoryDatabase(t);
  const harness = await startHarness(t, { db });
  const quotedProfile = { ...PROFILE, name: "O'Brien; DROP TABLE invoice_profile; --", address: "12 'Quoted' Street" };
  await saveInvoiceProfile(db, quotedProfile, OWNER);
  assert.deepEqual((await harness.mounted.getProfile()).profile, quotedProfile);
  await assert.rejects(async () => saveInvoiceProfile(db, { ...PROFILE, taxId: '123456789' }, OWNER));
  assert.deepEqual((await harness.mounted.getProfile()).profile, quotedProfile);
  await harness.mounted.saveProfile(PROFILE);
  assert.deepEqual((await harness.mounted.getProfile()).profile, PROFILE);
});

test('mutations reject foreign origins, scheme and port changes, and cross-site fetches', async t => {
  const harness = await startHarness(t);
  const hostileHeaders = [
    { Origin: 'https://hostile.invalid' },
    { Origin: `http://127.0.0.1:${harness.port === 65535 ? harness.port - 1 : harness.port + 1}` },
    { Origin: `https://127.0.0.1:${harness.port}` },
    { Origin: 'null' },
    { Origin: harness.origin, 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of hostileHeaders) {
    const response = await harness.request('/api/infocar/invoice-profile', { method: 'PUT', headers, body: PROFILE });
    assert.equal(response.status, 403);
    assertNoStore(response);
    assertNotEchoed(response, [PROFILE.address, PROFILE.email, PROFILE.phone, PROFILE.taxId]);
  }
  assert.deepEqual((await harness.mounted.getProfile()).profile, EMPTY_PROFILE);
});

test('same-origin localhost HTTP requests can save', async t => {
  const harness = await startHarness(t);
  const response = await harness.request('/api/infocar/invoice-profile', {
    method: 'PUT',
    headers: { Host: `localhost:${harness.port}`, Origin: `http://localhost:${harness.port}`, 'Sec-Fetch-Site': 'same-origin' },
    body: PROFILE,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(response.json.profile, PROFILE);
  assertNoStore(response);
});

test('mutations require JSON and validation errors do not disclose submitted values', async t => {
  const harness = await startHarness(t);
  const wrongType = await harness.request('/api/infocar/invoice-profile', {
    method: 'PUT', headers: { Origin: harness.origin, 'Content-Type': 'text/plain' }, body: PROFILE,
  });
  assert.equal(wrongType.status, 415);
  assertNoStore(wrongType);

  const secret = 'PRIVATE_INPUT_MUST_NEVER_APPEAR_IN_ERRORS';
  for (const body of [
    { ...PROFILE, name: secret, email: secret },
    { ...PROFILE, name: secret, unknown: secret },
    JSON.parse(`{"name":"${secret}","address":"Private address","__proto__":{"polluted":true}}`),
  ]) {
    const response = await harness.request('/api/infocar/invoice-profile', {
      method: 'PUT', headers: { Origin: harness.origin }, body,
    });
    assert.equal(response.status, 400);
    assertNoStore(response);
    assert.equal(typeof response.json.error, 'string');
    assertNotEchoed(response, [secret, PROFILE.email, PROFILE.taxId]);
  }
  assert.deepEqual((await harness.mounted.getProfile()).profile, EMPTY_PROFILE);
  assert.equal({}.polluted, undefined);
});

test('owner passes the script gate even when the requested asset is missing', async t => {
  const harness = await startHarness(t, { directory: path.join(__dirname, '__missing_test_assets__') });
  const response = await harness.request('/infocar-helper.js');
  assert.equal(response.status, 404);
  assertNoStore(response);
  assert.equal(response.raw.includes('__missing_test_assets__'), false, 'Asset errors must not expose filesystem paths');
});

test('malformed and oversized JSON return private generic errors', async t => {
  const harness = await startHarness(t);
  const secret = 'PRIVATE_JSON_FRAGMENT_MUST_NOT_LEAK';
  for (const [body, status] of [
    [`{"name":"${secret}","address":`, 400],
    [JSON.stringify({ ...PROFILE, name: secret + 'x'.repeat(17000) }), 413],
  ]) {
    const response = await harness.request('/api/infocar/invoice-profile', {
      method: 'PUT', headers: { Origin: harness.origin }, body,
    });
    assert.equal(response.status, status);
    assertNoStore(response);
    assert.equal(typeof response.json.error, 'string');
    assertNotEchoed(response, [secret, 'SyntaxError', 'PayloadTooLargeError']);
  }
  assert.deepEqual((await harness.mounted.getProfile()).profile, EMPTY_PROFILE);
});

test('database failures return generic errors with no SQL or private data', async t => {
  const harness = await startHarness(t);
  await harness.mounted.saveProfile(PROFILE);
  // This table belongs solely to this test's in-memory database.
  await new Promise((resolve, reject) => {
    harness.db.run('DROP TABLE infocar_invoice_profiles', error => error ? reject(error) : resolve());
  });
  for (const method of ['GET', 'PUT']) {
    const response = await harness.request('/api/infocar/invoice-profile', {
      method, headers: { Origin: harness.origin }, ...(method === 'PUT' ? { body: PROFILE } : {}),
    });
    assert.equal(response.status, 503);
    assertNoStore(response);
    assert.equal(typeof response.json.error, 'string');
    assertNotEchoed(response, [PROFILE.address, PROFILE.email, PROFILE.taxId, 'SQLITE_ERROR', 'infocar_invoice_profiles']);
  }
});
