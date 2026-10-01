import { useEffect, useMemo, useRef, useState } from 'react';
import { backendActor } from '../lib/auth';
import { unwrap, type HolderPayload, type HolderProfile } from '../lib/backend';
import { Field } from './Field';

const EMPTY: HolderPayload = {
  legal_name: '',
  date_of_birth_iso: '',
  nationality: '',
  country_of_residence: '',
  email: '',
  telegram_handle: [],
  preferred_comm_channel: { Email: null },
  has_filed_pod: false,
  pod_filed_date_iso: [],
  pod_reference: [],
  needs_help_filing_pod: false,
  consent_group_representation: false,
  consent_data_use_for_legal: false,
  ack_engagement_letter_to_follow: false,
  ack_fee_structure: false,
  ack_group_strategy_coordinated: false,
  ack_site_not_affiliated: false,
  truthfully_attested: false,
  fee_preference: { Undecided: null },
  preferred_payment_method: [],
  naming_preference: { WillingToBeNamed: null },
  other_multichain_claims: [],
  additional_documentation_notes: [],
};

function toOpt<T>(v: T | '' | null | undefined): [] | [T] {
  return v === '' || v == null ? [] : [v as T];
}
function fromOpt<T>(o: [] | [T]): T | '' {
  return (o[0] as T | undefined) ?? '';
}

// The two PoD booleans are mutually exclusive in the UI; this enum encodes that.
type PodChoice = 'filed' | 'needs_help' | 'self';

function podChoice(p: HolderPayload): PodChoice {
  if (p.has_filed_pod) return 'filed';
  if (p.needs_help_filing_pod) return 'needs_help';
  return 'self';
}

interface Props {
  initial: HolderProfile | null;
  onSaved: (h: HolderProfile) => void;
}

export function HolderForm({ initial, onSaved }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [form, setForm] = useState<HolderPayload>(EMPTY);
  const errorPanelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initial) {
      setForm({
        legal_name: initial.legal_name,
        date_of_birth_iso: initial.date_of_birth_iso,
        nationality: initial.nationality,
        country_of_residence: initial.country_of_residence,
        email: initial.email,
        telegram_handle: initial.telegram_handle,
        preferred_comm_channel: initial.preferred_comm_channel,
        has_filed_pod: initial.has_filed_pod,
        pod_filed_date_iso: initial.pod_filed_date_iso,
        pod_reference: initial.pod_reference,
        needs_help_filing_pod: initial.needs_help_filing_pod,
        consent_group_representation: initial.consent_group_representation,
        consent_data_use_for_legal: initial.consent_data_use_for_legal,
        ack_engagement_letter_to_follow: initial.ack_engagement_letter_to_follow,
        ack_fee_structure: initial.ack_fee_structure,
        ack_group_strategy_coordinated: initial.ack_group_strategy_coordinated,
        ack_site_not_affiliated: initial.ack_site_not_affiliated,
        truthfully_attested: initial.truthfully_attested,
        fee_preference: initial.fee_preference,
        preferred_payment_method: initial.preferred_payment_method,
        naming_preference: initial.naming_preference,
        other_multichain_claims: initial.other_multichain_claims,
        additional_documentation_notes: initial.additional_documentation_notes,
      });
    }
  }, [initial]);

  function update<K extends keyof HolderPayload>(k: K, v: HolderPayload[K]) {
    setForm((f) => ({ ...f, [k]: v }));
    if (validationErrors.length > 0) setValidationErrors([]);
  }

  function setPodChoice(c: PodChoice) {
    setForm((f) => ({
      ...f,
      has_filed_pod: c === 'filed',
      needs_help_filing_pod: c === 'needs_help',
      ...(c === 'filed' ? {} : { pod_filed_date_iso: [] as [] | [string], pod_reference: [] as [] | [string] }),
    }));
    if (validationErrors.length > 0) setValidationErrors([]);
  }

  const otherChannelText = useMemo(() => {
    return 'Other' in form.preferred_comm_channel ? form.preferred_comm_channel.Other : null;
  }, [form.preferred_comm_channel]);

  function validate(): string[] {
    const e: string[] = [];
    if (form.legal_name.trim().length === 0) e.push('Full legal name — please enter your full name as it appears on official ID.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date_of_birth_iso))
      e.push('Date of birth — please pick a date.');
    if (form.nationality.trim().length === 0) e.push('Nationality — please enter your nationality.');
    if (form.country_of_residence.trim().length === 0)
      e.push('Country of residence — please enter where you currently live.');
    if (!/^.+@.+\..+$/.test(form.email)) e.push('Email — please enter a valid email address.');
    if (otherChannelText !== null && otherChannelText.trim() === '')
      e.push('Preferred communication channel — describe your "Other" channel (or pick Email/Telegram).');
    if (!form.consent_group_representation)
      e.push('Consent to group representation must be checked.');
    if (!form.consent_data_use_for_legal) e.push('Consent to data use must be checked.');
    if (!form.ack_engagement_letter_to_follow)
      e.push('Acknowledge that a formal engagement letter follows off-platform.');
    if (!form.ack_fee_structure) e.push('Acknowledge the fee structure.');
    if (!form.ack_group_strategy_coordinated)
      e.push('Acknowledge that group strategy is coordinated, not individual.');
    if (!form.ack_site_not_affiliated)
      e.push('Acknowledge that this site is not affiliated with KPMG/Multichain/courts.');
    if (!form.truthfully_attested)
      e.push('Penalty-of-perjury truthfulness attestation must be checked.');
    return e;
  }

  async function onSaveClick() {
    setError(null);
    const errs = validate();
    if (errs.length > 0) {
      setValidationErrors(errs);
      // Scroll to the panel after render.
      setTimeout(() => errorPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
      return;
    }
    setValidationErrors([]);
    setBusy(true);
    try {
      const actor = await backendActor();
      const res = initial ? await actor.update_holder(form) : await actor.submit_holder(form);
      const h = unwrap(res);
      onSaved(h);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const pod = podChoice(form);

  return (
    <div className="card">
      <div className="card-header flex items-center justify-between">
        <div className="text-sm font-semibold text-ink-900">
          {initial ? `Edit holder profile (revision ${initial.revision})` : 'Holder profile'}
        </div>
        <div className="text-xs text-ink-500">
          Fields marked <span className="required-star">*</span> are required.
        </div>
      </div>
      <div className="card-body space-y-6">
        {validationErrors.length > 0 && (
          <div
            ref={errorPanelRef}
            className="rounded-md border border-red-400 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-1"
          >
            <div className="font-semibold">Please fix the following before saving:</div>
            <ul className="list-disc pl-5">
              {validationErrors.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink-800">Identity</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Full legal name" required>
              <input
                className="field-input"
                value={form.legal_name}
                onChange={(e) => update('legal_name', e.target.value)}
              />
            </Field>
            <Field label="Date of birth" required help="YYYY-MM-DD">
              <input
                type="date"
                className="field-input"
                value={form.date_of_birth_iso}
                onChange={(e) => update('date_of_birth_iso', e.target.value)}
              />
            </Field>
            <Field label="Nationality" required>
              <input
                className="field-input"
                value={form.nationality}
                onChange={(e) => update('nationality', e.target.value)}
              />
            </Field>
            <Field label="Country of residence" required>
              <input
                className="field-input"
                value={form.country_of_residence}
                onChange={(e) => update('country_of_residence', e.target.value)}
              />
            </Field>
            <Field label="Email" required>
              <input
                type="email"
                className="field-input"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
              />
            </Field>
            <Field label="Telegram handle (optional)">
              <input
                className="field-input"
                placeholder="@username"
                value={fromOpt(form.telegram_handle) as string}
                onChange={(e) => update('telegram_handle', toOpt(e.target.value))}
              />
            </Field>
            <Field label="Preferred communication channel" required>
              <select
                className="field-input"
                value={
                  'Email' in form.preferred_comm_channel
                    ? 'Email'
                    : 'Telegram' in form.preferred_comm_channel
                      ? 'Telegram'
                      : 'Other'
                }
                onChange={(e) => {
                  const v = e.target.value;
                  update(
                    'preferred_comm_channel',
                    v === 'Email'
                      ? { Email: null }
                      : v === 'Telegram'
                        ? { Telegram: null }
                        : { Other: '' },
                  );
                }}
              >
                <option value="Email">Email</option>
                <option value="Telegram">Telegram</option>
                <option value="Other">Other</option>
              </select>
            </Field>
            {otherChannelText !== null && (
              <Field
                label="Describe your preferred channel"
                required
                help="e.g. Signal, ProtonMail, an alternate email — anything we should use to reach you."
              >
                <input
                  className="field-input"
                  value={otherChannelText}
                  onChange={(e) => update('preferred_comm_channel', { Other: e.target.value })}
                />
              </Field>
            )}
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink-800">KPMG Proof of Debt</h3>
          <p className="text-xs text-ink-600">
            KPMG (Singapore liquidator) requires every creditor to file a Proof of Debt on its CCP
            portal. Pick the option that matches your situation — only one applies.
          </p>
          <div className="space-y-2">
            <Radio
              name="pod"
              checked={pod === 'filed'}
              onChange={() => setPodChoice('filed')}
              label="I have already filed a PoD on the KPMG CCP portal"
            />
            <Radio
              name="pod"
              checked={pod === 'needs_help'}
              onChange={() => setPodChoice('needs_help')}
              label="I have not filed yet, and would like the group's solicitor to coordinate my filing"
            />
            <Radio
              name="pod"
              checked={pod === 'self'}
              onChange={() => setPodChoice('self')}
              label="I have not filed yet and will handle it myself"
            />
          </div>
          {pod === 'filed' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pl-6">
              <Field label="PoD filing date (optional)">
                <input
                  type="date"
                  className="field-input"
                  value={fromOpt(form.pod_filed_date_iso) as string}
                  onChange={(e) => update('pod_filed_date_iso', toOpt(e.target.value))}
                />
              </Field>
              <Field label="PoD reference (optional, if you have one)">
                <input
                  className="field-input"
                  value={fromOpt(form.pod_reference) as string}
                  onChange={(e) => update('pod_reference', toOpt(e.target.value))}
                />
              </Field>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink-800">Funding preference</h3>
          <p className="text-xs text-ink-700 leading-relaxed">
            Pursuing a coordinated claim has real costs — Singapore solicitor fees, court filings,
            document discovery, expert witnesses. The group splits these costs in one of two ways.
            Tell us what you'd accept; this is <strong>non-binding</strong> and only used to
            decide which model the group pursues. Actual payment is coordinated off-platform.
          </p>
          <Field label="Fee preference" required>
            <select
              className="field-input"
              value={
                'UpfrontCostShare' in form.fee_preference
                  ? 'UpfrontCostShare'
                  : 'LitigationFunding' in form.fee_preference
                    ? 'LitigationFunding'
                    : 'ProportionalToClaim' in form.fee_preference
                      ? 'ProportionalToClaim'
                      : 'Undecided'
              }
              onChange={(e) => {
                const v = e.target.value;
                update(
                  'fee_preference',
                  v === 'UpfrontCostShare'
                    ? { UpfrontCostShare: null }
                    : v === 'LitigationFunding'
                      ? { LitigationFunding: null }
                      : v === 'ProportionalToClaim'
                        ? { ProportionalToClaim: null }
                        : { Undecided: null },
                );
              }}
            >
              <option value="UpfrontCostShare">
                Upfront cost-share — every holder pays ~$1,000–1,500 upfront; nothing taken from recovery
              </option>
              <option value="ProportionalToClaim">
                Proportional to claim — each holder pays in proportion to their declared multiBTC claim size
              </option>
              <option value="LitigationFunding">
                Litigation funding — funder pays the costs; takes a percentage of any recovery
              </option>
              <option value="Undecided">Undecided / open to any of the above</option>
            </select>
          </Field>
          <Field
            label="Preferred payment method (optional)"
            help="If you have a strong preference, e.g. wire transfer, USDC on Ethereum, USDC on Polygon."
          >
            <input
              className="field-input"
              placeholder="e.g. wire transfer, USDC on Polygon"
              value={fromOpt(form.preferred_payment_method) as string}
              onChange={(e) => update('preferred_payment_method', toOpt(e.target.value))}
            />
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-ink-800">Optional</h3>
          <Field label="Naming preference">
            <select
              className="field-input"
              value={
                'WillingToBeNamed' in form.naming_preference
                  ? 'WillingToBeNamed'
                  : 'AnonymousViaRepresentative'
              }
              onChange={(e) => {
                update(
                  'naming_preference',
                  e.target.value === 'WillingToBeNamed'
                    ? { WillingToBeNamed: null }
                    : { AnonymousViaRepresentative: null },
                );
              }}
            >
              <option value="WillingToBeNamed">Willing to be named in filings</option>
              <option value="AnonymousViaRepresentative">
                Prefer anonymity; file via representative
              </option>
            </select>
          </Field>
          <Field label="Other Multichain token claims you hold (optional)">
            <textarea
              className="field-input-textarea"
              value={fromOpt(form.other_multichain_claims) as string}
              onChange={(e) => update('other_multichain_claims', toOpt(e.target.value))}
              placeholder="e.g. anyUSDC on Fantom, anyETH on Avalanche…"
            />
          </Field>
          <Field
            label="Additional documentation you can provide (optional)"
            help="Text only. We'll request the actual files (screenshots, exports, correspondence) off-platform once the solicitor is retained."
          >
            <textarea
              className="field-input-textarea"
              value={fromOpt(form.additional_documentation_notes) as string}
              onChange={(e) => update('additional_documentation_notes', toOpt(e.target.value))}
              placeholder="e.g. tx hashes of failed bridge attempts; Multichain support ticket numbers; on-chain transfers to redemption addresses; correspondence with the team…"
            />
          </Field>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink-800">
            Acknowledgments <span className="required-star">*</span>
          </h3>
          <p className="text-xs text-ink-500">Every checkbox in this section is required.</p>
          <Check
            label="I consent to being represented by the multiBTC Holders Group's appointed Singapore solicitor in the Multichain Foundation Ltd. liquidation proceedings."
            checked={form.consent_group_representation}
            onChange={(v) => update('consent_group_representation', v)}
          />
          <Check
            label="I consent to the use of the data I provide for legal claims, group coordination, and submission to KPMG and the courts."
            checked={form.consent_data_use_for_legal}
            onChange={(v) => update('consent_data_use_for_legal', v)}
          />
          <Check
            label="I understand a formal engagement letter / retainer will follow off-platform once the solicitor is retained."
            checked={form.ack_engagement_letter_to_follow}
            onChange={(v) => update('ack_engagement_letter_to_follow', v)}
          />
          <Check
            label="I acknowledge the fee structure (cost-sharing or litigation funding) and that financial contribution will be coordinated separately."
            checked={form.ack_fee_structure}
            onChange={(v) => update('ack_fee_structure', v)}
          />
          <Check
            label="I understand I am joining a coordinated group action — strategy decisions will be made collectively, not individually."
            checked={form.ack_group_strategy_coordinated}
            onChange={(v) => update('ack_group_strategy_coordinated', v)}
          />
          <Check
            label="I understand this site is not affiliated with KPMG, the Multichain Foundation, or any court."
            checked={form.ack_site_not_affiliated}
            onChange={(v) => update('ack_site_not_affiliated', v)}
          />
          <Check
            label="I attest under penalty of perjury that the information I have provided is true, accurate, and complete to the best of my knowledge."
            checked={form.truthfully_attested}
            onChange={(v) => update('truthfully_attested', v)}
          />
        </section>

        {error && <div className="text-sm text-red-600">{error}</div>}

        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={onSaveClick} disabled={busy}>
            {busy
              ? 'Saving…'
              : initial
                ? `Save changes (revision ${initial.revision + 1})`
                : 'Save profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink-800">
      <input
        type="checkbox"
        className="mt-0.5 rounded border-ink-500 text-ink-900 focus:ring-ink-700"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function Radio({
  name,
  label,
  checked,
  onChange,
}: {
  name: string;
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink-800">
      <input
        type="radio"
        name={name}
        className="mt-0.5 border-ink-500 text-ink-900 focus:ring-ink-700"
        checked={checked}
        onChange={onChange}
      />
      <span>{label}</span>
    </label>
  );
}
