/**
 * Coinbase AgentKit Agent (Self-Custody Mode)
 * Uses local private key - no CDP required
 */

import {
  AgentKit,
  ViemWalletProvider,
  wethActionProvider,
  walletActionProvider,
  erc20ActionProvider,
} from '@coinbase/agentkit';
import { uniswapActionProvider } from './action-providers/uniswap.js';
import { walletAddressActionProvider } from './action-providers/wallet-address.js';
import { getLangChainTools } from '@coinbase/agentkit-langchain';
import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredTool } from '@langchain/core/tools';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base } from 'viem/chains';
import { config } from './config.js';
import { setServerWalletAddress } from './runtime-state.js';

const SYSTEM_PROMPT = `You are a friendly and knowledgeable blockchain wallet assistant powered by Coinbase AgentKit. Your goal is to help users manage their crypto assets in a clear, helpful, and conversational manner.

**Your Personality:**
- Be friendly, approachable, and conversational (like talking to a helpful friend)
- Use natural language, avoid technical jargon when possible, but explain things clearly when needed
- Show enthusiasm and be helpful
- Be empathetic when users encounter issues
- Use emojis sparingly but naturally to make responses more engaging

**Your Capabilities:**
You have access to various blockchain tools including:
- **get_wallet_address**: Get the current wallet address (use this when user asks for their address)
- **get_wallet_details**: Get wallet address, balance, and network info (use when user asks for wallet details)
- Wallet management (check address, view balances, transfer funds)
- ERC20 token operations (send tokens, check token balances)
- WETH wrapping/unwrapping (convert between ETH and WETH)
- And more blockchain operations

**Available Tools:**
- get_wallet_address: Returns ONLY the wallet address. Use this when user asks for their address
- get_wallet_details: Returns address, balance, and network. Use when user asks for wallet info or details

**Current Network:** ${config.networkId}

**Communication Style:**
- Respond in the same language the user uses (Chinese/English/etc.)
- When presenting technical information (addresses, transaction hashes, etc.), format them clearly
- Use bullet points or line breaks for readability when presenting multiple pieces of information
- When showing numbers (balances, amounts), format them in a human-readable way (e.g., "0.5 ETH" instead of "500000000000000000")

**Important Guidelines:**
1. **Transaction Safety & User Confirmation:** 
   - CRITICAL: When the user requests a transaction (transfer, swap, wrap, etc.), you MUST use the appropriate tool to prepare the transaction.
   - The system will automatically pause and ask for user confirmation before executing any transaction involving funds.
   - DO NOT execute transactions directly - let the confirmation system handle it.
   - Always explain what the transaction will do in clear, user-friendly language.
   - Show amounts, recipient addresses, and any relevant details clearly.

2. **Error Handling:** When something goes wrong, explain what happened in plain language and suggest what the user can do next. Don't just show raw error messages.

3. **Privacy & Security:** Never share private keys or sensitive information. Remind users about security best practices when relevant.

4. **Transparency:** Be honest when you don't know something or can't do something. Suggest alternatives when possible.

5. **Tool Results:** CRITICAL: When you see "Tool execution completed. Results:" in the conversation, you MUST respond with a friendly, natural message to the user. DO NOT repeat the raw tool output. Convert technical results into human-friendly language. Examples:
   - Transaction result → "✅ 转账成功！已发送 0.001 ETH 到地址 0x1234...5678。交易哈希: 0xabcd..."
   - Balance result → "💰 余额: 0.5 ETH" (ONLY show the balance, no technical details like WEI, Chain ID, Provider, etc.)
   - Address result → "📍 钱包地址: [FULL_ADDRESS_FROM_TOOL]" (CRITICAL: When user asks for address, you MUST use the get_wallet_address tool and show the EXACT address returned by the tool. DO NOT use example addresses, DO NOT truncate, DO NOT make up addresses. Always use the actual address from the tool result.)
   - **IMPORTANT for balance queries:** Keep it simple - just show the ETH balance. Do NOT include WEI values, network technical details, provider information, or any other technical metadata.
   - **CRITICAL for address queries:** 
     * When user asks "我的地址" or "what's my address" or similar, you MUST call the get_wallet_address tool.
     * The tool will return the actual wallet address in JSON format: {"address": "0x..."}.
     * You MUST extract and display the EXACT address from the tool result JSON.
     * DO NOT use placeholder addresses like 0x1234567890123456789012345678901234567890.
     * DO NOT use example addresses, DO NOT make up addresses, DO NOT truncate addresses.
     * If the tool returns an address, display the FULL 42-character address starting with 0x.
     * If the tool fails, show the error message but NEVER generate a fake address.
  - If the tool result includes a "clientAddress" (browser wallet), show BOTH:
    * 服务端钱包地址（交易签名实际使用）
    * 浏览器钱包地址（仅显示给用户确认）
    And warn that transactions still use the server wallet unless explicitly changed.
  - Always celebrate successes with the user!

6. **Context Awareness:** Remember previous conversation context and refer back to it when relevant.

7. **Proactive Help:** Anticipate follow-up questions users might have and provide helpful information upfront.

Remember: You're not just executing commands, you're helping a person understand and manage their crypto assets. Be helpful, clear, and friendly!`;

/**
 * Create LLM based on config
 */
function createLLM(): BaseChatModel {
  // Clamp temperature between 0 and 2
  const temperature = Math.max(0, Math.min(2, config.temperature));

  if (config.llmProvider === 'groq') {
    return new ChatGroq({
      model: config.groqModel,
      apiKey: config.groqApiKey,
      temperature: temperature, // Configurable temperature for natural conversations
    });
  } else if (config.llmProvider === 'alibaba') {
    return new ChatOpenAI({
      modelName: config.dashscopeModel,
      openAIApiKey: config.dashscopeApiKey,
      temperature: temperature,
      configuration: {
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
      }
    });
  } else if (config.llmProvider === 'claude') {
    return new ChatAnthropic({
      model: config.claudeModel,
      apiKey: config.anthropicApiKey,
      temperature: temperature, // Configurable temperature for natural conversations
    });
  } else {
    return new ChatOpenAI({
      modelName: config.openaiModel,
      openAIApiKey: config.openaiApiKey,
      temperature: temperature, // Configurable temperature for natural conversations
    });
  }
}

/**
 * Coinbase AgentKit Agent
 */
// 需要用户确认的交易操作
const TRANSACTION_REQUIRING_CONFIRMATION = [
  'native_transfer',
  'erc20_transfer',
  'uniswap_swap',
  'wrap_eth',
  'unwrap_eth',
];

// 待确认交易信息
interface PendingTransaction {
  toolName: string;
  toolArgs: any;
  description: string;
  estimatedGas?: string;
}

export class CoinbaseAgent {
  private agentKit: AgentKit | null = null;
  private llm: BaseChatModel;
  private tools: StructuredTool[] = [];
  private conversationHistory: (HumanMessage | AIMessage | SystemMessage)[] = [];
  private walletAddress: string = '';
  private pendingTransaction: PendingTransaction | null = null;
  private walletProvider: ViemWalletProvider | null = null;
  private summaryLLM: BaseChatModel;

  constructor() {
    this.llm = createLLM();
    this.summaryLLM = createLLM();
    this.conversationHistory.push(new SystemMessage(SYSTEM_PROMPT));
  }

  /**
   * Initialize the AgentKit with local wallet
   */
  async initialize(privateKey?: string): Promise<{ address: string; network: string; balance?: string }> {
    // Use provided key or fallback to config
    const pk = privateKey || config.privateKey;
    if (!pk) {
      throw new Error('No private key provided and none found in .env');
    }

    // Create account from private key
    const account = privateKeyToAccount(pk as `0x${string}`);

    // Get chain config
    const chain = config.networkId === 'base' ? base : baseSepolia;

    // Create Viem wallet client
    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(config.rpcUrl || undefined),
    });

    // Create ViemWalletProvider (self-custody)
    const walletProvider = new ViemWalletProvider(walletClient);
    this.walletProvider = walletProvider;

    // Create AgentKit with action providers
    this.agentKit = await AgentKit.from({
      walletProvider,
      // 能力边界，和 Langchain 兼容
      actionProviders: [
        wethActionProvider(),
        walletActionProvider(),
        erc20ActionProvider(),
        uniswapActionProvider(),
        walletAddressActionProvider(),
      ],
    });

    // Get LangChain tools
    this.tools = await getLangChainTools(this.agentKit);

    // Bind tools to LLM
    this.llm = (this.llm as any).bindTools(this.tools);

    // Get wallet address
    this.walletAddress = walletProvider.getAddress();
    setServerWalletAddress(this.walletAddress);

    // Get balance
    const balance = await walletProvider.getBalance();
    console.log(`[Agent] Raw balance from walletProvider: ${balance} (type: ${typeof balance})`);
    const balanceStr = this.formatEthBalance(balance);
    console.log(`[Agent] Formatted balance: ${balanceStr} ETH`);

    return {
      address: this.walletAddress,
      network: config.networkId,
      balance: balanceStr,
    };
  }

  /**
   * Refresh current wallet info (address/network/balance)
   */
  async refreshWalletInfo(): Promise<{ address: string; network: string; balance?: string }> {
    if (!this.walletProvider) {
      return {
        address: this.walletAddress,
        network: config.networkId,
      };
    }

    const balance = await this.walletProvider.getBalance();
    const balanceStr = this.formatEthBalance(balance);
    return {
      address: this.walletAddress,
      network: config.networkId,
      balance: balanceStr,
    };
  }

  /**
   * Generate friendly message from tool results (fallback if LLM doesn't generate one)
   */
  private generateFriendlyMessageFromToolResults(toolCalls: Array<{ name: string; result: string }>): string {
    if (toolCalls.length === 0) {
      return '操作已完成。';
    }

    const messages: string[] = [];

    for (const tc of toolCalls) {
      try {
        const result = JSON.parse(tc.result);

        // Handle transaction results
        if (tc.name.includes('transfer') || tc.name.includes('native_transfer')) {
          const hash = result.transactionHash || result.hash || result.txHash || '';
          const to = result.to || result.recipient || '';
          const amount = result.amount || result.value || '';
          messages.push(`✅ 转账成功！已发送 ${amount} ETH 到地址 ${to.slice(0, 6)}...${to.slice(-4)}。交易哈希: ${hash.slice(0, 10)}...${hash.slice(-8)}`);
        }
        // Handle wallet address query - 显示完整地址
        else if (tc.name === 'get_wallet_address') {
          const address = result.address || '';
          const clientAddress = result.clientAddress || '';
          console.log('[Agent] get_wallet_address result:', result);
          console.log('[Agent] extracted address:', address);
          if (address && address.length === 42 && address.startsWith('0x') && address !== '0x1234567890123456789012345678901234567890') {
            if (clientAddress) {
              if (clientAddress !== address) {
              messages.push(
                `🧭 当前连接钱包地址: ${clientAddress}\n` +
                `📍 服务端钱包地址（交易实际使用）: ${address}\n` +
                `⚠️ 注意：交易仍使用服务端钱包签名，若需更换请在 Wallet Manager 切换或导入私钥。`
              );
              } else {
                messages.push(`🧭 当前连接钱包地址: ${address}`);
              }
            } else {
              messages.push(`📍 钱包地址: ${address}`);
            }
          } else {
            console.error('[Agent] Invalid address format or placeholder address:', address);
            messages.push(`❌ 无法获取有效的钱包地址。请检查钱包连接。`);
          }
        }
        // Handle balance/wallet details queries - 简化显示
        else if (tc.name.includes('balance') || tc.name.includes('wallet') || tc.name.includes('get_wallet')) {
          // 提取 ETH 余额（优先使用格式化的值）
          let balance = result.balance || result.ethBalance || '';
          if (!balance && result.nativeBalance) {
            // 从 nativeBalance 字符串中提取 ETH 值
            if (typeof result.nativeBalance === 'string') {
              const match = result.nativeBalance.match(/([\d.]+)\s*ETH/);
              if (match) {
                balance = parseFloat(match[1]).toFixed(4);
              }
            }
          }
          
          // 只显示余额，不显示地址（除非用户明确询问地址）
          if (balance) {
            // 清理余额格式（移除 "ETH" 后缀如果已存在）
            const cleanBalance = balance.replace(/\s*ETH\s*/gi, '');
            messages.push(`💰 余额: ${cleanBalance} ETH`);
          } else {
            messages.push(`💰 余额: 0 ETH`);
          }
        }
        // Handle other results
        else {
          messages.push(`✅ ${tc.name} 操作完成`);
        }
      } catch {
        // Not JSON, try to extract meaningful info from string
        const resultStr = tc.result;
        
        // 处理钱包地址查询的字符串结果
        if (tc.name === 'get_wallet_address') {
          const addressMatch = resultStr.match(/0x[a-fA-F0-9]{40}/);
          console.log('[Agent] get_wallet_address string result:', resultStr);
          console.log('[Agent] extracted address from string:', addressMatch?.[0]);
          if (addressMatch && addressMatch[0] !== '0x1234567890123456789012345678901234567890') {
            messages.push(`📍 钱包地址: ${addressMatch[0]}`);
          } else {
            console.error('[Agent] Invalid address format or placeholder address in string:', addressMatch?.[0]);
            messages.push(`❌ 无法获取有效的钱包地址。请检查钱包连接。`);
          }
        }
        // 处理余额查询的字符串结果
        else if (tc.name.includes('balance') || tc.name.includes('wallet') || tc.name.includes('get_wallet')) {
          // 从字符串中提取 ETH 余额
          const ethBalanceMatch = resultStr.match(/Native Balance:\s*([\d.]+)\s*ETH/i) || 
                                  resultStr.match(/([\d.]+)\s*ETH/i);
          if (ethBalanceMatch) {
            const balance = parseFloat(ethBalanceMatch[1]).toFixed(4);
            messages.push(`💰 余额: ${balance} ETH`);
          } else {
            messages.push(`💰 余额: 0 ETH`);
          }
        }
        // 处理交易结果
        else if (resultStr.includes('Transaction') || resultStr.includes('transferred') || resultStr.includes('Transferred')) {
          // Extract transaction hash
          const hashMatch = resultStr.match(/0x[a-fA-F0-9]{64}/);
          const addressMatch = resultStr.match(/0x[a-fA-F0-9]{40}/);
          const amountMatch = resultStr.match(/(\d+\.?\d*)\s*ETH/);

          const hash = hashMatch ? hashMatch[0] : '';
          const address = addressMatch ? addressMatch[0] : '';
          const amount = amountMatch ? amountMatch[1] : '';

          if (amount && address) {
            messages.push(`✅ 转账成功！已发送 ${amount} ETH 到地址 ${address.slice(0, 6)}...${address.slice(-4)}`);
          }
          if (hash) {
            messages.push(`交易哈希: ${hash.slice(0, 10)}...${hash.slice(-8)}`);
          }
          if (!hash && !address) {
            messages.push(`✅ ${tc.name} 操作完成`);
          }
        } else {
          messages.push(`✅ ${tc.name} 操作完成`);
        }
      }
    }

    return messages.join('\n') || '操作已完成。';
  }

  /**
   * Format tool result for better readability
   */
  private formatToolResult(toolName: string, result: any): string {
    // Handle string results
    if (typeof result === 'string') {
      // Try to parse JSON strings for better formatting
      if (result.trim().startsWith('{') || result.trim().startsWith('[')) {
        try {
          const parsed = JSON.parse(result);
          return this.formatToolResult(toolName, parsed);
        } catch {
          // Not valid JSON, return as is
          return result;
        }
      }
      return result;
    }

    // Format object results
    if (typeof result === 'object' && result !== null) {
      // Format wallet address result - 只返回地址
      if (toolName === 'get_wallet_address') {
        const address = result.address || '';
        const clientAddress = result.clientAddress || '';
        if (!address) {
          console.warn('[Agent] get_wallet_address returned empty address');
        } else {
          console.log('[Agent] get_wallet_address returned:', address);
        }
        return JSON.stringify({
          address: address,
          clientAddress: clientAddress || undefined,
        }, null, 2);
      }

      // Format wallet details - 只显示关键信息
      if (toolName === 'get_wallet_details' || toolName === 'getWalletDetails') {
        // 提取 ETH 余额（优先使用格式化的 ETH 值，如果没有则从 WEI 转换）
        let balance = result.balance || result.ethBalance || '';
        if (!balance && result.nativeBalance) {
          // 如果只有 WEI，尝试从字符串中提取 ETH 值
          const ethMatch = String(result.nativeBalance).match(/Native Balance: ([\d.]+) ETH/);
          if (ethMatch) {
            balance = parseFloat(ethMatch[1]).toFixed(4);
          } else if (typeof result.nativeBalance === 'string' && result.nativeBalance.includes('ETH')) {
            // 从字符串中提取 ETH 值
            const match = result.nativeBalance.match(/([\d.]+)\s*ETH/);
            if (match) {
              balance = parseFloat(match[1]).toFixed(4);
            }
          }
        }
        
        const address = result.address || result.walletAddress || '';
        // 简化网络显示
        let network = result.network || config.networkId;
        if (result.networkId) {
          network = result.networkId === 'base-sepolia' ? 'Base Sepolia' : 
                    result.networkId === 'base' ? 'Base' : result.networkId;
        }
        
        return JSON.stringify({
          address: address,
          balance: balance ? `${balance} ETH` : '0 ETH',
          network: network,
        }, null, 2);
      }

      // Format balance results - 只显示 ETH 余额
      if (toolName.includes('balance') || toolName.includes('get_balance')) {
        // 提取 ETH 余额
        let balance = result.balance || result.ethBalance || '';
        if (!balance && result.nativeBalance) {
          // 尝试从 nativeBalance 字符串中提取 ETH 值
          if (typeof result.nativeBalance === 'string') {
            const match = result.nativeBalance.match(/([\d.]+)\s*ETH/);
            if (match) {
              balance = parseFloat(match[1]).toFixed(4);
            }
          }
        }
        
        const address = result.address || result.walletAddress || '';
        
        // 只返回关键信息
        const simplified: any = {};
        if (address) simplified.address = address;
        if (balance) simplified.balance = `${balance} ETH`;
        
        return JSON.stringify(simplified, null, 2);
      }

      // Default: pretty-print JSON
      return JSON.stringify(result, null, 2);
    }

    return String(result);
  }

  /**
   * Check if a tool call is a no-op (e.g. wrap_eth with 0 amount)
   */
  private isNoopToolCall(toolName: string, args: any): boolean {
    if (toolName.includes('wrap_eth') || toolName.includes('unwrap_eth')) {
      const amount = this.parseAmount(args?.amount ?? args?.amountToWrap ?? args?.value);
      if (amount === null || amount === 0) return true;
    }
    if (toolName.includes('native_transfer') || toolName.includes('erc20_transfer')) {
      const amount = this.parseAmount(args?.amount ?? args?.value);
      if (amount === null || amount === 0) return true;
    }
    return false;
  }

  private async processAgentIteration(options: {
    prefixMessage?: string;
    initialToolCalls?: Array<{ name: string; result: string }>;
  } = {}): Promise<{
    message: string;
    toolCalls?: Array<{ name: string; result: string }>;
    pendingTransaction?: any;
  }> {
    const { prefixMessage = '', initialToolCalls = [] } = options;
    let maxIterations = 3;
    let iteration = 0;
    let allToolCalls: Array<{ name: string; result: string }> = [...initialToolCalls];

    while (iteration < maxIterations) {
      iteration++;
      const response = await this.llm.invoke(this.conversationHistory);

      // Handle tool calls
      if (response.tool_calls && response.tool_calls.length > 0) {
        const toolResults: Array<{ name: string; result: string }> = [];

        // Deduplicate and filter tool calls
        const seenToolKeys = new Set<string>();
        const filteredToolCalls = response.tool_calls.filter((toolCall) => {
          const key = `${toolCall.name}:${JSON.stringify(toolCall.args || {})}`;

          if (seenToolKeys.has(key)) {
            console.log(`[Agent] Skipping duplicate tool call: ${toolCall.name}`);
            return false;
          }
          seenToolKeys.add(key);

          if (this.isNoopToolCall(toolCall.name, toolCall.args)) {
            console.log(`[Agent] Skipping no-op tool call: ${toolCall.name}`, toolCall.args);
            return false;
          }

          // Skip if same transaction tool was already executed in this session
          const isTransaction = TRANSACTION_REQUIRING_CONFIRMATION.some(
            (name) => toolCall.name.includes(name)
          );
          if (isTransaction) {
            const txKey = `${toolCall.name}:${JSON.stringify(toolCall.args || {})}`;
            if (allToolCalls.some(tc => `${tc.name}:${JSON.stringify(tc.result)}` !== '' && tc.name === toolCall.name)) {
              console.log(`[Agent] Skipping repeated transaction tool: ${toolCall.name}`);
              return false;
            }
          }

          return true;
        });

        // Execute filtered tool calls
        for (const toolCall of filteredToolCalls) {
          const tool = this.tools.find((t) => t.name === toolCall.name);
          if (tool) {
            const requiresConfirmation = TRANSACTION_REQUIRING_CONFIRMATION.some(
              (name) => toolCall.name.includes(name)
            );

            if (requiresConfirmation && !this.pendingTransaction) {
              const description = await this.buildTransactionDescription(toolCall.name, toolCall.args || {});
              this.pendingTransaction = {
                toolName: toolCall.name,
                toolArgs: toolCall.args || {},
                description,
              };

              return {
                message: prefixMessage 
                  ? `${prefixMessage}\n\n⚠️ 检测到需要确认的交易操作：\n\n${description}\n\n请确认是否执行此交易。`
                  : `⚠️ 检测到需要确认的交易操作：\n\n${description}\n\n请确认是否执行此交易。`,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
                pendingTransaction: this.pendingTransaction,
              };
            }

            try {
              console.log(`[Agent] Invoking tool: ${toolCall.name} with args:`, toolCall.args);
              const result = await tool.invoke(toolCall.args || {});
              console.log(`[Agent] Tool ${toolCall.name} returned:`, result);
              const formattedResult = this.formatToolResult(toolCall.name, result);
              console.log(`[Agent] Tool ${toolCall.name} formatted result:`, formattedResult);
              toolResults.push({
                name: toolCall.name,
                result: formattedResult,
              });
              allToolCalls.push({
                name: toolCall.name,
                result: formattedResult,
              });
            } catch (error) {
              const errorMsg = error instanceof Error ? error.message : String(error);
              console.error(`[Agent] Tool ${toolCall.name} failed:`, errorMsg);
              toolResults.push({
                name: toolCall.name,
                result: `Error: ${errorMsg}`,
              });
              allToolCalls.push({
                name: toolCall.name,
                result: `Error: ${errorMsg}`,
              });
            }
          }
        }

        // Format tool results for LLM to understand
        const toolResultsText = toolResults
          .map((r) => {
            try {
              const parsed = JSON.parse(r.result);
              // 如果是余额查询，只返回关键信息
              if (r.name.includes('balance') || r.name.includes('wallet') || r.name.includes('get_wallet')) {
                const simplified: any = {};
                if (parsed.balance) simplified.balance = parsed.balance;
                if (parsed.address && !r.name.includes('balance')) simplified.address = parsed.address;
                if (parsed.network && !r.name.includes('balance')) simplified.network = parsed.network;
                return JSON.stringify(simplified, null, 2);
              }
              return JSON.stringify(parsed, null, 2);
            } catch {
              // 对于字符串结果，如果是余额查询，尝试提取关键信息
              if (r.name.includes('balance') || r.name.includes('wallet') || r.name.includes('get_wallet')) {
                const ethMatch = r.result.match(/([\d.]+)\s*ETH/i);
                if (ethMatch) {
                  return JSON.stringify({ balance: `${parseFloat(ethMatch[1]).toFixed(4)} ETH` }, null, 2);
                }
              }
              return r.result;
            }
          })
          .join('\n');

        // Add tool results as an AI message
        this.conversationHistory.push(
          new AIMessage(`Tool execution completed. Results:\n${toolResultsText}`)
        );

        // Continue loop to let LLM generate friendly response
        continue;
      }

      // No tool calls - LLM is providing final response
      const content =
        typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

      // Check if content is just repeating tool results
      const isRawToolOutput = allToolCalls.length > 0 &&
        allToolCalls.some(tc => content.includes(tc.result) || content.includes(`Tool "${tc.name}"`));

      if (isRawToolOutput && content.length < 200) {
        // LLM didn't generate friendly response, create one based on tool results
        const friendlyMessage = this.generateFriendlyMessageFromToolResults(allToolCalls);
        this.conversationHistory.push(new AIMessage(friendlyMessage));
        return {
          message: prefixMessage ? `${prefixMessage}\n\n${friendlyMessage}` : friendlyMessage,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      this.conversationHistory.push(new AIMessage(content));

      return {
        message: prefixMessage ? `${prefixMessage}\n\n${content}` : content,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };
    }

    // Max iterations reached - generate friendly message from tool results
    const friendlyMessage = allToolCalls.length > 0
      ? this.generateFriendlyMessageFromToolResults(allToolCalls)
      : '我处理了你的请求，但遇到了一些问题。请重试。';

    return {
      message: prefixMessage ? `${prefixMessage}\n\n${friendlyMessage}` : friendlyMessage,
      toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
    };
  }

  /**
   * Chat with the agent
   */
  async chat(userMessage: string): Promise<{
    message: string;
    toolCalls?: Array<{ name: string; result: string }>;
    pendingTransaction?: any;
  }> {
    this.conversationHistory.push(new HumanMessage(userMessage));

    try {
      await this.maybeSummarizeHistory();
      return await this.processAgentIteration();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Generate a friendly error message using LLM
      try {
        const errorContext = this.conversationHistory.slice(0, -1); // Remove the user message
        const errorPrompt = `The user's request failed with this error: "${errorMsg}". 
Please provide a friendly, helpful explanation of what went wrong and suggest what the user can do next. 
Be empathetic and supportive. Respond in the same language as the user's message: "${userMessage}"`;

        const errorResponse = await this.llm.invoke([
          ...errorContext,
          new SystemMessage('You are a helpful assistant. Explain errors in a friendly way.'),
          new HumanMessage(errorPrompt),
        ]);

        const friendlyErrorMsg =
          typeof errorResponse.content === 'string'
            ? errorResponse.content
            : `I encountered an error: ${errorMsg}. Let me help you resolve this.`;

        this.conversationHistory.push(new AIMessage(friendlyErrorMsg));
        return { message: friendlyErrorMsg };
      } catch {
        // Fallback to friendly error message
        const friendlyError = `I'm sorry, something went wrong: ${errorMsg}. Please try again or let me know if you need help!`;
        this.conversationHistory.push(new AIMessage(friendlyError));
        return { message: friendlyError };
      }
    }
  }

  /**
   * Get wallet address
   */
  getAddress(): string {
    return this.walletAddress;
  }

  /**
   * Clear conversation history
   */
  clearHistory(): void {
    this.conversationHistory = [new SystemMessage(SYSTEM_PROMPT)];
  }

  /**
   * Generate human-readable transaction description
   */
  private generateTransactionDescription(toolName: string, args: any): string {
    if (toolName.includes('native_transfer')) {
      return `💰 ETH 转账
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
接收地址: ${args.to || args.recipient || 'N/A'}
转账金额: ${args.amount || args.value || 'N/A'} ETH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    } else if (toolName.includes('erc20_transfer')) {
      return `🪙 ERC20 代币转账
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
代币地址: ${args.tokenAddress || args.token || 'N/A'}
接收地址: ${args.to || args.recipient || 'N/A'}
转账数量: ${args.amount || args.value || 'N/A'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    } else if (toolName.includes('uniswap_swap')) {
      return `🔄 Uniswap 代币交换
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
从: ${args.tokenIn || 'N/A'}
到: ${args.tokenOut || 'N/A'}
数量: ${args.amount || 'N/A'}
滑点容忍度: ${args.slippage || 0.5}%
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    } else if (toolName.includes('wrap_eth')) {
      return `📦 包装 ETH 为 WETH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ETH 数量: ${args.amount || args.value || 'N/A'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    } else if (toolName.includes('unwrap_eth')) {
      return `📦 解包 WETH 为 ETH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
WETH 数量: ${args.amount || args.value || 'N/A'}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
    }
    return `交易操作: ${toolName}\n参数: ${JSON.stringify(args, null, 2)}`;
  }

  /**
   * Build transaction description with optional safety hints
   */
  private async buildTransactionDescription(toolName: string, args: any): Promise<string> {
    let description = this.generateTransactionDescription(toolName, args);

    const needsEthBalanceCheck =
      toolName.includes('native_transfer') ||
      toolName.includes('wrap_eth') ||
      (toolName.includes('uniswap_swap') && String(args?.tokenIn || '').toUpperCase() === 'ETH');

    if (needsEthBalanceCheck) {
      const balance = await this.getEthBalanceNumber();
      if (balance !== null) {
        description += `\n当前可用余额: ${balance.toFixed(4)} ETH`;
        const amount = this.parseAmount(args?.amount ?? args?.value);
        if (amount !== null && amount > balance) {
          description += `\n⚠️ 警告: 转账金额高于当前余额，可能会失败。`;
        }
      }
    }

    return description;
  }

  /**
   * Check if there is a pending transaction requiring confirmation
   */
  hasPendingTransaction(): boolean {
    return this.pendingTransaction !== null;
  }

  /**
   * Confirm and execute the pending transaction
   */
  async confirmTransaction(): Promise<{ message: string; toolCalls?: any[]; pendingTransaction?: any }> {
    if (!this.pendingTransaction) {
      return { message: "没有待确认的交易。" };
    }

    const { toolName, toolArgs } = this.pendingTransaction;
    const tool = this.tools.find((t) => t.name === toolName);

    if (!tool) {
      this.pendingTransaction = null;
      return { message: "找不到对应的交易工具。" };
    }

    try {
      console.log(`[Agent] Executing confirmed transaction: ${toolName}`, toolArgs);
      const result = await tool.invoke(toolArgs);
      const formattedResult = this.formatToolResult(toolName, result);

      this.pendingTransaction = null;

      this.conversationHistory.push(
        new AIMessage(`交易已确认并执行。结果: ${formattedResult}`)
      );

      const friendlyMessage = this.generateFriendlyMessageFromToolResults([{
        name: toolName,
        result: formattedResult,
      }]);

      return {
        message: `✅ 交易已确认并执行成功！\n\n${friendlyMessage}`,
        toolCalls: [{
          name: toolName,
          result: formattedResult,
        }],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.pendingTransaction = null;
      return {
        message: `❌ 交易执行失败: ${errorMsg}`,
      };
    }
  }

  /**
   * Cancel the pending transaction
   */
  cancelTransaction(): { message: string } {
    if (!this.pendingTransaction) {
      return { message: "没有待确认的交易。" };
    }

    const description = this.pendingTransaction.description;
    this.pendingTransaction = null;

    // 添加取消信息到对话历史
    this.conversationHistory.push(
      new AIMessage("用户取消了交易。")
    );

    return {
      message: `❌ 交易已取消。\n\n已取消的交易:\n${description}`,
    };
  }

  /**
   * Summarize older messages when history grows too large
   */
  private async maybeSummarizeHistory(): Promise<void> {
    const trigger = Math.max(10, config.summaryTriggerMessages);
    if (this.conversationHistory.length <= trigger) {
      return;
    }

    const keepCount = Math.max(6, config.summaryKeepMessages);
    const recentMessages = this.conversationHistory.slice(-keepCount);
    const messagesToSummarize = this.conversationHistory.slice(1, -keepCount);

    if (messagesToSummarize.length < 4) {
      return;
    }

    try {
      const summarySystem = new SystemMessage(
        '你是对话摘要助手。请用简洁中文总结用户需求、已完成动作、待确认交易、关键偏好与上下文。'
      );
      const summaryPrompt = new HumanMessage(
        '请给出一段不超过 8 行的摘要，便于后续继续对话。'
      );
      const summaryResponse = await this.summaryLLM.invoke([
        summarySystem,
        ...messagesToSummarize,
        summaryPrompt,
      ]);

      const summaryText =
        typeof summaryResponse.content === 'string'
          ? summaryResponse.content
          : JSON.stringify(summaryResponse.content);

      this.conversationHistory = [
        new SystemMessage(SYSTEM_PROMPT),
        new SystemMessage(`对话摘要：\n${summaryText}`),
        ...recentMessages,
      ];
    } catch (error) {
      console.warn('[Agent] Failed to summarize history, trimming instead:', error);
      this.conversationHistory = [
        new SystemMessage(SYSTEM_PROMPT),
        ...recentMessages,
      ];
    }
  }

  /**
   * Parse amount as number (best effort)
   */
  private parseAmount(value: any): number | null {
    if (value === undefined || value === null) return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return null;
    return num;
  }

  /**
   * Get ETH balance as a number (best effort)
   */
  private async getEthBalanceNumber(): Promise<number | null> {
    if (!this.walletProvider) return null;
    try {
      const balance = await this.walletProvider.getBalance();
      const balanceStr = this.formatEthBalance(balance);
      const num = Number(balanceStr);
      return Number.isFinite(num) ? num : null;
    } catch {
      return null;
    }
  }

  /**
   * Format balance to ETH string with 4 decimals
   * @param balance - Balance in WEI (bigint) or ETH (string/number)
   */
  private formatEthBalance(balance: bigint | string | number): string {
    try {
      // If it's a bigint, it's in WEI
      if (typeof balance === 'bigint') {
        const ethValue = Number(balance) / 1e18;
        console.log(`[Agent] formatEthBalance: bigint ${balance} -> ${ethValue} ETH`);
        return ethValue.toFixed(4);
      }
      
      // If it's a string that looks like a large integer (WEI)
      const strBalance = String(balance);
      if (/^\d+$/.test(strBalance) && strBalance.length > 10) {
        const ethValue = Number(BigInt(strBalance)) / 1e18;
        console.log(`[Agent] formatEthBalance: string WEI ${strBalance} -> ${ethValue} ETH`);
        return ethValue.toFixed(4);
      }
      
      // Otherwise assume it's already in ETH
      const num = Number(balance);
      if (Number.isFinite(num)) {
        // If it's a very small number, it's likely already in ETH
        if (num < 1000) {
          console.log(`[Agent] formatEthBalance: assumed ETH ${num}`);
          return num.toFixed(4);
        }
        // Otherwise it's likely WEI
        const ethValue = num / 1e18;
        console.log(`[Agent] formatEthBalance: large number as WEI ${num} -> ${ethValue} ETH`);
        return ethValue.toFixed(4);
      }
      
      console.warn(`[Agent] formatEthBalance: unrecognized format, returning 0`);
      return '0.0000';
    } catch (error) {
      console.error(`[Agent] formatEthBalance error:`, error);
      return '0.0000';
    }
  }
}
