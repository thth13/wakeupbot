export interface BotCommandDefinition {
  command: string;
  description: string;
  helpText: string;
}

export const BOT_COMMANDS: BotCommandDefinition[] = [
  {
    command: 'start',
    description: 'Start or reopen the main menu',
    helpText: '/start — открыть главное меню',
  },
  {
    command: 'time',
    description: 'Change your wake-up time',
    helpText: '/time — изменить время подъёма',
  },
  {
    command: 'stats',
    description: 'Show today leaderboard',
    helpText: '/stats — статистика за сегодня',
  },
  {
    command: 'mystats',
    description: 'Show your personal stats',
    helpText: '/mystats — моя история',
  },
];

export function getBotCommandsHelpText() {
  return BOT_COMMANDS.map(({ helpText }) => helpText).join('\n');
}