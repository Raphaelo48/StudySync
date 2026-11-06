/**
 * Карточка задачи: статус, подзадачи, действия (фокус, перенос, редактирование,
 * удаление с подтверждением), история учебных сессий.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/ui/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { Badge, Button, Card, IconButton, SectionTitle, Spinner } from '../../src/components/ui/primitives';
import { SegmentedControl } from '../../src/components/ui/inputs';
import { BottomSheet, ConfirmDialog } from '../../src/components/ui/overlays';
import { DateTimeField } from '../../src/components/ui/DateTimeField';
import { useDataVersion, useDatabase, useTheme, useToast } from '../../src/state/AppContexts';
import {
  DAY_MS,
  addDays,
  formatDateFull,
  formatDateShort,
  formatDateWithWeekday,
  formatDurationMinutes,
  formatTime,
} from '../../src/core/time';
import {
  DIFFICULTY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type StudySession,
  type Subtask,
  type TaskPriority,
  type TaskStatus,
  type TaskWithSubject,
} from '../../src/models/types';
import { priorityColor, statusColor } from '../../src/theme/tokens';
import { validateShortText } from '../../src/logic/validation';
import { cancelTaskNotification, syncTaskDeadlineNotification } from '../../src/notifications/scheduler';
import { getNotificationClient } from '../../src/notifications/client';
import { useSettings } from '../../src/state/AppContexts';

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors, fontSizes, spacing, radii } = useTheme();
  const { settings } = useSettings();
  const db = useDatabase();
  const toast = useToast();
  const { version, bump } = useDataVersion();

  const [task, setTask] = useState<TaskWithSubject | null>(null);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [sessions, setSessions] = useState<StudySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [newSubtask, setNewSubtask] = useState('');
  const [deferSheet, setDeferSheet] = useState(false);
  const [deferDate, setDeferDate] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notFound, setNotFound] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    const [t, subs, sess] = await Promise.all([
      db.tasks.get(id),
      db.subtasks.listByTask(id),
      db.sessions.listByTask(id),
    ]);
    if (!t) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    setTask(t);
    setSubtasks(subs);
    setSessions(sess);
    setLoading(false);
  }, [db, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version])
  );

  const addSubtask = async () => {
    const check = validateShortText(newSubtask, 'Подзадача');
    if (!check.ok) {
      toast.error(check.errors.value ?? 'Некорректный текст');
      return;
    }
    if (!id) return;
    await db.subtasks.create(id, check.value);
    setNewSubtask('');
    bump();
    await load();
  };

  const toggleSubtask = async (subtaskId: string) => {
    await db.subtasks.toggle(subtaskId);
    await load();
  };

  const deleteSubtask = async (subtaskId: string) => {
    await db.subtasks.delete(subtaskId);
    await load();
  };

  const changeStatus = async (status: TaskStatus) => {
    if (!task) return;
    const now = Date.now();
    const updated = await db.tasks.setStatus(task.id, status, { now });
    if (updated) {
      setTask({ ...task, ...updated });
      if (status === 'done') {
        await cancelTaskNotification(getNotificationClient(), task.id);
        toast.success('Задача выполнена', {
          label: 'Отменить',
          onPress: () => {
            void db.tasks.setStatus(task.id, task.status, { now: Date.now() }).then(async () => {
              bump();
              await load();
            });
          },
        });
      } else {
        await syncTaskDeadlineNotification(getNotificationClient(), settings, updated, now);
      }
      bump();
    }
  };

  const changePriority = async (priority: TaskPriority) => {
    if (!task) return;
    const updated = await db.tasks.update(task.id, { priority });
    if (updated) {
      setTask({ ...task, ...updated });
      bump();
    }
  };

  const applyDefer = async (target: number | null) => {
    if (!task) return;
    const now = Date.now();
    const updated = await db.tasks.defer(task.id, target, now);
    if (updated) {
      await syncTaskDeadlineNotification(getNotificationClient(), settings, updated, now);
      toast.success(target ? `Срок перенесён на ${formatDateFull(target)}` : 'Срок снят');
      setDeferSheet(false);
      bump();
      await load();
    }
  };

  const deleteTask = async () => {
    if (!task) return;
    try {
      await cancelTaskNotification(getNotificationClient(), task.id);
      await db.tasks.delete(task.id);
      toast.success('Задача удалена');
      bump();
      router.back();
    } catch {
      toast.error('Не удалось удалить задачу');
    }
  };

  if (loading) {
    return (
      <Screen testID="task-detail-screen">
        <Spinner testID="task-detail-loading" />
      </Screen>
    );
  }

  if (notFound || !task) {
    return (
      <Screen testID="task-detail-screen">
        <ScreenHeader title="Задача" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: colors.textSecondary }}>Задача не найдена — возможно, она была удалена</Text>
          <Button title="Назад к задачам" variant="secondary" style={{ marginTop: 16 }} onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  const done = task.status === 'done';
  const overdue = !done && task.deadlineAt != null && task.deadlineAt < Date.now();
  const subtasksDone = subtasks.filter((s) => s.done).length;
  const totalSessionMinutes = Math.round(sessions.reduce((sum, s) => sum + s.activeSeconds / 60, 0));

  return (
    <Screen testID="task-detail-screen">
      <ScreenHeader
        title="Задача"
        testID="task-detail-header"
        right={
          <View style={{ flexDirection: 'row' }}>
            <IconButton
              icon="create-outline"
              accessibilityLabel="Редактировать задачу"
              onPress={() => router.push({ pathname: '/task/edit', params: { taskId: task.id } })}
              testID="task-edit-button"
            />
            <IconButton
              icon="trash-outline"
              accessibilityLabel="Удалить задачу"
              color={colors.danger}
              onPress={() => setConfirmDelete(true)}
              testID="task-delete-button"
            />
          </View>
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        <Text style={{ color: colors.text, fontSize: fontSizes.xxl, fontWeight: '700' }}>{task.title}</Text>
        <View style={styles.badgeRow}>
          <Badge label={STATUS_LABELS[task.status]} color={statusColor(colors, task.status)} />
          <Badge label={`Приоритет: ${PRIORITY_LABELS[task.priority]}`} color={priorityColor(colors, task.priority)} icon="flag-outline" />
          <Badge label={DIFFICULTY_LABELS[task.difficulty]} color={colors.textSecondary} />
          {task.subject ? <Badge label={task.subject.name} color={task.subject.color} /> : null}
        </View>

        {/* Статус */}
        <View style={{ marginTop: spacing.lg }}>
          <SegmentedControl<TaskStatus>
            testID="task-status"
            value={task.status}
            onChange={(v) => void changeStatus(v)}
            options={[
              { value: 'planned', label: 'План' },
              { value: 'in_progress', label: 'В работе' },
              { value: 'done', label: 'Готово' },
              { value: 'deferred', label: 'Отложена' },
            ]}
          />
        </View>

        {/* Ключевые факты */}
        <Card style={{ marginTop: spacing.lg }}>
          <FactRow icon="calendar-outline" label="Дедлайн" testID="task-deadline-fact">
            {task.deadlineAt ? (
              <Text style={[styles.factValue, { color: overdue ? colors.danger : colors.text }]}>
                {formatDateWithWeekday(task.deadlineAt)}, {formatTime(task.deadlineAt)}
                {overdue ? ' · просрочено' : ''}
              </Text>
            ) : (
              <Text style={[styles.factValue, { color: colors.textMuted }]}>Не задан</Text>
            )}
          </FactRow>
          <FactRow icon="hourglass-outline" label="План / факт">
            <Text style={[styles.factValue, { color: colors.text }]}>
              {formatDurationMinutes(task.plannedMinutes)}
              {task.actualMinutes > 0 ? ` / ${formatDurationMinutes(task.actualMinutes)}` : ''}
            </Text>
          </FactRow>
          <FactRow icon="time-outline" label="Создана">
            <Text style={[styles.factValue, { color: colors.text }]}>{formatDateFull(task.createdAt)}</Text>
          </FactRow>
          {task.deferCount > 0 ? (
            <FactRow icon="swap-horizontal-outline" label="Переносов срока">
              <Text style={[styles.factValue, { color: colors.text }]}>{task.deferCount}</Text>
            </FactRow>
          ) : null}
          {task.scheduledStartAt && task.scheduledEndAt ? (
            <FactRow icon="git-compare-outline" label="Запланировано">
              <Text style={[styles.factValue, { color: colors.text }]}>
                {formatDateFull(task.scheduledStartAt)}, {formatTime(task.scheduledStartAt)}–{formatTime(task.scheduledEndAt)}
              </Text>
            </FactRow>
          ) : null}
        </Card>

        {/* Действия */}
        <View style={[styles.actionRow, { marginTop: spacing.lg }]}>
          <Button
            testID="task-focus-button"
            title={done ? 'Сессия' : 'Начать фокус'}
            icon="play"
            style={{ flex: 1 }}
            onPress={() => router.push({ pathname: '/focus', params: { taskId: task.id } })}
          />
          <Button
            testID="task-defer-button"
            title="Перенести срок"
            icon="calendar-outline"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => {
              setDeferDate(task.deadlineAt ? addDays(task.deadlineAt, 1) : null);
              setDeferSheet(true);
            }}
          />
        </View>

        {/* Описание */}
        {task.description ? (
          <>
            <SectionTitle title="Описание" />
            <Card>
              <Text style={{ color: colors.textSecondary, fontSize: fontSizes.md, lineHeight: 22 }}>{task.description}</Text>
            </Card>
          </>
        ) : null}

        {/* Подзадачи */}
        <SectionTitle title={`Подзадачи${subtasks.length > 0 ? ` · ${subtasksDone}/${subtasks.length}` : ''}`} />
        <Card>
          {subtasks.length === 0 ? (
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
              Разбейте задачу на шаги — так проще начать и отслеживать прогресс
            </Text>
          ) : (
            subtasks.map((s) => (
              <View key={s.id} style={[styles.subtaskRow, { borderBottomColor: colors.borderSoft }]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: s.done }}
                  accessibilityLabel={s.title}
                  onPress={() => void toggleSubtask(s.id)}
                  hitSlop={8}
                >
                  <Ionicons
                    name={s.done ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color={s.done ? colors.success : colors.textMuted}
                  />
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text
                    numberOfLines={2}
                    style={{
                      color: s.done ? colors.textMuted : colors.text,
                      fontSize: fontSizes.md,
                      textDecorationLine: s.done ? 'line-through' : 'none',
                    }}
                  >
                    {s.title}
                  </Text>
                  {s.dueAt != null ? (
                    <Text
                      style={{
                        color: !s.done && s.dueAt < Date.now() ? colors.danger : colors.textMuted,
                        fontSize: fontSizes.xs + 1,
                        marginTop: 1,
                      }}
                    >
                      {!s.done && s.dueAt < Date.now() ? 'просрочено · ' : 'до '}
                      {formatDateShort(s.dueAt)}
                    </Text>
                  ) : null}
                </View>
                <IconButton
                  icon="close"
                  accessibilityLabel={`Удалить подзадачу ${s.title}`}
                  color={colors.textMuted}
                  size={16}
                  onPress={() => void deleteSubtask(s.id)}
                />
              </View>
            ))
          )}
          <View style={[styles.subtaskInputRow, { borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surfaceAlt }]}>
            <TextInput
              testID="subtask-input"
              value={newSubtask}
              onChangeText={setNewSubtask}
              placeholder="Новый шаг…"
              placeholderTextColor={colors.textMuted}
              onSubmitEditing={() => void addSubtask()}
              returnKeyType="done"
              style={{ flex: 1, color: colors.text, fontSize: fontSizes.md, paddingVertical: 10, paddingHorizontal: 12 }}
            />
            <IconButton icon="add-circle" accessibilityLabel="Добавить подзадачу" color={colors.primary} onPress={() => void addSubtask()} testID="subtask-add" />
          </View>
        </Card>

        {/* Сессии */}
        <SectionTitle title={`Учебные сессии${sessions.length > 0 ? ` · ${formatDurationMinutes(totalSessionMinutes)}` : ''}`} />
        {sessions.length === 0 ? (
          <Card>
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm }}>
              Сессий пока не было. Нажмите «Начать фокус», чтобы измерить фактическое время.
            </Text>
          </Card>
        ) : (
          <Card>
            {sessions.map((s, i) => (
              <View key={s.id} style={[styles.subtaskRow, i < sessions.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSoft }]}>
                <Ionicons name="timer-outline" size={17} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '500' }}>
                    {formatDurationMinutes(s.activeSeconds / 60)}
                    {s.breakSeconds > 0 ? ` + ${formatDurationMinutes(s.breakSeconds / 60)} перерыв` : ''}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1 }}>
                    {formatDateFull(s.startedAt)}, {formatTime(s.startedAt)}
                  </Text>
                </View>
                {s.completed ? <Badge label="Цикл завершён" color={colors.success} /> : null}
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      {/* Перенос срока */}
      <BottomSheet visible={deferSheet} title="Перенести дедлайн" onClose={() => setDeferSheet(false)}>
        <View style={{ paddingBottom: 12 }}>
          <View style={styles.quickDeferRow}>
            {[
              { label: '+1 день', days: 1 },
              { label: '+3 дня', days: 3 },
              { label: '+неделя', days: 7 },
            ].map((opt) => (
              <Pressable
                key={opt.days}
                accessibilityRole="button"
                testID={`defer-plus-${opt.days}`}
                onPress={() => {
                  const base = task.deadlineAt && task.deadlineAt > Date.now() ? task.deadlineAt : Date.now();
                  void applyDefer(addDays(base, opt.days));
                }}
                style={[styles.quickDeferChip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radii.md }]}
              >
                <Text style={{ color: colors.text, fontSize: fontSizes.sm, fontWeight: '600' }}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
          <DateTimeField
            testID="defer-date"
            label="Или выберите дату и время"
            value={deferDate}
            onChange={setDeferDate}
            allowClear={false}
            minDate={Date.now()}
          />
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button title="Убрать срок" variant="secondary" style={{ flex: 1 }} onPress={() => void applyDefer(null)} />
            <Button title="Перенести" style={{ flex: 1 }} disabled={deferDate == null} onPress={() => deferDate != null && void applyDefer(deferDate)} />
          </View>
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={confirmDelete}
        title="Удалить задачу?"
        message={`«${task.title}» будет удалена вместе с подзадачами (${subtasks.length}). Учебные сессии сохранятся в статистике. Действие нельзя отменить.`}
        confirmLabel="Удалить"
        danger
        testID="task-delete-confirm"
        onConfirm={() => void deleteTask()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

function FactRow({
  icon,
  label,
  children,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  children: React.ReactNode;
  testID?: string;
}) {
  const { colors, fontSizes, spacing } = useTheme();
  return (
    <View testID={testID} style={[styles.factRow, { paddingBottom: spacing.md }]}>
      <Ionicons name={icon} size={16} color={colors.textMuted} />
      <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, width: 120 }}>{label}</Text>
      <View style={{ flex: 1, alignItems: 'flex-end' }}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  factValue: {
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  subtaskInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 10,
    paddingRight: 4,
  },
  quickDeferRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  quickDeferChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderWidth: 1,
  },
});
