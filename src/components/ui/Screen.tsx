/**
 * Экран-обёртка: безопасные области, фон темы, опциональный скролл.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../state/AppContexts';

export interface ScreenProps {
  children: React.ReactNode;
  /** Прокручиваемый контент (ScrollView). */
  scroll?: boolean;
  /** Отступы контента по горизонтали (по умолчанию 16). */
  padded?: boolean;
  /** KeyboardAvoidingView для форм. */
  keyboardAvoiding?: boolean;
  testID?: string;
  contentContainerStyle?: object;
}

export function Screen({
  children,
  scroll = false,
  padded = true,
  keyboardAvoiding = false,
  testID,
  contentContainerStyle,
}: ScreenProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  let content: React.ReactNode = children;
  if (scroll) {
    content = (
      <ScrollView
        testID={testID ? `${testID}-scroll` : undefined}
        style={styles.flex}
        contentContainerStyle={[
          styles.scrollContent,
          padded && styles.padded,
          { paddingBottom: insets.bottom + 24 },
          contentContainerStyle as object,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    );
  }

  const body = (
    <View
      testID={testID}
      style={[
        styles.flex,
        { backgroundColor: colors.bg, paddingTop: insets.top },
      ]}
    >
      {content}
    </View>
  );

  if (keyboardAvoiding) {
    return (
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: colors.bg }]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {body}
      </KeyboardAvoidingView>
    );
  }
  return body;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingTop: 8 },
  padded: { paddingHorizontal: 16 },
});
