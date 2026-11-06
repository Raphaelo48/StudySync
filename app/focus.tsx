/**
 * Экран учебной сессии: выбор задачи, Pomodoro/секундомер, таймер с корректным
 * восстановлением по меткам времени, итоги сессии.
 *
 * Состояние таймера живёт в TimerProvider (персистентно в SQLite), поэтому
 * сворачивание и закрытие приложения не сбивают учёт активного времени.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import Svg, { Circle, G } from 'react-native-svg';
import { activateKeepAwake, deactivateKeepAwake } from 'expo-keep-awake';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Button, Card } from '../src/components/ui/primitives';
import { NumberStepper, SegmentedControl, SelectField } from '../src/components/ui/inputs';
import { BottomSheet } from '../src/components/ui/overlays';
import { useDatabase, useSettings, useTheme, useToast } from '../src/state/AppContexts';
import { useTimer } from '../src/state/TimerContext';
import { formatDurationMinutes, formatSecondsClock } from '../src/core/time';
import type { FinishSessionResult } from '../src/logic/sessionService';
import type { SessionMode, TaskWithSubject } from '../src/models/types';
import { useDataVersion } from '../src/state/AppContexts';

const RING_SIZE = 260;
const RING_STROKE = 14;

export default function FocusScreen() {
  const params = useLocalSearchParams<{ taskId?: string }>();
  const { colors, fontSizes, spacing } = useTheme();
  const { settings } = useSettings();
  const db = useDatabase();
  const toast = useToast();
  const timer = useTimer();
  const { bump } = useDataVersion();

  const [tasks, setTasks] = useState<TaskWithSubject[]>([]);
  const [taskId, setTaskId] = useState<string | null>(params.taskId ?? null);
  const [mode, setMode] = useState<SessionMode>('pomodoro');
  const [workMin, setWorkMin] = useState(settings.defaultWorkMin);
  const [breakMin, setBreakMin] = useState(settings.defaultBreakMin);
  const [summary, setSummary] = useState<FinishSessionResult | null>(null);

  const running = timer.view.status === 'running';
  useEffect(() => {
    if (!running) return;
    void activateKeepAwake('focus-session');
    return () => {
      void deactivateKeepAwake('focus-session');
    };
  }, [running]);

  useEffect(() => {
    (async () => {
      const active = await db.tasks.list({ status: 'active' });
      setTasks(active);
      if (!taskId && timer.state.taskId) setTaskId(timer.state.taskId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  const selectedTask = useMemo(() => tasks.find((t) => t.id === (timer.isActive ? timer.state.taskId : taskId)) ?? null, [tasks, taskId, timer.isActive, timer.state.taskId]);

  const startSession = async () => {
    try {
      await timer.startWithDurations({
        mode,
        taskId,
        subjectId: selectedTask?.subjectId ?? null,
        workSec: Math.max(1, workMin) * 60,
        breakSec: Math.max(1, breakMin) * 60,
        longBreakSec: Math.max(1, settings.defaultLongBreakMin) * 60,
        cyclesBeforeLongBreak: settings.cyclesBeforeLongBreak,
      });
    } catch {
      toast.error('Не удалось запустить таймер');
    }
  };

  const finishSession = async () => {
    const result = await timer.finish();
    if (!result) {
      toast.error('Не удалось завершить сессию');
      return;
    }
    bump();
    if (result.saved && result.session) {
      setSummary(result);
    } else {
      toast.info(result.reason ?? 'Сессия завершена');
    }
  };

  const view = timer.view;
  const phaseLabel =
    view.phase === 'work' ? 'Фокус' : view.phase === 'break' ? 'Перерыв' : 'Готовы начать?';
  const tint = view.phase === 'break' ? colors.success : colors.primary;
  const progress =
    view.phasePlannedMs && view.phasePlannedMs > 0
      ? Math.min(1, view.phaseElapsedMs / view.phasePlannedMs)
      : 0;
  const clockText =
    view.phaseRemainingMs != null
      ? formatSecondsClock(Math.ceil(view.phaseRemainingMs / 1000))
      : formatSecondsClock(Math.floor(view.phaseElapsedMs / 1000));

  return (
    <Screen testID="focus-screen">
      <ScreenHeader
        title="Фокус"
        testID="focus-header"
        right={
          timer.isActive ? undefined : (
            <View style={{ width: 40 }} />
          )
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48, alignItems: 'stretch' }}>
        {!timer.isActive ? (
          <>
            {/* Настройка сессии */}
            <SelectField
              testID="focus-task"
              label="Задача (необязательно)"
              options={tasks.map((t) => ({
                value: t.id,
                label: t.subject ? `${t.title} · ${t.subject.name}` : t.title,
                color: t.subject?.color,
              }))}
              value={taskId}
              onChange={setTaskId}
              allowClear
              clearLabel="Без задачи (свободная сессия)"
            />
            <SegmentedControl<SessionMode>
              testID="focus-mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'pomodoro', label: 'Pomodoro', icon: 'timer-outline' },
                { value: 'stopwatch', label: 'Секундомер', icon: 'stopwatch-outline' },
              ]}
            />
            <View style={{ height: spacing.lg }} />
            {mode === 'pomodoro' ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <NumberStepper
                    testID="focus-work-min"
                    label="Работа, мин"
                    value={workMin}
                    onChange={setWorkMin}
                    min={5}
                    max={120}
                    step={5}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <NumberStepper
                    testID="focus-break-min"
                    label="Перерыв, мин"
                    value={breakMin}
                    onChange={setBreakMin}
                    min={1}
                    max={30}
                    step={1}
                  />
                </View>
              </View>
            ) : (
              <Card>
                <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 20 }}>
                  Секундомер считает всё время от старта до завершения как активную работу. Пауза не учитывается.
                </Text>
              </Card>
            )}
            <Button testID="focus-start" title="Начать сессию" size="lg" icon="play" onPress={() => void startSession()} />
          </>
        ) : (
          <>
            {/* Активная сессия */}
            <View style={styles.ringWrap}>
              <TimerRing progress={view.mode === 'stopwatch' ? 0 : progress} tint={tint} />
              <View style={styles.ringCenter}>
                <Text style={{ color: tint, fontSize: fontSizes.sm, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
                  {phaseLabel}
                </Text>
                <Text
                  testID="focus-clock"
                  style={{
                    color: colors.text,
                    fontSize: 52,
                    fontWeight: '700',
                    fontVariant: ['tabular-nums'],
                    marginTop: 2,
                  }}
                >
                  {clockText}
                </Text>
                {view.phasePlannedMs != null ? (
                  <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
                    из {formatSecondsClock(Math.floor(view.phasePlannedMs / 1000))}
                  </Text>
                ) : null}
                {selectedTask ? (
                  <Text numberOfLines={1} style={{ color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: 6, maxWidth: 200 }}>
                    {selectedTask.title}
                  </Text>
                ) : (
                  <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: 6 }}>Свободная сессия</Text>
                )}
              </View>
            </View>

            {/* Циклы */}
            {view.mode === 'pomodoro' ? (
              <View style={styles.cyclesRow}>
                {Array.from({ length: Math.max(4, settings.cyclesBeforeLongBreak) }, (_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.cycleDot,
                      { backgroundColor: i < view.completedCycles ? colors.primary : colors.track },
                    ]}
                  />
                ))}
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginLeft: 8 }}>
                  циклов: {view.completedCycles}
                </Text>
              </View>
            ) : null}

            {/* Итоги текущего времени */}
            <View style={styles.statsRow}>
              <View style={[styles.statBox, { backgroundColor: colors.surfaceAlt, borderRadius: 12 }]}>
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>Активное время</Text>
                <Text testID="focus-total-work" style={{ color: colors.text, fontSize: fontSizes.lg, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {formatSecondsClock(Math.floor(view.totalWorkMs / 1000))}
                </Text>
              </View>
              <View style={[styles.statBox, { backgroundColor: colors.surfaceAlt, borderRadius: 12 }]}>
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>Перерывы</Text>
                <Text style={{ color: colors.text, fontSize: fontSizes.lg, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                  {formatSecondsClock(Math.floor(view.totalBreakMs / 1000))}
                </Text>
              </View>
            </View>

            {/* Управление */}
            <View style={styles.controlsRow}>
              {view.status === 'running' ? (
                <Button testID="focus-pause" title="Пауза" variant="secondary" icon="pause" size="lg" style={{ flex: 1 }} onPress={() => void timer.pause()} />
              ) : (
                <Button testID="focus-resume" title="Продолжить" icon="play" size="lg" style={{ flex: 1 }} onPress={() => void timer.resume()} />
              )}
              <Button testID="focus-finish" title="Завершить" variant="danger" icon="stop" size="lg" style={{ flex: 1 }} onPress={() => void finishSession()} />
            </View>
            {view.phase === 'break' ? (
              <Button testID="focus-skip-break" title="Пропустить перерыв" variant="ghost" icon="play-skip-forward" style={{ marginTop: spacing.sm }} onPress={() => void timer.skipBreak()} />
            ) : null}
            {view.awaitingNextCycle ? (
              <Card style={{ marginTop: spacing.md, backgroundColor: colors.primarySoft }}>
                <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, lineHeight: 19 }}>
                  Цикл завершён. Нажмите «Продолжить», чтобы начать следующий помидор, или «Завершить», чтобы записать сессию.
                </Text>
              </Card>
            ) : null}
            <View style={{ height: spacing.md }} />
            {running ? (
              <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, textAlign: 'center' }}>
                Таймер продолжит работу, даже если свернуть приложение
              </Text>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Итоги сессии */}
      <BottomSheet
        visible={summary != null}
        title="Сессия завершена"
        onClose={() => {
          setSummary(null);
          router.back();
        }}
        testID="focus-summary"
      >
        {summary ? (
          <View style={{ paddingBottom: 16 }}>
            <View style={styles.summaryRow}>
              <SummaryStat label="Активная работа" value={formatDurationMinutes(summary.summary.activeSeconds / 60)} color={colors.primary} />
              <SummaryStat label="Перерывы" value={formatDurationMinutes(summary.summary.breakSeconds / 60)} color={colors.success} />
              <SummaryStat label="Завершено циклов" value={String(summary.summary.completedCycles)} color={colors.info} />
            </View>
            {selectedTask ? (
              <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: spacing.md, lineHeight: 19 }}>
                Фактическое время добавлено к задаче «{selectedTask.title}»
                {summary.summary.completedCycles === 0 ? '. Незавершённые циклы тоже учтены как активная работа.' : '.'}
              </Text>
            ) : (
              <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, marginTop: spacing.md, lineHeight: 19 }}>
                Сессия сохранена без привязки к задаче и учтена в общей статистике.
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10, marginTop: spacing.lg }}>
              <Button
                title="К задаче"
                variant="secondary"
                style={{ flex: 1 }}
                disabled={!timer.state.taskId && !selectedTask}
                onPress={() => {
                  const id = selectedTask?.id;
                  setSummary(null);
                  if (id) router.replace(`/task/${id}`);
                  else router.back();
                }}
              />
              <Button
                title="Готово"
                style={{ flex: 1 }}
                onPress={() => {
                  setSummary(null);
                  router.back();
                }}
              />
            </View>
          </View>
        ) : null}
      </BottomSheet>
    </Screen>
  );
}

function TimerRing({ progress, tint }: { progress: number; tint: string }) {
  const { colors } = useTheme();
  const r = (RING_SIZE - RING_STROKE) / 2;
  const c = 2 * Math.PI * r;
  return (
    <Svg width={RING_SIZE} height={RING_SIZE}>
      <G rotation={-90} originX={RING_SIZE / 2} originY={RING_SIZE / 2}>
        <Circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={r} stroke={colors.track} strokeWidth={RING_STROKE} fill="none" />
        <Circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={r}
          stroke={tint}
          strokeWidth={RING_STROKE}
          fill="none"
          strokeDasharray={`${c * progress} ${c}`}
          strokeLinecap="round"
        />
      </G>
    </Svg>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: string; color: string }) {
  const { colors, fontSizes } = useTheme();
  return (
    <View style={styles.summaryStat}>
      <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>{label}</Text>
      <Text style={{ color, fontSize: fontSizes.xl, fontWeight: '700', marginTop: 2 }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  ringWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 12,
  },
  ringCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cyclesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  cycleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 3,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statBox: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    gap: 2,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryStat: {
    flex: 1,
    alignItems: 'center',
  },
});
