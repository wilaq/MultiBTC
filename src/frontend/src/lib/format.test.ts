import { describe, it, expect } from 'vitest';
import { formatMultibtc, parseMultibtc, MULTIBTC_SCALE } from './format';

const ok = (t: string) => {
  const r = parseMultibtc(t);
  if (!r.ok) throw new Error(`expected ${JSON.stringify(t)} to parse, got: ${r.error}`);
  return r;
};
const refused = (t: string) => {
  const r = parseMultibtc(t);
  expect(r.ok, `expected ${JSON.stringify(t)} to be refused`).toBe(false);
  return r as { ok: false; error: string };
};

describe('parseMultibtc', () => {
  it('parses plain and fractional amounts', () => {
    expect(ok('1').value).toBe(MULTIBTC_SCALE);
    expect(ok('1.5').value).toBe(150_000_000n);
    expect(ok('0.00000001').value).toBe(1n);
    expect(ok('.5').value).toBe(50_000_000n);
    expect(ok('').value).toBe(0n);
    expect(ok('  2.25  ').value).toBe(225_000_000n);
  });

  it('treats a trailing dot as the integer it currently is', () => {
    // Intentional: "1." is mid-typing. The UI keeps the raw text so the dot
    // survives on screen (see AmountInput) -- the parsed value is still 1.
    expect(ok('1.').value).toBe(ok('1').value);
  });

  // Each of these silently produced a wrong number, or threw, before.
  it('refuses a decimal comma rather than reading it as 10x', () => {
    expect(refused('1,5').error).toMatch(/dot/i);
  });

  it('refuses separators, units, exponents and stray text', () => {
    for (const t of ['1 000.5', '1.5 BTC', '1.2e3', 'abc', '1..5', '1-2', '$1.5']) refused(t);
  });

  it('refuses negatives instead of returning them positive', () => {
    refused('-1.5');
    refused('-1');
  });

  it('refuses a bare dot', () => {
    refused('.');
  });

  it('reports truncation beyond 8 decimals rather than rounding silently', () => {
    const r = ok('1.123456789');
    expect(r.value).toBe(112_345_678n);
    expect(r.truncated).toBe(true);
    expect(ok('1.12345678').truncated).toBe(false);
  });

  it('handles amounts far beyond Number.MAX_SAFE_INTEGER', () => {
    expect(ok('99999999999.99999999').value).toBe(9_999_999_999_999_999_999n);
  });

  it('never throws, whatever it is given', () => {
    for (const t of ['', '   ', '...', '1.5.5', 'NaN', 'Infinity', '٣', '1e', '0x10']) {
      expect(() => parseMultibtc(t)).not.toThrow();
    }
  });
});

describe('formatMultibtc', () => {
  it('round-trips through parseMultibtc at full precision', () => {
    for (const t of ['0.00000001', '1.5', '12345.6789', '99999999999.99999999']) {
      expect(formatMultibtc(ok(t).value, 8)).toBe(
        t.includes('.') ? t.split('.')[0] + '.' + (t.split('.')[1] + '00000000').slice(0, 8) : t,
      );
    }
  });

  it('truncates rather than rounds, and defaults to 6 places', () => {
    expect(formatMultibtc(112_345_678n, 8)).toBe('1.12345678');
    expect(formatMultibtc(112_345_678n)).toBe('1.123456'); // default drops 2 digits
    expect(formatMultibtc(199_999_999n, 0)).toBe('1.');
  });
});
