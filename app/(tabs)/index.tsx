/**
 * Главная: приветствие, статистика дня, ближайшие занятия, задачи на сегодня,
 * высокий приоритет, ближайшие дедлайны, загруженность дня, быстрый доступ
 * к фокус-сессии и перепланировщику.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/ui/Screen';
import { Badge, Button, Card, EmptyState, SectionTitle, Spinner } from '../../src/components/ui/primitives';
import { DayLoadBar, StatTile, TimerMiniCard, formatRemaining } from '../../src/components/home/widgets';
import { TaskCard } from '../../src/components/tasks/TaskCard';
import { EventCard } from '../../src/components/schedule/EventCard';
import { useDataVersion, useSettings, useTheme, useDatabase } from '../../src/state/AppContexts';
import { useTimer } from '../../src/state/TimerContext';
import { computeDayLoad, type DayLoadInfo } from '../../src/logic/analytics';
import { conflictingIds } from '../../src/logic/conflicts';
import { toggleTaskDone } from '../../src/logic/taskStatusService';
import { DebtCard } from '../../src/components/debts/DebtCard';
import type { DebtWithSubject, HomeBlock } from '../../src/models/types';
import {
  DAY_MS,
  addDays,
  formatDateWithWeekday,
  formatDurationMinutes,
  formatSecondsClock,
  relativeDayLabel,
  startOfDay,
} from '../../src/core/time';
import type { EventWithRelations, TaskWithSubject } from '../../src/models/types';

interface HomeData {
  todayTasks: TaskWithSubject[];
  todayEvents: EventWithRelations[];
  nextEvents: EventWithRelations[];
  highPriority: TaskWithSubject[];
  upcomingDeadlines: TaskWithSubject[];
  overdue: TaskWithSubject[];
  doneToday: number;
  focusMinutesToday: number;
  plannedMinutesToday: number;
  dayLoad: DayLoadInfo;
  conflictIds: Set<string>;
  hasAnyContent: boolean;
  taskTitle: string | null;
  debts: DebtWithSubject[];
}

export default function HomeScreen() {
  const { colors, fontSizes, spacing } = useTheme();
  const { settings } = useSettings();
  const show = (b: HomeBlock) => !settings.homeHiddenBlocks.includes(b);
  const db = useDatabase();
  const router = useRouter();
  const { version, bump } = useDataVersion();
  const timer = useTimer();
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const now = Date.now();
    const dayStart = startOfDay(now);
    try {
      const [todayTasks, todayEvents, weekEvents, activeTasks, overdue, subjects, daySessions, taskForTimer, debts] =
        await Promise.all([
          db.tasks.listDueOnDay(dayStart, now),
          db.events.listDay(dayStart),
          db.events.listRange(now, addDays(now, 3)),
          db.tasks.list({ status: 'active', due: 'week' }),
          db.tasks.listOverdue(now),
          db.subjects.list(),
          db.sessions.listRange(dayStart, dayStart + DAY_MS),
          timer.state.taskId ? db.tasks.get(timer.state.taskId) : Promise.resolve(null),
          db.debts.listOpen(),
        ]);

      const doneToday = todayTasks.filter((t) => t.status === 'done').length;
      const focusMinutesToday = Math.round(
        daySessions.reduce((s, x) => s + x.activeSeconds / 60, 0)
      );
      const plannedMinutesToday = todayTasks
        .filter((t) => t.status !== 'done')
        .reduce((s, t) => s + t.plannedMinutes, 0);
      const dayLoad = computeDayLoad(todayEvents, todayTasks, settings, dayStart);
      const highPriority = activeTasks
        .filter((t) => t.priority === 3)
        .slice(0, 3);
      const upcomingDeadlines = activeTasks
        .filter((t) => t.deadlineAt != null && t.deadlineAt > now)
        .sort((a, b) => (a.deadlineAt ?? 0) - (b.deadlineAt ?? 0))
        .slice(0, 3);
      const nextEvents = weekEvents
        .filter((e) => e.endAt > now)
        .slice(0, 2);

      const hasSessions = await db.driver.getFirst<{ one: number }>(
        'SELECT 1 AS one FROM study_sessions LIMIT 1'
      );
      const hasAnyContent =
        subjects.length > 0 ||
        todayTasks.length > 0 ||
        todayEvents.length > 0 ||
        hasSessions != null ||
        activeTasks.length > 0;

      setData({
        todayTasks,
        todayEvents,
        nextEvents,
        highPriority,
        upcomingDeadlines,
        overdue,
        doneToday,
        focusMinutesToday,
        plannedMinutesToday,
        dayLoad,
        conflictIds: conflictingIds(todayEvents),
        hasAnyContent,
        taskTitle: taskForTimer?.title ?? null,
        debts,
      });
    } finally {
      setLoading(false);
    }
  }, [db, settings, timer.state.taskId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load, version])
  );

  const now = Date.now();
  const greeting = useMemo(() => {
    const h = new Date(now).getHours();
    if (h < 5) return 'Доброй ночи';
    if (h < 12) return 'Доброе утро';
    if (h < 18) return 'Добрый день';
    return 'Добрый вечер';
  }, [now]);
  const nameSuffix = settings.displayName.trim() ? `, ${settings.displayName.trim()}` : '';

  if (loading && !data) {
    return (
      <Screen testID="home-screen">
        <Spinner testID="home-loading" />
      </Screen>
    );
  }
  if (!data) return null;

  const timerActive = timer.isActive && timer.view.status !== 'idle';
  const dailyGoal = settings.dailyGoalMin;
  const goalReached = dailyGoal > 0 && data.focusMinutesToday >= dailyGoal;

  return (
    <Screen testID="home-screen">
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Приветствие */}
        <View style={styles.greetingRow}>
          <View style={{ flex: 1 }}>
            <Text testID="home-greeting" style={{ color: colors.text, fontSize: fontSizes.xxl, fontWeight: '700' }}>
              {greeting}
              {nameSuffix}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: 2 }}>
              {formatDateWithWeekday(now)}
            </Text>
          </View>
          <Pressable
            testID="home-replan-button"
            accessibilityRole="button"
            accessibilityLabel="Перепланировать день"
            onPress={() => router.push('/replan')}
            style={[styles.replanButton, { backgroundColor: colors.primarySoft, borderRadius: 14 }]}
          >
            <Ionicons name="git-compare-outline" size={20} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: fontSizes.xs + 1, fontWeight: '700' }}>План</Text>
          </Pressable>
        </View>

        {/* Пустое состояние для нового пользователя */}
        {!data.hasAnyContent ? (
          <Card style={{ marginTop: spacing.lg }}>
            <EmptyState
              testID="home-empty"
              icon="school-outline"
              title="Добро пожаловать в StudySync"
              subtitle="Добавьте первый предмет, занятие или задачу — приложение поможет составлять реалистичный учебный план и успевать к дедлайнам."
              actionLabel="Добавить предмет"
              onAction={() => router.push('/subject/edit')}
            />
            <View style={styles.emptyActionsRow}>
              <Button title="Новая задача" variant="secondary" size="sm" icon="add" onPress={() => router.push('/task/edit')} style={{ flex: 1 }} />
              <Button title="Новое занятие" variant="secondary" size="sm" icon="calendar" onPress={() => router.push('/event/edit')} style={{ flex: 1 }} />
            </View>
          </Card>
        ) : (
          <>
            {/* Активный таймер */}
            {timerActive && timer.view.phase !== 'none' ? (
              <View style={{ marginTop: spacing.lg }}>
                <TimerMiniCard
                  testID="home-timer-card"
                  phase={timer.view.phase === 'break' ? 'break' : 'work'}
                  remainingLabel={formatRemaining(timer.view.phaseRemainingMs)}
                  elapsedLabel={formatSecondsClock(Math.floor(timer.view.totalWorkMs / 1000))}
                  taskTitle={data.taskTitle}
                  onPress={() => router.push('/focus')}
                />
              </View>
            ) : null}

            {/* Статистика дня */}
            {show('stats') ? (
              <View style={[styles.statRow, { marginTop: spacing.lg }]}>
                <StatTile
                  testID="home-stat-done"
                  icon="checkmark-done"
                  color={colors.success}
                  value={`${data.doneToday}/${data.todayTasks.length}`}
                  label="задач выполнено сегодня"
                />
                <StatTile
                  testID="home-stat-focus"
                  icon="timer-outline"
                  color={colors.primary}
                  value={formatDurationMinutes(data.focusMinutesToday)}
                  label={dailyGoal > 0 ? `цель ${formatDurationMinutes(dailyGoal)}${goalReached ? ' · достигнута' : ''}` : 'фокус сегодня'}
                />
                <StatTile
                  testID="home-stat-planned"
                  icon="albums-outline"
                  color={colors.info}
                  value={formatDurationMinutes(data.plannedMinutesToday)}
                  label="запланировано на сегодня"
                />
              </View>
            ) : null}

            {/* Загруженность дня */}
            {show('dayload') ? (
              <Card style={{ marginTop: show('stats') ? spacing.md : spacing.lg }} testID="home-dayload">
                <DayLoadBar load={data.dayLoad} onPress={data.dayLoad.level === 'overload' ? () => router.push('/replan') : undefined} />
              </Card>
            ) : null}

            {/* Просроченные */}
            {data.overdue.length > 0 ? (
              <>
                <SectionTitle title="Просрочено" testID="home-overdue-title" />
                <Card>
                  <View style={styles.overdueHeader}>
                    <Ionicons name="alert-circle" size={16} color={colors.danger} />
                    <Text style={{ color: colors.danger, fontSize: fontSizes.sm, fontWeight: '600', flex: 1 }}>
                      {data.overdue.length} задач(и) ждут решения — перенесите срок или перепланируйте день
                    </Text>
                  </View>
                  {data.overdue.slice(0, 3).map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      now={now}
                      compact
                      testID={`home-overdue-${t.id}`}
                      onPress={() => router.push(`/task/${t.id}`)}
                    />
                  ))}
                </Card>
              </>
            ) : null}

            {/* Ближайшие занятия */}
            {show('lessons') && data.nextEvents.length > 0 ? (
              <>
                <SectionTitle
                  title="Ближайшие занятия"
                  actionLabel="Расписание"
                  action={() => router.push('/(tabs)/schedule')}
                />
                {data.nextEvents.map((e) => (
                  <EventCard
                    key={e.id}
                    event={e}
                    hasConflict={data.conflictIds.has(e.id)}
                    onPress={() => router.push({ pathname: '/event/edit', params: { eventId: e.id } })}
                    testID={`home-event-${e.id}`}
                  />
                ))}
              </>
            ) : null}

            {/* Долги и отработки: ближайшие два */}
            {show('debts') && data.debts.length > 0 ? (
              <>
                <SectionTitle
                  title={`Долги · ${data.debts.length}`}
                  actionLabel="Все"
                  action={() => router.push('/debts')}
                  testID="home-debts-title"
                />
                {data.debts.slice(0, 2).map((d) => (
                  <DebtCard
                    key={d.id}
                    debt={d}
                    now={now}
                    compact
                    testID={`home-debt-${d.id}`}
                    onPress={() => router.push('/debts')}
                  />
                ))}
              </>
            ) : null}

            {/* Задачи на сегодня */}
            <SectionTitle
              title="Сегодня"
              actionLabel="Все задачи"
              action={() => router.push('/(tabs)/tasks')}
              testID="home-today-title"
            />
            {data.todayTasks.length === 0 ? (
              <Card>
                <EmptyState
                  icon="cafe-outline"
                  title="На сегодня задач нет"
                  subtitle="Можно отдохнуть или добавить задачу наперёд"
                  actionLabel="Добавить задачу"
                  onAction={() => router.push('/task/edit')}
                />
              </Card>
            ) : (
              data.todayTasks.slice(0, 6).map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  now={now}
                  testID={`home-task-${t.id}`}
                  onPress={() => router.push(`/task/${t.id}`)}
                  onToggleDone={() => void toggleDone(t.id)}
                  onFocus={() => router.push({ pathname: '/focus', params: { taskId: t.id } })}
                />
              ))
            )}

            {/* Высокий приоритет */}
            {show('priority') && data.highPriority.length > 0 ? (
              <>
                <SectionTitle title="Высокий приоритет" />
                {data.highPriority.map((t) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    now={now}
                    compact
                    testID={`home-hp-${t.id}`}
                    onPress={() => router.push(`/task/${t.id}`)}
                    onToggleDone={() => void toggleDone(t.id)}
                  />
                ))}
              </>
            ) : null}

            {/* Ближайшие дедлайны */}
            {show('deadlines') && data.upcomingDeadlines.length > 0 ? (
              <>
                <SectionTitle title="Ближайшие дедлайны" />
                <Card>
                  {data.upcomingDeadlines.map((t, idx) => (
                    <Pressable
                      key={t.id}
                      accessibilityRole="button"
                      onPress={() => router.push(`/task/${t.id}`)}
                      style={[
                        styles.deadlineRow,
                        idx < data.upcomingDeadlines.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: colors.borderSoft,
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '500' }}>
                          {t.title}
                        </Text>
                        <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: 1 }}>
                          {t.deadlineAt ? relativeDayLabel(t.deadlineAt, now) : ''}
                        </Text>
                      </View>
                      <Badge label={formatDurationMinutes(t.plannedMinutes)} color={colors.textSecondary} />
                    </Pressable>
                  ))}
                </Card>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Плавающая кнопка быстрого добавления */}
      <Pressable
        testID="home-fab"
        accessibilityRole="button"
        accessibilityLabel="Быстро добавить задачу"
        onPress={() => router.push('/task/edit')}
        style={({ pressed }) => [
          styles.fab,
          { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1, bottom: 24 },
        ]}
      >
        <Ionicons name="add" size={28} color={colors.onPrimary} />
      </Pressable>
    </Screen>
  );

  async function toggleDone(taskId: string) {
    try {
      await toggleTaskDone(db, taskId);
      bump();
      await load();
    } catch {
      // ошибка уже логируется на уровне репозитория
    }
  }
}

const styles = StyleSheet.create({
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 8,
  },
  replanButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  statRow: {
    flexDirection: 'row',
    gap: 8,
  },
  overdueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  deadlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  emptyActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
});
