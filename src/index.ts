const DEFAULT_ALLRATES_URL = 'https://allratestoday.com';
const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1';
const FAWAZ_URL = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1';
const DEFAULT_TIMEOUT = 10000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Provider = 'allrates' | 'frankfurter' | 'fawaz';

export interface CurrencyRatesConfig {
  /**
   * Rate data source. Defaults to `frankfurter` (free, no key) unless an
   * `apiKey` is provided, in which case `allrates` is used.
   *
   * - `allrates`   — allratestoday.com (requires apiKey, 160+ currencies, real-time)
   * - `frankfurter`— frankfurter.app (free, no key, ~30 currencies, ECB daily)
   * - `fawaz`      — fawazahmed0 currency-api (free, no key, 200+ currencies incl. crypto)
   */
  provider?: Provider;
  /** API key for `allrates` provider. Get one free at https://allratestoday.com/register */
  apiKey?: string;
  /** Override the provider base URL */
  baseUrl?: string;
  /** Request timeout in ms (default: 10000) */
  timeout?: number;
}

export interface ConvertResult {
  /** Converted amount */
  amount: number;
  /** Exchange rate used */
  rate: number;
  /** Source currency */
  from: string;
  /** Target currency */
  to: string;
  /** Original amount */
  originalAmount: number;
}

export interface RateResult {
  /** Exchange rate */
  rate: number;
  /** Source currency */
  from: string;
  /** Target currency */
  to: string;
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

let _globalConfig: CurrencyRatesConfig | undefined;

function resolve(config?: CurrencyRatesConfig): Required<Pick<CurrencyRatesConfig, 'provider' | 'timeout'>> & CurrencyRatesConfig {
  const cfg = { ..._globalConfig, ...config };
  const provider: Provider = cfg.provider ?? (cfg.apiKey ? 'allrates' : 'frankfurter');
  const timeout = cfg.timeout ?? DEFAULT_TIMEOUT;
  return { ...cfg, provider, timeout };
}

async function httpGet<T>(url: string, timeout: number, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async function fetchRates(
  from: string,
  targets: string[] | undefined,
  cfg: ReturnType<typeof resolve>,
): Promise<Record<string, number>> {
  const source = from.toUpperCase();
  const targetList = targets?.map(t => t.toUpperCase());

  if (cfg.provider === 'allrates') {
    if (!cfg.apiKey) {
      throw new Error(
        'API key required for `allrates` provider. Call setup({ apiKey: "..." }), or use a free provider: setup({ provider: "frankfurter" }).',
      );
    }
    const url = new URL('/api/v1/rates', cfg.baseUrl || DEFAULT_ALLRATES_URL);
    url.searchParams.set('source', source);
    if (targetList?.length) url.searchParams.set('target', targetList.join(','));

    const raw = await httpGet<
      Array<{ rate: number; target: string }> | { rate: number; target: string }
    >(url.toString(), cfg.timeout, { Authorization: `Bearer ${cfg.apiKey}` });

    const arr = Array.isArray(raw) ? raw : [raw];
    const rates: Record<string, number> = {};
    for (const r of arr) rates[r.target] = r.rate;
    return rates;
  }

  if (cfg.provider === 'frankfurter') {
    const base = (cfg.baseUrl || FRANKFURTER_URL).replace(/\/+$/, '');
    const params = new URLSearchParams({ from: source });
    if (targetList?.length) params.set('to', targetList.join(','));
    const url = `${base}/latest?${params.toString()}`;

    const data = await httpGet<{ base: string; rates: Record<string, number> }>(
      url,
      cfg.timeout,
    );
    // Frankfurter omits the base currency from `rates`; add 1:1 for completeness.
    return { [source]: 1, ...data.rates };
  }

  if (cfg.provider === 'fawaz') {
    const base = cfg.baseUrl || FAWAZ_URL;
    const lower = source.toLowerCase();
    const url = `${base}/currencies/${lower}.json`;

    const data = await httpGet<Record<string, Record<string, number> | string>>(
      url,
      cfg.timeout,
    );
    const table = data[lower] as Record<string, number>;
    if (!table) throw new Error(`Unknown currency: ${source}`);

    const rates: Record<string, number> = {};
    const wanted = targetList?.map(t => t.toLowerCase());
    for (const [code, rate] of Object.entries(table)) {
      if (wanted && !wanted.includes(code)) continue;
      rates[code.toUpperCase()] = rate;
    }
    return rates;
  }

  throw new Error(`Unknown provider: ${cfg.provider}`);
}

async function fetchSymbols(cfg: ReturnType<typeof resolve>): Promise<Record<string, string>> {
  if (cfg.provider === 'allrates') {
    if (!cfg.apiKey) {
      throw new Error('API key required for `allrates` provider.');
    }
    const url = new URL('/api/v1/symbols', cfg.baseUrl || DEFAULT_ALLRATES_URL);
    const data = await httpGet<{ symbols: Record<string, string> }>(
      url.toString(),
      cfg.timeout,
      { Authorization: `Bearer ${cfg.apiKey}` },
    );
    return data.symbols;
  }

  if (cfg.provider === 'frankfurter') {
    const base = (cfg.baseUrl || FRANKFURTER_URL).replace(/\/+$/, '');
    return httpGet<Record<string, string>>(`${base}/currencies`, cfg.timeout);
  }

  if (cfg.provider === 'fawaz') {
    const base = cfg.baseUrl || FAWAZ_URL;
    const data = await httpGet<Record<string, string>>(
      `${base}/currencies.json`,
      cfg.timeout,
    );
    const out: Record<string, string> = {};
    for (const [code, name] of Object.entries(data)) out[code.toUpperCase()] = name;
    return out;
  }

  throw new Error(`Unknown provider: ${cfg.provider}`);
}

// ---------------------------------------------------------------------------
// Fluent builders
// ---------------------------------------------------------------------------

class ConversionFrom {
  constructor(
    private _amount: number,
    private _from: string,
    private _config?: CurrencyRatesConfig,
  ) {}

  async to(currency: string): Promise<ConvertResult> {
    const to = currency.toUpperCase();
    const from = this._from;
    const cfg = resolve(this._config);
    const rates = await fetchRates(from, [to], cfg);
    const rate = rates[to];
    if (rate === undefined) throw new Error(`No rate available for ${from} -> ${to}`);
    return {
      amount: this._amount * rate,
      rate,
      from,
      to,
      originalAmount: this._amount,
    };
  }
}

class ConversionAmount {
  constructor(private _amount: number, private _config?: CurrencyRatesConfig) {}

  from(currency: string): ConversionFrom {
    return new ConversionFrom(this._amount, currency.toUpperCase(), this._config);
  }
}

class RateFrom {
  constructor(private _from: string, private _config?: CurrencyRatesConfig) {}

  async to(currency: string): Promise<RateResult> {
    const to = currency.toUpperCase();
    const from = this._from;
    const cfg = resolve(this._config);
    const rates = await fetchRates(from, [to], cfg);
    const rate = rates[to];
    if (rate === undefined) throw new Error(`No rate available for ${from} -> ${to}`);
    return { rate, from, to };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Configure global options. Call once at app startup.
 *
 * ```ts
 * // Free, no key (default)
 * setup({ provider: 'frankfurter' });
 *
 * // Free with 200+ currencies incl. crypto
 * setup({ provider: 'fawaz' });
 *
 * // AllRatesToday (requires free key from https://allratestoday.com/register)
 * setup({ apiKey: 'art_live_...' });
 * ```
 */
export function setup(config: CurrencyRatesConfig): void {
  _globalConfig = config;
}

/**
 * Convert an amount between currencies using a fluent API.
 *
 * ```ts
 * const result = await Convert(100).from('USD').to('EUR');
 * console.log(result.amount); // 92.45
 * ```
 */
export function Convert(amount: number, config?: CurrencyRatesConfig): ConversionAmount {
  return new ConversionAmount(amount, config);
}

/**
 * Get the live exchange rate between two currencies.
 *
 * ```ts
 * const { rate } = await Rate('USD').to('EUR');
 * ```
 */
export function Rate(fromCurrency: string, config?: CurrencyRatesConfig): RateFrom {
  return new RateFrom(fromCurrency.toUpperCase(), config);
}

/**
 * Get latest rates for a base currency against multiple targets.
 *
 * ```ts
 * const rates = await Rates('USD', ['EUR', 'GBP', 'JPY']);
 * // { EUR: 0.92, GBP: 0.78, JPY: 149.5 }
 * ```
 */
export async function Rates(
  baseCurrency: string,
  targets?: string[],
  config?: CurrencyRatesConfig,
): Promise<Record<string, number>> {
  const cfg = resolve(config);
  return fetchRates(baseCurrency, targets, cfg);
}

/**
 * List supported currency symbols for the active provider.
 *
 * ```ts
 * const symbols = await Symbols();
 * // { USD: 'United States Dollar', EUR: 'Euro', ... }
 * ```
 */
export async function Symbols(config?: CurrencyRatesConfig): Promise<Record<string, string>> {
  const cfg = resolve(config);
  return fetchSymbols(cfg);
}

export default Convert;
