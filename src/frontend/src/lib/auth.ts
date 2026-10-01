import { AuthClient } from '@dfinity/auth-client';
import { HttpAgent, type Identity } from '@dfinity/agent';
import { createBackendActor, type BackendService } from './backend';
import type { ActorSubclass } from '@dfinity/agent';

const env = (import.meta as any).env ?? {};

export const BACKEND_CANISTER_ID: string =
  env.VITE_BACKEND_CANISTER_ID || env.CANISTER_ID_BACKEND || 'aaaaa-aa';

export const II_CANISTER_ID: string =
  env.VITE_II_CANISTER_ID || env.CANISTER_ID_INTERNET_IDENTITY || '';

export const DFX_NETWORK: string =
  env.VITE_DFX_NETWORK || env.DFX_NETWORK || 'local';

export const IS_LOCAL = DFX_NETWORK !== 'ic' && DFX_NETWORK !== 'mainnet';

export const IC_HOST = IS_LOCAL
  ? env.VITE_IC_HOST || 'http://127.0.0.1:4943'
  : 'https://icp0.io';

// We pin the local internet_identity canister to release-2026-03-09, the last
// monolithic dev build that bundles both backend and frontend in one wasm —
// later releases split it in two and the simple "type: custom" deploy stops
// serving HTML. On the IC we use the canonical `id.ai`.
export const II_PROVIDER = IS_LOCAL
  ? II_CANISTER_ID
    ? `http://${II_CANISTER_ID}.localhost:4943`
    : 'http://rdmx6-jaaaa-aaaaa-aaadq-cai.localhost:4943'
  : 'https://id.ai';

let authClient: AuthClient | null = null;

export async function getAuthClient(): Promise<AuthClient> {
  if (!authClient) {
    authClient = await AuthClient.create({ idleOptions: { disableIdle: true } });
  }
  return authClient;
}

export async function loginII(): Promise<void> {
  const c = await getAuthClient();
  await new Promise<void>((resolve, reject) => {
    c.login({
      identityProvider: II_PROVIDER,
      maxTimeToLive: BigInt(8 * 60 * 60 * 1_000_000_000),
      onSuccess: () => resolve(),
      onError: (e) => reject(new Error(e ?? 'II login failed')),
    });
  });
}

export async function logoutII(): Promise<void> {
  const c = await getAuthClient();
  await c.logout();
}

export async function isAuthenticated(): Promise<boolean> {
  const c = await getAuthClient();
  return c.isAuthenticated();
}

export async function getIdentity(): Promise<Identity> {
  const c = await getAuthClient();
  return c.getIdentity();
}

async function buildAgent(identity?: Identity): Promise<HttpAgent> {
  const agent = await HttpAgent.create({ identity, host: IC_HOST });
  if (IS_LOCAL) {
    try {
      await agent.fetchRootKey();
    } catch (e) {
      console.warn('fetchRootKey failed', e);
    }
  }
  return agent;
}

export async function backendActor(): Promise<ActorSubclass<BackendService>> {
  const identity = await getIdentity();
  const agent = await buildAgent(identity);
  return createBackendActor(BACKEND_CANISTER_ID, agent);
}

export async function anonymousBackendActor(): Promise<ActorSubclass<BackendService>> {
  const agent = await buildAgent();
  return createBackendActor(BACKEND_CANISTER_ID, agent);
}

