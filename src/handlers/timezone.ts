import { Markup, Telegraf } from 'telegraf';
import { User } from '../models/User';
import { APP_TIMEZONE, resolveTimezone } from '../utils/time';
import {
  getTimezoneByRegionIndex,
  getTimezoneLabel,
  getTimezonePage,
  TIMEZONE_REGIONS,
  type TimezoneRegionKey,
} from '../utils/timezones';
import { bold, TELEGRAM_HTML } from '../utils/telegram';

function isTimezoneRegionKey(value: string): value is TimezoneRegionKey {
  return value in TIMEZONE_REGIONS;
}

function buildRegionKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('Europe', 'timezone_region:europe:0'),
      Markup.button.callback('Americas', 'timezone_region:americas:0'),
    ],
    [
      Markup.button.callback('Asia', 'timezone_region:asia:0'),
      Markup.button.callback('Other', 'timezone_region:other:0'),
    ],
  ]);
}

function buildTimezonePageKeyboard(regionKey: TimezoneRegionKey, page: number) {
  const pageData = getTimezonePage(regionKey, page);
  const zoneButtons = pageData.zones.map((timeZone) => {
    const zoneIndex = pageData.region.zones.indexOf(timeZone);
    return [Markup.button.callback(getTimezoneLabel(timeZone), `timezone_set:${regionKey}:${zoneIndex}`)];
  });

  const navigationButtons = [];

  if (pageData.page > 0) {
    navigationButtons.push(Markup.button.callback('← Назад', `timezone_page:${regionKey}:${pageData.page - 1}`));
  }

  if (pageData.page < pageData.pageCount - 1) {
    navigationButtons.push(Markup.button.callback('Вперёд →', `timezone_page:${regionKey}:${pageData.page + 1}`));
  }

  return Markup.inlineKeyboard([
    ...zoneButtons,
    ...(navigationButtons.length > 0 ? [navigationButtons] : []),
    [Markup.button.callback('← К регионам', 'timezone_regions')],
  ]);
}

function buildTimezoneMessage(regionKey: TimezoneRegionKey, page: number): string {
  const pageData = getTimezonePage(regionKey, page);
  return (
    `🌍 <b>Выбор таймзоны</b>\n\n` +
    `Регион: ${bold(pageData.region.title)}\n` +
    `Страница: ${bold(`${pageData.page + 1}/${pageData.pageCount}`)}\n\n` +
    `Выбери свой город или ближайшую к тебе таймзону:`
  );
}

export function registerTimezoneHandler(bot: Telegraf) {
  bot.command('timezone', async (ctx) => {
    const user = await User.findOne({ telegramId: ctx.from.id });

    if (!user) {
      await ctx.reply('Сначала зарегистрируйся через /start');
      return;
    }

    const currentTimezone = resolveTimezone(user.timezone ?? APP_TIMEZONE);

    await ctx.reply(
      `🌍 Текущая таймзона: ${bold(currentTimezone)}\n\nВыбери регион:`,
      {
        parse_mode: TELEGRAM_HTML,
        ...buildRegionKeyboard(),
      }
    );
  });

  bot.action('timezone_regions', async (ctx) => {
    await ctx.editMessageText('🌍 <b>Выбор таймзоны</b>\n\nВыбери регион:', {
      parse_mode: TELEGRAM_HTML,
      ...buildRegionKeyboard(),
    });
    await ctx.answerCbQuery();
  });

  bot.action(/^timezone_region:([a-z]+):(\d+)$/, async (ctx) => {
    const regionKey = ctx.match[1];
    const page = parseInt(ctx.match[2], 10);

    if (!isTimezoneRegionKey(regionKey)) {
      await ctx.answerCbQuery('Неизвестный регион');
      return;
    }

    await ctx.editMessageText(buildTimezoneMessage(regionKey, page), {
      parse_mode: TELEGRAM_HTML,
      ...buildTimezonePageKeyboard(regionKey, page),
    });
    await ctx.answerCbQuery();
  });

  bot.action(/^timezone_page:([a-z]+):(\d+)$/, async (ctx) => {
    const regionKey = ctx.match[1];
    const page = parseInt(ctx.match[2], 10);

    if (!isTimezoneRegionKey(regionKey)) {
      await ctx.answerCbQuery('Неизвестный регион');
      return;
    }

    await ctx.editMessageText(buildTimezoneMessage(regionKey, page), {
      parse_mode: TELEGRAM_HTML,
      ...buildTimezonePageKeyboard(regionKey, page),
    });
    await ctx.answerCbQuery();
  });

  bot.action(/^timezone_set:([a-z]+):(\d+)$/, async (ctx) => {
    const regionKey = ctx.match[1];
    const zoneIndex = parseInt(ctx.match[2], 10);

    if (!isTimezoneRegionKey(regionKey)) {
      await ctx.answerCbQuery('Неизвестный регион');
      return;
    }

    const timeZone = getTimezoneByRegionIndex(regionKey, zoneIndex);

    if (!timeZone) {
      await ctx.answerCbQuery('Таймзона не найдена');
      return;
    }

    await User.updateOne({ telegramId: ctx.from.id }, { timezone: timeZone });

    await ctx.editMessageText(`✅ Таймзона сохранена: ${bold(timeZone)}`, {
      parse_mode: TELEGRAM_HTML,
    });
    await ctx.answerCbQuery('Таймзона обновлена');
  });
}