/**
 * Профиль: имя пользователя, тема, быстрые настройки, разделы
 * (предметы, цели, уведомления, данные), сводка по использованию.
 */
import React, { useCallback, useState } from 'react';
import { FEEDBACK_CONTACT, IS_DEMO } from '../../src/core/appVariant';
import { hasUserData, seedDemoData } from '../../src/logic/demoData';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/ui/Screen';
import { Button, Card, SectionTitle } from '../../src/components/ui/primitives';
import { SegmentedControl, TextField } from '../../src/components/ui/inputs';
import { BottomSheet } from '../../src/components/ui/overlays';
import { useDataVersion, useDatabase, useSettings, useTheme, useToast } from '../../src/state/AppContexts';
import type { ThemeMode } from '../../src/models/types';
import { pluralRu } from '../../src/core/time';
import { validateSettingsPatch } from '../../src/logic/validation';

interface ProfileTotals {
  subjects: number;
  activeTasks: number;
  doneTasks: number;
  sessions: number;
  focusMinutes: number;
}

export default function ProfileScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const { settings, update } = useSettings();
  const db = useDatabase();
  const router = useRouter();
  const toast = useToast();
  const { version, bump } = useDataVersion();

  const [totals, setTotals] = useState<ProfileTotals | null>(null);
  const [debtCount, setDebtCount] = useState(0);
  const [canSeedDemo, setCanSeedDemo] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const fillDemo = async () => {
    setSeeding(true);
    try {
      await seedDemoData(db);
      bump();
      toast.success('Готово: расписание, задачи, долги и конспект для примера');
      router.push('/(tabs)');
    } catch {
      toast.error('Не удалось добавить пример данных');
    } finally {
      setSeeding(false);
    }
  };
  const [nameSheet, setNameSheet] = useState(false);
  const [nameDraft, setNameDraft] = useState(settings.displayName);
  const [nameError, setNameError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [subjects, active, done, sessions] = await Promise.all([
      db.subjects.list(),
      db.tasks.list({ status: 'active' }),
      db.tasks.list({ status: 'done' }),
      db.sessions.listRecent(1000),
    ]);
    setDebtCount(await db.debts.countOpen());
    if (IS_DEMO) setCanSeedDemo(!(await hasUserData(db)));
    setTotals({
      subjects: subjects.length,
      activeTasks: active.length,
      doneTasks: done.length,
      sessions: sessions.length,
      focusMinutes: Math.round(sessions.reduce((s, x) => s + x.activeSeconds / 60, 0)),
    });
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version])
  );

  const saveName = async () => {
    const check = validateSettingsPatch({ displayName: nameDraft.trim() }, settings);
    if (!check.ok) {
      setNameError(check.errors.displayName ?? 'Некорректное имя');
      return;
    }
    await update({ displayName: nameDraft.trim() });
    setNameSheet(false);
    toast.success('Имя сохранено');
  };

  const displayName = settings.displayName.trim() || 'Студент';

  return (
    <Screen testID="profile-screen" scroll>
      <Text style={{ color: colors.text, fontSize: fontSizes.xxl, fontWeight: '700', paddingTop: 8 }}>Профиль</Text>

      {IS_DEMO ? (
        <Card style={{ marginTop: spacing.lg, backgroundColor: colors.primarySoft, borderColor: colors.primary }} testID="demo-card">
          <View style={styles.userRow}>
            <Ionicons name="flask-outline" size={22} color={colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '700' }}>Демо-версия</Text>
              <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 18, marginTop: 2 }}>
                {FEEDBACK_CONTACT
                  ? `Нашли ошибку или есть идея? Напишите: ${FEEDBACK_CONTACT}`
                  : 'Приложение в разработке — будем рады отзывам и идеям.'}
              </Text>
            </View>
          </View>
          {canSeedDemo ? (
            <Button
              testID="demo-seed"
              title="Заполнить примером данных"
              icon="sparkles-outline"
              variant="secondary"
              loading={seeding}
              style={{ marginTop: spacing.md }}
              onPress={() => void fillDemo()}
            />
          ) : null}
        </Card>
      ) : null}

      {/* Карточка пользователя */}
      <Card style={{ marginTop: spacing.lg }}>
        <View style={styles.userRow}>
          <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
            <Text style={{ color: colors.primary, fontSize: fontSizes.xxl, fontWeight: '700' }}>
              {displayName.slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text testID="profile-name" style={{ color: colors.text, fontSize: fontSizes.lg, fontWeight: '700' }}>
              {displayName}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: 2 }}>
              StudySync · все данные хранятся только на этом устройстве
            </Text>
          </View>
          <Pressable
            testID="profile-edit-name"
            accessibilityRole="button"
            accessibilityLabel="Изменить имя"
            hitSlop={8}
            onPress={() => {
              setNameDraft(settings.displayName);
              setNameError(null);
              setNameSheet(true);
            }}
          >
            <Ionicons name="create-outline" size={20} color={colors.primary} />
          </Pressable>
        </View>
        {totals ? (
          <View style={styles.totalsRow}>
            <TotalCell label="предметов" value={totals.subjects} />
            <TotalCell label="активных задач" value={totals.activeTasks} />
            <TotalCell label="выполнено" value={totals.doneTasks} />
            <TotalCell label="сессий" value={totals.sessions} />
          </View>
        ) : null}
      </Card>

      {/* Тема */}
      <SectionTitle title="Оформление" />
      <Card>
        <SegmentedControl<ThemeMode>
          testID="profile-theme"
          value={settings.themeMode}
          onChange={(v) => void update({ themeMode: v })}
          options={[
            { value: 'light', label: 'Светлая', icon: 'sunny-outline' },
            { value: 'dark', label: 'Тёмная', icon: 'moon-outline' },
            { value: 'system', label: 'Системная', icon: 'contrast-outline' },
          ]}
        />
      </Card>
      <Card style={{ marginTop: spacing.sm }}>
        <MenuRow
          icon="color-palette-outline"
          label="Персонализация"
          hint="цвет, шрифт, главная"
          onPress={() => router.push('/appearance')}
          testID="menu-appearance"
          last
        />
      </Card>

      {/* Разделы */}
      <SectionTitle title="Учёба" />
      <Card padded={false}>
        <MenuRow icon="school-outline" label="Предметы" hint={totals ? `${totals.subjects} ${pluralRu(totals.subjects, 'предмет', 'предмета', 'предметов')}` : ''} onPress={() => router.push('/subjects')} testID="menu-subjects" />
        <MenuRow icon="flag-outline" label="Цели" hint="неделя, месяц, семестр" onPress={() => router.push('/goals')} testID="menu-goals" />
        <MenuRow icon="document-text-outline" label="Конспекты" hint="фото и заметки к парам" onPress={() => router.push('/notes')} testID="menu-notes" />
        <MenuRow icon="alert-circle-outline" label="Долги и отработки" hint={debtCount > 0 ? `${debtCount} ${pluralRu(debtCount, 'долг', 'долга', 'долгов')}` : 'нет'} onPress={() => router.push('/debts')} testID="menu-debts" />
        <MenuRow icon="cloud-download-outline" label="Расписание КГЭУ" hint="импорт и синхронизация" onPress={() => router.push('/university')} testID="menu-university" />
        <MenuRow icon="search-outline" label="Поиск расписания" hint="препод., аудитория" onPress={() => router.push('/schedule-search')} testID="menu-schedule-search" />
        <MenuRow icon="notifications-outline" label="Уведомления и напоминания" hint={settings.notificationsEnabled ? 'включены' : 'отключены'} onPress={() => router.push('/settings')} testID="menu-settings" />
        <MenuRow icon="timer-outline" label="Сессии, перерывы, учебное окно" hint={`${settings.defaultWorkMin}/${settings.defaultBreakMin} мин`} onPress={() => router.push('/settings')} last />
      </Card>

      <SectionTitle title="Данные" />
      <Card padded={false}>
        <MenuRow icon="cloud-upload-outline" label="Экспорт данных" hint="JSON-файл" onPress={() => router.push('/data')} testID="menu-export" />
        <MenuRow icon="cloud-download-outline" label="Импорт и резервные копии" hint="" onPress={() => router.push('/data')} testID="menu-import" />
        <MenuRow icon="trash-outline" label="Сброс данных" hint="опасная зона" danger onPress={() => router.push('/data')} last testID="menu-reset" />
      </Card>

      <SectionTitle title="О приложении" />
      <Card>
        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 20 }}>
          StudySync 1.0.0{IS_DEMO ? ' (демо)' : ''} — офлайн-планировщик учёбы. Приложение не отправляет ваши данные на сервер,
          не использует скрытую аналитику и не наказывает за пропуски. Расписание, задачи и статистика
          хранятся локально в SQLite; экспорт и импорт доступны в разделе «Данные».
        </Text>
        <View style={{ height: spacing.md }} />
        <Button title="Открыть раздел данных" variant="secondary" icon="folder-open-outline" onPress={() => router.push('/data')} />
      </Card>
      <View style={{ height: 24 }} />

      {/* Изменение имени */}
      <BottomSheet visible={nameSheet} title="Ваше имя" onClose={() => setNameSheet(false)}>
        <View style={{ paddingBottom: 16 }}>
          <TextField
            testID="profile-name-input"
            label="Как к вам обращаться"
            value={nameDraft}
            onChangeText={setNameDraft}
            placeholder="Необязательно"
            maxLength={60}
            error={nameError}
          />
          <Button testID="profile-name-save" title="Сохранить" icon="checkmark" onPress={() => void saveName()} />
        </View>
      </BottomSheet>
    </Screen>
  );

  function TotalCell({ label, value }: { label: string; value: number }) {
    return (
      <View style={styles.totalCell}>
        <Text style={{ color: colors.text, fontSize: fontSizes.lg, fontWeight: '700' }}>{value}</Text>
        <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs, textAlign: 'center' }}>{label}</Text>
      </View>
    );
  }
}

function MenuRow({
  icon,
  label,
  hint,
  onPress,
  danger = false,
  last = false,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  onPress: () => void;
  danger?: boolean;
  last?: boolean;
  testID?: string;
}) {
  const { colors, fontSizes } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        {
          borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: colors.borderSoft,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.primary} />
      <Text style={{ color: danger ? colors.danger : colors.text, fontSize: fontSizes.md, fontWeight: '500', flex: 1 }}>
        {label}
      </Text>
      {hint ? <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>{hint}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  totalsRow: {
    flexDirection: 'row',
    marginTop: 16,
  },
  totalCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
});
