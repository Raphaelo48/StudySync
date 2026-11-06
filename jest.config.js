/**
 * Конфигурация Jest для StudySync.
 *
 * Используется пресет jest-expo (окружение node + моки React Native),
 * который одинаково подходит и для чисто логических тестов (модули src/),
 * и для тестов компонентов/навигации.
 */
module.exports = {
  preset: 'jest-expo/ios',
  testMatch: ['<rootDir>/tests/**/*.test.ts', '<rootDir>/tests/**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|standard-navigation|@sentry/react-native|native-base|react-native-svg)',
  ],
  setupFiles: ['<rootDir>/tests/setup.ts'],
  testTimeout: 20000,
};
