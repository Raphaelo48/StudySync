/**
 * Умный перепланировщик.
 *
 * Показывает предложенный план (порядок, время, причины), неразмещённые задачи
 * с предложениями, предупреждения о перегрузе. Данные не меняются до явного
 * нажатия «Применить план»; применение можно отменить.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Badge, Button, Card, EmptyState, SectionTitle, Spinner } from '../src/components/ui/primitives';
import { ConfirmDialog } from '../src/components/ui/overlays';
import { useDataVersion, useDatabase, useTheme, useToast } from '../src/state/AppContexts';
import { computePlan, applyPlan, revertPlan, type PlanContext } from '../src/logic/planService';
import { getNotificationClient } from '../src/notifications/client';
import { cancelEventNotification } from '../src/notifications/scheduler';
import type { PlannerAssignment } from '../src/logic/planner';
import {
  DAY_MS,
  formatDateFull,
  formatDurationMinutes,
  formatTime,
  isToday,
  startOfDay,
} from '../src/core/time';
import { logger } from '../src/core/logger';

/** Через сколько план считается устаревшим и пересчитывается перед применением. */
const PLAN_STALE_MS = 10 * 60_000;

export default function ReplanScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const db = useDatabase();
  const toast = useToast();
  const { bump, version } = useDataVersion();

  const [ctx, setCtx] = useState<PlanContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirmApply, setConfirmApply] = useState(false);
  const [revertiblePlanId, setRevertiblePlanId] = useState<string | null>(null);

  const calculate = useCallback(async (keepExcluded = false) => {
    setCalculating(true);
    try {
      const result = await computePlan(db);
      setCtx(result);
      if (!keepExcluded) setExcluded(new Set());
      const lastApplied = await db.plans.getLastApplied();
      setRevertiblePlanId(lastApplied?.id ?? null);
    } catch (e) {
      logger.error('replan', 'Ошибка расчёта плана', e);
      toast.error('Не удалось рассчитать план');
    } finally {
      setCalculating(false);
      setLoading(false);
    }
  }, [db, toast]);

  useFocusEffect(
    useCallback(() => {
      void calculate();
    }, [calculate, version])
  );

  const includedAssignments = useMemo(
    () => (ctx ? ctx.output.assignments.filter((a) => !excluded.has(a.taskId)) : []),
    [ctx, excluded]
  );

  const groupedByDay = useMemo(() => {
    const groups = new Map<number, PlannerAssignment[]>();
    for (const a of ctx?.output.assignments ?? []) {
      const day = startOfDay(a.start);
      const arr = groups.get(day) ?? [];
      arr.push(a);
      groups.set(day, arr);
    }
    return [...groups.entries()].sort((x, y) => x[0] - y[0]);
  }, [ctx]);

  const applyCurrentPlan = async () => {
    if (!ctx) return;
    // План считается на момент открытия экрана. Если с тех пор прошло время,
    // часть блоков могла оказаться в прошлом — пересчитываем и просим подтвердить.
    const now = Date.now();
    const stale = now - ctx.input.now > PLAN_STALE_MS || includedAssignments.some((a) => a.start < now);
    if (stale) {
      setConfirmApply(false);
      await calculate(true);
      toast.info('План пересчитан на текущее время — проверьте его и примените ещё раз');
      return;
    }
    setApplying(true);
    try {
      const filtered: PlanContext = {
        input: ctx.input,
        output: { ...ctx.output, assignments: includedAssignments },
      };
      const result = await applyPlan(db, filtered);
      const client = getNotificationClient();
      for (const id of result.removedEventIds) await cancelEventNotification(client, id);
      setConfirmApply(false);
      bump();
      setRevertiblePlanId(result.planRecordId);
      toast.success(`План применён: задач размещено — ${result.movedTaskCount}`, {
        label: 'Отменить',
        onPress: () => {
          void revertPlan(db, result.planRecordId)
            .then(() => {
              bump();
              toast.info('Применение плана отменено');
              void calculate();
            })
            .catch(() => toast.error('Не удалось отменить план'));
        },
      });
      await calculate();
    } catch (e) {
      logger.error('replan', 'Ошибка применения плана', e);
      toast.error('Не удалось применить план');
    } finally {
      setApplying(false);
    }
  };

  const revertLastPlan = async () => {
    if (!revertiblePlanId) return;
    try {
      const res = await revertPlan(db, revertiblePlanId);
      setRevertiblePlanId(null);
      bump();
      toast.success(`Отменено: удалено учебных блоков — ${res.removedEvents}`);
      await calculate();
    } catch {
      toast.error('Не удалось отменить последний план');
    }
  };

  if (loading) {
    return (
      <Screen testID="replan-screen">
        <ScreenHeader title="Перепланирование" />
        <Spinner testID="replan-loading" />
      </Screen>
    );
  }

  const output = ctx?.output;
  const noTasks = (ctx?.input.tasks.length ?? 0) === 0;

  return (
    <Screen testID="replan-screen">
      <ScreenHeader
        title="Перепланирование"
        subtitle={output ? `Горизонт: до ${formatDateFull(output.horizonEnd - DAY_MS + 1)}` : undefined}
        testID="replan-header"
        right={
          <Pressable accessibilityRole="button" accessibilityLabel="Пересчитать план" onPress={() => void calculate()} hitSlop={8}>
            <Ionicons name="refresh" size={22} color={colors.primary} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        {noTasks ? (
          <Card>
            <EmptyState
              testID="replan-empty"
              icon="checkmark-done-outline"
              title="Перепланировать нечего"
              subtitle="Все задачи выполнены или ещё не созданы. Добавьте задачи — алгоритм распределит их по свободному времени."
              actionLabel="К списку задач"
              onAction={() => router.push('/(tabs)/tasks')}
            />
          </Card>
        ) : output ? (
          <>
            {/* Сводка */}
            <Card>
              <View style={styles.totalsRow}>
                <TotalCell label="Нужно" value={formatDurationMinutes(output.totals.requiredMinutes)} color={colors.text} />
                <TotalCell label="Свободно" value={formatDurationMinutes(output.totals.availableMinutes)} color={colors.success} />
                <TotalCell label="Размещено" value={formatDurationMinutes(output.totals.plannedMinutes)} color={colors.primary} />
              </View>
              {output.overloaded ? (
                <View style={[styles.warningBox, { backgroundColor: colors.dangerSoft, borderRadius: radii.md }]}>
                  <Ionicons name="warning-outline" size={16} color={colors.danger} />
                  <Text style={{ color: colors.danger, fontSize: fontSizes.sm, flex: 1, lineHeight: 19 }}>
                    Перегруз: все задачи физически не помещаются в доступное время. Часть задач в списке ниже — с вариантами переноса.
                  </Text>
                </View>
              ) : (
                <View style={[styles.warningBox, { backgroundColor: colors.successSoft, borderRadius: radii.md }]}>
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
                  <Text style={{ color: colors.success, fontSize: fontSizes.sm, flex: 1 }}>
                    Все задачи помещаются в свободное время
                  </Text>
                </View>
              )}
              {output.warnings.map((w, i) => (
                <Text key={i} style={{ color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: 8, lineHeight: 19 }}>
                  · {w}
                </Text>
              ))}
            </Card>

            {/* Предложенный план */}
            <SectionTitle title="Предложенный план" testID="replan-plan-title" />
            {output.assignments.length === 0 ? (
              <Card>
                <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19 }}>
                  Ни одну задачу не удалось разместить в текущих учебных окнах. Проверьте настройки учебного окна или освободите время в расписании.
                </Text>
              </Card>
            ) : (
              groupedByDay.map(([day, items]) => (
                <View key={day}>
                  <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, fontWeight: '600', marginVertical: spacing.sm }}>
                    {isToday(day) ? 'Сегодня' : formatDateFull(day)}
                  </Text>
                  {items.map((a) => {
                    const isExcluded = excluded.has(a.taskId);
                    return (
                      <Card key={a.taskId} style={{ marginBottom: spacing.sm, opacity: isExcluded ? 0.5 : 1 }} padded>
                        <View style={styles.assignmentRow}>
                          <Pressable
                            testID={`replan-toggle-${a.taskId}`}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: !isExcluded }}
                            accessibilityLabel={isExcluded ? 'Вернуть задачу в план' : 'Исключить задачу из плана'}
                            hitSlop={8}
                            onPress={() =>
                              setExcluded((prev) => {
                                const next = new Set(prev);
                                if (next.has(a.taskId)) next.delete(a.taskId);
                                else next.add(a.taskId);
                                return next;
                              })
                            }
                          >
                            <Ionicons
                              name={isExcluded ? 'square-outline' : 'checkbox'}
                              size={22}
                              color={isExcluded ? colors.textMuted : colors.primary}
                            />
                          </Pressable>
                          <View style={{ flex: 1 }}>
                            <View style={styles.assignmentHeader}>
                              <Text numberOfLines={1} style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600', flex: 1 }}>
                                {a.title}
                              </Text>
                              <Badge label={`${formatTime(a.start)}–${formatTime(a.end)}`} color={colors.primary} icon="time-outline" />
                            </View>
                            {a.reasons.map((r, i) => (
                              <View key={i} style={styles.reasonRow}>
                                <Ionicons name="information-circle-outline" size={12} color={colors.textMuted} />
                                <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, flex: 1, lineHeight: 16 }}>
                                  {r}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      </Card>
                    );
                  })}
                </View>
              ))
            )}

            {/* Неразмещённые */}
            {output.unplaced.length > 0 ? (
              <>
                <SectionTitle title={`Не удалось разместить · ${output.unplaced.length}`} />
                {output.unplaced.map((u) => (
                  <Card key={u.taskId} style={{ marginBottom: spacing.sm, borderColor: colors.warning, borderWidth: 1 }}>
                    <View style={styles.assignmentHeader}>
                      <Text numberOfLines={1} style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600', flex: 1 }}>
                        {u.title}
                      </Text>
                      <Badge label={formatDurationMinutes(u.plannedMinutes)} color={colors.warning} />
                    </View>
                    <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: 6, lineHeight: 19 }}>
                      {u.reason === 'no_time_before_deadline'
                        ? 'Не завершается до дедлайна при текущей загрузке.'
                        : u.reason === 'too_long_for_window'
                          ? 'Задача длиннее учебного окна дня.'
                          : 'В горизонте планирования не хватает свободного времени.'}
                    </Text>
                    {u.suggestions.map((s, i) => (
                      <View key={i} style={styles.reasonRow}>
                        <Ionicons name="arrow-forward-circle-outline" size={13} color={colors.primary} />
                        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, flex: 1, lineHeight: 18 }}>{s}</Text>
                      </View>
                    ))}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => router.push(`/task/${u.taskId}`)}
                      hitSlop={8}
                      style={{ marginTop: 6, alignSelf: 'flex-start' }}
                    >
                      <Text style={{ color: colors.primary, fontSize: fontSizes.sm, fontWeight: '600' }}>Открыть задачу →</Text>
                    </Pressable>
                  </Card>
                ))}
              </>
            ) : null}

            {/* Действия */}
            <View style={{ height: spacing.xl }} />
            <View style={styles.actionsRow}>
              <Button testID="replan-cancel" title="Отменить" variant="ghost" style={{ flex: 1 }} onPress={() => router.back()} />
              <Button
                testID="replan-edit-manual"
                title="Изменить вручную"
                variant="secondary"
                style={{ flex: 1.4 }}
                onPress={() => router.push('/(tabs)/tasks')}
              />
              <Button
                testID="replan-apply"
                title="Применить план"
                style={{ flex: 1.6 }}
                disabled={includedAssignments.length === 0}
                loading={applying}
                onPress={() => setConfirmApply(true)}
              />
            </View>
            {revertiblePlanId ? (
              <Button
                testID="replan-revert"
                title="Отменить последний применённый план"
                variant="ghost"
                icon="arrow-undo"
                style={{ marginTop: spacing.sm }}
                onPress={() => void revertLastPlan()}
              />
            ) : null}
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, textAlign: 'center', marginTop: spacing.md, lineHeight: 16 }}>
              План не изменяет расписание до нажатия «Применить». Применение создаёт учебные блоки в календаре — их можно отменить.
            </Text>
          </>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={confirmApply}
        title="Применить план?"
        message={`Будет размещено задач: ${includedAssignments.length}. Учебные блоки появятся в расписании, прежние блоки этих задач заменятся. Действие можно отменить.`}
        confirmLabel="Применить"
        testID="replan-apply-confirm"
        onConfirm={() => void applyCurrentPlan()}
        onCancel={() => setConfirmApply(false)}
      />
    </Screen>
  );
}

function TotalCell({ label, value, color }: { label: string; value: string; color: string }) {
  const { colors, fontSizes } = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>{label}</Text>
      <Text style={{ color, fontSize: fontSizes.lg, fontWeight: '700', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  totalsRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  warningBox: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
    alignItems: 'flex-start',
  },
  assignmentRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  assignmentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 5,
    marginTop: 4,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
});
