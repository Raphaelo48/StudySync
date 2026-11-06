/**
 * Учебные цели (неделя / месяц / семестр). Цели необязательны и не блокируют
 * работу приложения; прогресс считается по реальным сессиям и задачам.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Button, Card, EmptyState, IconButton, Spinner } from '../src/components/ui/primitives';
import { NumberStepper, SegmentedControl, SelectField } from '../src/components/ui/inputs';
import { DateTimeField } from '../src/components/ui/DateTimeField';
import { BottomSheet, ConfirmDialog } from '../src/components/ui/overlays';
import { useDataVersion, useDatabase, useSettings, useTheme, useToast } from '../src/state/AppContexts';
import { computeGoalProgress, type GoalProgress } from '../src/logic/analytics';
import { validateGoalForm } from '../src/logic/validation';
import { formatDurationMinutes } from '../src/core/time';
import type { Goal, GoalMetric, GoalPeriod, Subject } from '../src/models/types';

interface GoalDraft {
  id: string | null;
  metric: GoalMetric;
  targetValue: number;
  period: GoalPeriod;
  subjectId: string | null;
  periodStartAt: number | null;
  periodEndAt: number | null;
  note: string;
}

const EMPTY_DRAFT: GoalDraft = {
  id: null,
  metric: 'study_minutes',
  targetValue: 300,
  period: 'week',
  subjectId: null,
  periodStartAt: null,
  periodEndAt: null,
  note: '',
};

export default function GoalsScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const { settings } = useSettings();
  const db = useDatabase();
  const toast = useToast();
  const { version, bump } = useDataVersion();

  const [items, setItems] = useState<GoalProgress[] | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const now = Date.now();
    const [goalRows, subs, sessions, tasks] = await Promise.all([
      db.goals.list(),
      db.subjects.list(),
      db.sessions.listRange(0, now + 86_400_000),
      db.tasks.list({ status: 'all' }, now),
    ]);
    setSubjects(subs);
    setItems(computeGoalProgress(goalRows, sessions, tasks, now, settings.weekStart));
  }, [db, settings.weekStart]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version])
  );

  const subjectById = new Map(subjects.map((s) => [s.id, s]));

  const saveGoal = async () => {
    if (!draft) return;
    const check = validateGoalForm({
      subjectId: draft.subjectId,
      metric: draft.metric,
      targetValue: draft.targetValue,
      period: draft.period,
      periodStartAt: draft.periodStartAt,
      periodEndAt: draft.periodEndAt,
      note: draft.note,
    });
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors({});
    try {
      if (draft.id) {
        await db.goals.update(draft.id, check.value);
        toast.success('Цель обновлена');
      } else {
        await db.goals.create(check.value);
        toast.success('Цель добавлена');
      }
      setDraft(null);
      bump();
      await load();
    } catch {
      toast.error('Не удалось сохранить цель');
    }
  };

  const deleteGoal = async (id: string) => {
    await db.goals.delete(id);
    setConfirmDeleteId(null);
    toast.success('Цель удалена');
    bump();
    await load();
  };

  return (
    <Screen testID="goals-screen">
      <ScreenHeader
        title="Цели"
        testID="goals-header"
        right={
          <Pressable
            testID="goals-add"
            accessibilityRole="button"
            accessibilityLabel="Добавить цель"
            hitSlop={8}
            onPress={() => {
              setErrors({});
              setDraft({ ...EMPTY_DRAFT });
            }}
          >
            <Ionicons name="add-circle" size={26} color={colors.primary} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        {items == null ? (
          <Spinner testID="goals-loading" />
        ) : items.length === 0 ? (
          <Card>
            <EmptyState
              testID="goals-empty"
              icon="flag-outline"
              title="Целей пока нет"
              subtitle="Цели необязательны. Пример: «5 часов математики в неделю» или «10 задач за месяц» — прогресс считается автоматически по вашим сессиям и задачам."
              actionLabel="Добавить цель"
              onAction={() => setDraft({ ...EMPTY_DRAFT })}
            />
          </Card>
        ) : (
          items.map((gp) => {
            const subject = gp.goal.subjectId ? subjectById.get(gp.goal.subjectId) : null;
            return (
              <Card key={gp.goal.id} style={{ marginBottom: spacing.sm }}>
                <View style={styles.goalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }}>
                      {gp.goal.metric === 'study_minutes'
                        ? `${formatDurationMinutes(gp.goal.targetValue)} учёбы`
                        : `${gp.goal.targetValue} задач выполнить`}
                    </Text>
                    <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: 2 }}>
                      {gp.periodLabel}
                      {subject ? ` · ${subject.name}` : ' · все предметы'}
                    </Text>
                  </View>
                  <IconButton
                    icon="create-outline"
                    accessibilityLabel="Редактировать цель"
                    onPress={() => {
                      setErrors({});
                      setDraft({
                        id: gp.goal.id,
                        metric: gp.goal.metric,
                        targetValue: gp.goal.targetValue,
                        period: gp.goal.period,
                        subjectId: gp.goal.subjectId,
                        periodStartAt: gp.goal.periodStartAt,
                        periodEndAt: gp.goal.periodEndAt,
                        note: gp.goal.note ?? '',
                      });
                    }}
                  />
                  <IconButton
                    icon="trash-outline"
                    accessibilityLabel="Удалить цель"
                    color={colors.danger}
                    onPress={() => setConfirmDeleteId(gp.goal.id)}
                  />
                </View>
                <View style={{ height: 8, backgroundColor: colors.track, borderRadius: radii.full, overflow: 'hidden', marginTop: 6 }}>
                  <View
                    style={{
                      width: `${Math.min(100, (gp.progress ?? 0) * 100)}%`,
                      height: '100%',
                      backgroundColor: (gp.progress ?? 0) >= 1 ? colors.success : colors.primary,
                      borderRadius: radii.full,
                    }}
                  />
                </View>
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: 6 }}>
                  {gp.goal.metric === 'study_minutes'
                    ? `${formatDurationMinutes(gp.current)} из ${formatDurationMinutes(gp.target)}`
                    : `${gp.current} из ${gp.target}`}
                  {(gp.progress ?? 0) >= 1 ? ' · цель достигнута' : ''}
                </Text>
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* Форма цели */}
      <BottomSheet
        visible={draft != null}
        title={draft?.id ? 'Редактировать цель' : 'Новая цель'}
        onClose={() => setDraft(null)}
        testID="goal-sheet"
      >
        {draft ? (
          <ScrollView bounces={false} style={{ maxHeight: 560 }} keyboardShouldPersistTaps="handled">
            <Text style={labelStyle(colors.textSecondary, fontSizes.sm)}>Показатель</Text>
            <SegmentedControl<GoalMetric>
              testID="goal-metric"
              value={draft.metric}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  metric: v,
                  targetValue: v === 'study_minutes' ? 300 : 10,
                })
              }
              options={[
                { value: 'study_minutes', label: 'Минуты учёбы' },
                { value: 'completed_tasks', label: 'Задачи' },
              ]}
            />
            <View style={{ height: spacing.lg }} />
            <NumberStepper
              testID="goal-target"
              label={draft.metric === 'study_minutes' ? 'Целевые минуты' : 'Количество задач'}
              value={draft.targetValue}
              onChange={(v) => setDraft({ ...draft, targetValue: v })}
              min={draft.metric === 'study_minutes' ? 15 : 1}
              max={draft.metric === 'study_minutes' ? 10000 : 500}
              step={draft.metric === 'study_minutes' ? 15 : 1}
              unit={draft.metric === 'study_minutes' ? 'мин' : undefined}
            />
            {errors.targetValue ? <Text style={{ color: colors.danger, fontSize: fontSizes.sm, marginTop: -8 }}>{errors.targetValue}</Text> : null}
            <Text style={labelStyle(colors.textSecondary, fontSizes.sm)}>Период</Text>
            <SegmentedControl<GoalPeriod>
              testID="goal-period"
              value={draft.period}
              onChange={(v) => setDraft({ ...draft, period: v })}
              options={[
                { value: 'week', label: 'Неделя' },
                { value: 'month', label: 'Месяц' },
                { value: 'semester', label: 'Семестр' },
              ]}
            />
            {errors.period ? <Text style={{ color: colors.danger, fontSize: fontSizes.sm }}>{errors.period}</Text> : null}
            {draft.period === 'semester' ? (
              <View style={{ marginTop: spacing.md }}>
                <DateTimeField
                  testID="goal-semester-start"
                  label="Начало семестра"
                  mode="date"
                  value={draft.periodStartAt}
                  onChange={(v) => setDraft({ ...draft, periodStartAt: v })}
                  error={errors.periodStartAt}
                />
                <DateTimeField
                  testID="goal-semester-end"
                  label="Конец семестра"
                  mode="date"
                  value={draft.periodEndAt}
                  onChange={(v) => setDraft({ ...draft, periodEndAt: v })}
                  error={errors.periodEndAt}
                />
              </View>
            ) : null}
            <SelectField
              testID="goal-subject"
              label="Предмет"
              options={subjects.map((s) => ({ value: s.id, label: s.name, color: s.color }))}
              value={draft.subjectId}
              onChange={(v) => setDraft({ ...draft, subjectId: v })}
              allowClear
              clearLabel="Все предметы"
            />
            <View style={{ height: spacing.md }} />
            <Button testID="goal-save" title={draft.id ? 'Сохранить' : 'Добавить цель'} icon="checkmark" onPress={() => void saveGoal()} />
            <View style={{ height: 16 }} />
          </ScrollView>
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmDeleteId != null}
        title="Удалить цель?"
        message="Цель будет удалена. История сессий и задач не изменится."
        confirmLabel="Удалить"
        danger
        testID="goal-delete-confirm"
        onConfirm={() => confirmDeleteId && void deleteGoal(confirmDeleteId)}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </Screen>
  );
}

const labelStyle = (color: string, fontSize: number) => ({
  color,
  fontSize,
  fontWeight: '600' as const,
  marginBottom: 6,
});

const styles = StyleSheet.create({
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
