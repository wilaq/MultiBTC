import { http, fallback, createConfig } from 'wagmi';
import { mainnet, bsc, polygon } from 'wagmi/chains';
import { defineChain } from 'viem';
import { injected, walletConnect, coinbaseWallet } from 'wagmi/connectors';

export const canto = defineChain({
  id: 7700,
  name: 'Canto',
  nativeCurrency: { name: 'Canto', symbol: 'CANTO', decimals: 18 },
  rpcUrls: { default: { http: ['https://canto.gravitychain.io'] } },
});

const rank = { interval: 30_000, sampleCount: 3 } as const;

const ethRpcs = [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum.publicnode.com',
  'https://cloudflare-eth.com',
  'https://eth.drpc.org',
  'https://1rpc.io/eth',
  'https://eth.merkle.io',
  'https://rpc.flashbots.net',
  'https://eth.api.onfinality.io/public',
  'https://eth-mainnet.public.blastapi.io',
  'https://eth-pokt.nodies.app',
  'https://rpc.payload.de',
  'https://mainnet.gateway.tenderly.co',
  'https://rpc.mevblocker.io',
];
const bscRpcs = [
  'https://bsc-dataseed.binance.org',
  'https://bsc-dataseed1.binance.org',
  'https://bsc-dataseed2.binance.org',
  'https://bsc-dataseed3.binance.org',
  'https://bsc-dataseed4.binance.org',
  'https://bsc-dataseed1.defibit.io',
  'https://bsc-dataseed2.defibit.io',
  'https://bsc-dataseed1.ninicoin.io',
  'https://bsc-dataseed2.ninicoin.io',
  'https://rpc.ankr.com/bsc',
  'https://bsc.publicnode.com',
  'https://bsc.drpc.org',
  'https://1rpc.io/bnb',
  'https://bsc.api.onfinality.io/public',
];
const polygonRpcs = [
  'https://polygon-rpc.com',
  'https://polygon.llamarpc.com',
  'https://rpc.ankr.com/polygon',
  'https://polygon.publicnode.com',
  'https://polygon.drpc.org',
  'https://1rpc.io/matic',
  'https://polygon-bor-rpc.publicnode.com',
  'https://polygon.api.onfinality.io/public',
  'https://polygon-pokt.nodies.app',
  'https://polygon-mainnet.public.blastapi.io',
];
const cantoRpcs = [
  'https://canto.gravitychain.io',
  'https://mainnode.plexnode.org:8545',
  'https://canto.slingshot.finance',
  'https://jsonrpc.canto.nodestake.top',
  'https://canto.evm.chandrastation.com',
  'https://canto-rpc.ansybl.io',
];

// The old hardcoded fallback was not a real project id — WalletConnect's own API
// answers `{"error":"Project id is not valid - ..."}` for it, so the connector has
// been failing in production. It is now opt-in: set VITE_WC_PROJECT_ID in .env and
// the connector (and its ~450KB of bundle) comes back. Without one, offering the
// button at all is worse than not offering it.
const WC_PROJECT_ID = import.meta.env.VITE_WC_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [mainnet, bsc, polygon, canto],
  transports: {
    [mainnet.id]: fallback(ethRpcs.map((u) => http(u)), { rank }),
    [bsc.id]: fallback(bscRpcs.map((u) => http(u)), { rank }),
    [polygon.id]: fallback(polygonRpcs.map((u) => http(u)), { rank }),
    [canto.id]: fallback(cantoRpcs.map((u) => http(u)), { rank }),
  },
  connectors: [
    injected({ shimDisconnect: true }),
    ...(WC_PROJECT_ID
      ? [
          walletConnect({
            projectId: WC_PROJECT_ID,
            showQrModal: true,
            metadata: {
              name: 'multiBTC Holders Group',
              description: 'Verification & Authorization Portal',
              url: typeof window !== 'undefined' ? window.location.origin : '',
              icons: [],
            },
          }),
        ]
      : []),
    // `preference: 'eoaOnly'` keeps the legacy extension/mobile-EOA flow and
    // skips Coinbase Smart Wallet (ERC-4337). EIP-1271 sigs are not supported
    // yet by our recovery path.
    coinbaseWallet({ appName: 'multiBTC Holders Group', preference: 'eoaOnly' }),
  ],
  ssr: false,
});

export type SupportedChainId = 1 | 56 | 137 | 7700;

export const CHAIN_LABELS: Record<SupportedChainId, string> = {
  1: 'Ethereum',
  56: 'BSC',
  137: 'Polygon',
  7700: 'Canto',
};

export const CHAIN_KEYS: Record<SupportedChainId, 'ethereum' | 'bsc' | 'polygon' | 'canto'> = {
  1: 'ethereum',
  56: 'bsc',
  137: 'polygon',
  7700: 'canto',
};
