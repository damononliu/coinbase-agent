#!/usr/bin/env node

/**
 * Interactive chat with Coinbase AgentKit Agent
 */

import chalk from 'chalk';
import ora from 'ora';
import { input } from '@inquirer/prompts';
import { config, validateConfig } from './config.js';
import { CoinbaseAgent } from './agent.js';

async function main() {
  console.log(chalk.cyan.bold('\n🤖 Coinbase AgentKit Wallet Agent\n'));

  // Validate config
  const validation = validateConfig();
  if (!validation.valid) {
    console.log(chalk.red('Configuration errors:'));
    validation.errors.forEach((err) => console.log(chalk.red(`  - ${err}`)));
    console.log(chalk.yellow('\nPlease set up your .env file.'));
    console.log(chalk.dim('See README.md for instructions.\n'));
    process.exit(1);
  }

  // Initialize agent
  const spinner = ora('Initializing AgentKit...').start();

  try {
    const agent = new CoinbaseAgent();
    const walletInfo = await agent.initialize();

    spinner.succeed('AgentKit ready!');

    // Show info
    const llmInfo =
      config.llmProvider === 'groq'
        ? `Groq (${config.groqModel})`
        : `OpenAI (${config.openaiModel})`;

    console.log(chalk.cyan(`\n🧠 LLM: ${llmInfo}`));
    console.log(chalk.green(`📍 Wallet: ${walletInfo.address}`));
    console.log(chalk.green(`🔗 Network: ${walletInfo.network}\n`));
    console.log(chalk.dim('Type your message and press Enter. Type "exit" to quit.\n'));

    // Chat loop
    while (true) {
      const message = await input({
        message: chalk.blue('You:'),
      });

      if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'quit') {
        console.log(chalk.cyan('\nGoodbye! 👋\n'));
        break;
      }

      if (!message.trim()) {
        continue;
      }

      const thinkingSpinner = ora('Thinking...').start();

      try {
        const response = await agent.chat(message);
        thinkingSpinner.stop();

        console.log(chalk.green('\n🤖 Agent:'), response.message, '\n');

        if (response.toolCalls && response.toolCalls.length > 0) {
          console.log(chalk.dim('Tools used:'));
          response.toolCalls.forEach((tc) => {
            console.log(chalk.dim(`  - ${tc.name}`));
          });
          console.log();
        }
      } catch (error) {
        thinkingSpinner.fail('Error');
        console.error(chalk.red(`Error: ${error}\n`));
      }
    }
  } catch (error) {
    spinner.fail('Failed to initialize');
    console.error(chalk.red(`\nError: ${error}`));
    console.log(chalk.yellow('\nMake sure your CDP API keys are correct.'));
    process.exit(1);
  }
}

main().catch(console.error);

