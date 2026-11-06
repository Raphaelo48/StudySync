/**
 * Долги и отработки: несданные (ближайшие сверху), отметка «Сдал» / «Не сдал»,
 * чек-лист «что взять», история сданного.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Screen } from '../src/components/ui/Screen';
import { ScreenHeader } from '../src/components/ScreenHeader';
import { Card, EmptyState, SectionTitle, Spinner } from '../src/components/ui/primitives';
import { DebtCard } from '../src/components/debts/DebtCard';
import { useDataVersion, useDatabase, useTheme, useToast } from '../src/state/AppContexts';
import type { DebtWithSubject } from '../src/models/types';
import { attemptLabel } from '../src/logic/debts';
import { pluralRu } from '../src/core/time';

export default function DebtsScreen() {
  const { colors, fontSizes, spacing } = useTheme();
  const db = useDatabase();
  const router = useRouter();
  const toast = useToast();
  const { version, bump } = useDataVersion();
  const [open, setOpen] = useState<DebtWithSubject[] | null>(null);
  const [passed, setPassed] = useState<DebtWithSubject[]>([]);
  const [showPassed, setShowPassed] = useState(false);

  const load = useCallback(async () => {
    const [o, p] = await Promise.all([db.debts.listOpen(), db.debts.listPassed()]);
    setOpen(o);
    setPassed(p);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load, version])
  );

  const edit = (id?: string) => router.push(id ? { pathname: '/debt/edit', params: { debtId: id } } : '/debt/edit');

  const markPassed = async (d: DebtWithSubject) => {
    const prevStatus = d.status;
    await db.debts.update(d.id, { status: 'passed' });
    bump();
    await load();
    toast.success(`«${d.title}» сдано 🎉`, {
      label: 'Отменить',
      onPress: () => {
        void db.debts.update(d.id, { status: prevStatus }).then(() => {
          bump();
          void load();
        });
      },
    });
  };

  const markFailed = async (d: DebtWithSubject) => {
    const next = await db.debts.nextAttempt(d.id);
    bump();
    await load();
    toast.info(`${attemptLabel(next?.attempt ?? d.attempt + 1) ?? 'Новая попытка'}: назначьте дату`);
    edit(d.id);
  };

  const toggleItem = async (d: DebtWithSubject, index: number) => {
    await db.debts.toggleChecklistItem(d.id, index);
    await load();
  };

  if (open == null) {
    return (
      <Screen testID="debts-screen">
        <ScreenHeader title="Долги и отработки" />
        <Spinner />
      </Screen>
    );
  }

  const scheduled = open.filter((d) => d.retakeAt != null).length;

  return (
    <Screen testID="debts-screen">
      <ScreenHeader
        title="Долги и отработки"
        subtitle={
          open.length === 0
            ? 'Долгов нет'
            : `${open.length} ${pluralRu(open.length, 'долг', 'долга', 'долгов')} · назначено ${scheduled}`
        }
        right={
          <Pressable testID="debts-add" accessibilityRole="button" accessibilityLabel="Добавить долг" hitSlop={8} onPress={() => edit()}>
            <Ionicons name="add-circle" size={26} color={colors.primary} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}>
        {open.length === 0 ? (
          <Card>
            <EmptyState
              testID="debts-empty"
              icon="happy-outline"
              title="Долгов нет"
              subtitle="Если что-то не сдал — добавь сюда: когда и где отработка, кому сдавать и что взять с собой"
              actionLabel="Добавить долг"
              onAction={() => edit()}
            />
          </Card>
        ) : (
          open.map((d) => (
            <DebtCard
              key={d.id}
              testID={`debt-${d.id}`}
              debt={d}
              onPress={() => edit(d.id)}
              onPassed={() => void markPassed(d)}
              onFailed={() => void markFailed(d)}
              onToggleItem={(i) => void toggleItem(d, i)}
            />
          ))
        )}

        {passed.length > 0 ? (
          <>
            <Pressable
              testID="debts-toggle-passed"
              accessibilityRole="button"
              onPress={() => setShowPassed((v) => !v)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg }}
            >
              <SectionTitle title={`Сдано · ${passed.length}`} />
              <Ionicons name={showPassed ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textMuted} />
            </Pressable>
            {showPassed
              ? passed.map((d) => <DebtCard key={d.id} debt={d} compact onPress={() => edit(d.id)} testID={`debt-passed-${d.id}`} />)
              : null}
          </>
        ) : null}

        <View style={{ height: spacing.md }} />
        <Text style={{ color: colors.textMuted, fontSize: fontSizes.xs + 1, lineHeight: 16 }}>
          За час до отработки придёт напоминание, а в утренней сводке появится строка «Отработка». «Не сдал» переводит
          долг на следующую попытку: пересдача, затем комиссия.
        </Text>
      </ScrollView>
    </Screen>
  );
}
