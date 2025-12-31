import fs from 'fs';
import path from 'path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const WALLETS_FILE = 'wallets.json';

export interface SavedWallet {
    id: string;
    alias: string;
    address: string;
    privateKey: string;
    createdAt: string;
}

export class WalletManager {
    private wallets: SavedWallet[] = [];
    private filePath: string;

    constructor() {
        this.filePath = path.resolve(process.cwd(), WALLETS_FILE);
        this.loadWallets();
    }

    /**
     * Load wallets from disk
     */
    private loadWallets() {
        if (fs.existsSync(this.filePath)) {
            try {
                const data = fs.readFileSync(this.filePath, 'utf-8');
                this.wallets = JSON.parse(data);
            } catch (error) {
                console.error('Failed to load wallets:', error);
                this.wallets = [];
            }
        }
    }

    /**
     * Save wallets to disk
     */
    private saveWallets() {
        fs.writeFileSync(this.filePath, JSON.stringify(this.wallets, null, 2));
    }

    /**
     * List all saved wallets
     */
    listWallets(): Omit<SavedWallet, 'privateKey'>[] {
        return this.wallets.map(({ privateKey, ...rest }) => rest);
    }

    /**
     * Get a wallet by ID
     */
    getWallet(id: string): SavedWallet | undefined {
        return this.wallets.find(w => w.id === id);
    }

    /**
     * Create a new wallet
     */
    createWallet(alias: string): SavedWallet {
        const privateKey = generatePrivateKey();
        const account = privateKeyToAccount(privateKey);

        const wallet: SavedWallet = {
            id: Math.random().toString(36).substring(2, 15),
            alias,
            address: account.address,
            privateKey,
            createdAt: new Date().toISOString(),
        };

        this.wallets.push(wallet);
        this.saveWallets();
        return wallet;
    }

    /**
     * Import an existing wallet
     */
    importWallet(alias: string, privateKey: string): SavedWallet {
        // Ensure 0x prefix
        if (!privateKey.startsWith('0x')) {
            privateKey = `0x${privateKey}`;
        }

        try {
            const account = privateKeyToAccount(privateKey as `0x${string}`);

            const wallet: SavedWallet = {
                id: Math.random().toString(36).substring(2, 15),
                alias,
                address: account.address,
                privateKey,
                createdAt: new Date().toISOString(),
            };

            this.wallets.push(wallet);
            this.saveWallets();
            return wallet;
        } catch (error) {
            throw new Error('Invalid private key');
        }
    }

    /**
     * Delete a wallet
     */
    deleteWallet(id: string): boolean {
        const initialLength = this.wallets.length;
        this.wallets = this.wallets.filter(w => w.id !== id);
        if (this.wallets.length !== initialLength) {
            this.saveWallets();
            return true;
        }
        return false;
    }
}

export const walletManager = new WalletManager();
