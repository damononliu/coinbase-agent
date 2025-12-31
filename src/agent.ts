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
import { getLangChainTools } from '@coinbase/agentkit-langchain';
import { ChatGroq } from '@langchain/groq';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { StructuredTool } from '@langchain/core/tools';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base } from 'viem/chains';
import { config } from './config.js';

const SYSTEM_PROMPT = `You are a friendly and knowledgeable blockchain wallet assistant powered by Coinbase AgentKit. Your goal is to help users manage their crypto assets in a clear, helpful, and conversational manner.

**Your Personality:**
- Be friendly, approachable, and conversational (like talking to a helpful friend)
- Use natural language, avoid technical jargon when possible, but explain things clearly when needed
- Show enthusiasm and be helpful
- Be empathetic when users encounter issues
- Use emojis sparingly but naturally to make responses more engaging

**Your Capabilities:**
You have access to various blockchain tools including:
- Wallet management (check address, view balances, transfer funds)
- ERC20 token operations (send tokens, check token balances)
- WETH wrapping/unwrapping (convert between ETH and WETH)
- And more blockchain operations

**Current Network:** ${config.networkId}

**Communication Style:**
- Respond in the same language the user uses (Chinese/English/etc.)
- When presenting technical information (addresses, transaction hashes, etc.), format them clearly
- Use bullet points or line breaks for readability when presenting multiple pieces of information
- When showing numbers (balances, amounts), format them in a human-readable way (e.g., "0.5 ETH" instead of "500000000000000000")

**Important Guidelines:**
1. **Transaction Safety:** Always confirm transaction details clearly with the user before executing any transactions. Show amounts, recipient addresses, and estimated gas costs in a clear format.

2. **Error Handling:** When something goes wrong, explain what happened in plain language and suggest what the user can do next. Don't just show raw error messages.

3. **Privacy & Security:** Never share private keys or sensitive information. Remind users about security best practices when relevant.

4. **Transparency:** Be honest when you don't know something or can't do something. Suggest alternatives when possible.

5. **Tool Results:** CRITICAL: When you see "Tool execution completed. Results:" in the conversation, you MUST respond with a friendly, natural message to the user. DO NOT repeat the raw tool output. Convert technical results into human-friendly language. Examples:
   - Transaction result → "✅ 转账成功！已发送 0.001 ETH 到地址 0x8f04...113a4。交易哈希: 0x9b6d5b..."
   - Balance result → "💰 你的余额: 0.5 ETH"
   - Address result → "📍 你的钱包地址: 0x1234...abcd"
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
export class CoinbaseAgent {
  private agentKit: AgentKit | null = null;
  private llm: BaseChatModel;
  private tools: StructuredTool[] = [];
  private conversationHistory: (HumanMessage | AIMessage | SystemMessage)[] = [];
  private walletAddress: string = '';

  constructor() {
    this.llm = createLLM();
    this.conversationHistory.push(new SystemMessage(SYSTEM_PROMPT));
  }

  /**
   * Initialize the AgentKit with local wallet
   */
  async initialize(privateKey?: string): Promise<{ address: string; network: string }> {
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

    // Create AgentKit with action providers
    this.agentKit = await AgentKit.from({
      walletProvider,
      // 能力边界，和 Langchain 兼容
      actionProviders: [
        wethActionProvider(),
        walletActionProvider(),
        erc20ActionProvider(),
        uniswapActionProvider(),
      ],
    });

    // Get LangChain tools
    this.tools = await getLangChainTools(this.agentKit);

    // Bind tools to LLM
    this.llm = (this.llm as any).bindTools(this.tools);

    // Get wallet address
    this.walletAddress = walletProvider.getAddress();

    // Get balance
    const balance = await walletProvider.getBalance();
    const balanceStr = (Number(balance) / 1e18).toFixed(4);

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
        // Handle balance/address queries
        else if (tc.name.includes('balance') || tc.name.includes('wallet')) {
          const balance = result.balance || result.ethBalance || '';
          const address = result.address || result.walletAddress || '';
          if (balance) messages.push(`💰 你的余额: ${balance} ETH`);
          if (address) messages.push(`📍 钱包地址: ${address.slice(0, 6)}...${address.slice(-4)}`);
        }
        // Handle other results
        else {
          messages.push(`✅ ${tc.name} 操作完成`);
        }
      } catch {
        // Not JSON, try to extract meaningful info from string
        const resultStr = tc.result;
        if (resultStr.includes('Transaction') || resultStr.includes('transferred') || resultStr.includes('Transferred')) {
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
      // Format wallet details
      if (toolName === 'get_wallet_details' || toolName === 'getWalletDetails') {
        const address = result.address || result.walletAddress || '';
        const balance = result.balance || result.ethBalance || '0';
        const network = result.network || config.networkId;
        return JSON.stringify({
          address: address,
          balance: balance,
          network: network,
        }, null, 2);
      }

      // Format balance results for better readability
      if (toolName.includes('balance')) {
        return JSON.stringify(result, null, 2);
      }

      // Default: pretty-print JSON
      return JSON.stringify(result, null, 2);
    }

    return String(result);
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
      let maxIterations = 5; // Prevent infinite loops
      let iteration = 0;
      let allToolCalls: Array<{ name: string; result: string }> = [];

      while (iteration < maxIterations) {
        iteration++;
        const response = await this.llm.invoke(this.conversationHistory);

        // Handle tool calls
        if (response.tool_calls && response.tool_calls.length > 0) {
          const toolResults: Array<{ name: string; result: string }> = [];

          // Execute all tool calls
          for (const toolCall of response.tool_calls) {
            // 关键点：代码会在 this.tools 列表里查找是否有这个工具
            const tool = this.tools.find((t) => t.name === toolCall.name);
            if (tool) {
              // 只有找到了，才会执行
              try {
                const result = await tool.invoke(toolCall.args || {});
                const formattedResult = this.formatToolResult(toolCall.name, result);
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
                return JSON.stringify(parsed, null, 2);
              } catch {
                return r.result;
              }
            })
            .join('\n');

          // Add tool results as an AI message (tool execution result)
          // Use a specific format that tells LLM this is a tool result that needs to be converted to friendly response
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

        // Check if content is just repeating tool results (which means LLM didn't generate friendly response)
        const isRawToolOutput = allToolCalls.length > 0 &&
          allToolCalls.some(tc => content.includes(tc.result) || content.includes(`Tool "${tc.name}"`));

        if (isRawToolOutput && content.length < 200) {
          // LLM didn't generate friendly response, create one based on tool results
          const friendlyMessage = this.generateFriendlyMessageFromToolResults(allToolCalls);
          this.conversationHistory.push(new AIMessage(friendlyMessage));
          return {
            message: friendlyMessage,
            toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          };
        }

        this.conversationHistory.push(new AIMessage(content));

        return {
          message: content,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      // Max iterations reached - generate friendly message from tool results
      const friendlyMessage = allToolCalls.length > 0
        ? this.generateFriendlyMessageFromToolResults(allToolCalls)
        : '我处理了你的请求，但遇到了一些问题。请重试。';

      return {
        message: friendlyMessage,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };
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
   * Check if there is a pending transaction requiring confirmation
   */
  hasPendingTransaction(): boolean {
    return false;
  }

  /**
   * Confirm and execute the pending transaction
   */
  async confirmTransaction(): Promise<{ message: string; toolCalls?: any[] }> {
    return { message: "No pending transaction to confirm." };
  }

  /**
   * Cancel the pending transaction
   */
  cancelTransaction(): { message: string } {
    return { message: "No pending transaction to cancel." };
  }
}
