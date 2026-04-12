import { config } from "dotenv";
import { Telegraf } from "telegraf";

config();

const token = process.env.BOT_TOKEN;

if (!token) {
  throw new Error("BOT_TOKEN is required in the environment");
}

const bot = new Telegraf(token);

bot.start(async (context) => {
  const firstName = context.from?.first_name ?? "there";

  await context.reply(
    [
      `Hello, ${firstName}.`,
      "Wakeupbot is online.",
      "Only /start is available for now."
    ].join("\n")
  );
});

const launch = async (): Promise<void> => {
  await bot.telegram.setMyCommands([
    {
      command: "start",
      description: "Check that Wakeupbot is online"
    }
  ]);

  await bot.launch();

  console.log("Wakeupbot is running");
};

void launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));