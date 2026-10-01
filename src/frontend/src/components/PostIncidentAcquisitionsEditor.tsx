import type { PostIncidentAcquisition } from '../lib/backend';
import { CHAIN_KEYS } from '../lib/wagmi';
import { Field } from './Field';
import { AmountInput, UsdInput } from './AmountInput';

const CHAIN_OPTS: { value: string; label: string }[] = [
  { value: CHAIN_KEYS[1], label: 'Ethereum' },
  { value: CHAIN_KEYS[56], label: 'BSC' },
  { value: CHAIN_KEYS[137], label: 'Polygon' },
  { value: CHAIN_KEYS[7700], label: 'Canto' },
];

export function PostIncidentAcquisitionsEditor({
  items,
  setItems,
}: {
  items: PostIncidentAcquisition[];
  setItems: (v: PostIncidentAcquisition[]) => void;
}) {
  function add() {
    setItems([
      ...items,
      {
        acquisition_date_iso: '',
        chain: CHAIN_KEYS[1],
        amount_multibtc: 0n,
        price_paid_usd: [],
        notes: [],
      },
    ]);
  }
  function update(i: number, v: PostIncidentAcquisition) {
    setItems(items.map((x, idx) => (idx === i ? v : x)));
  }
  function remove(i: number) {
    setItems(items.filter((_, idx) => idx !== i));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-ink-800">Post-incident acquisitions</h4>
        <button type="button" className="btn-primary !px-3 !py-1.5" onClick={add}>
          + Add acquisition
        </button>
      </div>
      <p className="text-xs text-ink-500">
        KPMG has attacked post-incident buyers as "opportunistic". Documenting each acquisition
        with date and price strengthens our defence.
      </p>
      {items.map((a, i) => (
        <div key={i} className="rounded-md border border-ink-200 p-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <Field label="Date" required>
              <input
                type="date"
                className="field-input"
                value={a.acquisition_date_iso}
                onChange={(e) => update(i, { ...a, acquisition_date_iso: e.target.value })}
              />
            </Field>
            <Field label="Chain" required>
              <select
                className="field-input"
                value={a.chain}
                onChange={(e) => update(i, { ...a, chain: e.target.value })}
              >
                {CHAIN_OPTS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount multiBTC" required>
              <AmountInput
                value={a.amount_multibtc}
                placeholder="0.00000000"
                onValue={(v) => update(i, { ...a, amount_multibtc: v })}
              />
            </Field>
            <Field label="Price paid (USD, optional)">
              <UsdInput
                value={a.price_paid_usd}
                onValue={(v) => update(i, { ...a, price_paid_usd: v })}
              />
            </Field>
          </div>
          <Field label="Notes (optional)">
            <input
              className="field-input"
              placeholder="e.g. bought on Curve to redeem during peg dislocation"
              value={a.notes.length > 0 ? a.notes[0] : ''}
              onChange={(e) =>
                update(i, { ...a, notes: e.target.value === '' ? [] : [e.target.value] })
              }
            />
          </Field>
          <div className="flex justify-end">
            <button
              type="button"
              className="text-xs text-red-600 hover:underline"
              onClick={() => remove(i)}
            >
              Remove
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
