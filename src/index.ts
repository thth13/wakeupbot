import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'path';
import { Telegraf } from 'telegraf';
import { BOT_COMMANDS } from './botCommands';
import { registerStartHandler } from './handlers/start';
import { registerTimeHandler } from './handlers/time';
import { registerStatsHandlers } from './handlers/stats';
import { registerCallbackHandler } from './handlers/callback';
import { registerDebugHandlers } from './handlers/debug';
import { startScheduler } from './jobs/scheduler';
import { startExpiryJob } from './jobs/expiry';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const BOT_TOKEN = process.env.BOT_TOKEN;
const MONGODB_URI = process.env.MONGODB_URI ?? process.env.MONGO_URI;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is not set in .env');
if (!MONGODB_URI) throw new Error('MONGODB_URI or MONGO_URI is not set in .env');

type StoppableTask = {
  stop: () => void;
};

let botInstance: Telegraf | undefined;
let schedulerTask: StoppableTask | undefined;
let expiryTask: StoppableTask | undefined;
let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[shutdown] Received ${signal}`);

  schedulerTask?.stop();
  expiryTask?.stop();

  try {
    botInstance?.stop(signal);
  } catch (err) {
    console.error('[shutdown] Failed to stop bot cleanly:', err);
  }

  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      console.log('[shutdown] MongoDB disconnected');
    }
  } catch (err) {
    console.error('[shutdown] Failed to disconnect MongoDB:', err);
  }

  if (signal === 'SIGUSR2') {
    process.kill(process.pid, 'SIGUSR2');
    return;
  }

  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGUSR2', () => void shutdown('SIGUSR2'));

async function main() {
  await mongoose.connect(MONGODB_URI!);
  console.log('[db] Connected to MongoDB');

  const bot = new Telegraf(BOT_TOKEN!);
  botInstance = bot;

  await bot.telegram.setMyCommands(
    BOT_COMMANDS.map(({ command, description }) => ({ command, description }))
  );

  // Register handlers
  const awaitingFromStart = registerStartHandler(bot);
  registerTimeHandler(bot, awaitingFromStart);
  registerStatsHandlers(bot);
  registerCallbackHandler(bot);

  if (process.env.DEBUG_MODE === 'true') {
    registerDebugHandlers(bot);
    console.log('[bot] Debug mode enabled');
  }

  // Start scheduled jobs
  schedulerTask = startScheduler(bot);
  expiryTask = startExpiryJob(bot);

  await bot.launch();
  console.log('[bot] WakeUp bot started');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
