/**
 * Custom action provider for wallet address operations
 */

import { z } from 'zod';
import { customActionProvider, EvmWalletProvider } from '@coinbase/agentkit';

/**
 * Wallet Address Action Provider
 * Provides a simple action to get just the wallet address
 */
export const walletAddressActionProvider = () => customActionProvider<EvmWalletProvider>([
    {
        name: 'get_wallet_address',
        description: 'Get the current wallet address. Use this tool when the user asks for their wallet address, such as "我的地址" or "what is my address". Returns only the address without balance or network information. This tool is always available and will return the actual wallet address.',
        schema: z.object({}),
        invoke: async (walletProvider: EvmWalletProvider) => {
            try {
                // Try different ways to get address
                let address: string | undefined;
                
                // Method 1: getAddress() method
                if (typeof (walletProvider as any).getAddress === 'function') {
                    address = (walletProvider as any).getAddress();
                }
                // Method 2: account.address property
                else if ((walletProvider as any).account?.address) {
                    address = (walletProvider as any).account.address;
                }
                // Method 3: walletClient.account.address
                else if ((walletProvider as any).walletClient?.account?.address) {
                    address = (walletProvider as any).walletClient.account.address;
                }
                // Method 4: Try to access address directly
                else if ((walletProvider as any).address) {
                    address = (walletProvider as any).address;
                }
                
                console.log('[WalletAddressAction] Retrieved address:', address);
                console.log('[WalletAddressAction] walletProvider type:', typeof walletProvider);
                console.log('[WalletAddressAction] walletProvider keys:', Object.keys(walletProvider || {}));
                
                if (!address || address.length !== 42 || !address.startsWith('0x')) {
                    throw new Error(`Invalid address format: ${address || 'undefined'}`);
                }
                return {
                    address: address,
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                console.error('[WalletAddressAction] Error:', errorMsg);
                throw new Error(`Failed to get wallet address: ${errorMsg}`);
            }
        },
    },
]);

