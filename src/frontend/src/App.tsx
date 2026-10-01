import { NavLink, Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Verify } from './pages/Verify';
import { Dashboard } from './pages/Dashboard';
import { Admin } from './pages/Admin';
import { Governance } from './pages/Governance';
import { LocalBanner } from './components/LocalBanner';

export function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <LocalBanner />
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/verify" element={<Verify />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/governance" element={<Governance />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="border-b border-ink-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <NavLink to="/" className="block">
            <div className="text-lg font-semibold tracking-tight text-ink-900">
              multiBTC Holders Group
            </div>
            <div className="text-xs text-ink-500">
              Coordinated Asset-Specific Recovery — Multichain Liquidation
            </div>
          </NavLink>
        </div>
        <nav className="flex flex-wrap items-center gap-1 sm:gap-3 text-sm">
          <NavTab to="/">Home</NavTab>
          <NavTab to="/verify">Verify</NavTab>
          <NavTab to="/dashboard">Dashboard</NavTab>
          <NavTab to="/governance">Governance</NavTab>
          <NavTab to="/admin">Admin</NavTab>
        </nav>
      </div>
    </header>
  );
}

function NavTab({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-md px-2.5 py-1.5 font-medium transition-colors sm:px-3 ${
          isActive ? 'bg-ink-900 text-white' : 'text-ink-700 hover:bg-ink-100'
        }`
      }
      end
    >
      {children}
    </NavLink>
  );
}

function Footer() {
  return (
    <footer className="border-t border-ink-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 text-xs text-ink-500 space-y-2">
        <p>
          This site is operated by coordinated multiBTC holders. It is not affiliated with KPMG,
          the Multichain Foundation, or any court. A formal engagement letter from the appointed
          Singapore solicitor will follow off-platform.
        </p>
        <p>
          References: U.S. Bankruptcy Court SDNY, Case No. 25-12340-DSJ · Singapore High Court,
          Case No. HC/CWU 134/2025
        </p>
      </div>
    </footer>
  );
}
