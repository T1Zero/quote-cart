/* Quote Cart — storefront runtime
 * Handles: Add-to-Quote click, variant tracking, popup, drawer, storage sync.
 * Defensive across themes: guards on selectors, try/catch on localStorage,
 * graceful degradation if product data can't be parsed.
 */
(function () {
  "use strict";

  if (window.__QUOTE_CART_INITIALIZED__) return;
  window.__QUOTE_CART_INITIALIZED__ = true;

  var STORAGE_KEY = "quote_cart";
  var GCLID_KEY = "quote_cart_gclid";
  var GCLID_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

  var STRINGS = window.QUOTE_CART_STRINGS || {};
  var CONFIG = window.QUOTE_CART_CONFIG || {};

  // ----- Storage helpers (try/catch everywhere — themes can disable storage) -----
  function readCart() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        localStorage.removeItem(STORAGE_KEY);
        return [];
      }
      return parsed;
    } catch (err) {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch (_) {}
      console.warn("[QuoteCart] localStorage corrupt — reset.", err);
      return [];
    }
  }
  function writeCart(items) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (err) {
      console.warn("[QuoteCart] localStorage write failed.", err);
    }
  }

  function dispatchUpdate(items) {
    try {
      window.dispatchEvent(
        new CustomEvent("quote:updated", { detail: { items: items } })
      );
    } catch (e) {
      // Old IE fallback — irrelevant on Shopify, but harmless.
    }
  }

  // ----- gclid persistence (90 days) -----
  function captureGclid() {
    try {
      var params = new URLSearchParams(window.location.search);
      var gclid = params.get("gclid");
      if (!gclid) return;
      localStorage.setItem(
        GCLID_KEY,
        JSON.stringify({ value: gclid, timestamp: Date.now() })
      );
    } catch (_) {}
  }
  function readGclid() {
    try {
      var raw = localStorage.getItem(GCLID_KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.value) return null;
      if (data.timestamp && Date.now() - data.timestamp > GCLID_TTL_MS) {
        localStorage.removeItem(GCLID_KEY);
        return null;
      }
      return data.value;
    } catch (_) {
      return null;
    }
  }

  // ----- Money helper -----
  function fmt(n) {
    var num = Number(n) || 0;
    var currency = CONFIG.shopCurrency || "USD";
    try {
      return new Intl.NumberFormat(CONFIG.locale || undefined, {
        style: "currency",
        currency: currency,
      }).format(num);
    } catch (_) {
      return currency + " " + num.toFixed(2);
    }
  }

  // ----- Read selected variant from product page -----
  // Two paths:
  //  1) inline JSON shipped by the button block (synchronous, no network)
  //  2) fall back to /products/<handle>.js — every theme exposes this.
  // Themes that don't expose `product` to nested blocks crash path 1 silently;
  // path 2 catches them.

  function readProductFromInline() {
    var dataNode = document.querySelector('[id^="qc-product-data-"]');
    if (!dataNode) return null;
    var raw = dataNode.textContent || "";
    if (!raw.trim()) return null;
    try {
      var product = JSON.parse(raw);
      if (product && product.variants && product.variants.length) return product;
    } catch (_) {}
    return null;
  }

  function fetchProductFromUrl() {
    var handleFromUrl = (window.location.pathname.match(/\/products\/([^/?#]+)/) || [])[1];
    var btn = document.querySelector(".qc-add-to-quote");
    var handleFromBtn = btn ? btn.getAttribute("data-qc-product-handle") : "";
    var handle = handleFromUrl || handleFromBtn;
    if (!handle) return Promise.resolve(null);
    return fetch("/products/" + handle + ".js", { credentials: "same-origin" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (p) {
        // Normalize Shopify's /products/<handle>.js shape to our internal shape.
        return {
          id: p.id,
          title: p.title,
          handle: p.handle,
          url: "/products/" + p.handle,
          featured_image:
            (typeof p.featured_image === "string" ? p.featured_image : "") ||
            (p.images && p.images[0]) ||
            "",
          variants: (p.variants || []).map(function (v) {
            return {
              id: v.id,
              title: v.title,
              // Shopify's .js endpoint returns price in cents.
              price: ((v.price || 0) / 100).toFixed(2),
              available: v.available,
              image: v.featured_image ? v.featured_image.src : "",
            };
          }),
        };
      })
      .catch(function (err) {
        console.warn("[QuoteCart] /products/handle.js fetch failed", err);
        return null;
      });
  }

  function getActiveVariantId(product) {
    try {
      var qs = new URLSearchParams(window.location.search);
      if (qs.get("variant")) return qs.get("variant");
    } catch (_) {}
    var sel = document.querySelector('form[action*="/cart/add"] [name="id"]');
    if (sel && sel.value) return sel.value;
    if (product && product.variants && product.variants[0]) return String(product.variants[0].id);
    return null;
  }

  function getActiveQuantity() {
    // Prefer our own block stepper if visible.
    var ownInput = document.querySelector("[data-qc-qty]");
    if (ownInput && ownInput.value) {
      var our = parseInt(ownInput.value, 10);
      if (our && our > 0) return our;
    }
    // Fall back to the theme's product form quantity input.
    var qtyInput = document.querySelector('form[action*="/cart/add"] [name="quantity"]');
    if (qtyInput && qtyInput.value) {
      var q = parseInt(qtyInput.value, 10);
      if (q && q > 0) return q;
    }
    return 1;
  }

  // Bind the +/- buttons inside our block-level quantity stepper.
  function bindBlockQtyStepper() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest && e.target.closest("[data-qc-qty-action]");
      if (!btn) return;
      var stepper = btn.closest(".qc-block-stepper");
      if (!stepper) return;
      var input = stepper.querySelector("[data-qc-qty]");
      if (!input) return;
      var current = parseInt(input.value, 10) || 1;
      var action = btn.getAttribute("data-qc-qty-action");
      if (action === "inc") input.value = String(current + 1);
      else if (action === "dec") input.value = String(Math.max(1, current - 1));
    });
    document.addEventListener("change", function (e) {
      if (e.target.matches && e.target.matches("[data-qc-qty]")) {
        var v = parseInt(e.target.value, 10);
        if (!v || v < 1) e.target.value = "1";
      }
    });
  }

  function buildItemFromProduct(product) {
    if (!product || !product.variants || !product.variants.length) return null;
    var variantId = getActiveVariantId(product);
    var variant = null;
    for (var i = 0; i < product.variants.length; i++) {
      if (String(product.variants[i].id) === String(variantId)) {
        variant = product.variants[i];
        break;
      }
    }
    if (!variant) variant = product.variants[0];
    return {
      productId: String(product.id),
      productTitle: product.title,
      variantId: String(variant.id),
      variantTitle: variant.title === "Default Title" ? "" : variant.title || "",
      image: variant.image || product.featured_image || "",
      price: variant.price,
      quantity: getActiveQuantity(),
    };
  }

  // Synchronous path — returns null if inline JSON missing/broken.
  function readSelectedVariant() {
    var product = readProductFromInline();
    if (!product) return null;
    return buildItemFromProduct(product);
  }

  // ----- Add to quote -----
  function addToQuote(item) {
    var items = readCart();
    var found = false;
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].variantId) === String(item.variantId)) {
        items[i].quantity = (parseInt(items[i].quantity, 10) || 0) + (item.quantity || 1);
        found = true;
        break;
      }
    }
    if (!found) items.push(item);
    writeCart(items);
    dispatchUpdate(items);
    // Custom AddToQuote tracking event (handled in quote-tracking.js)
    try {
      window.dispatchEvent(
        new CustomEvent("AddToQuote", {
          detail: {
            id: item.variantId,
            name: item.productTitle,
            price: parseFloat(item.price) || 0,
            quantity: item.quantity,
            currency: CONFIG.shopCurrency,
          },
        })
      );
    } catch (_) {}
    return items;
  }

  // ----- Popup -----
  var popupEls = null;
  function getPopupEls() {
    if (popupEls) return popupEls;
    popupEls = {
      overlay: document.getElementById("qc-popup-overlay"),
      popup: document.getElementById("qc-popup"),
      thumb: document.getElementById("qc-popup-thumb"),
      product: document.getElementById("qc-popup-product"),
      qty: document.getElementById("qc-popup-qty"),
      title: document.getElementById("qc-popup-title"),
      close: document.getElementById("qc-popup-close"),
      cont: document.getElementById("qc-popup-continue"),
      view: document.getElementById("qc-popup-view"),
    };
    return popupEls;
  }

  var lastFocused = null;
  function trapFocus(e, container) {
    if (e.key !== "Tab") return;
    var focusable = container.querySelectorAll(
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function showPopup(item) {
    var els = getPopupEls();
    if (!els.popup || !els.overlay) return;
    if (els.thumb) {
      if (item.image) {
        els.thumb.src = item.image;
        els.thumb.alt = item.productTitle || "";
        els.thumb.style.visibility = "visible";
      } else {
        els.thumb.style.visibility = "hidden";
      }
    }
    if (els.product) {
      var label = item.productTitle + (item.variantTitle ? " — " + item.variantTitle : "");
      els.product.textContent = label;
    }
    if (els.qty) {
      var qtyLabel = STRINGS.quantity_label || "Quantity";
      var n = parseInt(item.quantity, 10) || 1;
      els.qty.textContent = qtyLabel + ": " + n;
    }
    if (els.title && STRINGS.added) els.title.textContent = STRINGS.added;
    lastFocused = document.activeElement;
    els.overlay.classList.add("qc-active");
    els.popup.classList.add("qc-active");
    els.overlay.setAttribute("aria-hidden", "false");
    els.popup.setAttribute("aria-hidden", "false");
    document.body.classList.add("qc-no-scroll");
    setTimeout(function () {
      // First focus the View Quote button — primary action.
      if (els.view) els.view.focus();
    }, 60);
  }
  function hidePopup() {
    var els = getPopupEls();
    if (!els.popup || !els.overlay) return;
    els.overlay.classList.remove("qc-active");
    els.popup.classList.remove("qc-active");
    els.overlay.setAttribute("aria-hidden", "true");
    els.popup.setAttribute("aria-hidden", "true");
    document.body.classList.remove("qc-no-scroll");
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function bindPopup() {
    var els = getPopupEls();
    if (!els.popup) return;
    if (els.close) els.close.addEventListener("click", hidePopup);
    if (els.cont) els.cont.addEventListener("click", hidePopup);
    if (els.overlay) els.overlay.addEventListener("click", hidePopup);
    document.addEventListener("keydown", function (e) {
      if (els.popup.classList.contains("qc-active")) {
        if (e.key === "Escape") hidePopup();
        else trapFocus(e, els.popup);
      }
    });
  }

  // ----- Drawer -----
  var drawerEls = null;
  function getDrawerEls() {
    if (drawerEls) return drawerEls;
    drawerEls = {
      launcher: document.getElementById("qc-launcher"),
      btn: document.getElementById("qc-launcher-btn"),
      badge: document.getElementById("qc-launcher-badge"),
      drawer: document.getElementById("qc-drawer"),
      overlay: document.getElementById("qc-drawer-overlay"),
      close: document.getElementById("qc-drawer-close"),
      empty: document.getElementById("qc-drawer-empty"),
      items: document.getElementById("qc-drawer-items"),
      count: document.getElementById("qc-drawer-count"),
      subtotal: document.getElementById("qc-drawer-subtotal"),
      cont: document.getElementById("qc-drawer-continue"),
      view: document.getElementById("qc-drawer-view"),
    };
    return drawerEls;
  }

  // Detect any element pinned to the top of the viewport (announcement bar /
  // sticky header) and return its height. The drawer + overlay are offset by
  // this so they don't sit behind the bar.
  function measureTopBarOffset() {
    var selectors = [
      ".announcement-bar",
      ".announcement",
      "[data-section-type=\"announcement-bar\"]",
      "[id*=\"announcement-bar\"]",
      "[id*=\"shopify-section-announcement\"]",
      "[class*=\"announcement-bar\"]",
      ".header__announcement",
      ".header-announcement"
    ];
    var maxBottom = 0;
    for (var i = 0; i < selectors.length; i++) {
      var els = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (!el || !el.getBoundingClientRect) continue;
        // Skip elements we already counted via a different selector.
        if (el.__qcCounted) continue;
        var rect = el.getBoundingClientRect();
        // Only count things actually at the top of the viewport (within 5px)
        // and with a reasonable height (announcement bars are usually 30-80px).
        if (rect.top <= 5 && rect.height > 0 && rect.height < 200) {
          el.__qcCounted = true;
          maxBottom = Math.max(maxBottom, rect.bottom);
        }
      }
    }
    // Reset the marker so subsequent opens re-check.
    setTimeout(function () {
      var all = document.querySelectorAll("[data-qc-counted-tmp]");
      for (var k = 0; k < all.length; k++) all[k].__qcCounted = false;
    }, 0);
    return Math.round(maxBottom);
  }

  function openDrawer() {
    var els = getDrawerEls();
    if (!els.drawer) return;
    lastFocused = document.activeElement;
    if (els.btn) els.btn.setAttribute("aria-expanded", "true");
    // Measure announcement bar each time — themes can show / hide it dynamically.
    var topOffset = measureTopBarOffset();
    var offsetValue = topOffset > 0 ? topOffset + "px" : "0px";
    els.drawer.style.setProperty("--qc-top-offset", offsetValue);
    if (els.overlay) els.overlay.style.setProperty("--qc-top-offset", offsetValue);
    els.drawer.classList.add("qc-active");
    els.overlay && els.overlay.classList.add("qc-active");
    els.drawer.setAttribute("aria-hidden", "false");
    els.overlay && els.overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("qc-no-scroll");
    setTimeout(function () {
      if (els.close) els.close.focus();
    }, 60);
  }
  function closeDrawer() {
    var els = getDrawerEls();
    if (!els.drawer) return;
    if (els.btn) els.btn.setAttribute("aria-expanded", "false");
    els.drawer.classList.remove("qc-active");
    els.overlay && els.overlay.classList.remove("qc-active");
    els.drawer.setAttribute("aria-hidden", "true");
    els.overlay && els.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("qc-no-scroll");
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  function renderDrawer() {
    var els = getDrawerEls();
    if (!els.drawer) return;
    var items = readCart();
    var count = items.reduce(function (s, i) {
      return s + (parseInt(i.quantity, 10) || 0);
    }, 0);
    var subtotal = items.reduce(function (s, i) {
      return s + (parseFloat(i.price) || 0) * (parseInt(i.quantity, 10) || 0);
    }, 0);

    if (els.badge) {
      els.badge.textContent = String(count);
    }
    if (els.count) els.count.textContent = String(count);
    if (els.subtotal) els.subtotal.textContent = fmt(subtotal);

    // Hide launcher when count is 0 (configurable from launcher block).
    if (els.launcher) {
      var hideEmpty = els.launcher.getAttribute("data-hide-when-empty") === "true";
      if (count === 0 && hideEmpty) {
        els.launcher.classList.add("qc-launcher-hidden");
        els.launcher.setAttribute("aria-hidden", "true");
      } else {
        els.launcher.classList.remove("qc-launcher-hidden");
        els.launcher.setAttribute("aria-hidden", "false");
      }
    }

    if (els.empty) {
      els.empty.style.display = items.length === 0 ? "block" : "none";
    }
    if (els.items) {
      if (items.length === 0) {
        els.items.innerHTML = "";
      } else {
        var html = "";
        for (var i = 0; i < items.length; i++) {
          var it = items[i];
          var price = parseFloat(it.price) || 0;
          var qty = parseInt(it.quantity, 10) || 1;
          var line = price * qty;
          html +=
            '<div class="qc-drawer-item" data-variant="' + escAttr(it.variantId) + '" role="listitem">' +
              '<div class="qc-drawer-item-thumb">' +
                (it.image ? '<img src="' + escAttr(it.image) + '" alt="" />' : "") +
              "</div>" +
              '<div class="qc-drawer-item-info">' +
                '<span class="qc-drawer-item-title">' + escHtml(it.productTitle) + "</span>" +
                (it.variantTitle ? '<span class="qc-drawer-item-variant">' + escHtml(it.variantTitle) + "</span>" : "") +
                '<div class="qc-drawer-item-row">' +
                  '<div class="qc-stepper" role="group" aria-label="' + escAttr(STRINGS.qty || "Qty") + '">' +
                    '<button type="button" data-action="dec" aria-label="−">−</button>' +
                    '<input type="number" min="1" value="' + qty + '" data-action="qty" aria-label="' + escAttr(STRINGS.qty || "Qty") + '"/>' +
                    '<button type="button" data-action="inc" aria-label="+">+</button>' +
                  "</div>" +
                  '<span class="qc-drawer-item-price">' + fmt(line) + "</span>" +
                "</div>" +
              "</div>" +
              '<button type="button" class="qc-drawer-item-remove" data-action="remove" aria-label="' + escAttr(STRINGS.remove || "Remove") + '">×</button>' +
            "</div>";
        }
        els.items.innerHTML = html;
      }
    }
  }

  function bindDrawer() {
    var els = getDrawerEls();
    if (!els.drawer) return;
    if (els.btn) els.btn.addEventListener("click", openDrawer);
    if (els.close) els.close.addEventListener("click", closeDrawer);
    if (els.overlay) els.overlay.addEventListener("click", closeDrawer);
    if (els.cont) els.cont.addEventListener("click", closeDrawer);

    // Any [data-quote-cart-open-drawer] element opens the drawer (used by the
    // navbar link block, and any custom integration the merchant builds).
    document.addEventListener("click", function (e) {
      var trigger = e.target.closest && e.target.closest("[data-quote-cart-open-drawer]");
      if (!trigger) return;
      e.preventDefault();
      openDrawer();
    });
    document.addEventListener("keydown", function (e) {
      if (els.drawer.classList.contains("qc-active")) {
        if (e.key === "Escape") closeDrawer();
        else trapFocus(e, els.drawer);
      }
    });
    if (els.items) {
      els.items.addEventListener("click", function (e) {
        var btn = e.target.closest && e.target.closest("[data-action]");
        if (!btn) return;
        var row = btn.closest("[data-variant]");
        if (!row) return;
        var variantId = row.getAttribute("data-variant");
        var action = btn.getAttribute("data-action");
        var input = row.querySelector('input[data-action="qty"]');
        var current = input ? parseInt(input.value, 10) || 1 : 1;
        if (action === "inc") updateQty(variantId, current + 1);
        else if (action === "dec") updateQty(variantId, Math.max(1, current - 1));
        else if (action === "remove") removeItem(variantId);
      });
      els.items.addEventListener("change", function (e) {
        if (e.target.matches && e.target.matches('input[data-action="qty"]')) {
          var row = e.target.closest("[data-variant]");
          if (row) updateQty(row.getAttribute("data-variant"), e.target.value);
        }
      });
    }
  }

  function updateQty(variantId, qty) {
    var items = readCart();
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].variantId) === String(variantId)) {
        items[i].quantity = Math.max(1, parseInt(qty, 10) || 1);
      }
    }
    writeCart(items);
    dispatchUpdate(items);
  }
  function removeItem(variantId) {
    var items = readCart().filter(function (it) {
      return String(it.variantId) !== String(variantId);
    });
    writeCart(items);
    dispatchUpdate(items);
  }

  // ----- Add-to-Quote button binding -----
  function bindAddButtons() {
    var buttons = document.querySelectorAll(".qc-add-to-quote");
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      // Avoid double-binding when block re-renders in theme editor.
      if (btn.__qcBound) continue;
      btn.__qcBound = true;
      btn.addEventListener("click", onAddClick);
    }
    // We no longer pre-disable when inline JSON is missing — onAddClick has a
    // /products/<handle>.js fallback that works on every theme.
  }

  function onAddClick(e) {
    var btn = e && e.currentTarget;
    var item = readSelectedVariant();
    if (item && item.variantId) {
      addToQuote(item);
      showPopup(item);
      resetBlockQty();
      return;
    }
    // Fallback — fetch /products/<handle>.js. Disable the button while we fetch
    // so impatient users don't double-add.
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = "0.7";
    }
    fetchProductFromUrl()
      .then(function (product) {
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = "";
        }
        if (!product) {
          console.warn("[QuoteCart] could not determine product. Make sure you're on a product page.");
          return;
        }
        var item = buildItemFromProduct(product);
        if (!item) {
          console.warn("[QuoteCart] product has no variants.");
          return;
        }
        addToQuote(item);
        showPopup(item);
        resetBlockQty();
      })
      .catch(function (err) {
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = "";
        }
        console.warn("[QuoteCart] add failed", err);
      });
  }

  function resetBlockQty() {
    var inputs = document.querySelectorAll("[data-qc-qty]");
    for (var i = 0; i < inputs.length; i++) inputs[i].value = "1";
  }

  // ----- Variant change tracking -----
  function bindVariantWatch() {
    // A change on any input named "id" inside a /cart/add form means the
    // theme has switched the active variant. We don't act immediately —
    // we simply re-read on next click. But we DO need to reflect price
    // changes if the same product is re-added later.
    document.addEventListener("change", function (e) {
      var t = e.target;
      if (!t || !t.matches) return;
      if (
        t.matches('form[action*="/cart/add"] [name="id"]') ||
        t.matches('form[action*="/cart/add"] [data-id]')
      ) {
        // No-op — the next click will pick up the new variant.
      }
    });
  }

  // ----- Cross-tab sync -----
  function bindStorageSync() {
    window.addEventListener("storage", function (e) {
      if (e.key === STORAGE_KEY) {
        renderDrawer();
        dispatchUpdate(readCart());
      }
    });
    window.addEventListener("quote:updated", renderDrawer);
  }

  // ----- Helpers -----
  function escHtml(s) {
    s = String(s == null ? "" : s);
    return s.replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function escAttr(s) {
    return escHtml(s).replace(/'/g, "&#39;");
  }

  // Public API for advanced theme integrations.
  window.QuoteCart = {
    add: function (item) {
      addToQuote(item);
    },
    remove: removeItem,
    update: updateQty,
    items: readCart,
    open: openDrawer,
    close: closeDrawer,
    showPopup: showPopup,
  };

  // ----- Init -----
  function init() {
    captureGclid();
    bindAddButtons();
    bindBlockQtyStepper();
    bindPopup();
    bindDrawer();
    bindVariantWatch();
    bindStorageSync();
    renderDrawer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Theme editor: re-bind on shopify:section:load
  document.addEventListener("shopify:section:load", function () {
    bindAddButtons();
    renderDrawer();
  });
})();
