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

  it('в поиске нет режима «Предмет»; расписание преподавателя открывается месяцем', async () => {
    const today = new Date();
    today.setHours(9, 40, 0, 0);
    const iso = (d: Date) => {
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
    };
    const end = new Date(today.getTime() + 90 * 60_000);
    global.fetch = jest.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        String(url).includes('/api/Rasp?')
          ? {
              data: {
                rasp: [
                  { код: 1, датаНачала: iso(today), датаОкончания: iso(end), дисциплина: 'лек Физика', преподаватель: 'Абакумова Ю.А.', аудитория: 'Б-301', группа: 'А-1-22' },
                ],
              },
              state: 1,
            }
          : { data: [{ id: 472, name: 'Абакумова Юлия Андреевна', kaf: null }], state: 1 },
    })) as unknown as typeof fetch;

    renderRouter(APP_DIR, { initialUrl: '/schedule-search' });
    await expectScreen('schedule-search-screen');
    expect(screen.queryByTestId('search-mode-subject')).toBeNull();

    fireEvent.press(screen.getByTestId('search-mode-teacher'));
    fireEvent.changeText(screen.getByTestId('search-input'), 'абакумова');
    await waitFor(() => expect(screen.getByTestId('search-result-472')).toBeTruthy(), { timeout: 10000 });
    fireEvent.press(screen.getByTestId('search-result-472'));

    await expectScreen('schedule-view-screen');
    await waitFor(() => expect(screen.getByTestId('view-month')).toBeTruthy(), { timeout: 10000 });
    expect(screen.queryByTestId('schedule-view-past')).toBeNull();
    // выбран сегодняшний день с парой: группа и аудитория в описании
    await waitFor(() => expect(screen.getByText('Физика')).toBeTruthy(), { timeout: 10000 });
    expect(screen.getByText('А-1-22 · Б-301')).toBeTruthy();

    // следующий месяц: занятий нет, есть переход к ближайшему дню с парами
    fireEvent.press(screen.getByTestId('view-month-next'));
    await waitFor(() => expect(screen.getByTestId('schedule-view-empty-day')).toBeTruthy(), { timeout: 10000 });
    expect(screen.getByTestId('schedule-view-prev-day')).toBeTruthy();
  });

  it('разделы «Учёба» — плитки; блоки главной переключаются чипами', async () => {
    renderRouter(APP_DIR, { initialUrl: '/(tabs)/profile' });
    await expectScreen('profile-screen');
    for (const id of ['menu-subjects', 'menu-goals', 'menu-notes', 'menu-debts', 'menu-university', 'menu-schedule-search', 'menu-settings']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    fireEvent.press(screen.getByTestId('menu-appearance'));
    await expectScreen('appearance-screen');
    expect(screen.getByTestId('home-block-debts').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByTestId('home-block-debts'));
    await waitFor(() => expect(screen.getByTestId('home-block-debts').props.accessibilityState).toMatchObject({ selected: false }), {
      timeout: 10000,
    });
    // появилась кнопка сброса, она возвращает блок
    fireEvent.press(screen.getByTestId('appearance-reset'));
    await waitFor(() => expect(screen.getByTestId('home-block-debts').props.accessibilityState).toMatchObject({ selected: true }), {
      timeout: 10000,
    });
  });
});
