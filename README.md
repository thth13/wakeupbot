# Wakeupbot

Telegram bot on TypeScript for early wake-up checks.

## Setup

1. Create `.env` with `BOT_TOKEN=your_telegram_bot_token`.
2. Run `npm run dev` for development.
3. Open the bot in Telegram and send `/start` from the chat that should receive tasks.

## Behavior

- Every day at `06:00` the bot sends a task with the sum of two three-digit numbers.
- Every day at `06:30` the bot sends one more task to confirm the user is awake.
- The user must reply with the numeric answer, for example `742`.
- The schedule uses the server local time.
- Subscribed chats are stored in `data/bot-state.json`.

## Commands

- `/start` enables daily wake-up tasks for the current chat
- `/status` shows current subscription state
- `/stop` disables daily wake-up tasks for the current chat

## Scripts

- `npm run dev` starts the bot with `tsx`
- `npm run build` compiles TypeScript to `dist`
- `npm start` runs the compiled bot