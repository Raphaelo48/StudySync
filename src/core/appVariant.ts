/**
 * Вариант сборки (см. app.config.js): обычная или демо-версия.
 */
import Constants from 'expo-constants';

const extra = (Constants.expoConfig?.extra ?? {}) as { demo?: boolean; feedbackContact?: string };

/** Демо-версия: с примером данных и пометкой «Демо». */
export const IS_DEMO = extra.demo === true;

/** Контакт для обратной связи (Telegram, почта) или пустая строка. */
export const FEEDBACK_CONTACT = (extra.feedbackContact ?? '').trim();
