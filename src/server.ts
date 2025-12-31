/**
 * Express server for Coinbase AgentKit Web UI
 */

// Global error handlers for analytics timeouts (must be before any imports that trigger analytics)
process.on('unhandledRejection', (reason: any) => {
  const errorCode = reason?.cause?.code || reason?.code;
  const errorMessage = reason?.message || String(reason);

  if (errorCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    errorMessage.includes('fetch failed') ||
    errorMessage.includes('analytics') ||
    errorMessage.includes('Connect Timeout')) {
    console.warn('[AgentKit] Analytics request failed (ignored)');
    return;
  }
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error: any) => {
  const errorCode = error?.cause?.code || error?.code;
  const errorMessage = error?.message || String(error);

  if (errorCode === 'UND_ERR_CONNECT_TIMEOUT' ||
    errorMessage.includes('fetch failed') ||
    errorMessage.includes('analytics') ||
    errorMessage.includes('Connect Timeout')) {
    console.warn('[AgentKit] Analytics error caught (ignored)');
    return;
  }
  console.error('Uncaught exception:', error);
  process.exit(1);
});

// Note: If you see TypeScript errors here, run: npm install --save-dev @types/express
// @ts-ignore - Express types work at runtime even if @types/express is not installed
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config, validateConfig } from './config.js';
import { CoinbaseAgent } from './agent.js';
import { walletManager } from './wallet-manager.js';
import { privateKeyToAccount } from 'viem/accounts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Agent instance (singleton)
let agent: CoinbaseAgent | null = null;
let agentInitialized = false;
let walletInfo: { address: string; network: string } | null = null;

/**
 * Initialize agent
 */
async function initializeAgent(): Promise<void> {
  if (agentInitialized && agent) {
    return;
  }

  const validation = validateConfig();
  if (!validation.valid) {
    throw new Error(`Configuration errors: ${validation.errors.join(', ')}`);
  }

  agent = new CoinbaseAgent();
  walletInfo = await agent.initialize();
  agentInitialized = true;
}

// API Routes

/**
 * Health check
 */
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Initialize agent
 */
app.post('/api/initialize', async (req: Request, res: Response) => {
  try {
    await initializeAgent();
    res.json({
      success: true,
      wallet: walletInfo,
      llmProvider: config.llmProvider,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Get agent status
 */
app.get('/api/status', async (req: Request, res: Response) => {
  if (!agentInitialized || !agent || !walletInfo) {
    return res.json({
      initialized: false,
    });
  }

  res.json({
    initialized: true,
    wallet: walletInfo,
    llmProvider: config.llmProvider,
  });
});

/**
 * Chat endpoint
 */
app.post('/api/chat', async (req: Request, res: Response) => {
  try {
    if (!agentInitialized || !agent) {
      await initializeAgent();
      if (!agent) {
        throw new Error('Failed to initialize agent');
      }
    }

    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
      });
    }

    const response = await agent.chat(message);

    res.json({
      success: true,
      message: response.message,
      toolCalls: response.toolCalls,
      pendingTransaction: response.pendingTransaction,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Confirm pending transaction
 */
app.post('/api/confirm', async (req: Request, res: Response) => {
  try {
    if (!agent) {
      return res.status(400).json({
        success: false,
        error: 'Agent not initialized',
      });
    }

    if (!agent.hasPendingTransaction()) {
      return res.status(400).json({
        success: false,
        error: 'No pending transaction',
      });
    }

    const response = await agent.confirmTransaction();

    res.json({
      success: true,
      message: response.message,
      toolCalls: response.toolCalls,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Cancel pending transaction
 */
app.post('/api/cancel', async (req: Request, res: Response) => {
  try {
    if (!agent) {
      return res.status(400).json({
        success: false,
        error: 'Agent not initialized',
      });
    }

    const response = agent.cancelTransaction();

    res.json({
      success: true,
      message: response.message,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * Clear conversation history
 */
app.post('/api/clear', async (req: Request, res: Response) => {
  try {
    if (!agent) {
      return res.status(400).json({
        success: false,
        error: 'Agent not initialized',
      });
    }

    agent.clearHistory();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * List wallets
 */
app.get('/api/wallets', (req: Request, res: Response) => {
  try {
    const wallets = walletManager.listWallets();

    // Add env wallet if available
    if (config.privateKey) {
      try {
        let pk = config.privateKey;
        if (!pk.startsWith('0x')) {
          pk = `0x${pk}`;
        }
        const account = privateKeyToAccount(pk as `0x${string}`);
        wallets.unshift({
          id: 'env',
          alias: 'Environment Wallet',
          address: account.address,
          networkId: config.networkId || 'base-sepolia'
        });
      } catch (e) {
        console.warn('Failed to parse env private key:', e);
      }
    }

    res.json({ success: true, wallets });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Create wallet
 */
app.post('/api/wallets', (req: Request, res: Response) => {
  try {
    const { alias } = req.body;
    if (!alias) {
      return res.status(400).json({ success: false, error: 'Alias is required' });
    }
    const wallet = walletManager.createWallet(alias);
    res.json({ success: true, wallet });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Switch wallet
 */
app.post('/api/wallets/switch', async (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Wallet ID is required' });
    }

    let privateKey: string;

    if (id === 'env') {
      if (!config.privateKey) {
        return res.status(400).json({ success: false, error: 'Environment private key not found' });
      }
      privateKey = config.privateKey;
    } else {
      const wallet = walletManager.getWallet(id);
      if (!wallet) {
        return res.status(404).json({ success: false, error: 'Wallet not found' });
      }
      privateKey = wallet.privateKey;
    }

    if (!privateKey.startsWith('0x')) {
      privateKey = `0x${privateKey}`;
    }

    // Initialize agent with new key
    agent = new CoinbaseAgent();
    walletInfo = await agent.initialize(privateKey);
    agentInitialized = true;

    res.json({ success: true, wallet: walletInfo });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Export private key
 */
app.post('/api/wallets/export', (req: Request, res: Response) => {
  try {
    const { id } = req.body;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Wallet ID is required' });
    }

    let privateKey: string;

    if (id === 'env') {
      if (!config.privateKey) {
        return res.status(400).json({ success: false, error: 'Environment private key not found' });
      }
      privateKey = config.privateKey;
    } else {
      const wallet = walletManager.getWallet(id);
      if (!wallet) {
        return res.status(404).json({ success: false, error: 'Wallet not found' });
      }
      privateKey = wallet.privateKey;
    }

    res.json({ success: true, privateKey });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}\n`);
  console.log(`📝 Open http://localhost:${PORT} in your browser\n`);
});

