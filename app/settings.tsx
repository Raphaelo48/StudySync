/**
 * Настройки: уведомления (с обработкой отказа ОС), параметры сессий и перерывов,
 * учебное окно для перепланировщика, начало недели, дневная цель.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Card, SectionTitle } from '../src/components/ui/primitives';
import { NumberStepper, SegmentedControl, SwitchRow } from '../src/components/ui/inputs';
import { TimeOfDayField } from '../src/components/ui/TimeOfDayField';
import { useSettings, useTheme, useToast } from '../src/state/AppContexts';
import { getNotificationClient } from '../src/notifications/client';
import { validateSettingsPatch } from '../src/logic/validation';
import { resyncAllNotifications } from '../src/notifications/scheduler';
import { useDatabase } from '../src/state/AppContexts';
import { formatDateShort, formatTime } from '../src/core/time';

export default function SettingsScreen() {
  const { colors, fontSizes, spacing } = useTheme();
  const { settings, update } = useSettings();
  const db = useDatabase();
  const toast = useToast();
  const [permissionNote, setPermissionNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = async (p: Parameters<typeof update>[0]) => {
    const check = validateSettingsPatch(p, settings);
    if (!check.ok) {
      const firstMessage = Object.values(check.errors)[0];
      toast.error(firstMessage ?? 'Некорректное значение');
      return;
    }
    setSaving(true);
    try {
      await update(p);
      await resyncAllNotifications(db, getNotificationClient());
    } catch {
      toast.error('Не удалось сохранить настройку');
    } finally {
      setSaving(false);
    }
  };

  const toggleNotifications = async (enabled: boolean) => {
    if (enabled) {
      const client = getNotificationClient();
      if (!client.isSupported()) {
        setPermissionNote('Локальные уведомления не поддерживаются в этом окружении.');
        await patch({ notificationsEnabled: false });
        return;
      }
      const status = await client.requestPermission();
      if (status === 'granted' || status === 'provisional') {
        setPermissionNote(null);
        await patch({ notificationsEnabled: true });
        toast.success('Напоминания включены');
      } else if (status === 'denied') {
        setPermissionNote(
          'ОС отклонила разрешения на уведомления. Включите их в настройках системы, затем повторите здесь. Приложение продолжит работать без напоминаний.'
        );
        await patch({ notificationsEnabled: false });
      } else {
        setPermissionNote('Не удалось получить разрешение на уведомления. Попробуйте позже в настройках системы.');
        await patch({ notificationsEnabled: false });
      }
    } else {
      setPermissionNote(null);
      await patch({ notificationsEnabled: false });
    }
  };

  return (
    <Screen testID="settings-screen">
      <ScreenHeader title="Настройки" testID="settings-header" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {/* Уведомления */}
        <SectionTitle title="Уведомления" />
        <Card>
          <SwitchRow
            testID="settings-notifications"
            label="Напоминания"
            description="Локальные уведомления устройства, без сервера"
            value={settings.notificationsEnabled}
            onValueChange={(v) => void toggleNotifications(v)}
          />
          {settings.notificationsEnabled ? (
            <>
              <SwitchRow
                testID="settings-notify-lesson"
                label="О начале занятия"
                value={settings.notifyLesson}
                onValueChange={(v) => void patch({ notifyLesson: v })}
              />
              <NumberStepper
                label="Напоминать о занятии за"
                value={settings.notifyLessonBeforeMin}
                onChange={(v) => void patch({ notifyLessonBeforeMin: v })}
                min={0}
                max={24 * 60}
                step={5}
                unit="мин"
                testID="settings-lesson-before"
              />
              <SwitchRow
                testID="settings-notify-deadline"
                label="О приближении дедлайна"
                value={settings.notifyDeadline}
                onValueChange={(v) => void patch({ notifyDeadline: v })}
              />
              <NumberStepper
                label="Напоминать о дедлайне за"
                value={settings.notifyDeadlineBeforeMin}
                onChange={(v) => void patch({ notifyDeadlineBeforeMin: v })}
                min={0}
                max={7 * 24 * 60}
                step={15}
                unit="мин"
                testID="settings-deadline-before"
              />
              <SwitchRow
                testID="settings-notify-session"
                label="О завершении рабочей фазы"
                description="Когда помидор завершён, а приложение свёрнуто"
                value={settings.notifySession}
                onValueChange={(v) => void patch({ notifySession: v })}
              />
              <SwitchRow
                testID="settings-notify-break"
                label="О конце перерыва"
                value={settings.notifyBreak}
                onValueChange={(v) => void patch({ notifyBreak: v })}
              />
              <SwitchRow
                testID="settings-morning-digest"
                label="Утренняя сводка"
                description="Пары, дедлайны и отработки на день. В дни без пар — только если есть дедлайны"
                value={settings.morningDigestEnabled}
                onValueChange={(v) => void patch({ morningDigestEnabled: v })}
              />
              {settings.morningDigestEnabled ? (
                <TimeOfDayField
                  label="Время сводки"
                  value={settings.morningDigestTimeMin}
                  onChange={(v) => void patch({ morningDigestTimeMin: v })}
                  testID="settings-morning-digest-time"
                />
              ) : null}
              <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, lineHeight: 16, marginTop: spacing.xs }}>
                Доставка зависит от настроек операционной системы (режимы энергосбережения и «не беспокоить»
                могут откладывать уведомления). Мы не отправляем ничего на сервер.
              </Text>
            </>
          ) : null}
          {permissionNote ? (
            <View style={[styles.noteBox, { backgroundColor: colors.warningSoft, borderRadius: 12, marginTop: spacing.sm }]}>
              <Text style={{ color: colors.warning, fontSize: fontSizes.sm, lineHeight: 18 }}>{permissionNote}</Text>
            </View>
          ) : null}
        </Card>

        {/* Сессии */}
        <SectionTitle title="Расписание КГЭУ" />
        <Card>
          <SwitchRow
            testID="settings-autosync"
            label="Обновлять расписание группы при запуске"
            description={
              settings.kgeuGroupId != null
                ? `Группа ${settings.kgeuGroupName ?? ''}: не чаще раза в 6 часов${
                    settings.kgeuLastSyncAt ? `, последнее обновление ${formatDateShort(settings.kgeuLastSyncAt)} в ${formatTime(settings.kgeuLastSyncAt)}` : ''
                  }`
                : 'Заработает после импорта расписания своей группы'
            }
            value={settings.autoSyncGroup}
            onValueChange={(v) => void update({ autoSyncGroup: v })}
          />
        </Card>

        <SectionTitle title="Учебные сессии" />
        <Card>
          <NumberStepper
            label="Длительность работы по умолчанию"
            value={settings.defaultWorkMin}
            onChange={(v) => void patch({ defaultWorkMin: v })}
            min={5}
            max={120}
            step={5}
            unit="мин"
            testID="settings-work-min"
          />
          <NumberStepper
            label="Короткий перерыв"
            value={settings.defaultBreakMin}
            onChange={(v) => void patch({ defaultBreakMin: v })}
            min={1}
            max={30}
            step={1}
            unit="мин"
            testID="settings-break-min"
          />
          <NumberStepper
            label="Длинный перерыв"
            value={settings.defaultLongBreakMin}
            onChange={(v) => void patch({ defaultLongBreakMin: v })}
            min={5}
            max={60}
            step={5}
            unit="мин"
            testID="settings-long-break-min"
          />
          <NumberStepper
            label="Циклов до длинного перерыва"
            value={settings.cyclesBeforeLongBreak}
            onChange={(v) => void patch({ cyclesBeforeLongBreak: v })}
            min={2}
            max={8}
            step={1}
            testID="settings-cycles"
          />
        </Card>

        {/* Планирование */}
        <SectionTitle title="Планирование" />
        <Card>
          <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginBottom: spacing.sm }}>
            Начало недели
          </Text>
          <SegmentedControl<0 | 1>
            testID="settings-week-start"
            value={settings.weekStart}
            onChange={(v) => void patch({ weekStart: Number(v) as 0 | 1 })}
            options={[
              { value: 1, label: 'Понедельник' },
              { value: 0, label: 'Воскресенье' },
            ]}
          />
          <View style={{ height: spacing.lg }} />
          <TimeOfDayField
            label="Учебное окно: начало"
            value={settings.studyWindowStartMin}
            onChange={(v) => void patch({ studyWindowStartMin: v })}
            minuteStep={15}
            testID="settings-window-start"
          />
          <TimeOfDayField
            label="Учебное окно: окончание"
            value={settings.studyWindowEndMin}
            onChange={(v) => void patch({ studyWindowEndMin: v })}
            minuteStep={15}
            testID="settings-window-end"
          />
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, lineHeight: 16 }}>
            Перепланировщик размещает задачи только внутри этого окна.
          </Text>
          <View style={{ height: spacing.lg }} />
          <NumberStepper
            label="Пауза между задачами в плане"
            value={settings.breakBetweenTasksMin}
            onChange={(v) => void patch({ breakBetweenTasksMin: v })}
            min={0}
            max={30}
            step={5}
            unit="мин"
            testID="settings-break-between"
          />
          <NumberStepper
            label="Горизонт планирования"
            value={settings.planningHorizonDays}
            onChange={(v) => void patch({ planningHorizonDays: v })}
            min={1}
            max={30}
            step={1}
            unit="дн."
            testID="settings-horizon"
          />
          <NumberStepper
            label="Дневная цель фокуса"
            value={settings.dailyGoalMin}
            onChange={(v) => void patch({ dailyGoalMin: v })}
            min={0}
            max={16 * 60}
            step={15}
            unit="мин"
            testID="settings-daily-goal"
          />
        </Card>

        {saving ? <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: spacing.md }}>Сохранение…</Text> : null}
        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </Screen>
  );
}


const styles = StyleSheet.create({
  noteBox: {
    padding: 10,
  },
});
