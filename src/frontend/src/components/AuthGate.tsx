import { useEffect, useState } from 'react';
import type { Principal } from '@dfinity/principal';
import { getAuthClient, isAuthenticated, loginII, logoutII } from '../lib/auth';

interface Ctx {
  principal: Principal | null;
  loading: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): Ctx {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await isAuthenticated();
      if (cancelled) return;
      if (ok) {
        const c = await getAuthClient();
        setPrincipal(c.getIdentity().getPrincipal());
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async () => {
    setLoading(true);
    await loginII();
    const c = await getAuthClient();
    setPrincipal(c.getIdentity().getPrincipal());
    setLoading(false);
  };

  const logout = async () => {
    await logoutII();
    setPrincipal(null);
  };

  return { principal, loading, login, logout };
}

export function AuthGate({
  children,
}: {
  children: (ctx: { principal: Principal; logout: () => Promise<void> }) => React.ReactNode;
}) {
  const { principal, loading, login, logout } = useAuth();

  if (loading) {
    return <div className="text-sm text-ink-500">Checking session…</div>;
  }

  if (!principal || principal.isAnonymous()) {
    return (
      <div className="card">
        <div className="card-body space-y-4">
          <h2 className="text-lg font-semibold text-ink-900">Sign in to start</h2>
          <p className="text-sm text-ink-700">
            We use Internet Identity (<code>id.ai</code>) so you can come back later, view your
            submission, and edit it. Your principal is bound to the wallet(s) you link — only that
            identity can edit the record.
          </p>
          <button type="button" className="btn-accent" onClick={login}>
            Sign in with Internet Identity
          </button>
        </div>
      </div>
    );
  }

  return <>{children({ principal, logout })}</>;
}
