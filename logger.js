/**
 * Sistema de logging centralizado para o CRM.
 * Em produção, envia logs para o Sentry.
 * Em desenvolvimento, usa console.log normalmente.
 */

import { captureError, captureMessage } from './sentry.js';

const IS_PRODUCTION =
  window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

/**
 * Logger centralizado com níveis de severidade
 */
export const logger = {
  /**
   * Log de debug - apenas em desenvolvimento
   */
  debug(message, context) {
    if (!IS_PRODUCTION) {
      console.log(`[DEBUG] ${message}`, context || '');
    }
  },

  /**
   * Log informativo - apenas em desenvolvimento
   */
  info(message, context) {
    if (!IS_PRODUCTION) {
      console.info(`[INFO] ${message}`, context || '');
    }
  },

  /**
   * Log de warning - envia para Sentry em produção
   */
  warn(message, context) {
    if (IS_PRODUCTION) {
      captureMessage(message, 'warning', context);
    } else {
      console.warn(`[WARN] ${message}`, context || '');
    }
  },

  /**
   * Log de erro - sempre envia para Sentry
   */
  error(message, error, context) {
    if (error instanceof Error) {
      captureError(error, { message, ...context });
    } else {
      captureMessage(`ERROR: ${message}`, 'error', { error, ...context });
    }
    
    if (!IS_PRODUCTION) {
      console.error(`[ERROR] ${message}`, error, context || '');
    }
  },

  /**
   * Log de operação de sucesso - apenas em desenvolvimento
   */
  success(message, context) {
    if (!IS_PRODUCTION) {
      console.log(`✓ ${message}`, context || '');
    }
  },

  /**
   * Log de operação de banco de dados - apenas em desenvolvimento
   */
  db(operation, details) {
    if (!IS_PRODUCTION) {
      console.log(`[DB] ${operation}`, details || '');
    }
  },

  /**
   * Log de API call - apenas em desenvolvimento
   */
  api(method, endpoint, details) {
    if (!IS_PRODUCTION) {
      console.log(`[API] ${method} ${endpoint}`, details || '');
    }
  },
};

/**
 * Helper para medir performance de operações
 */
export function measurePerformance(label, fn) {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;
  
  if (!IS_PRODUCTION && duration > 100) {
    console.warn(`[PERF] ${label} took ${duration.toFixed(2)}ms`);
  }
  
  return result;
}

/**
 * Helper para medir performance de operações assíncronas
 */
export async function measurePerformanceAsync(label, fn) {
  const start = performance.now();
  const result = await fn();
  const duration = performance.now() - start;
  
  if (!IS_PRODUCTION && duration > 100) {
    console.warn(`[PERF] ${label} took ${duration.toFixed(2)}ms`);
  }
  
  return result;
}
