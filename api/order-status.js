// The order page asks this after the customer returns from Mollie.
// It also updates HubSpot, in case the webhook has not arrived yet (for example on a protected preview link).

const { syncPayment } = require('../lib/sync.js');

module.exports = async (req, res) => {
  const id = String((req.query && req.query.payment) || '');
  if (!/^tr_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: 'bad_payment' });
  try {
    const r = await syncPayment(id);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ status: r.status, order: r.order });
  } catch (err) {
    console.error('Status check failed for', id, err.message);
    res.status(502).json({ error: 'unavailable' });
  }
};
