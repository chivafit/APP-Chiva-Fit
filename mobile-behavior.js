/**
 * CHIVA FIT CRM — Mobile Behavior Layer
 *
 * Loaded after all app scripts. Enhances mobile UX without modifying
 * any existing function, selector, or business logic.
 *
 * Responsibilities:
 *  1. Auto-close sidebar when a nav item is tapped
 *  2. Escape key closes sidebar
 *  3. Resize to desktop auto-closes sidebar
 *  4. Touch swipe gestures (left-to-close, edge-swipe-right-to-open)
 *  5. Body scroll lock while sidebar drawer is open
 *  6. Wrap all .chiva-table elements in a scroll container (MutationObserver)
 *  7. Scroll main content to top on route change
 */
(function initMobileBehavior() {
  'use strict';

  /* ── helpers ─────────────────────────────────────────────── */

  var SIDEBAR_BP = 768;

  function isMobile() {
    return window.innerWidth <= SIDEBAR_BP;
  }

  function getSidebar() {
    return document.getElementById('sidebar');
  }

  function isOpen() {
    var s = getSidebar();
    return s ? s.classList.contains('open') : false;
  }

  function safeClose() {
    if (typeof window.closeMobileSidebar === 'function') {
      window.closeMobileSidebar();
    }
  }

  function safeOpen() {
    if (typeof window.openMobileSidebar === 'function') {
      window.openMobileSidebar();
    }
  }

  /* ── 1. AUTO-CLOSE SIDEBAR ON NAV CLICK ─────────────────────
     showPage() does not call closeMobileSidebar(), so the sidebar
     stays open after navigation. We intercept via capture-phase
     delegation to run before app.js route handlers.            */
  document.addEventListener(
    'click',
    function (e) {
      if (!isMobile()) return;
      var navItem = e.target && e.target.closest ? e.target.closest('.nav-item') : null;
      if (!navItem) return;
      // Use rAF so the route change fires first, then we close
      requestAnimationFrame(function () {
        safeClose();
      });
    },
    true /* capture phase */
  );

  /* ── 2. ESCAPE KEY TO CLOSE SIDEBAR ──────────────────────── */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isOpen()) safeClose();
  });

  /* ── 3. CLOSE SIDEBAR WHEN RESIZING TO DESKTOP ───────────── */
  window.addEventListener('resize', function () {
    if (!isMobile() && isOpen()) safeClose();
  });

  /* ── 4. BODY SCROLL LOCK ─────────────────────────────────────
     Watch the sidebar's class list. When 'open' is added on
     mobile, lock body scroll. Remove lock when closed or when
     the viewport reaches desktop width.                        */
  function initScrollLock() {
    var sidebar = getSidebar();
    if (!sidebar) return;

    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        if (m.attributeName !== 'class') return;
        var shouldLock = isMobile() && sidebar.classList.contains('open');
        document.body.classList.toggle('sidebar-open', shouldLock);
      });
    });
    obs.observe(sidebar, { attributes: true });
  }

  /* ── 5. SWIPE GESTURES ───────────────────────────────────────
     Swipe left  ≥60px while sidebar is open  → close
     Swipe right ≥60px starting from left edge (<30px) → open   */
  function initSwipe() {
    var startX = 0;
    var startY = 0;
    var startTime = 0;

    document.addEventListener(
      'touchstart',
      function (e) {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startTime = Date.now();
      },
      { passive: true }
    );

    document.addEventListener(
      'touchend',
      function (e) {
        if (!isMobile()) return;

        var dx = e.changedTouches[0].clientX - startX;
        var dy = e.changedTouches[0].clientY - startY;
        var dt = Date.now() - startTime;

        // Reject slow gestures and vertical scrolls
        if (dt > 420) return;
        if (Math.abs(dy) > Math.abs(dx) * 0.75) return;

        var sidebar = getSidebar();
        if (!sidebar) return;

        // Close: swipe left while sidebar is open
        if (dx < -60 && sidebar.classList.contains('open')) {
          safeClose();
        }

        // Open: swipe right from left edge while sidebar is closed
        if (dx > 60 && startX < 30 && !sidebar.classList.contains('open')) {
          safeOpen();
        }
      },
      { passive: true }
    );
  }

  /* ── 6. WRAP .chiva-table IN SCROLL CONTAINERS ───────────────
     Tables are rendered dynamically by JS without data-label
     attrs. We wrap each table in a .mobile-table-scroll div so
     the container handles overflow-x instead of the table itself.
     MutationObserver catches tables injected after page load.    */
  function wrapTable(table) {
    if (!table || !table.parentElement) return;
    // Already wrapped
    if (table.parentElement.classList.contains('mobile-table-scroll')) return;
    var wrapper = document.createElement('div');
    wrapper.className = 'mobile-table-scroll';
    table.parentElement.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  }

  function wrapAllTables(root) {
    (root || document).querySelectorAll('.chiva-table').forEach(function (t) {
      if (!t.closest('.mobile-table-scroll')) wrapTable(t);
    });
  }

  function initTableWrap() {
    wrapAllTables(document);

    var obs = new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType !== 1) return;
          if (node.classList && node.classList.contains('chiva-table')) {
            if (!node.closest('.mobile-table-scroll')) wrapTable(node);
          } else if (node.querySelectorAll) {
            node.querySelectorAll('.chiva-table').forEach(function (t) {
              if (!t.closest('.mobile-table-scroll')) wrapTable(t);
            });
          }
        });
      });
    });

    var root = document.body || document.documentElement;
    obs.observe(root, { childList: true, subtree: true });
  }

  /* ── 7. SCROLL TO TOP ON ROUTE CHANGE ───────────────────────
     When the user navigates to a new page via hash routing,
     scroll the main content area back to the top.              */
  function initScrollToTop() {
    window.addEventListener('hashchange', function () {
      // Small delay so the page has time to show before scrolling
      setTimeout(function () {
        var mainContent = document.getElementById('main-content');
        if (mainContent) mainContent.scrollTop = 0;
        window.scrollTo({ top: 0, behavior: 'instant' });
      }, 60);
    });
  }

  /* ── INIT ────────────────────────────────────────────────── */
  function init() {
    initScrollLock();
    initSwipe();
    initTableWrap();
    initScrollToTop();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
