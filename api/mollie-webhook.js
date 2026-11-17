// Mollie calls this address whenever a payment changes. It only sends the payment id;
// we always read the real status from Mollie ourselves, so nobody can fake a payment here.

const { syncPayment } = require('../lib/sync.js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const id = (req.body && req.body.id) || '';
  if (!/^tr_[A-Za-z0-9]+$/.test(id)) return res.status(400).end();
  try {
    await syncPayment(id);
    res.status(200).end();
  } catch (err) {
    console.error('Webhook failed for', id, err.message, JSON.stringify(err.body || {}));
    res.status(500).end(); // Mollie retries later
  }
};
