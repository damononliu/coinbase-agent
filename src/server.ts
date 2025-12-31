/**
 * Express server for Coinbase AgentKit Web UI
 */

// Note: If you see TypeScript errors here, run: npm install --save-dev @types/express
// @ts-ignore - Express types work at runtime even if @types/express is not installed
import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { config, validateConfig } from './config.js';
import { CoinbaseAgent } from './agent.js';

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

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}\n`);
  console.log(`📝 Open http://localhost:${PORT} in your browser\n`);
});

