(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NewCarProfile = api;
}(typeof globalThis === 'object' ? globalThis : window, function () {
  'use strict';

  const fields = Object.freeze(['firstName', 'lastName', 'taxId', 'address']);
  const limits = Object.freeze({ firstName: 80, lastName: 80, taxId: 9, address: 300 });

  function validTaxId(value) {
    if (!/^[0-9]{9}$/.test(value) || /^0+$/.test(value)) return false;
    let sum = 0;
    for (let index = 0; index < value.length; index += 1) {
      const product = Number(value[index]) * (index % 2 === 0 ? 1 : 2);
      sum += product > 9 ? product - 9 : product;
    }
    return sum % 10 === 0;
  }

  function normalize(input) {
    const invalid = () => new Error('invalid_profile');
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw invalid();
    if (Reflect.ownKeys(input).some(key => !fields.includes(key))) throw invalid();

    const profile = {};
    for (const field of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(input, field);
      if (!descriptor || typeof descriptor.value !== 'string') throw invalid();
      const value = descriptor.value;
      if (/[<>\u0000-\u001f\u007f-\u009f]/.test(value)) throw invalid();
      profile[field] = value.trim();
      if (!profile[field] || profile[field].length > limits[field]) throw invalid();
    }
    if (!validTaxId(profile.taxId)) throw invalid();
    return profile;
  }

  function suggestNames(invoiceName) {
    const empty = { lastName: '', firstName: '' };
    if (typeof invoiceName !== 'string' || invoiceName.length > 160 ||
        /[<>\u0000-\u001f\u007f-\u009f]/.test(invoiceName)) return empty;
    const words = invoiceName.trim().split(/\s+/);
    if (words.length !== 2 || words.some(word => !word || word.length > 80)) return empty;
    // This is only a reviewable suggestion. Saving remains an explicit user action.
    return { lastName: words[0], firstName: words[1] };
  }

  function isNewCarUrl(value) {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      if (url.username || url.password || url.pathname !== '/car-reception.html') return false;
      return url.origin === 'https://newcar-production.up.railway.app' ||
        (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'));
    } catch (_) {
      return false;
    }
  }

  function isInfocarUrl(value) {
    if (typeof value !== 'string') return false;
    try {
      const url = new URL(value);
      return !url.username && !url.password &&
        url.origin === 'https://tviot.slika-ins.co.il' &&
        (url.pathname === '/start/5' || url.pathname === '/start/5/');
    } catch (_) {
      return false;
    }
  }

  // Chrome serializes this function for execution in the NewCar tab. Keep every
  // dependency inside it; never read page globals for URLs, roles, or field names.
  async function readFromNewCar() {
    'use strict';
    const codes = {
      wrong_page: 'WRONG_PAGE', source_unavailable: 'FETCH_FAILED', owner_required: 'NOT_OWNER',
      not_configured: 'NO_PROFILE', invalid_profile: 'INVALID_PROFILE'
    };
    const fail = code => ({ ok: false, code: codes[code] });
    try {
      if (window.top !== window) return fail('wrong_page');
      const page = new URL(window.location.href);
      const allowedOrigin = page.origin === 'https://newcar-production.up.railway.app' ||
        (page.protocol === 'http:' && (page.hostname === 'localhost' || page.hostname === '127.0.0.1'));
      if (!allowedOrigin || page.username || page.password || page.pathname !== '/car-reception.html') {
        return fail('wrong_page');
      }

      async function getJson(path) {
        const endpoint = new URL(path, page.origin).href;
        const response = await fetch(endpoint, {
          method: 'GET',
          credentials: 'same-origin',
          cache: 'no-store',
          redirect: 'error',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(10000)
        });
        if (!response || response.ok !== true || response.redirected === true ||
            response.url !== endpoint || !response.headers ||
            !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
          throw new Error('source_unavailable');
        }
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('source_unavailable');
        return data;
      }

      const currentUser = await getJson('/api/me');
      if (currentUser.canManageInfocarProfile !== true) return fail('owner_required');
      const result = await getJson('/api/infocar/invoice-profile');
      if (result.configured !== true) return fail('not_configured');
      if (!result.profile || typeof result.profile !== 'object' || Array.isArray(result.profile)) {
        return fail('invalid_profile');
      }

      const invoice = {};
      for (const [field, limit] of [['name', 160], ['taxId', 9], ['address', 300]]) {
        const value = result.profile[field];
        if (typeof value !== 'string' || /[<>\u0000-\u001f\u007f-\u009f]/.test(value)) {
          return fail('invalid_profile');
        }
        invoice[field] = value.trim();
        if (!invoice[field] || invoice[field].length > limit) return fail('invalid_profile');
      }
      if (!/^[0-9]{9}$/.test(invoice.taxId) || /^0+$/.test(invoice.taxId)) return fail('invalid_profile');
      let checksum = 0;
      for (let index = 0; index < invoice.taxId.length; index += 1) {
        const product = Number(invoice.taxId[index]) * (index % 2 === 0 ? 1 : 2);
        checksum += product > 9 ? product - 9 : product;
      }
      if (checksum % 10 !== 0) return fail('invalid_profile');
      return { ok: true, invoice };
    } catch (_) {
      // No source content, identifiers, network errors, or credentials leave here.
      return fail('source_unavailable');
    }
  }

  return Object.freeze({ normalize, readFromNewCar, suggestNames, isNewCarUrl, isInfocarUrl });
}));
