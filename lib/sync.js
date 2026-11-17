// Reads a payment from Mollie and writes its result to the HubSpot deal.
// Used by the Mollie webhook and when the customer comes back from paying.
// Safe to run more than once for the same payment.

const CONFIG = require('./config.js');
const { mollie, getDeal, updateDeal } = require('./services.js');

const STATUS = { paid: 'Paid', failed: 'Failed', expired: 'Expired', canceled: 'Canceled', open: 'Pending', pending: 'Pending', authorized: 'Pending' };

async function syncPayment(paymentId) {
  const p = await mollie.getPayment(paymentId);
  const meta = p.metadata || {};
  if (!meta.dealId) return { status: p.status, order: meta.order || null };

  const props = {
    payment_status: STATUS[p.status] || 'Pending',
    last_mollie_payment_id: p.id
  };
  if (p.customerId) props.mollie_customer_id = p.customerId;
  if (p.mandateId) props.mollie_mandate_id = p.mandateId;

  const stages = CONFIG.hubspot.stages;
  // Only move the deal on while it is still waiting for this first payment,
  // so a later call never undoes progress you made in HubSpot.
  const deal = await getDeal(meta.dealId, ['dealstage']);
  const waiting = deal && deal.properties && deal.properties.dealstage === stages.awaitingPayment;
  if (!waiting) {
    await updateDeal(meta.dealId, props);
    return { status: p.status, order: meta.order || null };
  }
  if (p.status === 'paid') {
    props.dealstage = stages.paid;
    if (meta.plan && meta.plan !== 'single') {
      props.subscription_status = 'Active';
      props.next_delivery_date = meta.firstDelivery;
      props.boxes_delivered = 0;
      props.pauses_used = 0;
      props.pause_next_box = 'false';
    }
  } else if (['failed', 'expired', 'canceled'].includes(p.status)) {
    props.dealstage = stages.canceled;
  }

  await updateDeal(meta.dealId, props);
  return { status: p.status, order: meta.order || null };
}

module.exports = { syncPayment };
