/**
 * Компоненты ввода: текстовые поля, степпер числа, переключатель,
 * сегментированный контрол, поле выбора из списка.
 */
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
  type TextInputProps,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../state/AppContexts';
import { IconButton } from './primitives';
import { BottomSheet } from './overlays';

/* ---------------------------------- TextField ---------------------------------- */

export interface TextFieldProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  error?: string | null;
  multiline?: boolean;
  maxLength?: number;
  keyboardType?: TextInputProps['keyboardType'];
  autoFocus?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  editable?: boolean;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  multiline = false,
  maxLength = 500,
  keyboardType = 'default',
  autoFocus = false,
  testID,
  style,
  editable = true,
  secureTextEntry = false,
  autoCapitalize = 'sentences',
}: TextFieldProps) {
  const { colors, radii, fontSizes, spacing } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ marginBottom: spacing.lg }, style]}>
      {label ? (
        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginBottom: spacing.xs + 2 }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        multiline={multiline}
        maxLength={maxLength}
        keyboardType={keyboardType}
        autoFocus={autoFocus}
        editable={editable}
        secureTextEntry={secureTextEntry}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={label ?? placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          {
            backgroundColor: colors.surfaceAlt,
            borderRadius: radii.md,
            borderWidth: 1,
            borderColor: error ? colors.danger : focused ? colors.primary : colors.border,
            color: colors.text,
            fontSize: fontSizes.md,
            paddingHorizontal: spacing.md + 2,
            paddingVertical: multiline ? spacing.md : 0,
            minHeight: multiline ? 88 : 46,
            textAlignVertical: multiline ? 'top' : 'center',
          },
        ]}
      />
      {error ? (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={13} color={colors.danger} />
          <Text testID={testID ? `${testID}-error` : undefined} style={{ color: colors.danger, fontSize: fontSizes.xs + 1 }}>
            {error}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/* ---------------------------------- NumberStepper ---------------------------------- */

export interface NumberStepperProps {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  testID?: string;
}

export function NumberStepper({
  label,
  value,
  onChange,
  min = 1,
  max = 999,
  step = 5,
  unit,
  testID,
}: NumberStepperProps) {
  const { colors, radii, fontSizes, spacing } = useTheme();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <View style={{ marginBottom: spacing.lg }}>
      {label ? (
        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginBottom: spacing.xs + 2 }}>
          {label}
        </Text>
      ) : null}
      <View
        testID={testID}
        style={[
          styles.stepperRow,
          { backgroundColor: colors.surfaceAlt, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
        ]}
      >
        <IconButton
          testID={testID ? `${testID}-dec` : undefined}
          icon="remove"
          accessibilityLabel="Уменьшить"
          color={value <= min ? colors.textMuted : colors.primary}
          onPress={() => onChange(clamp(value - step))}
          disabled={value <= min}
        />
        <Pressable
          accessibilityRole="adjustable"
          accessibilityLabel={label}
          accessibilityValue={{ min, max, now: value }}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === 'increment') onChange(clamp(value + step));
            if (e.nativeEvent.actionName === 'decrement') onChange(clamp(value - step));
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          style={styles.stepperValue}
        >
          <Text style={{ color: colors.text, fontSize: fontSizes.md, fontWeight: '600' }}>
            {value}
            {unit ? <Text style={{ color: colors.textMuted, fontWeight: '400' }}> {unit}</Text> : null}
          </Text>
        </Pressable>
        <IconButton
          testID={testID ? `${testID}-inc` : undefined}
          icon="add"
          accessibilityLabel="Увеличить"
          color={value >= max ? colors.textMuted : colors.primary}
          onPress={() => onChange(clamp(value + step))}
          disabled={value >= max}
        />
      </View>
    </View>
  );
}

/* ---------------------------------- SwitchRow ---------------------------------- */

export interface SwitchRowProps {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
}

export function SwitchRow({ label, description, value, onValueChange, disabled = false, testID }: SwitchRowProps) {
  const { colors, fontSizes, spacing } = useTheme();
  return (
    <View testID={testID} style={[styles.switchRow, { paddingVertical: spacing.md }]}>
      <View style={styles.switchTextWrap}>
        <Text style={{ color: disabled ? colors.textMuted : colors.text, fontSize: fontSizes.md, fontWeight: '500' }}>
          {label}
        </Text>
        {description ? (
          <Text style={{ color: colors.textMuted, fontSize: fontSizes.sm, marginTop: 2 }}>{description}</Text>
        ) : null}
      </View>
      <Switch
        testID={testID ? `${testID}-switch` : undefined}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.track, true: colors.primary }}
        thumbColor={colors.surface}
        accessibilityLabel={label}
      />
    </View>
  );
}

/* ---------------------------------- SegmentedControl ---------------------------------- */

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export interface SegmentedControlProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}

export function SegmentedControl<T extends string | number>({ options, value, onChange, testID }: SegmentedControlProps<T>) {
  const { colors, radii, fontSizes } = useTheme();
  return (
    <View
      testID={testID}
      style={[styles.segmentedWrap, { backgroundColor: colors.surfaceAlt, borderRadius: radii.md }]}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            testID={testID ? `${testID}-${opt.value}` : undefined}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(opt.value)}
            style={[
              styles.segment,
              {
                backgroundColor: selected ? colors.surface : 'transparent',
                borderRadius: radii.sm + 2,
              },
            ]}
          >
            {opt.icon ? (
              <Ionicons name={opt.icon} size={14} color={selected ? colors.primary : colors.textMuted} />
            ) : null}
            <Text
              numberOfLines={1}
              style={{
                color: selected ? colors.text : colors.textMuted,
                fontSize: fontSizes.sm,
                fontWeight: selected ? '600' : '500',
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ---------------------------------- SelectField ---------------------------------- */

export interface SelectOption {
  value: string;
  label: string;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

export interface SelectFieldProps {
  label?: string;
  options: SelectOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  clearLabel?: string;
  error?: string | null;
  testID?: string;
}

export function SelectField({
  label,
  options,
  value,
  onChange,
  placeholder = 'Не выбрано',
  allowClear = false,
  clearLabel = 'Не выбирать',
  error,
  testID,
}: SelectFieldProps) {
  const { colors, radii, fontSizes, spacing } = useTheme();
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value) ?? null;

  return (
    <View style={{ marginBottom: spacing.lg }}>
      {label ? (
        <Text style={{ color: colors.textSecondary, fontSize: fontSizes.sm, fontWeight: '600', marginBottom: spacing.xs + 2 }}>
          {label}
        </Text>
      ) : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${selected?.label ?? placeholder}` : placeholder}
        onPress={() => setOpen(true)}
        style={[
          styles.selectTrigger,
          {
            backgroundColor: colors.surfaceAlt,
            borderRadius: radii.md,
            borderColor: error ? colors.danger : colors.border,
            paddingHorizontal: spacing.md + 2,
          },
        ]}
      >
        {selected?.color ? <View style={[styles.colorDot, { backgroundColor: selected.color }]} /> : null}
        {selected?.icon ? <Ionicons name={selected.icon} size={16} color={colors.textSecondary} /> : null}
        <Text
          numberOfLines={1}
          style={{
            color: selected ? colors.text : colors.textMuted,
            fontSize: fontSizes.md,
            flex: 1,
          }}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>
      {error ? (
        <Text style={{ color: colors.danger, fontSize: fontSizes.xs + 1, marginTop: 4 }}>{error}</Text>
      ) : null}

      <BottomSheet visible={open} title={label ?? 'Выберите значение'} onClose={() => setOpen(false)}>
        <ScrollView style={{ maxHeight: 420 }} bounces={false}>
          {allowClear ? (
            <Pressable
              testID={testID ? `${testID}-clear` : undefined}
              accessibilityRole="button"
              onPress={() => {
                onChange(null);
                setOpen(false);
              }}
              style={[styles.selectOption, { borderBottomColor: colors.borderSoft, borderBottomWidth: StyleSheet.hairlineWidth }]}
            >
              <Ionicons name="close-circle-outline" size={18} color={colors.textMuted} />
              <Text style={{ color: colors.textMuted, fontSize: fontSizes.md }}>{clearLabel}</Text>
            </Pressable>
          ) : null}
          {options.map((opt) => (
            <Pressable
              key={opt.value}
              testID={testID ? `${testID}-opt-${opt.value}` : undefined}
              accessibilityRole="button"
              accessibilityState={{ selected: opt.value === value }}
              onPress={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              style={[styles.selectOption, { borderBottomColor: colors.borderSoft, borderBottomWidth: StyleSheet.hairlineWidth }]}
            >
              {opt.color ? <View style={[styles.colorDot, { backgroundColor: opt.color }]} /> : null}
              {opt.icon && !opt.color ? <Ionicons name={opt.icon} size={18} color={colors.textSecondary} /> : null}
              <Text style={{ color: colors.text, fontSize: fontSizes.md, flex: 1 }} numberOfLines={1}>
                {opt.label}
              </Text>
              {opt.value === value ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
            </Pressable>
          ))}
          <View style={{ height: 16 }} />
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 46,
  },
  stepperValue: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  switchTextWrap: {
    flex: 1,
  },
  segmentedWrap: {
    flexDirection: 'row',
    padding: 3,
    gap: 2,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  selectTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
    borderWidth: 1,
  },
  selectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 13,
    paddingHorizontal: 4,
  },
  colorDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
});
