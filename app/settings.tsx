/**
 * Настройки: уведомления (с обработкой отказа ОС), параметры сессий и перерывов,
 * учебное окно для перепланировщика, начало недели, дневная цель, язык.
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
import type { LanguagePref } from '../src/models/types';
import { useT } from '../src/i18n/useT';

export default function SettingsScreen() {
  const { colors, fontSizes, spacing } = useTheme();
  const { settings, update } = useSettings();
  const db = useDatabase();
  const toast = useToast();
  const t = useT();
  const [permissionNote, setPermissionNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const patch = async (p: Parameters<typeof update>[0]) => {
    const check = validateSettingsPatch(p, settings);
    if (!check.ok) {
      const firstMessage = Object.values(check.errors)[0];
      toast.error(firstMessage ?? t('common.invalidValue'));
      return;
    }
    setSaving(true);
    try {
      await update(p);
      await resyncAllNotifications(db, getNotificationClient());
    } catch {
      toast.error(t('settings.notifications.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const toggleNotifications = async (enabled: boolean) => {
    if (enabled) {
      const client = getNotificationClient();
      if (!client.isSupported()) {
        setPermissionNote(t('settings.notifications.unsupported'));
        await patch({ notificationsEnabled: false });
        return;
      }
      const status = await client.requestPermission();
      if (status === 'granted' || status === 'provisional') {
        setPermissionNote(null);
        await patch({ notificationsEnabled: true });
        toast.success(t('settings.notifications.enabledToast'));
      } else if (status === 'denied') {
        setPermissionNote(t('settings.notifications.denied'));
        await patch({ notificationsEnabled: false });
      } else {
        setPermissionNote(t('settings.notifications.unknown'));
        await patch({ notificationsEnabled: false });
      }
    } else {
      setPermissionNote(null);
      await patch({ notificationsEnabled: false });
    }
  };

  const autoSyncHint = settings.kgeuGroupId != null
    ? t('settings.kgeu.autoSyncHintOn', {
        group: settings.kgeuGroupName ?? '',
        last: settings.kgeuLastSyncAt
          ? t('settings.kgeu.autoSyncLast', {
              date: formatDateShort(settings.kgeuLastSyncAt),
              time: formatTime(settings.kgeuLastSyncAt),
            })
          : '',
      })
    : t('settings.kgeu.autoSyncHintOff');

  return (
    <Screen testID="settings-screen">
      <ScreenHeader title={t('settings.title')} testID="settings-header" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {/* Уведомления */}
        <SectionTitle title={t('settings.sections.notifications')} />
        <Card>
          <SwitchRow
            testID="settings-notifications"
            label={t('settings.notifications.reminders')}
            description={t('settings.notifications.remindersHint')}
            value={settings.notificationsEnabled}
            onValueChange={(v) => void toggleNotifications(v)}
          />
          {settings.notificationsEnabled ? (
            <>
              <SwitchRow
                testID="settings-notify-lesson"
                label={t('settings.notifications.lesson')}
                value={settings.notifyLesson}
                onValueChange={(v) => void patch({ notifyLesson: v })}
              />
              <NumberStepper
                label={t('settings.notifications.lessonBefore')}
                value={settings.notifyLessonBeforeMin}
                onChange={(v) => void patch({ notifyLessonBeforeMin: v })}
                min={0}
                max={24 * 60}
                step={5}
                unit={t('common.minShort')}
                testID="settings-lesson-before"
              />
              <SwitchRow
                testID="settings-notify-deadline"
                label={t('settings.notifications.deadline')}
                value={settings.notifyDeadline}
                onValueChange={(v) => void patch({ notifyDeadline: v })}
              />
              <NumberStepper
                label={t('settings.notifications.deadlineBefore')}
                value={settings.notifyDeadlineBeforeMin}
                onChange={(v) => void patch({ notifyDeadlineBeforeMin: v })}
                min={0}
                max={7 * 24 * 60}
                step={15}
                unit={t('common.minShort')}
                testID="settings-deadline-before"
              />
              <SwitchRow
                testID="settings-notify-session"
                label={t('settings.notifications.session')}
                description={t('settings.notifications.sessionHint')}
                value={settings.notifySession}
                onValueChange={(v) => void patch({ notifySession: v })}
              />
              <SwitchRow
                testID="settings-notify-break"
                label={t('settings.notifications.break')}
                value={settings.notifyBreak}
                onValueChange={(v) => void patch({ notifyBreak: v })}
              />
              <SwitchRow
                testID="settings-morning-digest"
                label={t('settings.notifications.digest')}
                description={t('settings.notifications.digestHint')}
                value={settings.morningDigestEnabled}
                onValueChange={(v) => void patch({ morningDigestEnabled: v })}
              />
              {settings.morningDigestEnabled ? (
                <TimeOfDayField
                  label={t('settings.notifications.digestTime')}
                  value={settings.morningDigestTimeMin}
                  onChange={(v) => void patch({ morningDigestTimeMin: v })}
                  testID="settings-morning-digest-time"
                />
              ) : null}
              <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, lineHeight: 16, marginTop: spacing.xs }}>
                {t('settings.notifications.deliveryNote')}
              </Text>
            </>
          ) : null}
          {permissionNote ? (
            <View style={[styles.noteBox, { backgroundColor: colors.warningSoft, borderRadius: 12, marginTop: spacing.sm }]}>
              <Text style={{ color: colors.warning, fontSize: fontSizes.sm, lineHeight: 18 }}>{permissionNote}</Text>
            </View>
          ) : null}
        </Card>

        {/* Расписание КГЭУ */}
        <SectionTitle title={t('settings.sections.kgeu')} />
        <Card>
          <SwitchRow
            testID="settings-autosync"
            label={t('settings.kgeu.autoSync')}
            description={autoSyncHint}
            value={settings.autoSyncGroup}
            onValueChange={(v) => void update({ autoSyncGroup: v })}
          />
        </Card>

        <SectionTitle title={t('settings.sections.sessions')} />
        <Card>
          <NumberStepper
            label={t('settings.sessions.work')}
            value={settings.defaultWorkMin}
            onChange={(v) => void patch({ defaultWorkMin: v })}
            min={5}
            max={120}
            step={5}
            unit={t('common.minShort')}
            testID="settings-work-min"
          />
          <NumberStepper
            label={t('settings.sessions.shortBreak')}
            value={settings.defaultBreakMin}
            onChange={(v) => void patch({ defaultBreakMin: v })}
            min={1}
            max={30}
            step={1}
            unit={t('common.minShort')}
            testID="settings-break-min"
          />
          <NumberStepper
            label={t('settings.sessions.longBreak')}
            value={settings.defaultLongBreakMin}
            onChange={(v) => void patch({ defaultLongBreakMin: v })}
            min={5}
            max={60}
            step={5}
            unit={t('common.minShort')}
            testID="settings-long-break-min"
          />
          <NumberStepper
            label={t('settings.sessions.cycles')}
            value={settings.cyclesBeforeLongBreak}
            onChange={(v) => void patch({ cyclesBeforeLongBreak: v })}
            min={2}
            max={8}
            step={1}
            testID="settings-cycles"
          />
        </Card>

        {/* Планирование */}
        <SectionTitle title={t('settings.sections.planning')} />
        <Card>
          <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginBottom: spacing.sm }}>
            {t('settings.planning.weekStart')}
          </Text>
          <SegmentedControl<0 | 1>
            testID="settings-week-start"
            value={settings.weekStart}
            onChange={(v) => void patch({ weekStart: Number(v) as 0 | 1 })}
            options={[
              { value: 1, label: t('settings.planning.monday') },
              { value: 0, label: t('settings.planning.sunday') },
            ]}
          />
          <View style={{ height: spacing.lg }} />
          <TimeOfDayField
            label={t('settings.planning.windowStart')}
            value={settings.studyWindowStartMin}
            onChange={(v) => void patch({ studyWindowStartMin: v })}
            minuteStep={15}
            testID="settings-window-start"
          />
          <TimeOfDayField
            label={t('settings.planning.windowEnd')}
            value={settings.studyWindowEndMin}
            onChange={(v) => void patch({ studyWindowEndMin: v })}
            minuteStep={15}
            testID="settings-window-end"
          />
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, lineHeight: 16 }}>
            {t('settings.planning.windowHint')}
          </Text>
          <View style={{ height: spacing.lg }} />
          <NumberStepper
            label={t('settings.planning.breakBetween')}
            value={settings.breakBetweenTasksMin}
            onChange={(v) => void patch({ breakBetweenTasksMin: v })}
            min={0}
            max={30}
            step={5}
            unit={t('common.minShort')}
            testID="settings-break-between"
          />
          <NumberStepper
            label={t('settings.planning.horizon')}
            value={settings.planningHorizonDays}
            onChange={(v) => void patch({ planningHorizonDays: v })}
            min={1}
            max={30}
            step={1}
            unit={t('common.dayShort')}
            testID="settings-horizon"
          />
          <NumberStepper
            label={t('settings.planning.dailyGoal')}
            value={settings.dailyGoalMin}
            onChange={(v) => void patch({ dailyGoalMin: v })}
            min={0}
            max={16 * 60}
            step={15}
            unit={t('common.minShort')}
            testID="settings-daily-goal"
          />
        </Card>

        {/* Приложение */}
        <SectionTitle title={t('settings.sections.app')} />
        <Card>
          <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginBottom: spacing.sm }}>
            {t('settings.language.title')}
          </Text>
          <SegmentedControl<LanguagePref>
            testID="settings-language"
            value={settings.language}
            onChange={(v) => void patch({ language: v })}
            options={[
              { value: 'system', label: t('settings.language.system') },
              { value: 'ru', label: t('settings.language.ru') },
              { value: 'en', label: t('settings.language.en') },
            ]}
          />
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, lineHeight: 16, marginTop: spacing.sm }}>
            {t('settings.language.hint')}
          </Text>
        </Card>

        {saving ? <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: spacing.md }}>{t('common.saving')}</Text> : null}
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
