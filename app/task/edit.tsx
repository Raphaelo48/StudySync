/**
 * Форма задачи: создание и редактирование.
 * Валидация — src/logic/validation.ts. Дедлайн в прошлом не допускается
 * (для существующих просроченных задач редактирование срока возможно
 * через явное действие «перенести» на карточке задачи).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/ui/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { Button, Card } from '../../src/components/ui/primitives';
import { NumberStepper, SegmentedControl, SelectField, SwitchRow, TextField } from '../../src/components/ui/inputs';
import { DateTimeField } from '../../src/components/ui/DateTimeField';
import { BottomSheet } from '../../src/components/ui/overlays';
import { useDataVersion, useDatabase, useSettings, useTheme, useToast } from '../../src/state/AppContexts';
import { validateTaskForm, type FieldErrors } from '../../src/logic/validation';
import { SUBJECT_COLORS, type Subject } from '../../src/models/types';
import { syncTaskDeadlineNotification } from '../../src/notifications/scheduler';
import { getNotificationClient } from '../../src/notifications/client';
import { TASK_TEMPLATES, getTemplate, isCompressed, planStages, templateTitle, type TaskTemplate } from '../../src/logic/taskTemplates';
import { formatDateShort, formatTime } from '../../src/core/time';

export default function TaskEditScreen() {
  const params = useLocalSearchParams<{ taskId?: string; template?: string }>();
  const editingId = params.taskId ?? null;

  const { colors, fontSizes, spacing } = useTheme();
  const { settings } = useSettings();
  const db = useDatabase();
  const toast = useToast();
  const { bump } = useDataVersion();

  const [loading, setLoading] = useState(!!editingId);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [hasDeadline, setHasDeadline] = useState(false);
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [originalDeadlineAt, setOriginalDeadlineAt] = useState<number | null>(null);
  const [plannedMinutes, setPlannedMinutes] = useState(30);
  const [difficulty, setDifficulty] = useState<1 | 2 | 3>(2);
  const [priority, setPriority] = useState<1 | 2 | 3>(2);

  const [templateId, setTemplateId] = useState<string | null>(params.template ?? null);
  const [autoTitle, setAutoTitle] = useState<string | null>(null);
  const template = getTemplate(templateId);

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectSheet, setSubjectSheet] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState('');
  const [newSubjectColor, setNewSubjectColor] = useState(SUBJECT_COLORS[0]!);

  useEffect(() => {
    (async () => {
      const subs = await db.subjects.list();
      setSubjects(subs);
      if (editingId) {
        const task = await db.tasks.get(editingId);
        if (!task) {
          toast.error('Задача не найдена');
          router.back();
          return;
        }
        setTitle(task.title);
        setDescription(task.description ?? '');
        setSubjectId(task.subjectId);
        setHasDeadline(task.deadlineAt != null);
        setDeadlineAt(task.deadlineAt);
        setOriginalDeadlineAt(task.deadlineAt);
        setPlannedMinutes(task.plannedMinutes);
        setDifficulty(task.difficulty);
        setPriority(task.priority);
        setLoading(false);
      } else {
        // Разумные значения по умолчанию для новой задачи.
        setPlannedMinutes(Math.max(15, Math.round(settings.defaultWorkMin / 5) * 5));
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, editingId]);

  const subjectName = subjects.find((s) => s.id === subjectId)?.name ?? null;

  const applyTemplate = (t: TaskTemplate | null) => {
    setTemplateId(t?.id ?? null);
    if (!t) {
      if (autoTitle != null && title === autoTitle) setTitle('');
      setAutoTitle(null);
      return;
    }
    const nextTitle = templateTitle(t, subjectName);
    if (title.trim() === '' || title === autoTitle) {
      setTitle(nextTitle);
      setAutoTitle(nextTitle);
    }
    setPlannedMinutes(t.plannedMinutes);
    setDifficulty(t.difficulty);
    setPriority(t.priority);
    setHasDeadline(true);
    if (deadlineAt == null || deadlineAt < Date.now()) {
      // По умолчанию — полный срок шаблона, 10:00.
      const nominal = Math.max(...t.stages.map((s) => s.daysBefore), 1);
      const d = new Date(Date.now() + nominal * 86_400_000);
      d.setHours(10, 0, 0, 0);
      setDeadlineAt(d.getTime());
    }
  };

  // Название из шаблона следует за выбранным предметом, пока его не правили вручную.
  useEffect(() => {
    if (!template || autoTitle == null || title !== autoTitle) return;
    const next = templateTitle(template, subjectName);
    setTitle(next);
    setAutoTitle(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectName]);

  const stagePreview = useMemo(
    () => (template && hasDeadline && deadlineAt ? planStages(template, deadlineAt) : []),
    [template, hasDeadline, deadlineAt]
  );

  const subjectOptions = useMemo(
    () => subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
    [subjects]
  );

  const addSubject = async () => {
    const name = newSubjectName.trim();
    if (name.length === 0) {
      toast.error('Введите название предмета');
      return;
    }
    try {
      const created = await db.subjects.create({ name, color: newSubjectColor });
      setSubjects((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, 'ru')));
      setSubjectId(created.id);
      setNewSubjectName('');
      setSubjectSheet(false);
      bump();
      toast.success(`Предмет «${created.name}» добавлен`);
    } catch {
      toast.error('Не удалось добавить предмет');
    }
  };

  const save = async () => {
    setSaving(true);
    const result = validateTaskForm(
      {
        title,
        description,
        subjectId,
        hasDeadline,
        deadlineAt,
        plannedMinutes,
        difficulty,
        priority,
      },
      // При редактировании разрешаем оставить уже просроченный дедлайн без изменения
      // (перенос делается явным действием), но выбрать НОВОЕ время в прошлом нельзя.
      { allowPastDeadline: editingId != null && deadlineAt === originalDeadlineAt }
    );
    if (!result.ok) {
      setErrors(result.errors);
      setSaving(false);
      return;
    }
    setErrors({});
    try {
      const now = Date.now();
      if (editingId) {
        const updated = await db.tasks.update(editingId, result.value, now);
        if (updated) {
          await syncTaskDeadlineNotification(getNotificationClient(), settings, updated, now);
        }
        toast.success('Задача сохранена');
      } else {
        const created = await db.tasks.create(result.value, now);
        if (template && created.deadlineAt != null) {
          for (const stage of planStages(template, created.deadlineAt, now)) {
            await db.subtasks.create(created.id, stage.title, now, stage.dueAt);
          }
        }
        await syncTaskDeadlineNotification(getNotificationClient(), settings, created, now);
        toast.success(template ? `Создано: ${template.stages.length} этапов со сроками` : 'Задача создана');
      }
      bump();
      router.back();
    } catch (e) {
      toast.error('Не удалось сохранить задачу');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen testID="task-edit-screen">
        <ScreenHeader title="Задача" />
        <View />
      </Screen>
    );
  }

  return (
    <Screen testID="task-edit-screen" keyboardAvoiding>
      <ScreenHeader title={editingId ? 'Редактировать задачу' : 'Новая задача'} testID="task-edit-header" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        {!editingId ? (
          <>
            <Text style={labelStyle(colors.textSecondary, fontSizes.sm)}>Шаблон</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templates} style={{ marginBottom: spacing.lg }}>
              <TemplateChip label="Обычная задача" icon="checkbox-outline" selected={!template} onPress={() => applyTemplate(null)} testID="template-none" />
              {TASK_TEMPLATES.map((t) => (
                <TemplateChip
                  key={t.id}
                  label={t.name}
                  icon={t.icon}
                  selected={templateId === t.id}
                  onPress={() => applyTemplate(t)}
                  testID={`template-${t.id}`}
                />
              ))}
            </ScrollView>
          </>
        ) : null}
        <TextField
          testID="task-title-input"
          label="Название *"
          value={title}
          onChangeText={setTitle}
          placeholder="Например: подготовить реферат"
          error={errors.title}
          maxLength={120}
        />
        <TextField
          testID="task-description-input"
          label="Описание"
          value={description}
          onChangeText={setDescription}
          placeholder="Требования, материалы, ссылки…"
          multiline
          maxLength={2000}
        />

        <SelectField
          testID="task-subject-select"
          label="Предмет"
          options={subjectOptions}
          value={subjectId}
          onChange={setSubjectId}
          allowClear
          clearLabel="Без предмета"
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => setSubjectSheet(true)}
          style={styles.addSubjectLink}
        >
          <Ionicons name="add-circle-outline" size={15} color={colors.primary} />
          <Text style={{ color: colors.primary, fontSize: fontSizes.sm, fontWeight: '600' }}>Новый предмет</Text>
        </Pressable>

        <Card style={{ marginVertical: spacing.md, paddingVertical: spacing.sm }}>
          <SwitchRow
            testID="task-has-deadline"
            label="Дедлайн"
            description="Напоминание и учёт в перепланировании"
            value={hasDeadline}
            onValueChange={(v) => {
              setHasDeadline(v);
              if (v && deadlineAt == null) {
                const d = new Date(Date.now() + DAY_EVENING_OFFSET);
                d.setHours(20, 0, 0, 0);
                setDeadlineAt(d.getTime());
              }
            }}
          />
        </Card>

        {hasDeadline ? (
          <DateTimeField
            testID="task-deadline"
            label={template ? template.deadlineLabel : 'Дата и время дедлайна'}
            mode="datetime"
            value={deadlineAt}
            onChange={setDeadlineAt}
            allowClear={false}
            minDate={Date.now()}
            error={errors.deadlineAt}
          />
        ) : null}

        {stagePreview.length > 0 ? (
          <Card style={{ marginBottom: spacing.lg }} testID="template-stages">
            <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '700', marginBottom: 6 }}>
              Этапы · {stagePreview.length}
            </Text>
            {template && deadlineAt && isCompressed(template, deadlineAt) ? (
              <Text style={{ color: colors.warning, fontSize: fontSizes.xs + 1, marginBottom: 8 }}>
                До срока меньше времени, чем обычно нужно, — этапы сжаты пропорционально.
              </Text>
            ) : null}
            {stagePreview.map((s, i) => (
              <View key={`${i}-${s.title}`} style={styles.stageRow}>
                <View style={[styles.stageDot, { backgroundColor: i === stagePreview.length - 1 ? colors.primary : colors.border }]} />
                <Text style={{ color: colors.text, fontSize: fontSizes.sm, flex: 1 }}>{s.title}</Text>
                <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, fontVariant: ['tabular-nums'] }}>
                  {formatDateShort(s.dueAt)}
                  {i === stagePreview.length - 1 ? `, ${formatTime(s.dueAt)}` : ''}
                </Text>
              </View>
            ))}
            <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, marginTop: 6 }}>
              Этапы появятся подзадачами — их можно переименовать, отметить и удалить.
            </Text>
          </Card>
        ) : null}

        <NumberStepper
          testID="task-duration"
          label="Предполагаемая длительность"
          value={plannedMinutes}
          onChange={setPlannedMinutes}
          min={5}
          max={24 * 60}
          step={5}
          unit="мин"
        />
        {errors.plannedMinutes ? (
          <Text style={{ color: colors.danger, fontSize: fontSizes.sm, marginTop: -8, marginBottom: 12 }}>
            {errors.plannedMinutes}
          </Text>
        ) : null}

        <Text style={labelStyle(colors.textSecondary, fontSizes.sm)}>Приоритет</Text>
        <SegmentedControl<1 | 2 | 3>
          testID="task-priority"
          value={priority}
          onChange={(v) => setPriority(Number(v) as 1 | 2 | 3)}
          options={[
            { value: 1, label: 'Низкий' },
            { value: 2, label: 'Средний' },
            { value: 3, label: 'Высокий' },
          ]}
        />
        <Text style={[labelStyle(colors.textSecondary, fontSizes.sm), { marginTop: spacing.lg }]}>Сложность</Text>
        <SegmentedControl<string>
          testID="task-difficulty"
          value={String(difficulty)}
          onChange={(v) => setDifficulty(Number(v) as 1 | 2 | 3)}
          options={[
            { value: '1', label: 'Лёгкая' },
            { value: '2', label: 'Средняя' },
            { value: '3', label: 'Сложная' },
          ]}
        />

        <View style={{ height: spacing.xl }} />
        <Button
          testID="task-save"
          title={editingId ? 'Сохранить изменения' : 'Создать задачу'}
          size="lg"
          icon="checkmark"
          loading={saving}
          onPress={() => void save()}
        />
      </ScrollView>

      {/* Быстрое добавление предмета */}
      <BottomSheet visible={subjectSheet} title="Новый предмет" onClose={() => setSubjectSheet(false)}>
        <View style={{ paddingBottom: 12 }}>
          <TextField
            testID="quick-subject-name"
            label="Название *"
            value={newSubjectName}
            onChangeText={setNewSubjectName}
            placeholder="Например: Матанализ"
            maxLength={80}
          />
          <Text style={labelStyle(colors.textSecondary, fontSizes.sm)}>Цвет</Text>
          <View style={styles.colorRow}>
            {SUBJECT_COLORS.map((c) => (
              <Pressable
                key={c}
                accessibilityRole="button"
                accessibilityLabel={`Цвет ${c}`}
                accessibilityState={{ selected: newSubjectColor === c }}
                onPress={() => setNewSubjectColor(c)}
                style={[
                  styles.colorDot,
                  { backgroundColor: c, borderColor: newSubjectColor === c ? colors.text : 'transparent', borderWidth: 2 },
                ]}
              >
                {newSubjectColor === c ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
              </Pressable>
            ))}
          </View>
          <Button testID="quick-subject-save" title="Добавить предмет" icon="add" onPress={() => void addSubject()} style={{ marginTop: spacing.md }} />
        </View>
      </BottomSheet>
    </Screen>
  );
}

const DAY_EVENING_OFFSET = 86_400_000;

const labelStyle = (color: string, fontSize: number) => ({
  color,
  fontSize,
  fontWeight: '600' as const,
  marginBottom: 6,
});

function TemplateChip({
  label,
  icon,
  selected,
  onPress,
  testID,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors, fontSizes, radii } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.templateChip,
        {
          borderRadius: radii.md,
          backgroundColor: selected ? colors.primarySoft : colors.surfaceAlt,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={selected ? colors.primary : colors.textSecondary} />
      <Text style={{ color: selected ? colors.primary : colors.text, fontSize: fontSizes.sm, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  templates: { gap: 8, paddingRight: 8 },
  templateChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderWidth: 1 },
  stageRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  stageDot: { width: 8, height: 8, borderRadius: 4 },
  addSubjectLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: -10,
    marginBottom: 8,
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  colorDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
