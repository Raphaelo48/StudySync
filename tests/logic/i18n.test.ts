/**
 * Локализация: словари, выбор языка и валидация настройки.
 */
import { deviceLocale, resolveLocale, setLocale, translate } from '../../src/i18n';
import { parsePrefs } from '../../src/logic/prefs';
import { DEFAULT_SETTINGS } from '../../src/models/types';

describe('i18n', () => {
  afterEach(() => setLocale('ru'));

  it('язык устройства в тестах — русский (мок expo-localization)', () => {
    expect(deviceLocale()).toBe('ru');
    expect(resolveLocale('system')).toBe('ru');
  });

  it('явный выбор языка игнорирует системный', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('ru')).toBe('ru');
  });

  it('переводит ключи и подставляет параметры', () => {
    setLocale('en');
    expect(translate('tabs.home')).toBe('Home');
    expect(translate('settings.language.title')).toBe('Language');
    expect(translate('settings.kgeu.autoSyncHintOn', { group: 'А-1-22', last: '' })).toBe(
      'Group А-1-22: at most once every 6 hours'
    );
  });

  it('неизвестный ключ не ломает интерфейс', () => {
    expect(typeof translate('settings.does.not.exist')).toBe('string');
  });

  it('настройка языка проходит валидацию prefs и сохраняется по умолчанию', () => {
    expect(parsePrefs({ language: 'en' }).language).toBe('en');
    expect(parsePrefs({ language: 'system' }).language).toBe('system');
    // Некорректное значение откатывается к системному, остальные поля не страдают.
    expect(parsePrefs({ language: 'de', accentColor: 'teal' })).toMatchObject({
      language: 'system',
      accentColor: 'teal',
    });
    expect(DEFAULT_SETTINGS.language).toBe('system');
  });
});
