// @vitest-environment jsdom
import { useState } from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AmountInput, UsdInput } from './AmountInput';
import { formatMultibtc } from '../lib/format';

/**
 * The parser exactly as it was when the defect shipped. Inlined on purpose: this
 * test documents historical behaviour, so it must not drift when format.ts
 * changes. (It is also why "1,5" used to become 15.)
 */
function legacyParse(text: string): bigint {
  const t = text.trim();
  if (t.length === 0) return 0n;
  const [whole, frac = ''] = t.split('.');
  const wholeBI = BigInt(whole.replace(/[^0-9-]/g, '') || '0');
  const fracBI = BigInt((frac + '00000000').slice(0, 8));
  const sign = whole.trim().startsWith('-') ? -1n : 1n;
  return sign * (wholeBI * 100_000_000n + (sign < 0n ? -fracBI : fracBI));
}

afterEach(cleanup);

/** One keystroke = append a character to whatever actually survived in the DOM. */
function type(input: HTMLInputElement, keys: string) {
  for (const k of keys) {
    fireEvent.change(input, { target: { value: input.value + k } });
  }
}

describe('the defect this component exists to prevent', () => {
  // Verbatim reproduction of the old PositionsEditor / PostIncidentAcquisitionsEditor
  // input: `value` derived from the stored bigint on every render.
  function LegacyInput({ onValue }: { onValue: (v: bigint) => void }) {
    const [v, setV] = useState(0n);
    return (
      <input
        aria-label="legacy"
        value={formatMultibtc(v, 8).replace(/\.?0+$/, '')}
        onChange={(e) => {
          const parsed = legacyParse(e.target.value);
          setV(parsed);
          onValue(parsed);
        }}
      />
    );
  }

  it('typing 1 . 5 into the old input yields 15, not 1.5', () => {
    let last = 0n;
    render(<LegacyInput onValue={(v) => (last = v)} />);
    const input = screen.getByLabelText('legacy') as HTMLInputElement;

    type(input, '1');
    expect(input.value).toBe('1');

    type(input, '.');
    // The dot is gone: React re-applied the formatted bigint to the DOM.
    expect(input.value).toBe('1');

    type(input, '5');
    expect(input.value).toBe('15');
    expect(last).toBe(1_500_000_000n); // 15 multiBTC, a silent 10x
  });
});

describe('AmountInput', () => {
  it('keeps the decimal point and reports 1.5', () => {
    let last = 0n;
    render(<AmountInput value={0n} onValue={(v) => (last = v)} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;

    type(input, '1');
    type(input, '.');
    expect(input.value).toBe('1.'); // survives now
    type(input, '5');

    expect(input.value).toBe('1.5');
    expect(last).toBe(150_000_000n);
  });

  it('accepts a pasted decimal', () => {
    let last = 0n;
    render(<AmountInput value={0n} onValue={(v) => (last = v)} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2.25' } });
    expect(last).toBe(225_000_000n);
  });

  it('does not crash on text the parser rejects, and keeps the last good value', () => {
    let last = 0n;
    render(<AmountInput value={0n} onValue={(v) => (last = v)} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    type(input, '1.5');
    expect(last).toBe(150_000_000n);
    expect(() => fireEvent.change(input, { target: { value: '1.5 BTC' } })).not.toThrow();
    expect(last).toBe(150_000_000n);
  });

  it('re-seeds when the value changes from outside (Prefill from detected)', () => {
    function Harness() {
      const [v, setV] = useState(0n);
      return (
        <>
          <AmountInput value={v} onValue={setV} />
          <button onClick={() => setV(494_200_548n)}>prefill</button>
        </>
      );
    }
    render(<Harness />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    type(input, '1.5');
    expect(input.value).toBe('1.5');
    fireEvent.click(screen.getByText('prefill'));
    expect(input.value).toBe('4.94200548');
  });
});

describe('UsdInput', () => {
  it('keeps the decimal point', () => {
    let last: [] | [number] = [];
    render(<UsdInput value={[]} onValue={(v) => (last = v)} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    type(input, '30000.50');
    expect(input.value).toBe('30000.50');
    expect(last).toEqual([30000.5]);
  });

  it('never stores NaN', () => {
    let last: [] | [number] = [];
    render(<UsdInput value={[]} onValue={(v) => (last = v)} />);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abc' } });
    // Absent, not [NaN]: toEqual would pass for [NaN] against [NaN], so assert
    // the shape directly.
    expect(last).toEqual([]);
    expect(last.length).toBe(0);
  });
});
