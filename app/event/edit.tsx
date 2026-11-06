/**
 * Форма события: создание/редактирование занятий и личных событий,
 * повторение (серия), напоминание. Конфликты показываются как предупреждение,
 * события никогда не изменяются автоматически.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../src/components/ui/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { Button, Card } from '../../src/components/ui/primitives';
import { SegmentedControl, SelectField, TextField } from '../../src/components/ui/inputs';
import { DateTimeField } from '../../src/components/ui/DateTimeField';
import { BottomSheet, ConfirmDialog } from '../../src/components/ui/overlays';
import { useDataVersion, useDatabase, useSettings, useTheme, useToast } from '../../src/state/AppContexts';
import { validateEventForm, type FieldErrors } from '../../src/logic/validation';
import { expandRecurrence, sameRecurrenceRule, DEFAULT_SERIES_HORIZON_MS } from '../../src/logic/recurrence';
import {
  DAY_MS,
  MINUTE_MS,
  WEEKDAY_SHORT,
  addDays,
  formatDateFull,
  formatTime,
  startOfDay,
} from '../../src/core/time';
import { newId } from '../../src/core/id';
import { Ionicons } from '@expo/vector-icons';
import type { CalendarEvent, EventKind, RecurrenceRule, Subject } from '../../src/models/types';
import { syncEventNotification, cancelEventNotification } from '../../src/notifications/scheduler';
import { getNotificationClient } from '../../src/notifications/client';

type RepeatMode = 'none' | 'weekly' | 'daily';

type EventFormValue = Extract<ReturnType<typeof validateEventForm>, { ok: true }>['value'];

const REMINDER_OPTIONS = [
  { value: 'none', label: 'Без напоминания' },
  { value: '5', label: 'За 5 минут' },
  { value: '15', label: 'За 15 минут' },
  { value: '30', label: 'За 30 минут' },
  { value: '60', label: 'За 1 час' },
  { value: '120', label: 'За 2 часа' },
];

export default function EventEditScreen() {
  const params = useLocalSearchParams<{ eventId?: string; startAt?: string }>();
  const editingId = params.eventId ?? null;

  const { colors, fontSizes, spacing } = useTheme();
  const { settings } = useSettings();
  const db = useDatabase();
  const toast = useToast();
  const { bump } = useDataVersion();

  const [loading, setLoading] = useState(!!editingId);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [seriesEvent, setSeriesEvent] = useState<CalendarEvent | null>(null);
  const [scopeSheet, setScopeSheet] = useState(false);
  const [editScope, setEditScope] = useState<'single' | 'series'>('single');
  const [confirmConflicts, setConfirmConflicts] = useState<CalendarEvent[] | null>(null);

  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<EventKind>('lesson');
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [startAt, setStartAt] = useState<number>(() => {
    const fromParam = params.startAt ? Number(params.startAt) : NaN;
    if (Number.isFinite(fromParam) && fromParam > 0) return fromParam;
    const d = new Date();
    d.setMinutes(0, 0, 0);
    return d.getTime() + 60 * MINUTE_MS;
  });
  const [endAt, setEndAt] = useState<number>(() => startAt + 90 * MINUTE_MS);
  const [notes, setNotes] = useState('');
  const [reminder, setReminder] = useState<string>('15');
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  const [repeatDays, setRepeatDays] = useState<number[]>([]);
  const [repeatUntil, setRepeatUntil] = useState<number | null>(null);

  const [subjects, setSubjects] = useState<Subject[]>([]);

  useEffect(() => {
    (async () => {
      const subs = await db.subjects.list();
      setSubjects(subs);
      if (editingId) {
        const ev = await db.events.get(editingId);
        if (!ev) {
          toast.error('Событие не найдено');
          router.back();
          return;
        }
        setSeriesEvent(ev);
        setTitle(ev.title);
        setKind(ev.kind === 'study' ? 'lesson' : ev.kind);
        setSubjectId(ev.subjectId);
        setLocation(ev.location ?? '');
        setStartAt(ev.startAt);
        setEndAt(ev.endAt);
        setNotes(ev.notes ?? '');
        setReminder(ev.notifyOffsetMinutes != null ? String(ev.notifyOffsetMinutes) : 'none');
        if (ev.seriesId && ev.recurrence) {
          setRepeatMode(ev.recurrence.freq);
          setRepeatDays(ev.recurrence.daysOfWeek ?? []);
          setRepeatUntil(ev.recurrence.until);
        }
        setLoading(false);
      } else {
        setRepeatDays([new Date(startAt).getDay()]);
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, editingId]);

  // При смене даты начала повторяемого события — синхронизируем день недели
  useEffect(() => {
    if (repeatMode === 'weekly' && repeatDays.length === 0) {
      setRepeatDays([new Date(startAt).getDay()]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startAt, repeatMode]);

  const durationMs = Math.max(MINUTE_MS, endAt - startAt);

  const seriesPreview = useMemo(() => {
    if (repeatMode === 'none') return null;
    const rule: RecurrenceRule = {
      freq: repeatMode,
      daysOfWeek: repeatMode === 'weekly' ? [...repeatDays].sort() : undefined,
      until: repeatUntil,
    };
    if (repeatMode === 'weekly' && repeatDays.length === 0) return { count: 0, rule, instances: [] as Array<{ startAt: number; endAt: number }> };
    const limit = repeatUntil ?? startAt + DEFAULT_SERIES_HORIZON_MS;
    const instances = expandRecurrence(rule, startAt, startAt + durationMs, limit, 200);
    return { count: instances.length, rule, instances };
  }, [repeatMode, repeatDays, repeatUntil, startAt, durationMs]);

  const subjectOptions = useMemo(
    () => subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })),
    [subjects]
  );

  const buildRule = (): RecurrenceRule | null => {
    if (repeatMode === 'none') return null;
    return {
      freq: repeatMode,
      daysOfWeek: repeatMode === 'weekly' ? [...repeatDays].sort() : undefined,
      until: repeatUntil,
    };
  };

  const validate = () => {
    const result = validateEventForm({
      title,
      kind,
      subjectId: kind === 'lesson' ? subjectId : null,
      location,
      startAt,
      endAt,
      notes,
      notifyOffsetMinutes: reminder === 'none' ? null : Number(reminder),
    });
    if (!result.ok) {
      setErrors(result.errors);
      return null;
    }
    if (repeatMode === 'weekly' && repeatDays.length === 0) {
      setErrors({ repeat: 'Выберите дни недели для повторения' });
      return null;
    }
    setErrors({});
    return result.value;
  };

  const trySave = async () => {
    const value = validate();
    if (!value) return;
    // Проверка конфликтов — предупреждаем, но не блокируем.
    const conflicts = await db.events.findConflicts(value.startAt, value.endAt, editingId);
    if (conflicts.length > 0) {
      setConfirmConflicts(conflicts);
      return;
    }
    await persist(value, buildRule());
  };

  const persist = async (value: EventFormValue | null, rule: RecurrenceRule | null) => {
    if (!value) return;
    setSaving(true);
    const now = Date.now();
    const client = getNotificationClient();
    try {
      if (
        editingId &&
        seriesEvent?.seriesId &&
        editScope === 'series' &&
        rule &&
        seriesPreview &&
        !sameRecurrenceRule(rule, seriesEvent.recurrence)
      ) {
        // Изменилось правило повтора (дни недели, дата окончания): прежние будущие
        // инстансы удаляются, серия пересоздаётся от редактируемого события.
        const seriesId = seriesEvent.seriesId;
        const series = await db.events.listSeries(seriesId);
        const future = series.filter((e) => e.startAt >= startOfDay(seriesEvent.startAt) && e.id !== editingId);
        const created: CalendarEvent[] = [];
        let updated: CalendarEvent | null = null;
        await db.driver.transaction(async () => {
          updated = await db.events.update(editingId, { ...value, recurrence: rule, seriesId }, now);
          for (const inst of future) await db.events.delete(inst.id);
          for (const inst of seriesPreview.instances.slice(1)) {
            created.push(
              await db.events.create({ ...value, startAt: inst.startAt, endAt: inst.endAt, seriesId, recurrence: rule }, now)
            );
          }
        });
        for (const inst of future) await cancelEventNotification(client, inst.id);
        for (const ev of updated ? [updated, ...created] : created) {
          await cancelEventNotification(client, ev.id);
          await syncEventNotification(client, settings, ev, now);
        }
        toast.success(`Серия пересоздана: событий — ${created.length + 1}`);
      } else if (editingId && seriesEvent?.seriesId && editScope === 'series') {
        // Редактирование всей серии: будущие инстансы получают новые время/поля.
        const series = await db.events.listSeries(seriesEvent.seriesId);
        const future = series.filter((e) => e.startAt >= startOfDay(seriesEvent.startAt));
        await db.driver.transaction(async () => {
          // Первый (редактируемый) инстанс
          const updated = await db.events.update(editingId, {
            ...value,
            recurrence: rule ?? seriesEvent.recurrence,
            seriesId: seriesEvent.seriesId,
          }, now);
          if (updated) {
            await cancelEventNotification(client, updated.id);
            await syncEventNotification(client, settings, updated, now);
          }
          // Остальные будущие: переносим время суток, сохраняем день
          for (const inst of future) {
            if (inst.id === editingId) continue;
            const newStart = inst.startAt + (value.startAt - seriesEvent.startAt);
            const newEnd = newStart + durationMs;
            const upd = await db.events.update(inst.id, {
              ...value,
              startAt: newStart,
              endAt: newEnd,
              recurrence: rule ?? seriesEvent.recurrence,
              seriesId: seriesEvent.seriesId,
            }, now);
            if (upd) {
              await cancelEventNotification(client, upd.id);
              await syncEventNotification(client, settings, upd, now);
            }
          }
        });
        toast.success('Серия событий обновлена');
      } else if (editingId) {
        const updated = await db.events.update(editingId, { ...value, recurrence: rule ?? (seriesEvent?.recurrence ?? null) }, now);
        if (updated) {
          await cancelEventNotification(client, updated.id);
          await syncEventNotification(client, settings, updated, now);
        }
        toast.success('Событие сохранено');
      } else {
        // Создание: одиночное или серия
        if (rule && seriesPreview && seriesPreview.count > 1) {
          const seriesId = newId();
          const instances = seriesPreview.instances;
          await db.driver.transaction(async () => {
            for (const inst of instances) {
              const created = await db.events.create({
                ...value,
                startAt: inst.startAt,
                endAt: inst.endAt,
                seriesId,
                recurrence: rule,
              }, now);
              await syncEventNotification(client, settings, created, now);
            }
          });
          toast.success(`Создано событий: ${instances.length}`);
        } else {
          const created = await db.events.create({ ...value, recurrence: rule }, now);
          await syncEventNotification(client, settings, created, now);
          toast.success('Событие создано');
        }
      }
      bump();
      router.back();
    } catch (e) {
      toast.error('Не удалось сохранить событие');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen testID="event-edit-screen">
        <ScreenHeader title="Событие" />
      </Screen>
    );
  }

  const toggleRepeatDay = (dow: number) => {
    setRepeatDays((prev) => (prev.includes(dow) ? prev.filter((d) => d !== dow) : [...prev, dow].sort()));
  };

  return (
    <Screen testID="event-edit-screen" keyboardAvoiding>
      <ScreenHeader title={editingId ? 'Редактировать событие' : 'Новое событие'} testID="event-edit-header" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <TextField
          testID="event-title-input"
          label="Название *"
          value={title}
          onChangeText={setTitle}
          placeholder="Например: Лекция по матанализу"
          error={errors.title}
          maxLength={120}
        />

        <SegmentedControl<EventKind>
          testID="event-kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'lesson', label: 'Занятие', icon: 'school-outline' },
            { value: 'personal', label: 'Личное', icon: 'person-outline' },
          ]}
        />
        <View style={{ height: spacing.lg }} />

        {kind === 'lesson' ? (
          <SelectField
            testID="event-subject"
            label="Предмет"
            options={subjectOptions}
            value={subjectId}
            onChange={setSubjectId}
            allowClear
            clearLabel="Без предмета"
          />
        ) : null}

        <TextField
          testID="event-location"
          label="Место"
          value={location}
          onChangeText={setLocation}
          placeholder="Аудитория, корпус или ссылка"
          maxLength={120}
        />

        <DateTimeField
          testID="event-start"
          label="Начало *"
          value={startAt}
          onChange={(v) => {
            if (v == null) return;
            setEndAt(v + durationMs);
            setStartAt(v);
          }}
          allowClear={false}
          error={errors.startAt}
        />
        <DateTimeField
          testID="event-end"
          label="Окончание *"
          value={endAt}
          onChange={(v) => v != null && setEndAt(v)}
          allowClear={false}
          minDate={startAt}
          error={errors.endAt}
        />

        {/* Повторение */}
        <Text style={labelStyle(colors.textSecondary, fontSizes.sm)}>Повторение</Text>
        <SegmentedControl<RepeatMode>
          testID="event-repeat"
          value={repeatMode}
          onChange={setRepeatMode}
          options={[
            { value: 'none', label: 'Нет' },
            { value: 'weekly', label: 'Каждую неделю' },
            { value: 'daily', label: 'Каждый день' },
          ]}
        />
        {errors.repeat ? (
          <Text style={{ color: colors.danger, fontSize: fontSizes.sm, marginTop: 6 }}>{errors.repeat}</Text>
        ) : null}

        {repeatMode === 'weekly' ? (
          <View style={styles.daysRow}>
            {(settings.weekStart === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]).map((dow) => {
              const selected = repeatDays.includes(dow);
              return (
                <Pressable
                  key={dow}
                  testID={`event-repeat-day-${dow}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={WEEKDAY_SHORT[dow]}
                  onPress={() => toggleRepeatDay(dow)}
                  style={[
                    styles.dayToggle,
                    {
                      backgroundColor: selected ? colors.primary : colors.surfaceAlt,
                      borderColor: selected ? colors.primary : colors.border,
                      borderRadius: 18,
                    },
                  ]}
                >
                  <Text style={{ color: selected ? colors.onPrimary : colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600' }}>
                    {WEEKDAY_SHORT[dow]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {repeatMode !== 'none' ? (
          <>
            <DateTimeField
              testID="event-repeat-until"
              label="Повторять до (необязательно)"
              mode="date"
              value={repeatUntil}
              onChange={setRepeatUntil}
              minDate={addDays(startAt, 1)}
            />
            {seriesPreview ? (
              <Card style={{ backgroundColor: colors.primarySoft, marginBottom: spacing.lg }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Ionicons name="repeat" size={16} color={colors.primary} />
                  <Text style={{ color: colors.text, fontSize: fontSizes.sm, flex: 1 }}>
                    {seriesPreview.count > 0
                      ? `Будет создано событий: ${seriesPreview.count}${repeatUntil ? ` до ${formatDateFull(repeatUntil)}` : ` (до ${formatDateFull(startAt + DEFAULT_SERIES_HORIZON_MS)})`}`
                      : 'Выберите дни повторения'}
                  </Text>
                </View>
              </Card>
            ) : null}
          </>
        ) : null}

        <SelectField
          testID="event-reminder"
          label="Напоминание"
          options={REMINDER_OPTIONS}
          value={reminder}
          onChange={(v) => setReminder(v ?? 'none')}
        />

        <TextField
          testID="event-notes"
          label="Заметки"
          value={notes}
          onChangeText={setNotes}
          placeholder="Домашнее задание к занятию, материалы…"
          multiline
          maxLength={1000}
        />

        {editingId && seriesEvent?.seriesId ? (
          <Pressable accessibilityRole="button" testID="event-scope" onPress={() => setScopeSheet(true)} style={styles.scopeLink}>
            <Ionicons name="layers-outline" size={15} color={colors.primary} />
            <Text style={{ color: colors.primary, fontSize: fontSizes.sm, fontWeight: '600' }}>
              {editScope === 'single' ? 'Изменится только это событие' : 'Изменится вся серия'} — нажать, чтобы сменить
            </Text>
          </Pressable>
        ) : null}

        <View style={{ height: spacing.lg }} />
        <Button testID="event-save" title={editingId ? 'Сохранить' : 'Создать событие'} size="lg" icon="checkmark" loading={saving} onPress={() => void trySave()} />
      </ScrollView>

      {/* Выбор области редактирования серии */}
      <BottomSheet visible={scopeSheet} title="Область изменений" onClose={() => setScopeSheet(false)}>
        <View style={{ gap: 10, paddingBottom: 16 }}>
          <Button
            title="Только это событие"
            variant={editScope === 'single' ? 'primary' : 'secondary'}
            onPress={() => {
              setEditScope('single');
              setScopeSheet(false);
            }}
          />
          <Button
            title="Вся серия (будущие события)"
            variant={editScope === 'series' ? 'primary' : 'secondary'}
            onPress={() => {
              setEditScope('series');
              setScopeSheet(false);
            }}
          />
        </View>
      </BottomSheet>

      {/* Предупреждение о конфликтах */}
      <ConfirmDialog
        visible={confirmConflicts != null}
        title="Есть пересечения"
        message={
          confirmConflicts
            ? `Событие пересекается с: ${confirmConflicts
                .slice(0, 3)
                .map((c) => `«${c.title}» (${formatTime(c.startAt)}–${formatTime(c.endAt)})`)
                .join(', ')}. Сохранить всё равно? Существующие события не изменяются.`
            : ''
        }
        confirmLabel="Сохранить всё равно"
        cancelLabel="Изменить время"
        testID="event-conflict-confirm"
        onConfirm={() => {
          setConfirmConflicts(null);
          void persist(validate(), buildRule());
        }}
        onCancel={() => setConfirmConflicts(null)}
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
  daysRow: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: 12,
  },
  dayToggle: {
    width: 40,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  scopeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
  },
});
