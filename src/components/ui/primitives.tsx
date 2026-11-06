/**
 * Базовые примитивы дизайн-системы: кнопки, карточки, бейджи, чипы,
 * пустые состояния, заголовки секций.
 */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../state/AppContexts';

/* ---------------------------------- Button ---------------------------------- */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityHint?: string;
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  style,
  testID,
  accessibilityHint,
}: ButtonProps) {
  const { colors, radii, fontSizes, spacing } = useTheme();
  const isDisabled = disabled || loading || !onPress;

  const bg =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.surfaceAlt
          : 'transparent';
  const fg =
    variant === 'primary' || variant === 'danger'
      ? colors.onPrimary
      : variant === 'secondary'
        ? colors.text
        : colors.primary;
  const borderColor = variant === 'ghost' ? 'transparent' : variant === 'secondary' ? colors.border : bg;

  const height = size === 'lg' ? 52 : size === 'sm' ? 36 : 44;
  const fontSize = size === 'lg' ? fontSizes.lg : size === 'sm' ? fontSizes.sm : fontSizes.md;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.buttonBase,
        {
          height,
          borderRadius: radii.md,
          backgroundColor: isDisabled && variant !== 'ghost' ? colors.track : bg,
          borderColor,
          borderWidth: variant === 'secondary' ? 1 : 0,
          paddingHorizontal: size === 'sm' ? spacing.md : spacing.lg,
          opacity: isDisabled && variant === 'ghost' ? 0.4 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={fontSize + 2} color={isDisabled && variant !== 'ghost' ? colors.textMuted : fg} style={styles.buttonIcon} /> : null}
          <Text
            numberOfLines={1}
            style={{
              color: isDisabled && variant !== 'ghost' ? colors.textMuted : fg,
              fontSize,
              fontWeight: '600',
            }}
          >
            {title}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/* ---------------------------------- IconButton ---------------------------------- */

export interface IconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  accessibilityLabel: string;
  color?: string;
  size?: number;
  disabled?: boolean;
  testID?: string;
  background?: string;
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  color,
  size = 22,
  disabled = false,
  testID,
  background,
}: IconButtonProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.iconButton,
        { backgroundColor: background ?? 'transparent', opacity: pressed || disabled ? 0.5 : 1 },
      ]}
    >
      <Ionicons name={icon} size={size} color={color ?? colors.text} />
    </Pressable>
  );
}

/* ---------------------------------- Card ---------------------------------- */

export interface CardProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  padded?: boolean;
}

export function Card({ children, onPress, style, testID, padded = true }: CardProps) {
  const { colors, radii, spacing } = useTheme();
  const content = (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radii.lg,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.borderSoft,
          padding: padded ? spacing.lg : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [{ opacity: pressed ? 0.8 : 1 }]}
      >
        {content}
      </Pressable>
    );
  }
  return <View testID={testID}>{content}</View>;
}

/* ---------------------------------- SectionTitle ---------------------------------- */

export function SectionTitle({
  title,
  action,
  actionLabel,
  testID,
}: {
  title: string;
  action?: () => void;
  actionLabel?: string;
  testID?: string;
}) {
  const { colors, fontSizes, spacing } = useTheme();
  return (
    <View testID={testID} style={[styles.sectionTitleRow, { marginTop: spacing.xl, marginBottom: spacing.md }]}>
      <Text style={{ color: colors.text, fontSize: fontSizes.lg, fontWeight: '700' }}>{title}</Text>
      {action && actionLabel ? (
        <Pressable onPress={action} accessibilityRole="button" accessibilityLabel={actionLabel} hitSlop={8}>
          <Text style={{ color: colors.primary, fontSize: fontSizes.sm, fontWeight: '600' }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ---------------------------------- Badge ---------------------------------- */

export interface BadgeProps {
  label: string;
  color: string;
  softColor?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  testID?: string;
}

export function Badge({ label, color, softColor, icon, testID }: BadgeProps) {
  const { fontSizes, radii, spacing } = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.badge,
        { backgroundColor: softColor ?? `${color}22`, borderRadius: radii.full, paddingHorizontal: spacing.sm + 2 },
      ]}
    >
      {icon ? <Ionicons name={icon} size={fontSizes.xs + 1} color={color} /> : null}
      <Text style={{ color, fontSize: fontSizes.xs, fontWeight: '600' }} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/* ---------------------------------- Chip ---------------------------------- */

export interface ChipProps {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  testID?: string;
}

export function Chip({ label, selected = false, onPress, color, testID }: ChipProps) {
  const { colors, radii, fontSizes, spacing } = useTheme();
  const accent = color ?? colors.primary;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          borderRadius: radii.full,
          paddingHorizontal: spacing.md,
          backgroundColor: selected ? accent : colors.surfaceAlt,
          borderColor: selected ? accent : colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={{
          color: selected ? colors.onPrimary : colors.textSecondary,
          fontSize: fontSizes.sm,
          fontWeight: selected ? '600' : '500',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ---------------------------------- EmptyState ---------------------------------- */

export interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}

export function EmptyState({ icon = 'sparkles-outline', title, subtitle, actionLabel, onAction, testID }: EmptyStateProps) {
  const { colors, spacing } = useTheme();
  return (
    <View testID={testID} style={[styles.emptyState, { paddingVertical: spacing.xxxl }]}>
      <View style={[styles.emptyIconWrap, { backgroundColor: colors.primarySoft }]}>
        <Ionicons name={icon} size={28} color={colors.primary} />
      </View>
      <Text style={{ color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center', marginTop: spacing.md }}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={{ color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: spacing.xs, paddingHorizontal: spacing.lg }}>
          {subtitle}
        </Text>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.lg, minWidth: 180 }}>
          <Button title={actionLabel} onPress={onAction} size="sm" />
        </View>
      ) : null}
    </View>
  );
}

/* ---------------------------------- Spinner ---------------------------------- */

export function Spinner({ testID }: { testID?: string }) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={styles.spinnerWrap}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

/* ---------------------------------- Divider ---------------------------------- */

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 4 }} />;
}

const styles = StyleSheet.create({
  buttonBase: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonIcon: {
    marginRight: 0,
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 3,
  },
  chip: {
    paddingVertical: 7,
    borderWidth: 1,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerWrap: {
    paddingVertical: 32,
    alignItems: 'center',
  },
});
