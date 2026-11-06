/**
 * Прогресс: аналитика по реальным данным с фильтрацией по периодам.
 * Каждый показатель имеет прозрачную формулу (см. src/logic/analytics.ts);
 * при нехватке данных показывается честное сообщение вместо выдуманного числа.
 */
import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/ui/Screen';
import { Card, EmptyState, SectionTitle, Spinner } from '../../src/components/ui/primitives';
import { SegmentedControl } from '../../src/components/ui/inputs';
import { BarChart, ChartLegend, DonutChart, HBar, weekdayLabelShort } from '../../src/components/charts/charts';
import { useDataVersion, useDatabase, useSettings, useTheme } from '../../src/state/AppContexts';
import {
  computeGoalProgress,
  computeProgressStats,
  resolvePeriod,
  type ProgressStats,
  type StatsPeriodKind,
} from '../../src/logic/analytics';
import { formatDurationMinutes } from '../../src/core/time';
import type { GoalProgress } from '../../src/logic/analytics';
import type { StudySession, Subject, Task } from '../../src/models/types';

export default function ProgressScreen() {
  const { colors, fontSizes, spacing, radii } = useTheme();
  const { settings } = useSettings();
  const db = useDatabase();
  const router = useRouter();
  const { version } = useDataVersion();

  const [periodKind, setPeriodKind] = useState<StatsPeriodKind>('week');
  const [stats, setStats] = useState<ProgressStats | null>(null);
  const [goals, setGoals] = useState<GoalProgress[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const now = Date.now();
    const [tasks, sessions, subjects, goalRows] = await Promise.all([
      db.tasks.list({ status: 'all' }, now),
      db.sessions.listRange(0, now + 86_400_000),
      db.subjects.list(true),
      db.goals.list(),
    ]);
    const period = resolvePeriod(periodKind, now, settings.weekStart);
    const computed = computeProgressStats({
      tasks,
      sessions,
      subjects,
      period,
      now,
      weekStart: settings.weekStart,
      dailyPoints: periodKind === '30d' || periodKind === 'month' || periodKind === 'all' ? '30d' : '7d',
    });
    setStats(computed);
    setGoals(computeGoalProgress(goalRows, sessions, tasks, now, settings.weekStart));
    setLoading(false);
  }, [db, periodKind, settings.weekStart]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load, version])
  );

  if (loading && !stats) {
    return (
      <Screen testID="progress-screen">
        <Spinner testID="progress-loading" />
      </Screen>
    );
  }
  if (!stats) return null;

  const pva = stats.plannedVsActual;
  const defer = stats.deferStats;

  return (
    <Screen testID="progress-screen">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <Text style={{ color: colors.text, fontSize: fontSizes.xxl, fontWeight: '700', paddingTop: 8 }}>Прогресс</Text>
        <View style={{ marginVertical: spacing.md }}>
          <SegmentedControl<StatsPeriodKind>
            testID="progress-period"
            value={periodKind}
            onChange={setPeriodKind}
            options={[
              { value: 'week', label: 'Неделя' },
              { value: 'month', label: 'Месяц' },
              { value: '7d', label: '7 дней' },
              { value: '30d', label: '30 дней' },
              { value: 'all', label: 'Всё' },
            ]}
          />
        </View>

        {!stats.hasAnyData ? (
          <Card>
            <EmptyState
              testID="progress-empty"
              icon="bar-chart-outline"
              title="Данных пока нет"
              subtitle="Статистика появится после первых выполненных задач и учебных сессий. Мы показываем только реальные данные — ничего не выдумываем."
              actionLabel="Добавить задачу"
              onAction={() => router.push('/task/edit')}
            />
          </Card>
        ) : (
          <>
            {/* Ключевые показатели */}
            <View style={styles.metricsGrid}>
              <MetricCard
                testID="metric-completed"
                icon="checkmark-done"
                color={colors.success}
                value={String(stats.completedCount)}
                label="выполнено задач"
              />
              <MetricCard
                testID="metric-rate"
                icon="pie-chart-outline"
                color={colors.primary}
                value={stats.completionRate != null ? `${stats.completionRate}%` : '—'}
                label={
                  stats.completionRate != null
                    ? `из ${stats.dueCount} с дедлайном в периоде`
                    : 'нет задач с дедлайном в периоде'
                }
              />
              <MetricCard
                testID="metric-focus"
                icon="timer-outline"
                color={colors.info}
                value={formatDurationMinutes(stats.focusMinutes)}
                label={`${stats.sessionsCount} сессий${stats.avgSessionMinutes != null ? ` · в среднем ${formatDurationMinutes(stats.avgSessionMinutes)}` : ''}`}
              />
              <MetricCard
                testID="metric-overdue"
                icon="alert-circle-outline"
                color={stats.overdueCount > 0 ? colors.danger : colors.success}
                value={String(stats.overdueCount)}
                label="просрочено сейчас"
              />
            </View>

            {/* Активность по дням */}
            <SectionTitle title="Активность по дням" />
            <Card>
              <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginBottom: spacing.sm }}>
                Минуты фокуса за {stats.daily.length} дней
              </Text>
              {stats.daily.every((d) => d.focusMinutes === 0 && d.completedTasks === 0) ? (
                <Text testID="progress-no-activity" style={{ color: colors.textSecondary, fontSize: fontSizes.sm, paddingVertical: spacing.md }}>
                  В этом периоде сессий пока не было — график появится после первой фокус-сессии.
                </Text>
              ) : (
                <BarChart
                  testID="progress-bars"
                  data={stats.daily.map((d) => ({ label: weekdayLabelShort(d.day), value: d.focusMinutes }))}
                  height={130}
                />
              )}
            </Card>

            {/* Время по предметам */}
            <SectionTitle title="Время по предметам" />
            <Card>
              {stats.bySubject.length === 0 ? (
                <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }}>
                  Нет данных: проводите фокус-сессии, выбирая задачу или предмет.
                </Text>
              ) : (
                <View style={styles.donutRow}>
                  <DonutChart
                    testID="progress-donut"
                    slices={stats.bySubject.map((s) => ({ label: s.name, value: s.minutes, color: s.color }))}
                    centerValue={formatDurationMinutes(stats.focusMinutes)}
                    centerLabel="всего"
                  />
                  <View style={{ flex: 1 }}>
                    <ChartLegend slices={stats.bySubject.map((s) => ({ label: s.name, value: s.minutes, color: s.color }))} />
                  </View>
                </View>
              )}
            </Card>

            {/* План против факта */}
            <SectionTitle title="План против факта" />
            <Card>
              {pva.ratio == null || pva.sampleSize === 0 ? (
                <Text testID="progress-pva-empty" style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19 }}>
                  Недостаточно данных: показатель считается по выполненным задачам, у которых измерено фактическое время
                  (фокус-сессии с привязкой к задаче).
                </Text>
              ) : (
                <View>
                  <HBar
                    testID="pva-planned"
                    label="Запланировано"
                    value={pva.plannedMinutes}
                    max={Math.max(pva.plannedMinutes, pva.actualMinutes)}
                    color={colors.info}
                    valueLabel={formatDurationMinutes(pva.plannedMinutes)}
                  />
                  <HBar
                    testID="pva-actual"
                    label="Фактически"
                    value={pva.actualMinutes}
                    max={Math.max(pva.plannedMinutes, pva.actualMinutes)}
                    color={colors.primary}
                    valueLabel={formatDurationMinutes(pva.actualMinutes)}
                  />
                  <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: spacing.sm, lineHeight: 16 }}>
                    По {pva.sampleSize} выполненным задачам с измеренным временем. Факт/план: {(pva.ratio ?? 0).toFixed(2)}×
                    {pva.ratio != null && pva.ratio > 1.2
                      ? ' — задачи занимают больше времени, чем планировалось; учитывайте это при планировании.'
                      : ''}
                  </Text>
                </View>
              )}
            </Card>

            {/* Переносы */}
            <SectionTitle title="Переносы сроков" />
            <Card>
              {defer.deferRate == null ? (
                <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm }}>
                  В периоде не создавалось задач — сравнивать нечего.
                </Text>
              ) : (
                <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 20 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{defer.totalDefers}</Text> переносов у{' '}
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{defer.tasksCreated}</Text> задач, созданных в периоде
                  {defer.deferRate > 0 ? ` (в среднем ${defer.deferRate.toFixed(1)} на задачу)` : ''}. Перенос срока — нормальная
                  практика при изменениях обстоятельств; показатель помогает замечать перегруз.
                </Text>
              )}
            </Card>

            {/* Цели */}
            <SectionTitle title="Цели" actionLabel="Управлять" action={() => router.push('/goals')} />
            {goals.length === 0 ? (
              <Card>
                <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19 }}>
                  Цели не заданы — и это нормально. Они необязательны и нужны только вам: например, «4 часа математики в неделю».
                </Text>
              </Card>
            ) : (
              goals.map((gp) => (
                <Card key={gp.goal.id} style={{ marginBottom: spacing.sm }}>
                  <View style={styles.goalHeader}>
                    <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600', flex: 1 }} numberOfLines={1}>
                      {gp.goal.metric === 'study_minutes'
                        ? `${formatDurationMinutes(gp.goal.targetValue)} учёбы`
                        : `${gp.goal.targetValue} задач`}
                      {gp.goal.subjectId ? '' : ' · все предметы'}
                    </Text>
                    <View style={[styles.goalPeriodBadge, { backgroundColor: colors.surfaceAlt, borderRadius: radii.full }]}>
                      <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs }}>{gp.periodLabel}</Text>
                    </View>
                  </View>
                  <View style={{ height: 8, backgroundColor: colors.track, borderRadius: 4, overflow: 'hidden', marginTop: 8 }}>
                    <View
                      style={{
                        width: `${Math.min(100, (gp.progress ?? 0) * 100)}%`,
                        height: '100%',
                        backgroundColor: (gp.progress ?? 0) >= 1 ? colors.success : colors.primary,
                        borderRadius: 4,
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
              ))
            )}

            <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, textAlign: 'center', marginTop: spacing.xl, lineHeight: 16 }}>
              Статистика основана только на ваших данных и не оценивает способности.
              {'\n'}Формулы показателей описаны в документации проекта.
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function MetricCard({
  icon,
  color,
  value,
  label,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  value: string;
  label: string;
  testID?: string;
}) {
  const { colors, fontSizes, radii, spacing } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.metricCard,
        { backgroundColor: colors.surface, borderColor: colors.borderSoft, borderRadius: radii.lg, padding: spacing.md + 2 },
      ]}
    >
      <View style={[styles.metricIcon, { backgroundColor: `${color}1F` }]}>
        <Ionicons name={icon} size={15} color={color} />
      </View>
      <Text style={{ color: colors.text, fontSize: fontSizes.xl, fontWeight: '700', marginTop: 6 }}>{value}</Text>
      <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: 2, lineHeight: 15 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: '46%',
    borderWidth: StyleSheet.hairlineWidth,
  },
  metricIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  donutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  goalPeriodBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
