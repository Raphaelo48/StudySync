/**
 * Форма предмета + безопасное удаление.
 *
 * Если предмет связан с задачами/событиями/сессиями, приложение НЕ удаляет
 * их молча: предлагается архивация (рекомендуется) или удаление с явным
 * перечислением последствий (связи обнуляются, история сессий сохраняется).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../../src/components/ui/Screen';
import { ScreenHeader } from '../../src/components/ScreenHeader';
import { Button, Card } from '../../src/components/ui/primitives';
import { TextField } from '../../src/components/ui/inputs';
import { BottomSheet, ConfirmDialog } from '../../src/components/ui/overlays';
import { useDataVersion, useDatabase, useTheme, useToast } from '../../src/state/AppContexts';
import { validateSubject } from '../../src/logic/validation';
import { SUBJECT_COLORS, type Subject } from '../../src/models/types';
import type { SubjectRelations } from '../../src/db/repos/subjectsRepo';

export default function SubjectEditScreen() {
  const params = useLocalSearchParams<{ subjectId?: string }>();
  const editingId = params.subjectId ?? null;

  const { colors, fontSizes, spacing } = useTheme();
  const db = useDatabase();
  const toast = useToast();
  const { bump } = useDataVersion();

  const [subject, setSubject] = useState<Subject | null>(null);
  const [relations, setRelations] = useState<SubjectRelations | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(SUBJECT_COLORS[0]!);
  const [targetGrade, setTargetGrade] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleteSheet, setDeleteSheet] = useState(false);
  const [confirmHardDelete, setConfirmHardDelete] = useState(false);

  useEffect(() => {
    if (!editingId) return;
    (async () => {
      const [s, rel] = await Promise.all([db.subjects.get(editingId), db.subjects.countRelations(editingId)]);
      if (!s) {
        toast.error('Предмет не найден');
        router.back();
        return;
      }
      setSubject(s);
      setRelations(rel);
      setName(s.name);
      setDescription(s.description ?? '');
      setColor(s.color);
      setTargetGrade(s.targetGrade ?? '');
      setNote(s.note ?? '');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, editingId]);

  const save = async () => {
    setSaving(true);
    const check = validateSubject({ name, description, color, targetGrade, note });
    if (!check.ok) {
      setErrors(check.errors);
      setSaving(false);
      return;
    }
    setErrors({});
    try {
      if (editingId) {
        await db.subjects.update(editingId, check.value);
        toast.success('Предмет сохранён');
      } else {
        await db.subjects.create(check.value);
        toast.success('Предмет добавлен');
      }
      bump();
      router.back();
    } catch {
      toast.error('Не удалось сохранить предмет');
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!editingId) return;
    await db.subjects.archive(editingId);
    toast.success('Предмет в архиве — все данные на месте');
    bump();
    router.back();
  };

  const hardDelete = async () => {
    if (!editingId) return;
    try {
      await db.subjects.delete(editingId);
      toast.success('Предмет удалён');
      bump();
      router.back();
    } catch {
      toast.error('Не удалось удалить предмет');
    }
  };

  const totalRelations = relations ? relations.tasks + relations.events + relations.sessions + relations.goals : 0;

  return (
    <Screen testID="subject-edit-screen" keyboardAvoiding>
      <ScreenHeader title={editingId ? 'Предмет' : 'Новый предмет'} testID="subject-edit-header" />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        <TextField
          testID="subject-name"
          label="Название *"
          value={name}
          onChangeText={setName}
          placeholder="Например: Физика"
          error={errors.name}
          maxLength={80}
        />
        <TextField
          testID="subject-description"
          label="Описание"
          value={description}
          onChangeText={setDescription}
          placeholder="Преподаватель, курс, особенности"
          multiline
          maxLength={500}
        />
        <TextField
          testID="subject-target-grade"
          label="Целевая оценка (необязательно)"
          value={targetGrade}
          onChangeText={setTargetGrade}
          placeholder="Например: 5 или «зачёт»"
          maxLength={20}
        />
        <TextField
          testID="subject-note"
          label="Заметка"
          value={note}
          onChangeText={setNote}
          placeholder="Что важно не забыть по предмету"
          multiline
          maxLength={500}
        />

        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginBottom: spacing.sm }}>
          Цвет
        </Text>
        <View style={styles.colorRow}>
          {SUBJECT_COLORS.map((c) => (
            <Pressable
              key={c}
              testID={`subject-color-${c.slice(1)}`}
              accessibilityRole="button"
              accessibilityState={{ selected: color === c }}
              accessibilityLabel={`Цвет ${c}`}
              onPress={() => setColor(c)}
              style={[styles.colorDot, { backgroundColor: c, borderColor: color === c ? colors.text : 'transparent', borderWidth: 2 }]}
            >
              {color === c ? <Ionicons name="checkmark" size={15} color="#fff" /> : null}
            </Pressable>
          ))}
        </View>
        {errors.color ? <Text style={{ color: colors.danger, fontSize: fontSizes.sm }}>{errors.color}</Text> : null}

        <View style={{ height: spacing.xl }} />
        <Button testID="subject-save" title={editingId ? 'Сохранить' : 'Добавить предмет'} size="lg" icon="checkmark" loading={saving} onPress={() => void save()} />

        {editingId && subject ? (
          <>
            {subject.archived ? (
              <Button
                title="Вернуть из архива"
                variant="secondary"
                icon="archive-outline"
                style={{ marginTop: spacing.md }}
                onPress={async () => {
                  await db.subjects.update(editingId, { archived: false });
                  toast.success('Предмет снова активен');
                  bump();
                  router.back();
                }}
              />
            ) : null}
            <Button
              testID="subject-delete"
              title="Архивировать или удалить…"
              variant="ghost"
              icon="alert-circle-outline"
              style={{ marginTop: spacing.md }}
              onPress={() => setDeleteSheet(true)}
            />
          </>
        ) : null}
      </ScrollView>

      {/* Варианты удаления */}
      <BottomSheet visible={deleteSheet} title="Что сделать с предметом?" onClose={() => setDeleteSheet(false)}>
        <View style={{ gap: 10, paddingBottom: 16 }}>
          {totalRelations > 0 ? (
            <Card style={{ backgroundColor: colors.warningSoft }}>
              <Text style={{ color: colors.text, fontSize: fontSizes.sm, lineHeight: 19 }}>
                К предмету привязаны: {relations?.tasks ?? 0} задач, {relations?.events ?? 0} событий,{' '}
                {relations?.sessions ?? 0} сессий, {relations?.goals ?? 0} целей. Данные не исчезнут бесследно —
                выберите осознанное действие.
              </Text>
            </Card>
          ) : null}
          <Button
            testID="subject-archive"
            title="Архивировать (рекомендуется)"
            icon="archive-outline"
            onPress={() => {
              setDeleteSheet(false);
              void archive();
            }}
          />
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, lineHeight: 16 }}>
            Предмет скроется из списков выбора, но задачи, события, сессии и статистика полностью сохранятся.
          </Text>
          <Button
            testID="subject-hard-delete"
            title="Удалить предмет"
            variant="danger"
            icon="trash-outline"
            onPress={() => {
              setDeleteSheet(false);
              setConfirmHardDelete(true);
            }}
          />
          <Button title="Отмена" variant="ghost" onPress={() => setDeleteSheet(false)} />
        </View>
      </BottomSheet>

      <ConfirmDialog
        visible={confirmHardDelete}
        title="Удалить предмет безвозвратно?"
        message={
          totalRelations > 0
            ? `Задачи (${relations?.tasks ?? 0}), события (${relations?.events ?? 0}) и сессии (${relations?.sessions ?? 0}) останутся, но потеряют связь с предметом («без предмета»). Цели предмета (${relations?.goals ?? 0}) будут удалены. Восстановить связь можно только из резервной копии.`
            : 'Предмет будет удалён. Действие нельзя отменить.'
        }
        confirmLabel="Удалить"
        danger
        testID="subject-delete-confirm"
        onConfirm={() => {
          setConfirmHardDelete(false);
          void hardDelete();
        }}
        onCancel={() => setConfirmHardDelete(false)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 8,
  },
  colorDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
