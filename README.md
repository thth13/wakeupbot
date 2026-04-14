# Wakeupbot

Telegram bot on TypeScript for early wake-up checks.

## Setup

1. Create `.env` with `BOT_TOKEN=your_telegram_bot_token` and `MONGODB_URI=your_mongodb_connection_string`.
2. Optionally set `MONGODB_DB_NAME=wakeupbot` if you want a custom database name.
3. Run `npm run dev` for development.
4. Open the bot in Telegram and send `/start` from the chat that should receive tasks.

## Behavior

- Every day at `06:00` the bot sends a task with the sum of two three-digit numbers.
- Every day at `06:30` the bot sends one more task to confirm the user is awake.
- Each task is sent as a quiz with four answer options.
- The user must choose the correct option under the message.
- The schedule uses the server local time.
- State is stored in MongoDB.
- Wake-up history is stored in daily documents keyed by the wake date, for example `2026-04-13`.
- Each wake-day document keeps the exact `wokeUpAt` timestamp and a `wakeEvents` array for every successful check.
- The same wake-day document is ready for a future `fellAsleepAt` field, even if the sleep started on the previous calendar day.

## Commands

- `/start` enables daily wake-up tasks for the current chat
- `/status` shows current subscription state
- `/stats` shows wake-up statistics
- `/stop` disables daily wake-up tasks for the current chat

## Statistics

- The bot shows a `My stats` button after `/start`.
- Statistics are built from `wake_days` documents in MongoDB.
- The stats response includes total recorded wake days, fully confirmed days, average wake-up time, and the latest recorded days.

## Scripts

- `npm run dev` starts the bot with `tsx`
- `npm run build` compiles TypeScript to `dist`
- `npm start` runs the compiled bot