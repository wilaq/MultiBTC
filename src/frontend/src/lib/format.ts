// multiBTC has 8 decimals, identical to BTC.
export const MULTIBTC_SCALE = 100_000_000n;
export const MULTIBTC_DECIMALS = 8;

export function formatMultibtc(raw: bigint, decimals = 6): string {
  const sign = raw < 0n ? '-' : '';
  const abs = raw < 0n ? -raw : raw;
  const whole = abs / MULTIBTC_SCALE;
  const frac = abs % MULTIBTC_SCALE;
  const fracStr = frac.toString().padStart(8, '0').slice(0, decimals);
  return `${sign}${whole.toString()}.${fracStr}`;
}

export type AmountParse =
  | { ok: true; value: bigint; truncated: boolean }
  | { ok: false; error: string };

/**
 * Text -> base units. Total: never throws, never guesses.
 *
 * The previous version stripped every non-digit from the whole part, so "1,5"
 * became 15 -- a silent 10x for anyone whose keyboard offers a decimal comma.
 * It threw an uncaught SyntaxError from inside React onChange for "1.5 BTC" and
 * "1.2e3", and applied the sign twice so "-1.5" came back positive. These values
 * are signed under penalty of perjury and travel to a liquidator, so anything
 * ambiguous is now refused with a reason instead of interpreted.
 */
export function parseMultibtc(text: string): AmountParse {
  const t = text.trim();
  if (t.length === 0) return { ok: true, value: 0n, truncated: false };

  if (t.includes(',')) {
    return { ok: false, error: 'Use a dot for decimals — 1.5, not 1,5.' };
  }
  if (!/^[0-9]*\.?[0-9]*$/.test(t) || !/[0-9]/.test(t)) {
    return { ok: false, error: 'Enter a plain number like 1.5 — no units, spaces or symbols.' };
  }

  const [whole, frac = ''] = t.split('.');
  const truncated = frac.length > MULTIBTC_DECIMALS;
  const fracPadded = (frac + '00000000').slice(0, MULTIBTC_DECIMALS);
  return {
    ok: true,
    value: BigInt(whole || '0') * MULTIBTC_SCALE + BigInt(fracPadded),
    truncated,
  };
}

export function shortAddress(a: string): string {
  if (!a) return '';
  const lower = a.toLowerCase();
  return `${lower.slice(0, 6)}…${lower.slice(-4)}`;
}

export function formatTsNs(ns: bigint | number): string {
  const ms = typeof ns === 'bigint' ? Number(ns / 1_000_000n) : Math.floor(ns / 1_000_000);
  return new Date(ms).toISOString();
}
