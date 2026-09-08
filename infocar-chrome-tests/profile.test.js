'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const profile = require('../infocar-chrome/profile');

const production = 'https://newcar-production.up.railway.app';
const reception = `${production}/car-reception.html`;

// Generate synthetic checksum fixtures; no user or production identifiers.
function syntheticTaxId(seed = 76543210) {
  const prefix = String(seed).padStart(8, '0');
  let sum = 0;
  for (let index = 0; index < prefix.length; index += 1) {
    const product = Number(prefix[index]) * (index % 2 === 0 ? 1 : 2);
    sum += product > 9 ? product - 9 : product;
  }
  return `${prefix}${(10 - sum % 10) % 10}`;
}

function validProfile(overrides = {}) {
  return { firstName: 'פרטי', lastName: 'בדיקה', taxId: syntheticTaxId(), address: 'כתובת בדיקה 1', ...overrides };
}

function invoiceResult(overrides = {}) {
  return {
    configured: true,
    profile: {
      name: 'בדיקה פרטי', taxId: syntheticTaxId(), address: 'כתובת בדיקה 1',
      email: 'excluded@example.test', phone: 'excluded', password: 'excluded',
      ...overrides
    }
  };
}

function response(body, url, overrides = {}) {
  return {
    ok: true, redirected: false, url,
    headers: { get: name => name.toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null },
    json: async () => body,
    ...overrides
  };
}

function harness(options = {}) {
  const calls = [];
  const timeouts = [];
  const logs = [];
  const window = { location: { href: options.href || reception } };
  window.top = options.frame ? {} : window;
  const context = vm.createContext({
    window, URL,
    AbortSignal: { timeout: milliseconds => { timeouts.push(milliseconds); return { timeout: milliseconds }; } },
    console: Object.fromEntries(['log', 'error', 'warn', 'info', 'debug'].map(method => [method, (...args) => logs.push(args)])),
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (options.fetch) return options.fetch(url, init, calls.length);
      const body = calls.length === 1 ? (options.me || { canManageInfocarProfile: true }) :
        (options.invoice || invoiceResult());
      return response(body, url);
    }
  });
  return {
    calls, timeouts, logs,
    run: async () => JSON.parse(JSON.stringify(await vm.runInContext(`(${profile.readFromNewCar.toString()})()`, context)))
  };
}

test('exports the same browser API without requiring CommonJS', () => {
  const context = vm.createContext({ URL });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../infocar-chrome/profile.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.NewCarProfile).sort(), Object.keys(profile).sort());
  assert.equal(context.NewCarProfile.isNewCarUrl(reception), true);
});

test('normalization returns only required trimmed fields', () => {
  const input = validProfile({ firstName: '  פרטי  ', address: '  כתובת בדיקה 1  ' });
  assert.deepEqual(profile.normalize(input), validProfile());
  assert.notEqual(profile.normalize(input), input);
  assert.deepEqual(profile.normalize(Object.assign(Object.create(null), validProfile())), validProfile());
});

test('normalization accepts field boundaries and rejects oversized fields', () => {
  for (const [field, limit] of [['firstName', 80], ['lastName', 80], ['address', 300]]) {
    assert.equal(profile.normalize(validProfile({ [field]: 'א'.repeat(limit) }))[field].length, limit);
    assert.throws(() => profile.normalize(validProfile({ [field]: 'א'.repeat(limit + 1) })), /invalid_profile/);
  }
});

test('normalization rejects missing, empty, non-string, unexpected, inherited and accessor fields', () => {
  const missing = validProfile();
  delete missing.firstName;
  const inherited = Object.assign(Object.create({ firstName: 'פרטי' }), validProfile());
  delete inherited.firstName;
  const accessor = validProfile();
  Object.defineProperty(accessor, 'firstName', { get() { throw new Error('must not invoke accessors'); } });
  const badInputs = [null, [], 'text', missing, inherited, accessor,
    validProfile({ email: 'excluded@example.test' }), validProfile({ [Symbol('extra')]: 'excluded' })];
  for (const field of ['firstName', 'lastName', 'taxId', 'address']) {
    for (const value of ['', '   ', null, 10, {}, []]) badInputs.push(validProfile({ [field]: value }));
  }
  for (const input of badInputs) assert.throws(() => profile.normalize(input), /invalid_profile/);
});

test('normalization rejects markup and control characters in every field', () => {
  for (const field of ['firstName', 'lastName', 'taxId', 'address']) {
    for (const control of ['<', '>', '\u0000', '\n', '\t', '\r', '\u007f', '\u0085', '\u009f']) {
      assert.throws(() => profile.normalize(validProfile({ [field]: `${control}${validProfile()[field]}` })), /invalid_profile/);
    }
  }
});

test('tax identifiers must have exactly nine digits and a nonzero valid checksum', () => {
  const valid = syntheticTaxId();
  const invalidChecksum = `${valid.slice(0, 8)}${(Number(valid[8]) + 1) % 10}`;
  for (const taxId of ['0'.repeat(9), valid.slice(1), `${valid}0`, invalidChecksum, 'A'.repeat(9), '١'.repeat(9)]) {
    assert.throws(() => profile.normalize(validProfile({ taxId })), /invalid_profile/);
  }
  for (const seed of [76543210, 43210987, 87654321]) {
    assert.equal(profile.normalize(validProfile({ taxId: syntheticTaxId(seed) })).taxId, syntheticTaxId(seed));
  }
});

test('name suggestions are limited to two safe whitespace-separated words', () => {
  assert.deepEqual(profile.suggestNames('  בדיקה   פרטי  '), { lastName: 'בדיקה', firstName: 'פרטי' });
  for (const name of ['', 'בדיקה', 'בדיקה שם פרטי', '<בדיקה> פרטי', 'בדיקה\nפרטי', null, 1, 'א'.repeat(81) + ' פרטי']) {
    assert.deepEqual(profile.suggestNames(name), { lastName: '', firstName: '' });
  }
});

test('NewCar URLs allow only reception on production or HTTP loopback', () => {
  for (const url of [reception, `${reception}?untrusted=https://example.test/#review`,
    'http://localhost:4567/car-reception.html', 'http://127.0.0.1:9876/car-reception.html']) {
    assert.equal(profile.isNewCarUrl(url), true, url);
  }
  for (const url of [null, {}, '', '/car-reception.html', `${production}/`, `${reception}/`,
    `${production}:444/car-reception.html`, `${production}.example.test/car-reception.html`,
    'http://newcar-production.up.railway.app/car-reception.html',
    'https://owner:secret@newcar-production.up.railway.app/car-reception.html',
    'https://localhost/car-reception.html', 'http://localhost.example.test/car-reception.html',
    'http://192.168.1.1/car-reception.html', 'http://[::1]/car-reception.html',
    'file:///car-reception.html', 'https://example.test/car-reception.html']) {
    assert.equal(profile.isNewCarUrl(url), false, String(url));
  }
});

test('Infocar URL matching fixes the HTTPS origin and stage-five route', () => {
  const target = 'https://tviot.slika-ins.co.il/start/5';
  for (const url of [target, `${target}/`, `${target}?key=ignored#details`]) assert.equal(profile.isInfocarUrl(url), true);
  for (const url of [null, {}, '/start/5', `${target}/nested`, `${target}0`,
    'https://tviot.slika-ins.co.il:444/start/5', 'http://tviot.slika-ins.co.il/start/5',
    'https://tviot.slika-ins.co.il.example.test/start/5', 'https://u:p@tviot.slika-ins.co.il/start/5',
    'https://tviot.slika-ins.co.il/start/4']) assert.equal(profile.isInfocarUrl(url), false, String(url));
});

test('serialized importer checks owner capability before importing the three permitted fields', async () => {
  const fixture = harness({ href: `${reception}?next=https://example.test/private#fragment` });
  const result = await fixture.run();
  assert.deepEqual(result, { ok: true, invoice: {
    name: 'בדיקה פרטי', taxId: syntheticTaxId(), address: 'כתובת בדיקה 1'
  } });
  assert.deepEqual(fixture.calls.map(call => call.url), [`${production}/api/me`, `${production}/api/infocar/invoice-profile`]);
  for (const { init } of fixture.calls) {
    assert.equal(init.method, 'GET');
    assert.equal(init.credentials, 'same-origin');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Accept, 'application/json');
    assert.equal(init.body, undefined);
  }
  assert.deepEqual(fixture.timeouts, [10000, 10000]);
  assert.deepEqual(fixture.logs, []);
});

test('serialized importer requires the precise page and top frame before any request', async () => {
  for (const options of [{ frame: true }, { href: 'https://example.test/car-reception.html' },
    { href: `${production}/other.html` }, { href: `${production}:444/car-reception.html` },
    { href: 'https://user:password@newcar-production.up.railway.app/car-reception.html' },
    { href: 'https://tviot.slika-ins.co.il/start/5' }, { href: 'http://192.168.0.2/car-reception.html' }]) {
    const fixture = harness(options);
    assert.deepEqual(await fixture.run(), { ok: false, code: 'WRONG_PAGE' });
    assert.equal(fixture.calls.length, 0);
  }
});

test('HTTP loopback import keeps both requests on the active NewCar origin', async () => {
  for (const origin of ['http://localhost:4567', 'http://127.0.0.1:8765']) {
    const fixture = harness({ href: `${origin}/car-reception.html?url=https://example.test/` });
    assert.equal((await fixture.run()).ok, true);
    assert.deepEqual(fixture.calls.map(call => call.url), [`${origin}/api/me`, `${origin}/api/infocar/invoice-profile`]);
  }
});

test('employee, demo, missing, and truthy-but-not-true capabilities cannot request a profile', async () => {
  for (const me of [{ role: 'employee', canManageInfocarProfile: false },
    { role: 'admin', demo: true, canManageInfocarProfile: false }, {},
    { canManageInfocarProfile: 'true' }, { canManageInfocarProfile: 1 },
    { user: { canManageInfocarProfile: true } }]) {
    const fixture = harness({ me });
    assert.deepEqual(await fixture.run(), { ok: false, code: 'NOT_OWNER' });
    assert.deepEqual(fixture.calls.map(call => call.url), [`${production}/api/me`]);
  }
});

test('redirected, non-JSON, failed and malformed /api/me responses stop before profile access', async () => {
  const variants = [
    url => response({}, url, { redirected: true }),
    url => response({}, 'https://example.test/api/me'),
    url => response({}, url, { ok: false }),
    url => response({}, url, { headers: { get: () => 'text/html' } }),
    url => response({}, url, { json: async () => { throw new Error('sensitive parse error'); } }),
    url => response([], url),
    url => response(null, url),
    () => { throw new Error('sensitive network error'); }
  ];
  for (const variant of variants) {
    const fixture = harness({ fetch: url => variant(url) });
    assert.deepEqual(await fixture.run(), { ok: false, code: 'FETCH_FAILED' });
    assert.equal(fixture.calls.length, 1);
    assert.deepEqual(fixture.logs, []);
  }
});

test('profile import requires configured true and validates copied fields', async () => {
  for (const configured of [false, 'true', 1, null, undefined]) {
    const fixture = harness({ invoice: { ...invoiceResult(), configured } });
    assert.deepEqual(await fixture.run(), { ok: false, code: 'NO_PROFILE' });
  }
  const invalidProfiles = [null, [], {},
    invoiceResult({ name: '' }).profile, invoiceResult({ name: 'א'.repeat(161) }).profile,
    invoiceResult({ address: 'א'.repeat(301) }).profile, invoiceResult({ address: '<script>' }).profile,
    invoiceResult({ name: 'שם\u0000' }).profile, invoiceResult({ taxId: 123 }).profile,
    invoiceResult({ taxId: '0'.repeat(9) }).profile,
    invoiceResult({ taxId: `${syntheticTaxId()}0` }).profile,
    invoiceResult({ taxId: `${syntheticTaxId().slice(0, 8)}${(Number(syntheticTaxId()[8]) + 1) % 10}` }).profile];
  for (const invalid of invalidProfiles) {
    const fixture = harness({ invoice: { configured: true, profile: invalid } });
    assert.deepEqual(await fixture.run(), { ok: false, code: 'INVALID_PROFILE' });
    assert.equal(fixture.calls.length, 2);
    assert.deepEqual(fixture.logs, []);
  }
});

test('profile response errors stay generic and never return source values', async () => {
  for (const override of [{ redirected: true }, { headers: { get: () => 'text/html' } },
    { json: async () => { throw new Error('excluded credential'); } }]) {
    const fixture = harness({ fetch: (url, init, count) => count === 1 ?
      response({ canManageInfocarProfile: true }, url) : response(invoiceResult(), url, override) });
    assert.deepEqual(await fixture.run(), { ok: false, code: 'FETCH_FAILED' });
    assert.equal(fixture.calls.length, 2);
    assert.deepEqual(fixture.logs, []);
  }
});
