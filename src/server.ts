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
import { createPublicClient, erc20Abi, formatUnits, getAddress, http, parseAbi } from 'viem';
import { base, baseSepolia } from 'viem/chains';
import { getClientWalletAddress, setClientWalletAddress } from './runtime-state.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const chain = config.networkId === 'base' ? base : baseSepolia;
const publicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl || undefined),
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Agent instance (singleton)
let agent: CoinbaseAgent | null = null;
let agentInitialized = false;
let walletInfo: { address: string; network: string; balance?: string } | null = null;

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

function normalizeIpfsUri(uri: string): string {
  if (uri.startsWith('ipfs://')) {
    return `https://ipfs.io/ipfs/${uri.replace('ipfs://', '')}`;
  }
  return uri;
}

function resolveErc1155UriTemplate(uri: string, tokenId: string): string {
  if (!uri.includes('{id}')) {
    return uri;
  }
  const hexId = BigInt(tokenId).toString(16).padStart(64, '0');
  return uri.replace('{id}', hexId);
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
      clientWallet: getClientWalletAddress(),
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
    clientWallet: getClientWalletAddress(),
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
    // Refresh wallet info after transaction
    walletInfo = await agent.refreshWalletInfo();

    res.json({
      success: true,
      message: response.message,
      toolCalls: response.toolCalls,
      wallet: walletInfo,
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
        } as any);
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

    res.json({ success: true, wallet: walletInfo, llmProvider: config.llmProvider });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Refresh wallet info (balance)
 */
app.get('/api/wallet/refresh', async (req: Request, res: Response) => {
  try {
    if (!agent) {
      return res.status(400).json({
        success: false,
        error: 'Agent not initialized',
      });
    }

    walletInfo = await agent.refreshWalletInfo();
    res.json({
      success: true,
      wallet: walletInfo,
      llmProvider: config.llmProvider,
      clientWallet: getClientWalletAddress(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Set or clear client (browser) wallet address
 */
app.post('/api/client_wallet', (req: Request, res: Response) => {
  try {
    const { address } = req.body || {};
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ success: false, error: 'Address is required' });
    }
    setClientWalletAddress(address);
    res.json({ success: true, clientWallet: getClientWalletAddress() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.delete('/api/client_wallet', (req: Request, res: Response) => {
  try {
    setClientWalletAddress(null);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

app.get('/api/client_wallet', (req: Request, res: Response) => {
  try {
    res.json({ success: true, clientWallet: getClientWalletAddress() });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Token details
 */
app.get('/api/token/details', async (req: Request, res: Response) => {
  try {
    const tokenAddress = String(req.query.tokenAddress || '');
    if (!tokenAddress) {
      return res.status(400).json({ success: false, error: 'tokenAddress is required' });
    }
    const address = getAddress(tokenAddress);
    const [name, symbol, decimals] = await Promise.all([
      publicClient.readContract({ address, abi: erc20Abi, functionName: 'name' }),
      publicClient.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
      publicClient.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
    ]);

    res.json({
      success: true,
      token: {
        address,
        name: String(name),
        symbol: String(symbol),
        decimals: Number(decimals),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Token balance
 */
app.get('/api/token/balance', async (req: Request, res: Response) => {
  try {
    const tokenAddress = String(req.query.tokenAddress || '');
    const address = String(req.query.address || walletInfo?.address || '');
    if (!tokenAddress || !address) {
      return res.status(400).json({ success: false, error: 'tokenAddress and address are required' });
    }
    const token = getAddress(tokenAddress);
    const owner = getAddress(address);

    const [decimals, balance] = await Promise.all([
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [owner],
      }),
    ]);

    const formatted = formatUnits(balance as bigint, Number(decimals));
    res.json({ success: true, balance: formatted });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Token allowance
 */
app.get('/api/token/allowance', async (req: Request, res: Response) => {
  try {
    const tokenAddress = String(req.query.tokenAddress || '');
    const spenderAddress = String(req.query.spenderAddress || '');
    const ownerAddress = String(req.query.ownerAddress || walletInfo?.address || '');
    if (!tokenAddress || !spenderAddress || !ownerAddress) {
      return res.status(400).json({ success: false, error: 'tokenAddress, spenderAddress, ownerAddress are required' });
    }

    const token = getAddress(tokenAddress);
    const spender = getAddress(spenderAddress);
    const owner = getAddress(ownerAddress);

    const [decimals, symbol, allowance] = await Promise.all([
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
      publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [owner, spender],
      }),
    ]);

    const formatted = formatUnits(allowance as bigint, Number(decimals));
    res.json({ success: true, allowance: formatted, symbol: String(symbol) });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Token transfer history (ERC20 Transfer logs)
 */
app.get('/api/token/history', async (req: Request, res: Response) => {
  try {
    const tokenAddress = String(req.query.tokenAddress || '');
    const address = String(req.query.address || '');
    if (!tokenAddress || !address) {
      return res.status(400).json({ success: false, error: 'tokenAddress and address are required' });
    }
    const token = getAddress(tokenAddress);
    const owner = getAddress(address);

    const latestBlock = await publicClient.getBlockNumber();
    const fromParam = req.query.fromBlock ? BigInt(String(req.query.fromBlock)) : null;
    const defaultFrom = latestBlock > 5000n ? latestBlock - 5000n : 0n;
    const fromBlock = fromParam ?? defaultFrom;

    const transferEvent = parseAbi([
      'event Transfer(address indexed from, address indexed to, uint256 value)',
    ])[0];

    const [incoming, outgoing, decimals] = await Promise.all([
      publicClient.getLogs({
        address: token,
        event: transferEvent,
        args: { to: owner },
        fromBlock,
        toBlock: latestBlock,
      }),
      publicClient.getLogs({
        address: token,
        event: transferEvent,
        args: { from: owner },
        fromBlock,
        toBlock: latestBlock,
      }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
    ]);

    const merged = [...incoming, ...outgoing];
    const unique = new Map<string, any>();
    merged.forEach((log: any) => {
      const key = `${log.transactionHash}-${log.logIndex}`;
      unique.set(key, log);
    });

    const events = Array.from(unique.values()).map((log: any) => ({
      from: log.args?.from,
      to: log.args?.to,
      value: formatUnits(log.args?.value || 0n, Number(decimals)),
      txHash: log.transactionHash,
      blockNumber: Number(log.blockNumber),
    }));

    res.json({ success: true, events });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * NFT metadata (ERC721/1155 tokenURI/uri)
 */
app.get('/api/nft/metadata', async (req: Request, res: Response) => {
  try {
    const contract = String(req.query.contract || '');
    const tokenId = String(req.query.tokenId || '');
    if (!contract || !tokenId) {
      return res.status(400).json({ success: false, error: 'contract and tokenId are required' });
    }

    const address = getAddress(contract);
    const nftAbi = parseAbi([
      'function tokenURI(uint256 tokenId) view returns (string)',
      'function uri(uint256 tokenId) view returns (string)',
      'function name() view returns (string)',
      'function symbol() view returns (string)',
    ]);

    let tokenUri = '';
    try {
      tokenUri = await publicClient.readContract({
        address,
        abi: nftAbi,
        functionName: 'tokenURI',
        args: [BigInt(tokenId)],
      });
    } catch {
      tokenUri = await publicClient.readContract({
        address,
        abi: nftAbi,
        functionName: 'uri',
        args: [BigInt(tokenId)],
      });
    }

    const resolved = normalizeIpfsUri(resolveErc1155UriTemplate(String(tokenUri), tokenId));
    let metadata: any = null;
    try {
      const response = await fetch(resolved);
      if (response.ok) {
        metadata = await response.json();
        if (metadata?.image) {
          metadata.image = normalizeIpfsUri(metadata.image);
        }
      }
    } catch {
      metadata = null;
    }

    let name = '';
    let symbol = '';
    try {
      name = String(await publicClient.readContract({ address, abi: nftAbi, functionName: 'name' }));
    } catch {}
    try {
      symbol = String(await publicClient.readContract({ address, abi: nftAbi, functionName: 'symbol' }));
    } catch {}

    res.json({
      success: true,
      contract: address,
      tokenId,
      tokenUri: resolved,
      name,
      symbol,
      metadata,
    });
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

/**
 * Delete wallet
 */
app.delete('/api/wallets/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Wallet ID is required' });
    }

    if (id === 'env') {
      return res.status(403).json({ success: false, error: 'Cannot delete environment wallet' });
    }

    const deleted = walletManager.deleteWallet(id);
    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Wallet not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: String(error) });
  }
});

// ============================================
// Alibaba Cloud DashScope Voice API
// ============================================

/**
 * Text-to-Speech using DashScope CosyVoice (Enhanced for natural speech)
 * 
 * 改进点：
 * 1. 使用更高采样率 (24000Hz)
 * 2. 支持情感和语速控制
 * 3. 智能文本预处理，保持自然语调
 * 4. 支持流式合成
 */
app.post('/api/voice/tts', async (req: Request, res: Response) => {
  try {
    const { 
      text, 
      voice = 'longxiaochun',  // 默认使用更自然的音色
      emotion = 'neutral',     // 情感: neutral, happy, sad, angry, fearful, surprised
      speechRate = 1.0,        // 语速: 0.5-2.0
      pitchRate = 1.0,         // 音调: 0.5-2.0
      volume = 50,             // 音量: 0-100
    } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ success: false, error: 'Text is required' });
    }
    
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'DashScope API key not configured' });
    }
    
    // 智能文本预处理 - 保持自然语调
    let processedText = text
      // 保留标点符号以维持语调
      .replace(/\n+/g, '，')
      // 处理长地址，用更自然的方式
      .replace(/0x[a-fA-F0-9]{40}/g, '钱包地址')
      .replace(/0x[a-fA-F0-9]{64}/g, '交易哈希')
      // 移除表情但保持语义
      .replace(/[🤖💰📍✅❌⚠️🔄📦🪙🦊🧭◆◈👋❓👤🎉]/g, '')
      // 处理数字，使其更自然
      .replace(/(\d+\.\d{4,})/g, (match) => parseFloat(match).toFixed(4))
      .trim();
    
    // 限制长度但尽量在句子边界截断
    if (processedText.length > 300) {
      const cutPoint = processedText.lastIndexOf('。', 300);
      if (cutPoint > 100) {
        processedText = processedText.slice(0, cutPoint + 1);
      } else {
        processedText = processedText.slice(0, 300) + '。';
      }
    }
    
    // 根据内容自动调整情感
    let autoEmotion = emotion;
    if (emotion === 'auto' || emotion === 'neutral') {
      if (text.includes('成功') || text.includes('完成') || text.includes('✅')) {
        autoEmotion = 'happy';
      } else if (text.includes('失败') || text.includes('错误') || text.includes('❌')) {
        autoEmotion = 'sad';
      } else if (text.includes('警告') || text.includes('注意') || text.includes('⚠️')) {
        autoEmotion = 'fearful';
      }
    }
    
    // 映射音色到 CosyVoice 支持的音色
    const voiceMap: Record<string, string> = {
      'longxiaochun': 'longxiaochun',     // 龙小淳 - 温柔女声
      'longxiaocheng': 'longxiaocheng',   // 龙小诚 - 沉稳男声
      'longxiaobai': 'longxiaobai',       // 龙小白 - 活泼女声
      'longlaotie': 'longlaotie',         // 龙老铁 - 东北男声
      'longshu': 'longshu',               // 龙叔 - 成熟男声
      'longshuo': 'longshuo',             // 龙硕 - 磁性男声
      'longjielidou': 'longjielidou',     // 龙杰力豆 - 可爱童声
      'loongstella': 'loongstella',       // Stella - 英文女声
      // 兼容旧的音色名
      'zhixiaobai': 'longxiaobai',
      'zhixiaoxia': 'longxiaochun',
      'zhixiaomei': 'longxiaochun',
      'zhixiaobei': 'longxiaobai',
      'zhixiaolong': 'longxiaocheng',
    };
    
    const mappedVoice = voiceMap[voice] || 'longxiaochun';
    
    // 使用 CosyVoice 同步 API（更快响应）
    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/generation', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'cosyvoice-v1',
        input: {
          text: processedText,
        },
        parameters: {
          voice: mappedVoice,
          format: 'mp3',
          sample_rate: 24000,      // 更高采样率
          speech_rate: speechRate, // 语速控制
          pitch_rate: pitchRate,   // 音调控制
          volume: volume,          // 音量控制
          // emotion: autoEmotion, // 情感控制（如果模型支持）
        },
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('DashScope TTS error:', errorData);
      
      // 尝试使用备用模型
      console.log('Trying Sambert fallback...');
      const fallbackResponse = await fetch('https://dashscope.aliyuncs.com/api/v1/services/aigc/text2audio/generation', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'sambert-zhichu-v1',  // 备用模型
          input: { text: processedText },
          parameters: {
            format: 'mp3',
            sample_rate: 24000,
          },
        }),
      });
      
      if (!fallbackResponse.ok) {
        return res.status(500).json({ 
          success: false, 
          error: errorData.message || 'TTS request failed' 
        });
      }
      
      const fallbackData = await fallbackResponse.json();
      if (fallbackData.output?.audio) {
        return res.json({ success: true, audioBase64: fallbackData.output.audio });
      }
      
      return res.status(500).json({ success: false, error: 'TTS generation failed' });
    }
    
    const data = await response.json();
    
    // 处理异步任务
    if (data.output?.task_id) {
      const taskId = data.output.task_id;
      let audioUrl = null;
      let attempts = 0;
      const maxAttempts = 20;
      
      while (!audioUrl && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 300)); // 更快轮询
        attempts++;
        
        const statusResponse = await fetch(
          `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
          { headers: { 'Authorization': `Bearer ${apiKey}` } }
        );
        
        if (statusResponse.ok) {
          const statusData = await statusResponse.json();
          if (statusData.output?.task_status === 'SUCCEEDED') {
            audioUrl = statusData.output?.results?.[0]?.url;
            break;
          } else if (statusData.output?.task_status === 'FAILED') {
            return res.status(500).json({ success: false, error: 'TTS generation failed' });
          }
        }
      }
      
      if (audioUrl) {
        res.json({ success: true, audioUrl });
      } else {
        res.status(500).json({ success: false, error: 'TTS timeout' });
      }
    } else if (data.output?.audio) {
      res.json({ success: true, audioBase64: data.output.audio });
    } else {
      res.status(500).json({ success: false, error: 'Unexpected TTS response' });
    }
  } catch (error) {
    console.error('TTS error:', error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Speech-to-Text using DashScope SenseVoice (supports direct audio input)
 */
app.post('/api/voice/stt', async (req: Request, res: Response) => {
  try {
    const { audioBase64, format = 'webm' } = req.body;
    
    if (!audioBase64) {
      return res.status(400).json({ success: false, error: 'Audio data is required' });
    }
    
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ success: false, error: 'DashScope API key not configured' });
    }
    
    // Use SenseVoice model for better accuracy and format support
    const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/recognition', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sensevoice-v1',
        input: {
          audio: audioBase64,
          format: format, // webm, wav, mp3, etc.
          sample_rate: 16000,
        },
        parameters: {
          language_hints: ['zh', 'en', 'auto'], // Support Chinese, English, and auto-detect
        },
      }),
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('DashScope ASR error:', errorData);
      
      // Fallback to Paraformer if SenseVoice fails
      console.log('Trying Paraformer fallback...');
      const fallbackResponse = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify({
          model: 'paraformer-v2',
          input: {
            file_urls: [`data:audio/${format};base64,${audioBase64}`],
          },
          parameters: {
            language_hints: ['zh', 'en'],
          },
        }),
      });
      
      if (!fallbackResponse.ok) {
        return res.status(500).json({ 
          success: false, 
          error: errorData.message || 'ASR request failed' 
        });
      }
      
      const fallbackData = await fallbackResponse.json();
      
      // Handle async task for Paraformer
      if (fallbackData.output?.task_id) {
        const taskId = fallbackData.output.task_id;
        let transcript = null;
        let attempts = 0;
        const maxAttempts = 60;
        
        while (!transcript && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 500));
          attempts++;
          
          const statusResponse = await fetch(
            `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`,
            {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
              },
            }
          );
          
          if (statusResponse.ok) {
            const statusData = await statusResponse.json();
            if (statusData.output?.task_status === 'SUCCEEDED') {
              transcript = statusData.output?.results?.[0]?.transcription?.full_sentence || '';
              break;
            } else if (statusData.output?.task_status === 'FAILED') {
              return res.status(500).json({ 
                success: false, 
                error: 'ASR transcription failed' 
              });
            }
          }
        }
        
        return res.json({ success: true, transcript: transcript || '' });
      }
      
      return res.json({ success: true, transcript: '' });
    }
    
    const data = await response.json();
    
    // SenseVoice returns direct result
    if (data.output?.text) {
      // Clean up the text (remove special tokens like <|zh|>, <|NEUTRAL|>, etc.)
      let transcript = data.output.text
        .replace(/<\|[^|]+\|>/g, '')
        .trim();
      res.json({ success: true, transcript });
    } else if (data.output?.sentence) {
      res.json({ success: true, transcript: data.output.sentence });
    } else {
      console.log('ASR response:', JSON.stringify(data, null, 2));
      res.json({ success: true, transcript: '' });
    }
  } catch (error) {
    console.error('STT error:', error);
    res.status(500).json({ success: false, error: String(error) });
  }
});

/**
 * Get available TTS voices (CosyVoice)
 */
app.get('/api/voice/voices', (req: Request, res: Response) => {
  res.json({
    success: true,
    voices: [
      // CosyVoice 高质量音色
      { id: 'longxiaochun', name: '龙小淳 (温柔)', gender: 'female', language: 'zh', quality: 'high' },
      { id: 'longxiaocheng', name: '龙小诚 (沉稳)', gender: 'male', language: 'zh', quality: 'high' },
      { id: 'longxiaobai', name: '龙小白 (活泼)', gender: 'female', language: 'zh', quality: 'high' },
      { id: 'longshu', name: '龙叔 (成熟)', gender: 'male', language: 'zh', quality: 'high' },
      { id: 'longshuo', name: '龙硕 (磁性)', gender: 'male', language: 'zh', quality: 'high' },
      { id: 'longlaotie', name: '龙老铁 (东北)', gender: 'male', language: 'zh', quality: 'high' },
      { id: 'longjielidou', name: '龙杰力豆 (童声)', gender: 'male', language: 'zh', quality: 'high' },
      { id: 'loongstella', name: 'Stella (英文)', gender: 'female', language: 'en', quality: 'high' },
    ],
    // 支持的情感
    emotions: ['neutral', 'happy', 'sad', 'angry', 'fearful', 'surprised'],
    // 参数范围
    parameters: {
      speechRate: { min: 0.5, max: 2.0, default: 1.0, description: '语速' },
      pitchRate: { min: 0.5, max: 2.0, default: 1.0, description: '音调' },
      volume: { min: 0, max: 100, default: 50, description: '音量' },
    },
  });
});

// ============================================
// WebSocket for Real-time Voice Recognition
// ============================================
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/voice' });

// DashScope Real-time ASR WebSocket URL
const DASHSCOPE_ASR_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';

wss.on('connection', (clientWs: WebSocket) => {
  console.log('[Voice WS] Client connected');
  
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    clientWs.send(JSON.stringify({ type: 'error', message: 'DashScope API key not configured' }));
    clientWs.close();
    return;
  }

  let dashscopeWs: WebSocket | null = null;
  let taskId: string | null = null;
  let isStarted = false;

  // Connect to DashScope real-time ASR
  const connectToDashScope = () => {
    dashscopeWs = new WebSocket(DASHSCOPE_ASR_WS_URL, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-DashScope-DataInspection': 'enable',
      },
    });

    dashscopeWs.on('open', () => {
      console.log('[DashScope WS] Connected');
      
      // Send run-task message to start recognition
      const startMessage = {
        header: {
          action: 'run-task',
          task_id: `task-${Date.now()}`,
          streaming: 'duplex',
        },
        payload: {
          task_group: 'audio',
          task: 'asr',
          function: 'recognition',
          model: 'paraformer-realtime-v2',
          parameters: {
            language_hints: ['zh', 'en'],
            format: 'pcm',
            sample_rate: 16000,
            enable_inverse_text_normalization: true,
            enable_punctuation_prediction: true,
            enable_intermediate_result: true,
          },
          input: {},
        },
      };
      
      dashscopeWs!.send(JSON.stringify(startMessage));
      taskId = startMessage.header.task_id;
      isStarted = true;
      clientWs.send(JSON.stringify({ type: 'status', status: 'ready' }));
    });

    dashscopeWs.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.header?.event === 'task-started') {
          console.log('[DashScope WS] Task started');
          clientWs.send(JSON.stringify({ type: 'status', status: 'listening' }));
        } else if (message.header?.event === 'result-generated') {
          const output = message.payload?.output;
          if (output?.sentence) {
            const result = output.sentence;
            const isFinal = result.end_time !== undefined;
            
            clientWs.send(JSON.stringify({
              type: 'transcript',
              text: result.text || '',
              isFinal: isFinal,
            }));
          }
        } else if (message.header?.event === 'task-finished') {
          console.log('[DashScope WS] Task finished');
          clientWs.send(JSON.stringify({ type: 'status', status: 'finished' }));
        } else if (message.header?.event === 'task-failed') {
          console.error('[DashScope WS] Task failed:', message);
          clientWs.send(JSON.stringify({ 
            type: 'error', 
            message: message.payload?.message || 'Recognition failed' 
          }));
        }
      } catch (e) {
        console.error('[DashScope WS] Parse error:', e);
      }
    });

    dashscopeWs.on('error', (error) => {
      console.error('[DashScope WS] Error:', error);
      clientWs.send(JSON.stringify({ type: 'error', message: 'Connection error' }));
    });

    dashscopeWs.on('close', () => {
      console.log('[DashScope WS] Closed');
      isStarted = false;
    });
  };

  // Handle messages from client
  clientWs.on('message', (data: Buffer) => {
    try {
      // Check if it's JSON control message or binary audio data
      const firstByte = data[0];
      
      // JSON messages start with '{' (0x7B)
      if (firstByte === 0x7B) {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'start') {
          if (!dashscopeWs || dashscopeWs.readyState !== WebSocket.OPEN) {
            connectToDashScope();
          }
        } else if (message.type === 'stop') {
          if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN && isStarted) {
            // Send finish-task message
            const finishMessage = {
              header: {
                action: 'finish-task',
                task_id: taskId,
                streaming: 'duplex',
              },
              payload: {
                input: {},
              },
            };
            dashscopeWs.send(JSON.stringify(finishMessage));
          }
        }
      } else {
        // Binary audio data - forward to DashScope
        if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN && isStarted) {
          // Send audio as continue-task
          const audioMessage = {
            header: {
              action: 'continue-task',
              task_id: taskId,
              streaming: 'duplex',
            },
            payload: {
              input: {
                audio: data.toString('base64'),
              },
            },
          };
          dashscopeWs.send(JSON.stringify(audioMessage));
        }
      }
    } catch (e) {
      console.error('[Voice WS] Message handling error:', e);
    }
  });

  clientWs.on('close', () => {
    console.log('[Voice WS] Client disconnected');
    if (dashscopeWs && dashscopeWs.readyState === WebSocket.OPEN) {
      dashscopeWs.close();
    }
  });
});

// Start server with WebSocket support
server.listen(PORT, () => {
  console.log(`\n🚀 Server running at http://localhost:${PORT}\n`);
  console.log(`📝 Open http://localhost:${PORT} in your browser\n`);
  console.log(`🎤 Voice features: Alibaba Cloud DashScope (Real-time ASR + TTS)\n`);
  console.log(`🔌 WebSocket endpoint: ws://localhost:${PORT}/ws/voice\n`);
});

