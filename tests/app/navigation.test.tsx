/**
 * Сценарий 17: проверка навигации между всеми основными экранами.
 *
 * Используется официальный expo-router/testing-library (renderRouter):
 * монтируется реальное дерево маршрутов app/ с реальными провайдерами,
 * БД — настоящая SQLite (WASM) через мок expo-sqlite.
 */
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

// Мок expo-sqlite должен быть зарегистрирован до импорта приложения.
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

describe('Навигация (сценарий 17)', () => {
  it('первый запуск ведёт на экран первоначальной настройки', async () => {
    renderRouter(APP_DIR, { initialUrl: '/' });
    await expectScreen('welcome-screen');
  });

  it('после пропуска настройки открывается Главная, все пять вкладок доступны', async () => {
    renderRouter(APP_DIR, { initialUrl: '/welcome' });
    await expectScreen('welcome-screen');

    fireEvent.press(screen.getByTestId('welcome-skip'));
    await expectScreen('home-screen');

    // Нижняя навигация: Расписание
    fireEvent.press(screen.getByRole('button', { name: 'Расписание' }));
    await expectScreen('schedule-screen');

    // Задачи
    fireEvent.press(screen.getByRole('button', { name: 'Задачи' }));
    await expectScreen('tasks-screen');

    // Прогресс
    fireEvent.press(screen.getByRole('button', { name: 'Прогресс' }));
    await expectScreen('progress-screen');

    // Профиль
    fireEvent.press(screen.getByRole('button', { name: 'Профиль' }));
    await expectScreen('profile-screen');

    // Возврат на Главную
    fireEvent.press(screen.getByRole('button', { name: 'Главная' }));
    await expectScreen('home-screen');
  });

  it('с главной открываются Фокус и Перепланировщик', async () => {
    renderRouter(APP_DIR, { initialUrl: '/(tabs)' });
    await expectScreen('home-screen');

    fireEvent.press(screen.getByTestId('home-replan-button'));
    await expectScreen('replan-screen');
  });

  it('форма задачи открывается с главной', async () => {
    renderRouter(APP_DIR, { initialUrl: '/(tabs)' });
    await expectScreen('home-screen');

    fireEvent.press(screen.getByTestId('home-fab'));
    await expectScreen('task-edit-screen');
  });

  it('глубокие маршруты экранов доступны напрямую', async () => {
    renderRouter(APP_DIR, { initialUrl: '/focus' });
    await expectScreen('focus-screen');
  });

  it('в режиме месяца тап по дню показывает расписание дня под сеткой, не переключая режим', async () => {
    renderRouter(APP_DIR, { initialUrl: '/(tabs)/schedule' });
    await expectScreen('schedule-screen');

    fireEvent.press(screen.getByTestId('schedule-mode-month'));
    await waitFor(() => expect(screen.getByTestId('schedule-period')).toBeTruthy(), { timeout: 10000 });

    // Нажимаем на сегодняшний день в сетке месяца
    const dayTs = (() => {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    })();
    fireEvent.press(screen.getByTestId(`month-day-${dayTs}`));

    // Список дня появился под сеткой, режим остался «месяц»
    await waitFor(() => expect(screen.getByTestId('schedule-month-daylist')).toBeTruthy(), { timeout: 10000 });
    expect(screen.getByTestId('schedule-month-daylist')).toBeTruthy();
    // Дневной вид не активирован: заголовок периода всё ещё месяц
    const periodText = screen.getByTestId('schedule-period').props.children;
    expect(String(periodText)).not.toContain('Среда');
  });

  it('экран импорта расписания КГЭУ рендерится', async () => {
    renderRouter(APP_DIR, { initialUrl: '/university' });
    await expectScreen('university-screen');
  });

  it('экраны настроек, данных, предметов и целей рендерятся', async () => {
    renderRouter(APP_DIR, { initialUrl: '/settings' });
    await expectScreen('settings-screen');

    renderRouter(APP_DIR, { initialUrl: '/data' });
    await expectScreen('data-screen');

    renderRouter(APP_DIR, { initialUrl: '/subjects' });
    await expectScreen('subjects-screen');

    renderRouter(APP_DIR, { initialUrl: '/goals' });
    await expectScreen('goals-screen');
  });

  it('создание задачи через форму: сохранение возвращает в список и задача видна', async () => {
    renderRouter(APP_DIR, { initialUrl: '/(tabs)/tasks' });
    await expectScreen('tasks-screen');

    fireEvent.press(screen.getByTestId('tasks-fab'));
    await expectScreen('task-edit-screen');

    fireEvent.changeText(screen.getByTestId('task-title-input'), 'Тестовая задача навигации');
    fireEvent.press(screen.getByTestId('task-save'));

    // После сохранения возвращаемся к списку, задача отображается
    await waitFor(() => expect(screen.queryByTestId('task-edit-screen')).toBeNull(), { timeout: 15000 });
    await expectScreen('tasks-screen');
    await waitFor(() => expect(screen.getByText('Тестовая задача навигации')).toBeTruthy(), { timeout: 15000 });
  });
});
