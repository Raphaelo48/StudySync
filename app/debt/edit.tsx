/**
 * Форма долга: что и по какому предмету сдать, попытка, дата и место отработки,
 * преподаватель (подставляется из расписания), чек-лист «что взять», заметки.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/ui/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { Button, Chip } from '../../src/components/ui/primitives';
import { NumberStepper, SelectField, SwitchRow, TextField } from '../../src/components/ui/inputs';
import { DateTimeField } from '../../src/components/ui/DateTimeField';
import { ConfirmDialog } from '../../src/components/ui/overlays';
import { useDataVersion, useDatabase, useTheme, useToast } from '../../src/state/AppContexts';
import { DEBT_KIND_LABELS, type ChecklistItem, type DebtKind, type Subject } from '../../src/models/types';
import { attemptLabel, defaultChecklist, suggestTeacher } from '../../src/logic/debts';

const KINDS = Object.keys(DEBT_KIND_LABELS) as DebtKind[];

const sameList = (a: ChecklistItem[], b: ChecklistItem[]) =>
  a.length === b.length && a.every((x, i) => x.text === b[i]!.text);

export default function DebtEditScreen() {
  const params = useLocalSearchParams<{ debtId?: string; subjectId?: string; title?: string }>();
  const editingId = params.debtId ?? null;
  const { colors, fontSizes, spacing, radii } = useTheme();
  const db = useDatabase();
  const toast = useToast();
  const { bump } = useDataVersion();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState<string | null>(params.subjectId ?? null);
  const [title, setTitle] = useState(params.title ?? '');
  const [kind, setKind] = useState<DebtKind>('lab');
  const [attempt, setAttempt] = useState(1);
  const [retakeAt, setRetakeAt] = useState<number | null>(null);
  const [location, setLocation] = useState('');
  const [teacher, setTeacher] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() => defaultChecklist('lab'));
  const [newItem, setNewItem] = useState('');
  const [notes, setNotes] = useState('');
  const [passed, setPassed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const teacherTouched = useRef(false);

  useEffect(() => {
    void db.subjects.list().then(setSubjects);
    if (!editingId) return;
    (async () => {
      const d = await db.debts.get(editingId);
      if (!d) {
        toast.error('Долг не найден');
        router.back();
        return;
      }
      setSubjectId(d.subjectId);
      setTitle(d.title);
      setKind(d.kind);
      setAttempt(d.attempt);
      setRetakeAt(d.retakeAt);
      setLocation(d.location ?? '');
      setTeacher(d.teacher ?? '');
      teacherTouched.current = !!d.teacher;
      setChecklist(d.checklist);
      setNotes(d.notes ?? '');
      setPassed(d.status === 'passed');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, editingId]);

  // Преподаватель по предмету — из расписания, пока пользователь не ввёл своего.
  useEffect(() => {
    if (!subjectId || teacherTouched.current) return;
    void suggestTeacher(db, subjectId).then((t) => {
      if (t && !teacherTouched.current) setTeacher(t);
    });
  }, [db, subjectId]);

  const subjectOptions = useMemo(() => subjects.map((s) => ({ value: s.id, label: s.name, color: s.color })), [subjects]);

  const changeKind = (k: DebtKind) => {
    // Стартовый чек-лист меняем, только если пользователь его не трогал.
    if (checklist.length === 0 || sameList(checklist, defaultChecklist(kind))) setChecklist(defaultChecklist(k));
    setKind(k);
  };

  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    setChecklist((c) => [...c, { text: text.slice(0, 200), done: false }]);
    setNewItem('');
  };

  const save = async () => {
    const t = title.trim();
    if (!t) {
      setError('Напишите, что нужно сдать');
      return;
    }
    if (t.length > 200) {
      setError('Не длиннее 200 символов');
      return;
    }
    setError(null);
    setSaving(true);
    const input = {
      subjectId,
      title: t,
      kind,
      attempt,
      retakeAt,
      location,
      teacher,
      checklist,
      notes,
      status: passed ? ('passed' as const) : retakeAt ? ('scheduled' as const) : ('open' as const),
    };
    try {
      if (editingId) await db.debts.update(editingId, input);
      else await db.debts.create(input);
      toast.success(editingId ? 'Сохранено' : 'Долг добавлен');
      bump();
      router.back();
    } catch {
      toast.error('Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editingId) return;
    await db.debts.delete(editingId);
    toast.success('Удалено');
    bump();
    router.back();
  };

  const attemptText = attemptLabel(attempt) ?? 'Первая сдача';

  return (
    <Screen testID="debt-edit-screen" keyboardAvoiding>
      <ScreenHeader title={editingId ? 'Долг' : 'Новый долг'} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <SelectField
          testID="debt-subject"
          label="Предмет"
          options={subjectOptions}
          value={subjectId}
          onChange={setSubjectId}
          placeholder="Выберите предмет"
          allowClear
          clearLabel="Без предмета"
        />
        <TextField
          testID="debt-title"
          label="Что сдать *"
          value={title}
          onChangeText={setTitle}
          placeholder="Например: Лабораторная №3"
          error={error}
          maxLength={200}
        />

        <Text style={[styles.label, { color: colors.textSecondary, fontSize: fontSizes.sm }]}>Тип</Text>
        <View style={styles.chips}>
          {KINDS.map((k) => (
            <Chip key={k} testID={`debt-kind-${k}`} label={DEBT_KIND_LABELS[k]} selected={kind === k} onPress={() => changeKind(k)} />
          ))}
        </View>

        <NumberStepper label={`Попытка: ${attemptText}`} value={attempt} onChange={setAttempt} min={1} max={10} testID="debt-attempt" />

        <DateTimeField
          testID="debt-retake"
          label="Когда отработка / пересдача"
          value={retakeAt}
          onChange={setRetakeAt}
          placeholder="Дата ещё не назначена"
        />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <TextField testID="debt-location" label="Аудитория" value={location} onChangeText={setLocation} placeholder="А-212" maxLength={60} />
          </View>
          <View style={{ flex: 2 }}>
            <TextField
              testID="debt-teacher"
              label="Кому сдавать"
              value={teacher}
              onChangeText={(v) => {
                teacherTouched.current = true;
                setTeacher(v);
              }}
              placeholder="ФИО преподавателя"
              maxLength={120}
            />
          </View>
        </View>

        <Text style={[styles.label, { color: colors.textSecondary, fontSize: fontSizes.sm }]}>Что взять и подготовить</Text>
        {checklist.map((it, i) => (
          <View key={`${i}-${it.text}`} style={[styles.checkRow, { borderColor: colors.borderSoft }]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: it.done }}
              accessibilityLabel={it.text}
              onPress={() => setChecklist((c) => c.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}
              style={styles.checkMain}
            >
              <Ionicons name={it.done ? 'checkbox' : 'square-outline'} size={19} color={it.done ? colors.success : colors.textMuted} />
              <Text style={{ color: colors.text, fontSize: fontSizes.sm, flex: 1 }}>{it.text}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Удалить пункт ${it.text}`}
              hitSlop={8}
              onPress={() => setChecklist((c) => c.filter((_, j) => j !== i))}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        ))}
        <View style={[styles.addRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderRadius: radii.md }]}>
          <TextInput
            testID="debt-new-item"
            value={newItem}
            onChangeText={setNewItem}
            placeholder="Добавить пункт"
            placeholderTextColor={colors.textMuted}
            onSubmitEditing={addItem}
            returnKeyType="done"
            style={{ flex: 1, color: colors.text, fontSize: fontSizes.sm, paddingVertical: 10 }}
          />
          <Pressable accessibilityRole="button" accessibilityLabel="Добавить пункт" onPress={addItem} hitSlop={8}>
            <Ionicons name="add-circle" size={22} color={colors.primary} />
          </Pressable>
        </View>

        <TextField testID="debt-notes" label="Заметки" value={notes} onChangeText={setNotes} placeholder="Темы, требования преподавателя" multiline maxLength={1000} />

        {editingId ? (
          <SwitchRow testID="debt-passed" label="Сдано" description="Долг уйдёт в историю сданного" value={passed} onValueChange={setPassed} />
        ) : null}

        <View style={{ height: spacing.lg }} />
        <Button testID="debt-save" title={editingId ? 'Сохранить' : 'Добавить долг'} size="lg" icon="checkmark" loading={saving} onPress={() => void save()} />
        {editingId ? (
          <Button
            testID="debt-delete"
            title="Удалить"
            variant="ghost"
            icon="trash-outline"
            style={{ marginTop: spacing.md }}
            onPress={() => setConfirmDelete(true)}
          />
        ) : null}
      </ScrollView>
      <ConfirmDialog
        visible={confirmDelete}
        title="Удалить долг?"
        message="Если долг сдан, лучше отметить «Сдано» — он останется в истории."
        confirmLabel="Удалить"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          void remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontWeight: '600', marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  row: { flexDirection: 'row', gap: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  checkMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, paddingHorizontal: 12, marginTop: 8, marginBottom: 16 },
});
