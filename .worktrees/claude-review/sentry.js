/**
 * Sentry error tracking wrapper.
 * Requer window.APP_CONFIG.sentryDsn preenchido para ativar.
 * O SDK do Sentry deve ser carregado via CDN antes deste módulo.
 */

const DSN = (window.APP_CONFIG && window.APP_CONFIG.sentryDsn) || '';
const RELEASE = 'crm-chivafit@20260317';
const ENV =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'development'
    : 'production';

export function initSentry() {
  if (!DSN || typeof window.Sentry === 'undefined') return;
  window.Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: RELEASE,
    tracesSampleRate: 0.05,
    beforeSend(event) {
      // Remove breadcrumbs que podem conter PII de formulários
      if (event.breadcrumbs) {
        event.breadcrumbs.values = (event.breadcrumbs.values || []).filter(
          (b) => b.category !== 'ui.input',
        );
      }
      return event;
    },
  });
}

export function captureError(error, context) {
  if (typeof window.Sentry !== 'undefined' && DSN) {
    window.Sentry.captureException(error, context ? { extra: context } : undefined);
  }
  console.error('[captureError]', error, context || '');
}

export function captureMessage(message, level, context) {
  const lvl = level || 'warning';
  if (typeof window.Sentry !== 'undefined' && DSN) {
    window.Sentry.captureMessage(message, { level: lvl, extra: context });
  }
  console.warn('[captureMessage]', message, context || '');
}

export function setSentryUser(user) {
  if (typeof window.Sentry !== 'undefined' && DSN) {
    window.Sentry.setUser(user || null);
  }
}
