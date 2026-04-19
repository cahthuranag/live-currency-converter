import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setup, Convert, Rate, Rates, Symbols } from './index';

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockClear();
  vi.stubGlobal('fetch', mockFetch);
  setup({ apiKey: 'art_test_key' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockResponse(data: unknown, ok = true, status = 200) {
  mockFetch.mockResolvedValueOnce({
    ok,
    status,
    statusText: 'OK',
    json: () => Promise.resolve(data),
  });
}

describe('Convert', () => {
  it('converts amount with fluent API', async () => {
    mockResponse({
      from: { currency: 'USD', amount: 100 },
      to: { currency: 'EUR', amount: 92.45 },
      rate: 0.9245,
    });

    const result = await Convert(100).from('USD').to('EUR');

    expect(result.amount).toBe(92.45);
    expect(result.rate).toBe(0.9245);
    expect(result.from).toBe('USD');
    expect(result.to).toBe('EUR');
    expect(result.originalAmount).toBe(100);

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('source')).toBe('USD');
    expect(url.searchParams.get('target')).toBe('EUR');
    expect(url.searchParams.get('amount')).toBe('100');
  });

  it('normalizes currency codes to uppercase', async () => {
    mockResponse({
      from: { currency: 'USD', amount: 50 },
      to: { currency: 'GBP', amount: 39.5 },
      rate: 0.79,
    });

    await Convert(50).from('usd').to('gbp');

    const url = new URL(mockFetch.mock.calls[0][0]);
    expect(url.searchParams.get('source')).toBe('USD');
    expect(url.searchParams.get('target')).toBe('GBP');
  });

  it('throws without API key', async () => {
    setup(undefined as any);
    await expect(Convert(100).from('USD').to('EUR')).rejects.toThrow('API key required');
  });
});

describe('Rate', () => {
  it('gets exchange rate between two currencies', async () => {
    mockResponse({ rate: 0.9245 });

    const result = await Rate('USD').to('EUR');

    expect(result.rate).toBe(0.9245);
    expect(result.from).toBe('USD');
    expect(result.to).toBe('EUR');
  });
});

describe('Rates', () => {
  it('gets multiple rates', async () => {
    mockResponse([
      { rate: 0.92, target: 'EUR', time: '2026-04-19T00:00:00Z' },
      { rate: 0.78, target: 'GBP', time: '2026-04-19T00:00:00Z' },
    ]);

    const rates = await Rates('USD', ['EUR', 'GBP']);

    expect(rates).toEqual({ EUR: 0.92, GBP: 0.78 });
  });

  it('handles single rate response', async () => {
    mockResponse({ rate: 0.92, target: 'EUR', time: '2026-04-19T00:00:00Z' });

    const rates = await Rates('USD', ['EUR']);

    expect(rates).toEqual({ EUR: 0.92 });
  });
});

describe('Symbols', () => {
  it('returns currency symbols', async () => {
    mockResponse({ symbols: { USD: 'United States Dollar', EUR: 'Euro' } });

    const symbols = await Symbols();

    expect(symbols).toEqual({ USD: 'United States Dollar', EUR: 'Euro' });
  });
});

describe('authentication', () => {
  it('sends Bearer token in Authorization header', async () => {
    mockResponse({ rate: 1.0 });

    await Rate('USD').to('USD');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer art_test_key');
  });

  it('supports per-request config override', async () => {
    mockResponse({
      from: { currency: 'USD', amount: 10 },
      to: { currency: 'EUR', amount: 9.2 },
      rate: 0.92,
    });

    await Convert(10, { apiKey: 'art_override_key' }).from('USD').to('EUR');

    const headers = mockFetch.mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer art_override_key');
  });
});

describe('error handling', () => {
  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ error: 'Invalid API key' }),
    });

    await expect(Rate('USD').to('EUR')).rejects.toThrow('Invalid API key');
  });
});
