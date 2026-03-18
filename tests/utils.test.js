import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  escapeHTML,
  escapeJsSingleQuote,
  parseDateToIso,
  fmtDateBrFromIso,
  withRetry,
  debounce,
  safeSetItem,
  safeJsonParse,
} from '../utils.js';

// ──────────────────────────────────────────────────────
// escapeHTML
// ──────────────────────────────────────────────────────
describe('escapeHTML', () => {
  it('escapes & < > " \' ` = /', () => {
    expect(escapeHTML('& < > " \' ` = /')).toBe(
      '&amp; &lt; &gt; &quot; &#39; &#96; &#61; &#47;',
    );
  });

  it('returns empty string for null', () => {
    expect(escapeHTML(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(escapeHTML(undefined)).toBe('');
  });

  it('converts numbers to string', () => {
    expect(escapeHTML(42)).toBe('42');
  });

  it('leaves plain text unchanged', () => {
    expect(escapeHTML('hello world')).toBe('hello world');
  });

  it('prevents XSS via script tags', () => {
    const xss = '<script>alert("xss")</script>';
    const escaped = escapeHTML(xss);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  it('handles strings with multiple special chars', () => {
    expect(escapeHTML('<b class="x">Hi</b>')).toBe(
      '&lt;b class&#61;&quot;x&quot;&gt;Hi&lt;&#47;b&gt;',
    );
  });
});

// ──────────────────────────────────────────────────────
// escapeJsSingleQuote
// ──────────────────────────────────────────────────────
describe('escapeJsSingleQuote', () => {
  it('escapes single quotes', () => {
    expect(escapeJsSingleQuote("it's")).toBe("it\\'s");
  });

  it('escapes backslashes', () => {
    expect(escapeJsSingleQuote('a\\b')).toBe('a\\\\b');
  });

  it('escapes carriage return', () => {
    expect(escapeJsSingleQuote('a\rb')).toBe('a\\rb');
  });

  it('escapes newline', () => {
    expect(escapeJsSingleQuote('a\nb')).toBe('a\\nb');
  });

  it('escapes line separator U+2028', () => {
    expect(escapeJsSingleQuote('a\u2028b')).toBe('a\\u2028b');
  });

  it('escapes paragraph separator U+2029', () => {
    expect(escapeJsSingleQuote('a\u2029b')).toBe('a\\u2029b');
  });

  it('returns empty string for falsy input', () => {
    expect(escapeJsSingleQuote('')).toBe('');
    expect(escapeJsSingleQuote(null)).toBe('');
    expect(escapeJsSingleQuote(undefined)).toBe('');
  });
});

// ──────────────────────────────────────────────────────
// parseDateToIso
// ──────────────────────────────────────────────────────
describe('parseDateToIso', () => {
  it('converts BR format dd/mm/yyyy to ISO', () => {
    expect(parseDateToIso('25/12/2024')).toBe('2024-12-25');
  });

  it('accepts ISO format as-is', () => {
    expect(parseDateToIso('2024-12-25')).toBe('2024-12-25');
  });

  it('converts 8-digit string DDMMYYYY to ISO', () => {
    expect(parseDateToIso('25122024')).toBe('2024-12-25');
  });

  it('returns empty string for empty input', () => {
    expect(parseDateToIso('')).toBe('');
    expect(parseDateToIso(null)).toBe('');
    expect(parseDateToIso(undefined)).toBe('');
  });

  it('returns empty string for unrecognized format', () => {
    expect(parseDateToIso('not-a-date')).toBe('');
  });

  it('handles single-digit day/month in BR format', () => {
    // The function returns parts directly without zero-padding
    expect(parseDateToIso('1/3/2024')).toBe('2024-3-1');
  });

  it('strips whitespace', () => {
    expect(parseDateToIso('  2024-01-15  ')).toBe('2024-01-15');
  });
});

// ──────────────────────────────────────────────────────
// fmtDateBrFromIso
// ──────────────────────────────────────────────────────
describe('fmtDateBrFromIso', () => {
  it('converts ISO to BR format', () => {
    expect(fmtDateBrFromIso('2024-12-25')).toBe('25/12/2024');
  });

  it('returns original string for non-ISO input', () => {
    expect(fmtDateBrFromIso('not-a-date')).toBe('not-a-date');
  });

  it('returns empty string for null/undefined', () => {
    expect(fmtDateBrFromIso(null)).toBe('');
    expect(fmtDateBrFromIso(undefined)).toBe('');
  });

  it('is inverse of parseDateToIso for BR input', () => {
    const br = '15/06/2023';
    expect(fmtDateBrFromIso(parseDateToIso(br))).toBe(br);
  });
});

// ──────────────────────────────────────────────────────
// withRetry
// ──────────────────────────────────────────────────────
describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns value on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, 3, 0);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on transient error and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue('success');

    const promise = withRetry(fn, 3, 10);
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws immediately on Unauthorized (non-retryable)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Unauthorized'));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow('Unauthorized');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws immediately on invalid_grant (non-retryable)', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid_grant'));
    await expect(withRetry(fn, 3, 10)).rejects.toThrow('invalid_grant');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after maxAttempts exhausted', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    const promise = withRetry(fn, 3, 10);
    // Attach rejection handler BEFORE advancing timers to avoid unhandled rejection warning
    const assertion = expect(promise).rejects.toThrow('timeout');
    await vi.runAllTimersAsync();
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses exponential backoff delays', async () => {
    const delays = [];
    vi.spyOn(global, 'setTimeout').mockImplementation((fn, delay) => {
      delays.push(delay);
      fn();
      return 0;
    });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('ok');

    await withRetry(fn, 3, 100);
    expect(delays[0]).toBe(100); // 100 * 2^0
    expect(delays[1]).toBe(200); // 100 * 2^1
  });
});

// ──────────────────────────────────────────────────────
// debounce
// ──────────────────────────────────────────────────────
describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls function after delay', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);
    debounced();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resets timer on repeated calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 200);
    debounced();
    vi.advanceTimersByTime(100);
    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes arguments to the wrapped function', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);
    debounced('a', 'b');
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledWith('a', 'b');
  });
});

// ──────────────────────────────────────────────────────
// safeJsonParse (uses localStorage mock via jsdom)
// ──────────────────────────────────────────────────────
describe('safeJsonParse', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns parsed value when key exists', () => {
    localStorage.setItem('test_key', JSON.stringify({ a: 1 }));
    expect(safeJsonParse('test_key', null)).toEqual({ a: 1 });
  });

  it('returns fallback when key does not exist', () => {
    expect(safeJsonParse('missing_key', [])).toEqual([]);
  });

  it('returns fallback and removes key for invalid JSON', () => {
    localStorage.setItem('bad_json', '{not valid json}');
    expect(safeJsonParse('bad_json', 'default')).toBe('default');
    expect(localStorage.getItem('bad_json')).toBeNull();
  });

  it('returns fallback for null value', () => {
    expect(safeJsonParse('undefined_key', 42)).toBe(42);
  });

  it('parses arrays correctly', () => {
    localStorage.setItem('arr', JSON.stringify([1, 2, 3]));
    expect(safeJsonParse('arr', [])).toEqual([1, 2, 3]);
  });
});

// ──────────────────────────────────────────────────────
// safeSetItem (uses localStorage mock via jsdom)
// ──────────────────────────────────────────────────────
describe('safeSetItem', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('sets item normally', () => {
    safeSetItem('key', 'value');
    expect(localStorage.getItem('key')).toBe('value');
  });

  it('handles QuotaExceededError by evicting other keys and retrying', () => {
    // Pre-populate an evictable key before setting up the spy
    const store = {};
    const mockStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: vi.fn((k, v) => { store[k] = v; }),
      removeItem: (k) => { delete store[k]; },
    };
    store['crm_bling_orders'] = '[]';

    // First call throws QuotaExceededError, subsequent calls succeed
    let targetCallCount = 0;
    mockStorage.setItem.mockImplementation((k, v) => {
      if (k === 'target') {
        targetCallCount++;
        if (targetCallCount === 1) {
          const err = new Error('QuotaExceededError');
          err.name = 'QuotaExceededError';
          throw err;
        }
      }
      store[k] = v;
    });

    // Temporarily replace global localStorage methods used by safeSetItem
    const origSetItem = localStorage.setItem.bind(localStorage);
    const origRemoveItem = localStorage.removeItem.bind(localStorage);
    Object.defineProperty(window, 'localStorage', {
      value: mockStorage,
      configurable: true,
    });

    try {
      safeSetItem('target', 'data');
      expect(targetCallCount).toBeGreaterThan(1);
      expect(store['target']).toBe('data');
    } finally {
      // Restore localStorage
      Object.defineProperty(window, 'localStorage', {
        value: { setItem: origSetItem, removeItem: origRemoveItem, getItem: () => null, clear: () => {} },
        configurable: true,
      });
    }
  });

  it('does not throw on non-quota errors', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('SecurityError');
    });
    expect(() => safeSetItem('k', 'v')).not.toThrow();
  });
});
