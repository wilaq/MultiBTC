import { Link } from 'react-router-dom';
import { StatsBar } from '../components/StatsBar';

export function Landing() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 space-y-10">
      <section className="space-y-3">
        <p className="text-xs uppercase tracking-wider text-gold-600 font-semibold">
          Multichain liquidation — coordinated claim
        </p>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink-900">
          Verify your multiBTC holdings &amp; authorize representation
        </h1>
        <p className="text-base text-ink-700 leading-relaxed max-w-2xl">
          A coordinated group of multiBTC holders is pursuing asset-specific recovery in the
          Multichain Foundation Ltd. liquidation. This portal collects the cryptographic and
          identity evidence needed for our Singapore solicitor, KPMG's Proof of Debt process,
          and the U.S. Bankruptcy Court record.
        </p>
        <div className="pt-2 flex flex-wrap gap-3">
          <Link to="/verify" className="btn-accent">
            Sign in &amp; verify
          </Link>
          <Link to="/dashboard" className="btn-secondary">
            See aggregate stats
          </Link>
        </div>
      </section>

      <section>
        <StatsBar />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <InfoCard
          title="What this is"
          body="A verified register of multiBTC holders. You sign in with Internet Identity, then prove control of your wallet(s) by signing a message. We then collect your declared holdings across the four chains where multiBTC lived."
        />
        <InfoCard
          title="Why sign?"
          body="It proves you control your wallet, anchors your claim in a coordinated group, and authorizes our appointed Singapore solicitor to represent you. No transaction, no gas — only an off-chain signature."
        />
        <InfoCard
          title="What we collect"
          body="Identity (legal name, DOB, nationality, residence, contact); wallet addresses with signatures; declared multiBTC on Ethereum, BSC, Polygon, Canto, plus LP/vault positions; pre/post-incident timing; PoD status; preferred funding model."
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-ink-900">Legal context</h2>
        <ul className="list-disc pl-5 space-y-1 text-sm text-ink-700">
          <li>
            Multichain Foundation Ltd. is in court-ordered liquidation in Singapore — HC/CWU
            134/2025; KPMG appointed liquidator (May 2025).
          </li>
          <li>
            A parallel proceeding is in U.S. Bankruptcy Court SDNY — Case 25-12340-DSJ.
          </li>
          <li>
            multiBTC has unique legal arguments for enhanced recovery: explicit 1:1 BTC backing,
            dedicated HTLC infrastructure, traceable Bitcoin reserves.
          </li>
          <li>
            multiBTC contracts: Ethereum 0x66eFF522…F7D · BSC 0xD9907fcD…7A8 · Polygon
            0xf5b9b4A0…3A1 · Canto 0x80A16016…844.
          </li>
        </ul>
      </section>
    </div>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card">
      <div className="card-body space-y-2">
        <div className="text-sm font-semibold text-ink-900">{title}</div>
        <div className="text-sm text-ink-700 leading-relaxed">{body}</div>
      </div>
    </div>
  );
}
