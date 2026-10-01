import type { SupportedChainId } from './wagmi';

export const MULTIBTC_DECIMALS = 8;

export const MULTIBTC: Record<SupportedChainId, `0x${string}`> = {
  1: '0x66eFF5221ca926636224650Fd3B9c497FF828F7D',
  56: '0xD9907fcDa91aC644F70477B8fC1607ad15b2D7A8',
  137: '0xf5b9b4A0534cf508ab9953c64c5310DFa0B303A1',
  7700: '0x80A16016cC4A2E6a2CACA8a4a498b1699fF0f844',
};

export const erc20BalanceAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
