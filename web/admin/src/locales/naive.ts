/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
import { dateZhCN, zhCN, dateEnUS, enUS } from 'naive-ui';
import type { NDateLocale, NLocale } from 'naive-ui';
import type { LocaleType } from './types';

interface NaiveLocaleConfig {
  locale: NLocale;
  dateLocale: NDateLocale;
}

/** naive-ui 语言包与当前 i18n 语言保持一致 */
export const naiveLocales: Record<LocaleType, NaiveLocaleConfig> = {
  'zh-CN': { locale: zhCN, dateLocale: dateZhCN },
  'en-US': { locale: enUS, dateLocale: dateEnUS },
};
