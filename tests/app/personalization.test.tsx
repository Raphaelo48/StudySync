/**
 * Экраны персонализации и поиска расписания: рендер и основные действия
 * на реальном дереве маршрутов (expo-router/testing-library) с настоящей SQLite.
 */
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

jest.mock('expo-sqlite', () => require('../support/expoSqliteMock'));
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const realFetch = global.fetch;

beforeAll(async () => {
  const initSqlJs = require('sql.js') as typeof import('sql.js');
  const SQL = await (initSqlJs.default ?? initSqlJs)();
  (globalThis as { __SQLJS__?: unknown }).__SQLJS__ = SQL;
});

beforeEach(() => {
  // Справочник групп грузится при открытии поиска — подставляем ответ API без сети.
  global.fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      data: [
        { id: 14569, name: 'А-1-22', kurs: 5, facul: 'ИАТЭ' },
        { id: 14572, name: 'А-2-24', kurs: 3, facul: 'ИАТЭ' },
      ],
      state: 1,
    }),
  })) as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = realFetch;
});

const APP_DIR = './app';

async function expectScreen(testId: string) {
  await waitFor(() => expect(screen.getByTestId(testId)).toBeTruthy(), { timeout: 15000 });
}

describe('Персонализация и поиск расписания', () => {
  it('из профиля открывается «Оформление»; компактный вид меняет карточку пары', async () => {
    renderRouter(APP_DIR, { initialUrl: '/(tabs)/profile' });
    await expectScreen('profile-screen');
    fireEvent.press(screen.getByTestId('menu-appearance'));
    await expectScreen('appearance-screen');

    expect(screen.queryByTestId('appearance-preview-compact-meta')).toBeNull();
    fireEvent(screen.getByTestId('appearance-compact-switch'), 'valueChange', true);
    await waitFor(() => expect(screen.getByTestId('appearance-preview-compact-meta')).toBeTruthy(), { timeout: 10000 });
    expect(String(screen.getByTestId('appearance-preview-compact-meta').props.children)).toContain('Б-301');

    fireEvent.press(screen.getByTestId('accent-teal'));
    await waitFor(() => expect(screen.getByTestId('accent-teal').props.accessibilityState).toMatchObject({ selected: true }), {
      timeout: 10000,
    });
  });

  it('поиск открывается из расписания и находит группу по части названия', async () => {
    renderRouter(APP_DIR, { initialUrl: '/(tabs)/schedule' });
    await expectScreen('schedule-screen');
    fireEvent.press(screen.getByTestId('schedule-search'));
    await expectScreen('schedule-search-screen');

    fireEvent.changeText(screen.getByTestId('search-input'), 'а-2');
    await waitFor(() => expect(screen.getByTestId('search-result-14572')).toBeTruthy(), { timeout: 10000 });
    expect(screen.queryByTestId('search-result-14569')).toBeNull();
  });

  it('поиск по предмету без расписания подсказывает импортировать группу', async () => {
    renderRouter(APP_DIR, { initialUrl: '/schedule-search' });
    await expectScreen('schedule-search-screen');
    fireEvent.press(screen.getByTestId('search-mode-subject'));
    await waitFor(() => expect(screen.getByText('В расписании пока нет занятий')).toBeTruthy(), { timeout: 10000 });
  });
});
