/**
 * Configuration for Coinbase AgentKit (Self-Custody Mode)
 */

import { config as dotenvConfig } from 'dotenv';

dotenvConfig();

export const config = {
  // LLM Provider
  llmProvider: (process.env.LLM_PROVIDER || 'alibaba') as 'groq' | 'openai' | 'alibaba',

  // Groq (free)
  groqApiKey: process.env.GROQ_API_KEY || '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',

  // OpenAI (paid)
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o',

  // Alibaba Cloud (DashScope)
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
  dashscopeModel: process.env.DASHSCOPE_MODEL || 'qwen-turbo',

  // Self-Custody Wallet (your private key)
  privateKey: process.env.PRIVATE_KEY || '',

  // Network
  networkId: process.env.NETWORK_ID || 'base-sepolia',

  // RPC URL (optional)
  rpcUrl: process.env.RPC_URL || '',

  // LLM Temperature (0-1, higher = more creative/random)
  // Default: 0.7 for more natural conversations
  temperature: parseFloat(process.env.LLM_TEMPERATURE || '0.7'),
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

  if (!config.privateKey) {
    errors.push('PRIVATE_KEY is required (your wallet private key, starts with 0x)');
  }

  return { valid: errors.length === 0, errors };
}
