function bindNavigation() {
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('[data-page]') : null;
    if (!el) return;
    const page = String(el.dataset.page || '').trim();
    if (!page) return;
    const fn = window.showPage;
    if (typeof fn === 'function') fn(page);
  });
}

function pageFromHash() {
  const raw = String(window.location.hash || '')
    .replace(/^#/, '')
    .trim();
  if (!raw) return '';
  if (raw === 'pedidos') return 'pedidos-page';
  if (raw === 'cliente') return '';
  const exists = !!document.getElementById('page-' + raw);
  return exists ? raw : '';
}

function hashFromPage(page) {
  const p = String(page || '').trim();
  if (!p) return '';
  if (p === 'pedidos-page') return '#pedidos';
  if (p === 'cliente') return '';
  return '#' + p;
}

function enableHashNavigation() {
  const original = window.showPage;
  if (typeof original === 'function' && !original._hashWrapped) {
    const wrapped = function (page) {
      original(page);
      const nextHash = hashFromPage(page);
      if (nextHash && window.location.hash !== nextHash) window.location.hash = nextHash;
    };
    wrapped._hashWrapped = true;
    window.showPage = wrapped;
  }

  const initial = pageFromHash();
  if (initial && typeof window.showPage === 'function') window.showPage(initial);

  window.addEventListener('hashchange', () => {
    const page = pageFromHash();
    if (page && typeof window.showPage === 'function') window.showPage(page);
  });
}

function _initController() {
  bindNavigation();
  enableHashNavigation();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initController);
} else {
  _initController();
}
