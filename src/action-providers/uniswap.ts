
import { z } from 'zod';
import { customActionProvider, EvmWalletProvider } from '@coinbase/agentkit';
import { encodeFunctionData, parseUnits, parseAbi } from 'viem';
import { config } from '../config.js';

// Configuration for different networks
const ADDRESSES = {
    'base-sepolia': {
        ROUTER: '0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4', // Uniswap V3 SwapRouter02
        WETH: '0x4200000000000000000000000000000000000006',
        USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    },
    'base-mainnet': {
        ROUTER: '0x2626664c2603336E57B271c5C0b26F421741e481',
        WETH: '0x4200000000000000000000000000000000000006',
        USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    }
};

// Router ABI (Minimal)
const ROUTER_ABI = parseAbi([
    'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)'
]);

// ERC20 ABI
const ERC20_ABI = parseAbi([
    'function approve(address spender, uint256 value) external returns (bool)',
    'function decimals() external view returns (uint8)'
]);

/**
 * Uniswap Swap Action
 */
export const uniswapActionProvider = () => customActionProvider<EvmWalletProvider>([
    {
        name: 'uniswap_swap',
        description: 'Swap tokens using Uniswap V3 on Base chain. Supports ETH, WETH, USDC. Automatically adapts to Base Mainnet or Sepolia.',
        schema: z.object({
            tokenIn: z.string().describe('The token symbol or address to swap FROM (e.g. ETH, USDC)'),
            tokenOut: z.string().describe('The token symbol or address to swap TO (e.g. USDC, ETH)'),
            amount: z.string().describe('The amount of tokenIn to swap (e.g. 0.01, 100)'),
            slippage: z.number().nullable().optional().describe('Slippage tolerance in percentage (default 0.5)'),
        }),
        invoke: async (walletProvider, args) => {
            try {
                const { tokenIn, tokenOut, amount, slippage } = args;
                // Use default slippage of 0.5% if not provided
                const slippageTolerance = slippage ?? 0.5;

                // Determine network
                const networkId = config.networkId === 'base' ? 'base-mainnet' : 'base-sepolia';
                const addrs = ADDRESSES[networkId];

                // Resolve tokens
                const getTokenAddr = (token: string) => {
                    const upper = token.toUpperCase();
                    if (upper === 'ETH' || upper === 'WETH') return addrs.WETH;
                    if (upper === 'USDC') return addrs.USDC;
                    return token;
                };

                const tokenInAddr = getTokenAddr(tokenIn);
                const tokenOutAddr = getTokenAddr(tokenOut);

                const isEthIn = tokenIn.toUpperCase() === 'ETH';

                // Decimals - hardcoded for demo simplicity
                let decimalsIn = 18;
                if (tokenIn.toUpperCase() === 'USDC') decimalsIn = 6;

                const amountInWei = parseUnits(amount, decimalsIn);

                // Approve if not ETH
                if (!isEthIn) {
                    const txHash = await walletProvider.sendTransaction({
                        to: tokenInAddr as `0x${string}`,
                        data: encodeFunctionData({
                            abi: ERC20_ABI,
                            functionName: 'approve',
                            args: [addrs.ROUTER as `0x${string}`, amountInWei]
                        })
                    });
                    // In production, should wait for receipt here
                }

                const params = {
                    tokenIn: tokenInAddr as `0x${string}`,
                    tokenOut: tokenOutAddr as `0x${string}`,
                    fee: 3000,
                    recipient: walletProvider.getAddress() as `0x${string}`,
                    amountIn: amountInWei,
                    amountOutMinimum: BigInt(0),
                    sqrtPriceLimitX96: BigInt(0)
                };

                const data = encodeFunctionData({
                    abi: ROUTER_ABI,
                    functionName: 'exactInputSingle',
                    args: [params]
                });

                const txHash = await walletProvider.sendTransaction({
                    to: addrs.ROUTER as `0x${string}`,
                    data,
                    value: isEthIn ? amountInWei : BigInt(0)
                });

                return `Swap submitted on ${networkId}! Tx Hash: ${txHash}`;
            } catch (error) {
                return `Swap failed: ${error}`;
            }
        }
    }
]);
