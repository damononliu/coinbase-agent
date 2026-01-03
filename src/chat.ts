#!/usr/bin/env node

/**
 * Interactive chat with Coinbase AgentKit Agent
 */

import chalk from 'chalk';
import ora from 'ora';
import { input, select, confirm } from '@inquirer/prompts';
import { config, validateConfig } from './config.js';
import { CoinbaseAgent } from './agent.js';
import { walletManager } from './wallet-manager.js';

async function main() {
  console.log(chalk.cyan.bold('\n🤖 Coinbase AgentKit Wallet Agent\n'));

  // Validate config (skip private key check here as we handle it below)
  const validation = validateConfig();
  if (!validation.valid) {
    console.log(chalk.red('Configuration errors:'));
    validation.errors.forEach((err) => console.log(chalk.red(`  - ${err}`)));
    // process.exit(1); // Don't exit yet, might select wallet manually
  }

  // Wallet Selection
  let selectedPrivateKey = config.privateKey;
  let walletSource = 'Environment';

  const choices = [
    { name: 'Use Default Wallet (.env)', value: 'env', disabled: !config.privateKey },
    { name: 'Select Saved Wallet', value: 'select' },
    { name: 'Create New Wallet', value: 'create' },
    { name: 'Import Wallet', value: 'import' },
  ];

  const action = await select({
    message: 'Select Wallet Option:',
    choices: choices,
  });

  if (action === 'select') {
    const wallets = walletManager.listWallets();
    if (wallets.length === 0) {
      console.log(chalk.yellow('No saved wallets found. Creating a new one...'));
      const alias = await input({ message: 'Enter name for new wallet:' });
      const newWallet = walletManager.createWallet(alias);
      selectedPrivateKey = newWallet.privateKey;
      walletSource = `Saved (${newWallet.alias})`;
    } else {
      const walletId = await select({
        message: 'Choose a wallet:',
        choices: wallets.map(w => ({ name: `${w.alias} (${w.address})`, value: w.id })),
      });
      const wallet = walletManager.getWallet(walletId);
      if (wallet) {
        selectedPrivateKey = wallet.privateKey;
        walletSource = `Saved (${wallet.alias})`;
      }
    }
  } else if (action === 'create') {
    const alias = await input({ message: 'Enter name for new wallet:' });
    const newWallet = walletManager.createWallet(alias);
    selectedPrivateKey = newWallet.privateKey;
    walletSource = `New (${newWallet.alias})`;
    console.log(chalk.green(`Wallet created! Address: ${newWallet.address}`));
  } else if (action === 'import') {
    const alias = await input({ message: 'Enter name for wallet:' });
    const pk = await input({ message: 'Enter private key (starts with 0x):' });
    try {
      const newWallet = walletManager.importWallet(alias, pk);
      selectedPrivateKey = newWallet.privateKey;
      walletSource = `Imported (${newWallet.alias})`;
    } catch (e) {
      console.error(chalk.red('Invalid private key'));
      process.exit(1);
    }
  }

  if (!selectedPrivateKey) {
    console.log(chalk.red('No valid wallet selected. Exiting.'));
    process.exit(1);
  }

  // Initialize agent
  const spinner = ora('Initializing AgentKit...').start();

  try {
    const agent = new CoinbaseAgent();
    // Pass the selected private key
    const walletInfo = await agent.initialize(selectedPrivateKey);

    spinner.succeed('AgentKit ready!');

    // Show info
    const llmInfo =
      config.llmProvider === 'groq'
        ? `Groq (${config.groqModel})`
        : config.llmProvider === 'alibaba'
          ? `Alibaba Cloud (${config.dashscopeModel})`
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

        // 检查是否有待确认的交易
        if (response.pendingTransaction) {
          console.log(chalk.yellow('⚠️  检测到需要确认的交易操作\n'));
          console.log(chalk.cyan(response.pendingTransaction.description));
          console.log();

          const shouldConfirm = await confirm({
            message: '是否确认执行此交易？',
            default: false,
          });

          if (shouldConfirm) {
            const confirmSpinner = ora('执行交易中...').start();
            try {
              const confirmResponse = await agent.confirmTransaction();
              confirmSpinner.stop();
              console.log(chalk.green('\n✅'), confirmResponse.message, '\n');

              if (confirmResponse.toolCalls && confirmResponse.toolCalls.length > 0) {
                console.log(chalk.dim('交易详情:'));
                confirmResponse.toolCalls.forEach((tc) => {
                  console.log(chalk.dim(`  - ${tc.name}: ${tc.result}`));
                });
                console.log();
              }
            } catch (error) {
              confirmSpinner.fail('交易执行失败');
              console.error(chalk.red(`Error: ${error}\n`));
            }
          } else {
            const cancelResponse = agent.cancelTransaction();
            console.log(chalk.yellow('\n❌'), cancelResponse.message, '\n');
          }
        } else {
          // 正常响应
          if (response.toolCalls && response.toolCalls.length > 0) {
            console.log(chalk.dim('Tools used:'));
            response.toolCalls.forEach((tc) => {
              console.log(chalk.dim(`  - ${tc.name}`));
            });
            console.log();
          }
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

