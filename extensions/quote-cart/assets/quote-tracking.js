/* Quote Cart — client-side tracking helpers
 * Listens for AddToQuote events from quote-cart.js and pushes them to:
 *   - dataLayer (always)
 *   - fbq if present
 *   - gtag if present
 *
 * The InitiateQuote event fires on the App Proxy quote page itself
 * (see apps.quote.tsx) — this file handles the funnel up to that point.
 */
(function () {
  "use strict";

  if (window.__QUOTE_CART_TRACKING__) return;
  window.__QUOTE_CART_TRACKING__ = true;

  function pushDL(obj) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(obj);
    } catch (_) {}
  }

  // AddToQuote fires from the storefront button (see quote-cart.js).
  window.addEventListener("AddToQuote", function (e) {
    var d = (e && e.detail) || {};
    pushDL({
      event: "add_to_quote",
      ecommerce: {
        currency: d.currency,
        value: (parseFloat(d.price) || 0) * (parseInt(d.quantity, 10) || 1),
        items: [
          {
            item_id: d.id,
            item_name: d.name,
            price: parseFloat(d.price) || 0,
            quantity: parseInt(d.quantity, 10) || 1,
          },
        ],
      },
    });
    if (typeof window.fbq === "function") {
      try {
        window.fbq("trackCustom", "AddToQuote", {
          value: (parseFloat(d.price) || 0) * (parseInt(d.quantity, 10) || 1),
          currency: d.currency,
          content_ids: [d.id],
          content_type: "product",
          contents: [
            {
              id: d.id,
              quantity: parseInt(d.quantity, 10) || 1,
              item_price: parseFloat(d.price) || 0,
            },
          ],
        });
      } catch (_) {}
    }
    if (typeof window.gtag === "function") {
      try {
        window.gtag("event", "add_to_quote", {
          currency: d.currency,
          value: (parseFloat(d.price) || 0) * (parseInt(d.quantity, 10) || 1),
          items: [
            {
              item_id: d.id,
              item_name: d.name,
              price: parseFloat(d.price) || 0,
              quantity: parseInt(d.quantity, 10) || 1,
            },
          ],
        });
      } catch (_) {}
    }
  });
})();
