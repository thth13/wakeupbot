import { Markup } from 'telegraf';

export const mainMenuKeyboard = Markup.keyboard([
  [Markup.button.text('📊 Рейтинг сегодня'), Markup.button.text('👤 Моя статистика')],
]).resize();

export const debugMenuKeyboard = Markup.keyboard([
  [Markup.button.text('🎯 Послать задачку'), Markup.button.text('🗑 Сбросить челлендж')],
  [Markup.button.text('⏰ Послать reminder'), Markup.button.text('♻️ Сбросить reminder')],
  [Markup.button.text('❌ Удалить запись'), Markup.button.text('🔙 Главное меню')],
]).resize();

// Maps button text to the command it should trigger
export const MENU_BUTTON_COMMANDS: Record<string, string> = {
  '📊 Рейтинг сегодня': '/stats',
  '👤 Моя статистика': '/mystats',
};

export const DEBUG_BUTTON_COMMANDS: Record<string, string> = {
  '🎯 Послать задачку': '/debug challenge',
  '🗑 Сбросить челлендж': '/debug clear',
  '⏰ Послать reminder': '/debug reminder',
  '♻️ Сбросить reminder': '/debug clearreminder',
  '❌ Удалить запись': '/debug clearentry',
};
