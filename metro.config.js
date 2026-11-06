/**
 * Конфигурация Metro.
 *
 * Единственная специальность: стаб-заглушка для модуля
 * `DevicePushTokenAutoRegistration.fx` из expo-notifications.
 *
 * Зачем: этот модуль на этапе ИМПОРТА вызывает addPushTokenListener(),
 * который в Expo Go на Android бросает исключение (push-функциональность
 * удалена из Expo Go в SDK 53). StudySync использует только ЛОКАЛЬНЫЕ
 * уведомления и никогда не запрашивает push-токены, поэтому авто-регистрация
 * серверных push-токенов нам не нужна; заглушка убирает краш, не затрагивая
 * локальные уведомления (scheduleNotificationAsync, permissions и т.д.).
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const STUBBED = /DevicePushTokenAutoRegistration\.fx(\.js)?$/;

const userResolveRequest = config.resolver?.resolveRequest;
config.resolver = {
  ...config.resolver,
  resolveRequest: (context, moduleName, platform) => {
    if (STUBBED.test(moduleName)) {
      // Пустой модуль: side-effect не выполняется.
      return { type: 'empty' };
    }
    if (typeof userResolveRequest === 'function') {
      return userResolveRequest(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  },
};

module.exports = config;
