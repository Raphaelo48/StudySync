/**
 * Варианты сборки:
 *   обычная  — `npx expo start`, `eas build --profile preview`
 *   демо     — `npm run start:demo`, `eas build --profile demo`
 *
 * Демо-версия ставится рядом с обычной (другой идентификатор пакета)
 * и предлагает заполнить приложение примером данных.
 */
const IS_DEMO = process.env.APP_VARIANT === 'demo';

module.exports = ({ config }) => ({
  ...config,
  name: IS_DEMO ? 'StudySync Demo' : config.name,
  scheme: IS_DEMO ? 'studysync-demo' : config.scheme,
  ios: {
    ...config.ios,
    bundleIdentifier: IS_DEMO ? 'app.studysync.demo' : config.ios.bundleIdentifier,
  },
  android: {
    ...config.android,
    package: IS_DEMO ? 'app.studysync.demo' : config.android.package,
  },
  extra: {
    ...config.extra,
    demo: IS_DEMO,
    /** Контакт для обратной связи в демо (Telegram, почта) — задаётся при сборке. */
    feedbackContact: process.env.FEEDBACK_CONTACT || '',
  },
});
