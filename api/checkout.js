// Receives an order from the order page, checks it, calculates the price itself,
// creates the contact and the order deal in HubSpot, and starts the first payment in Mollie.

const crypto = require('crypto');
const CONFIG = require('../lib/config.js');
const { upsertContact, createDeal, mollie, siteUrl } = require('../lib/services.js');

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 200);

function orderNumber() {
  const d = CONFIG.todayAmsterdam().replace(/-/g, '').slice(2); // YYMMDD
  return 'BB-' + d + '-' + crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const b = req.body || {};

  // ---- Check the order ----
  const o = {
    plan: clean(b.plan, 10),
    alcoholFree: clean(b.alcoholFree, 10) || 'none',
    extraBites: b.extraBites === true,
    allergies: clean(b.allergies, 1000),
    firstDelivery: clean(b.firstDelivery, 10),
    firstName: clean(b.firstName, 80),
    lastName: clean(b.lastName, 80),
    email: clean(b.email, 120).toLowerCase(),
    phone: clean(b.phone, 20).replace(/[^\d+]/g, ''),
    postcode: clean(b.postcode, 7).toUpperCase().replace(/\s/g, ''),
    houseNumber: clean(b.houseNumber, 6),
    addition: clean(b.addition, 8),
    street: clean(b.street, 120),
    city: clean(b.city, 80),
    addressSource: b.addressSource === 'lookup' ? 'lookup' : 'manual',
    deliveryNotes: clean(b.deliveryNotes, 500),
    lang: b.lang === 'en' ? 'en' : 'nl'
  };
  const problems = [];
  if (!CONFIG.plans[o.plan]) problems.push('plan');
  if (!CONFIG.alcoholFree[o.alcoholFree]) problems.push('alcoholFree');
  if (!CONFIG.availableDates().includes(o.firstDelivery)) problems.push('firstDelivery');
  if (!o.firstName || !o.lastName) problems.push('name');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.email)) problems.push('email');
  if (!/^\+\d{8,15}$/.test(o.phone)) problems.push('phone');
  if (!/^\d{4}[A-Z]{2}$/.test(o.postcode) || !CONFIG.inArea(o.postcode)) problems.push('postcode');
  if (!/^\d{1,5}$/.test(o.houseNumber)) problems.push('houseNumber');
  if (!o.street || !o.city) problems.push('address');
  if (b.adult !== true) problems.push('adult');
  if (b.terms !== true) problems.push('terms');
  if (problems.length) return res.status(400).json({ error: 'invalid', fields: problems });

  const price = CONFIG.price(o.plan, o.alcoholFree, o.extraBites);
  const plan = CONFIG.plans[o.plan];
  const order = orderNumber();
  const amount = price.firstBox.toFixed(2);

  try {
    // ---- HubSpot: contact ----
    const contactId = await upsertContact({
      email: o.email,
      firstname: o.firstName,
      lastname: o.lastName,
      phone: o.phone,
      address: o.street,
      house_number: o.houseNumber,
      house_number_addition: o.addition,
      zip: o.postcode,
      city: o.city,
      address_source: o.addressSource,
      delivery_notes: o.deliveryNotes
    });

    // ---- HubSpot: order deal ----
    const dealId = await createDeal({
      dealname: order + ' · ' + plan.hubspot + ' · ' + o.firstName + ' ' + o.lastName,
      pipeline: CONFIG.hubspot.pipeline,
      dealstage: CONFIG.hubspot.stages.awaitingPayment,
      amount: price.packageValue.toFixed(2),
      order_number: order,
      box_plan: plan.hubspot,
      first_delivery_date: o.firstDelivery,
      alcohol_free: CONFIG.alcoholFree[o.alcoholFree].hubspot,
      extra_bites_for_2_more_people: o.extraBites ? 'true' : 'false',
      allergies: o.allergies || 'None',
      n18_confirmed: 'true',
      first_payment_amount: amount,
      payment_status: 'Pending'
    }, contactId);

    // ---- Mollie: first payment ----
    const site = siteUrl(req);
    const recurring = o.plan !== 'single';
    const customer = await mollie.createCustomer({
      name: o.firstName + ' ' + o.lastName,
      email: o.email,
      locale: o.lang === 'en' ? 'en_US' : 'nl_NL',
      metadata: { contactId }
    });
    const payment = await mollie.createPayment({
      amount: { currency: CONFIG.currency, value: amount },
      description: 'Bubbles & Bites ' + order,
      redirectUrl: site + '/order?order=' + encodeURIComponent(order),
      webhookUrl: site + '/api/mollie-webhook',
      customerId: customer.id,
      sequenceType: recurring ? 'first' : 'oneoff',
      locale: o.lang === 'en' ? 'en_US' : 'nl_NL',
      metadata: { order, dealId, contactId, plan: o.plan, firstDelivery: o.firstDelivery }
    });

    res.status(200).json({
      order,
      amount,
      paymentId: payment.id,
      checkoutUrl: payment._links && payment._links.checkout && payment._links.checkout.href
    });
  } catch (err) {
    console.error('Checkout failed', order, err.message, JSON.stringify(err.body || {}));
    res.status(502).json({ error: 'checkout_failed', order });
  }
};
