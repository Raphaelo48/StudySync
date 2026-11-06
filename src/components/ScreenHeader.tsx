/**
 * Заголовок экрана с опциональной кнопкой «назад» и действиями справа.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTheme } from '../state/AppContexts';
import { IconButton } from './ui/primitives';

export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
  testID?: string;
}

export function ScreenHeader({ title, subtitle, back = true, right, testID }: ScreenHeaderProps) {
  const { colors, fontSizes, spacing } = useTheme();
  const router = useRouter();
  return (
    <View testID={testID} style={[styles.header, { paddingHorizontal: spacing.sm }]}>
      {back ? (
        <IconButton
          icon="chevron-back"
          accessibilityLabel="Назад"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          testID={testID ? `${testID}-back` : 'header-back'}
        />
      ) : (
        <View style={styles.backPlaceholder} />
      )}
      <View style={styles.titleWrap}>
        <Text numberOfLines={1} style={{ color: colors.text, fontSize: fontSizes.xl, fontWeight: '700', textAlign: 'center' }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: fontSizes.sm, textAlign: 'center', marginTop: 1 }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={styles.rightWrap}>{right ?? <View style={styles.backPlaceholder} />}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 4,
    gap: 4,
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  rightWrap: {
    minWidth: 40,
    alignItems: 'flex-end',
  },
  backPlaceholder: {
    width: 40,
  },
});
