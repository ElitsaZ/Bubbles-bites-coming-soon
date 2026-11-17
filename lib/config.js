/*
 * Bubbles & Bites order settings.
 * One file for both the order page (browser) and the checkout scripts (server),
 * so prices, delivery days and the delivery area are always the same in both places.
 * Change prices here, push, and both sides update together.
 */
(function (root) {
  const CONFIG = {
    currency: 'EUR',

    // Price per box, including VAT and delivery.
    plans: {
      single:  { price: 169.99, boxes: 1,  paidBoxes: 1,  hubspot: 'Single',   jotform: 'Single' },
      three:   { price: 139.99, boxes: 3,  paidBoxes: 3,  hubspot: '3 months', jotform: '3 Months' },
      yearly:  { price: 119.99, boxes: 12, paidBoxes: 11, hubspot: 'Yearly',   jotform: 'Yearly' } // 12th box free
    },

    // Price changes per box.
    alcoholFree: {
      none:    { delta: 0,   hubspot: 'None',    jotform: 'None' },
      replace: { delta: -20, hubspot: 'Replace', jotform: 'Replace' },
      extra:   { delta: 30,  hubspot: 'Extra',   jotform: 'Extra' }
    },
    extraBites: 30,

    // Delivery days: 5 = Friday, 6 = Saturday.
    deliveryDays: [5, 6],
    // Orders up to Tuesday 23:59 (Amsterdam time) can still get that week's box.
    weeksAhead: 6,
    // Earliest possible first delivery (YYYY-MM-DD), or null for no limit.
    firstDeliveryFrom: null,
    // Days we do not deliver (holidays), YYYY-MM-DD.
    closedDates: ['2026-12-25', '2026-12-26', '2027-01-01'],

    // Same postcode list as the waiting list.
    deliveryPostcodes: '2011-2037, 2040-2042, 2060-2061, 2101-2106, 2130-2149, 2156-2159, 2165, 1161, 1117-1119, 1435-1438',

    jotformId: '263154744937062',

    hubspot: {
      pipeline: 'default',
      stages: {
        awaitingPayment: 'appointmentscheduled',
        paid: '6457783525',
        active: '6458530029',
        completed: '6457783526',
        canceled: '6457783527'
      }
    }
  };

  const round2 = n => Math.round(n * 100) / 100;

  // Price of the first box and the value of the whole package.
  CONFIG.price = function (plan, alcoholFree, extraBites) {
    const p = CONFIG.plans[plan];
    const a = CONFIG.alcoholFree[alcoholFree] || CONFIG.alcoholFree.none;
    if (!p) return null;
    const firstBox = round2(p.price + a.delta + (extraBites ? CONFIG.extraBites : 0));
    const packageValue = round2(firstBox + p.price * (p.paidBoxes - 1));
    return { firstBox, packageValue, perBox: p.price };
  };

  CONFIG.inArea = function (postcode) {
    const n = parseInt(String(postcode || '').replace(/\s/g, '').slice(0, 4), 10);
    if (isNaN(n)) return false;
    return CONFIG.deliveryPostcodes.split(',').some(r => {
      const [a, b] = r.trim().split('-').map(x => parseInt(x, 10));
      return !isNaN(a) && n >= a && n <= (isNaN(b) ? a : b);
    });
  };

  // Today's date in Amsterdam as YYYY-MM-DD.
  CONFIG.todayAmsterdam = function (now) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now || new Date());
    return parts; // en-CA formats as YYYY-MM-DD
  };

  const addDays = (iso, n) => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const weekday = iso => new Date(iso + 'T12:00:00Z').getUTCDay();

  // Delivery dates someone can choose today.
  CONFIG.availableDates = function (now) {
    const today = CONFIG.todayAmsterdam(now);
    const out = [];
    for (let i = 0; i <= CONFIG.weeksAhead * 7 + 6 && out.length < CONFIG.weeksAhead * CONFIG.deliveryDays.length; i++) {
      const d = addDays(today, i);
      const wd = weekday(d);
      if (!CONFIG.deliveryDays.includes(wd)) continue;
      const tuesday = addDays(d, -((wd - 2 + 7) % 7)); // Tuesday of that week
      if (today > tuesday) continue;
      if (CONFIG.firstDeliveryFrom && d < CONFIG.firstDeliveryFrom) continue;
      if (CONFIG.closedDates.includes(d)) continue;
      out.push(d);
    }
    return out;
  };

  CONFIG.weekdayName = iso => (weekday(iso) === 6 ? 'Saturday' : 'Friday');

  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
  else root.BNB_CONFIG = CONFIG;
})(typeof window !== 'undefined' ? window : this);
