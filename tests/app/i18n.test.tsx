/**
 * Пилот локализации: переключение языка на экране настроек.
 * Проверяем, что интерфейс перерисовывается без перезапуска приложения.
 */
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

jest.mock('expo-sqlite', () => require('../support/expoSqliteMock'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

beforeAll(async () => {
  const initSqlJs = require('sql.js') as typeof import('sql.js');
  const SQL = await (initSqlJs.default ?? initSqlJs)();
  (globalThis as { __SQLJS__?: unknown }).__SQLJS__ = SQL;
});

const APP_DIR = './app';

async function expectScreen(testId: string) {
  await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy(), { timeout: 15000 });
}

describe('Локализация (пилот)', () => {
  it('по умолчанию интерфейс русский', async () => {
    renderRouter(APP_DIR, { initialUrl: '/settings' });
    await expectScreen('settings-screen');

    expect(screen.getByText('Настройки')).toBeTruthy();
    expect(screen.getByText('Уведомления')).toBeTruthy();
    expect(screen.queryByText('Notifications')).toBeNull();
  });

  it('переключение на English сразу меняет тексты экрана настроек', async () => {
    renderRouter(APP_DIR, { initialUrl: '/settings' });
    await expectScreen('settings-screen');

    fireEvent.press(screen.getByTestId('settings-language-en'));

    await waitFor(() => expect(screen.getByText('Settings')).toBeTruthy(), { timeout: 10000 });
    expect(screen.getByText('Notifications')).toBeTruthy();
    expect(screen.getByText('Study sessions')).toBeTruthy();
    expect(screen.queryByText('Уведомления')).toBeNull();
  });

  it('возврат на «Системный» восстанавливает русский язык', async () => {
    renderRouter(APP_DIR, { initialUrl: '/settings' });
    await expectScreen('settings-screen');

    fireEvent.press(screen.getByTestId('settings-language-en'));
    await waitFor(() => expect(screen.getByText('Settings')).toBeTruthy(), { timeout: 10000 });

    fireEvent.press(screen.getByTestId('settings-language-system'));
    await waitFor(() => expect(screen.getByText('Настройки')).toBeTruthy(), { timeout: 10000 });
    expect(screen.getByText('Уведомления')).toBeTruthy();
  });
});
