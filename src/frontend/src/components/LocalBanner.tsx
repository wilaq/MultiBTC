import { BACKEND_CANISTER_ID, DFX_NETWORK, II_CANISTER_ID, II_PROVIDER, IS_LOCAL } from '../lib/auth';

export function LocalBanner() {
  if (!IS_LOCAL) return null;
  return (
    <div className="bg-amber-100 border-b border-amber-300 text-amber-900 text-xs">
      <div className="mx-auto max-w-6xl px-4 py-2 sm:px-6 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="font-semibold uppercase tracking-wide">Local environment</span>
        <span>
          network: <code className="font-mono">{DFX_NETWORK || '(unset)'}</code>
        </span>
        <span>
          backend: <code className="font-mono">{BACKEND_CANISTER_ID || '(unset)'}</code>
        </span>
        <span>
          II canister:{' '}
          <code className="font-mono">{II_CANISTER_ID || '(unset)'}</code>
        </span>
        <span>
          II URL:{' '}
          <a
            href={II_PROVIDER}
            target="_blank"
            rel="noreferrer"
            className="underline hover:no-underline"
          >
            {II_PROVIDER}
          </a>
        </span>
      </div>
    </div>
  );
}
