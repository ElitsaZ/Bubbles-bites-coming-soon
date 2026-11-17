// Small helpers for HubSpot and Mollie. Keys come from Vercel environment variables, never from this file.

const HS = 'https://api.hubapi.com';
const MOLLIE = 'https://api.mollie.com/v2';

async function call(url, opts, token) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts && opts.headers) }
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = { raw: text }; }
  if (!res.ok) {
    const err = new Error((body && (body.message || body.detail)) || ('HTTP ' + res.status));
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

// ---------- HubSpot ----------

function hsToken() {
  const t = process.env.HUBSPOT_TOKEN;
  if (!t) throw new Error('HUBSPOT_TOKEN is not set in Vercel');
  return t;
}

// Names of properties HubSpot refused (missing property or unknown dropdown option).
function rejectedProps(err) {
  const msg = JSON.stringify(err.body || {});
  const names = new Set();
  const re = /\\?"name\\?"\s*:\s*\\?"([a-z0-9_]+)\\?"/gi;
  let m;
  while ((m = re.exec(msg))) names.add(m[1]);
  return [...names];
}

// Send properties; if HubSpot refuses some, drop those, log them and try again,
// so an order is never lost because one field is set up differently.
async function hsWrite(method, path, properties, extra) {
  let props = { ...properties };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await call(HS + path, { method, body: JSON.stringify({ properties: props, ...(extra || {}) }) }, hsToken());
    } catch (err) {
      const bad = err.status === 400 ? rejectedProps(err).filter(n => n in props) : [];
      if (!bad.length) throw err;
      console.warn('HubSpot refused properties, retrying without them:', bad.join(', '));
      bad.forEach(n => delete props[n]);
    }
  }
  throw new Error('HubSpot write failed');
}

async function upsertContact(props) {
  const found = await call(HS + '/crm/v3/objects/contacts/search', {
    method: 'POST',
    body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: props.email }] }], limit: 1 })
  }, hsToken());
  if (found && found.results && found.results.length) {
    const id = found.results[0].id;
    await hsWrite('PATCH', '/crm/v3/objects/contacts/' + id, props);
    return id;
  }
  const created = await hsWrite('POST', '/crm/v3/objects/contacts', props);
  return created.id;
}

async function createDeal(props, contactId) {
  const created = await hsWrite('POST', '/crm/v3/objects/deals', props, {
    associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] }]
  });
  return created.id;
}

function getDeal(id, props) {
  return call(HS + '/crm/v3/objects/deals/' + id + '?properties=' + props.join(','), { method: 'GET' }, hsToken());
}

function updateDeal(id, props) {
  return hsWrite('PATCH', '/crm/v3/objects/deals/' + id, props);
}

// ---------- Mollie ----------

function mollieKey() {
  const k = process.env.MOLLIE_API_KEY;
  if (!k) throw new Error('MOLLIE_API_KEY is not set in Vercel');
  return k;
}

const mollie = {
  createCustomer: data => call(MOLLIE + '/customers', { method: 'POST', body: JSON.stringify(data) }, mollieKey()),
  createPayment: data => call(MOLLIE + '/payments', { method: 'POST', body: JSON.stringify(data) }, mollieKey()),
  getPayment: id => call(MOLLIE + '/payments/' + encodeURIComponent(id), { method: 'GET' }, mollieKey())
};

// Public address of this deployment (live site or preview link).
function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return 'https://' + host;
}

module.exports = { upsertContact, createDeal, getDeal, updateDeal, mollie, siteUrl };
