/**
 * Configuration for Coinbase AgentKit (Self-Custody Mode)
 */

import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export const config = {
  // LLM Provider
  llmProvider: (process.env.LLM_PROVIDER || 'alibaba') as 'groq' | 'openai' | 'alibaba' | 'claude',

  // Groq (free)
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',

  // OpenAI (paid)
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',

  // Alibaba Cloud (DashScope)
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
  dashscopeModel: process.env.DASHSCOPE_MODEL || 'qwen-turbo',

  // Claude (Anthropic)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  claudeModel: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',

  // Self-Custody Wallet (your private key)
  privateKey: process.env.PRIVATE_KEY || '',

  // Network
  networkId: process.env.NETWORK_ID || 'base-sepolia',

  // RPC URL (optional)
  rpcUrl: process.env.RPC_URL || '',

  // LLM Temperature (0-1, higher = more creative/random)
  // Default: 0.7 for more natural conversations
  temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),

  // Conversation memory settings
  // When history grows too large, summarize older messages to keep context concise
  summaryTriggerMessages: parseInt(process.env.SUMMARY_TRIGGER_MESSAGES || '40', 10),
  summaryKeepMessages: parseInt(process.env.SUMMARY_KEEP_MESSAGES || '12', 10),
};

export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.llmProvider === 'groq' && !config.groqApiKey) {
    errors.push('GROQ_API_KEY is required (get free key at https://console.groq.com)');
  }

  if (config.llmProvider === 'openai' && !config.openaiApiKey) {
    errors.push('OPENAI_API_KEY is required');
  }

  if (config.llmProvider === 'alibaba' && !config.dashscopeApiKey) {
    errors.push('DASHSCOPE_API_KEY is required for Alibaba Cloud');
  }

  if (config.llmProvider === 'claude' && !config.anthropicApiKey) {
    errors.push('ANTHROPIC_API_KEY is required for Claude (get it at https://console.anthropic.com/)');
  }

  // NOTE: privateKey is no longer strictly checked here because it might be supplied dynamically via WalletManager

  return { valid: errors.length === 0, errors };
}
