/**
 * Оверлеи: нижние листы, диалоги подтверждения, хост тостов.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, useToast, type ToastKind } from '../../state/AppContexts';
import { Button } from './primitives';

/* ---------------------------------- BottomSheet ---------------------------------- */

export interface BottomSheetProps {
  visible: boolean;
  title?: string;
  onClose: () => void;
  children: React.ReactNode;
  testID?: string;
}

export function BottomSheet({ visible, title, onClose, children, testID }: BottomSheetProps) {
  const { colors, radii, spacing, fontSizes } = useTheme();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        testID={testID ? `${testID}-backdrop` : undefined}
        accessibilityRole="button"
        accessibilityLabel="Закрыть"
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={onClose}
      />
      <Animated.View
        testID={testID}
        style={[
          styles.sheet,
          {
            backgroundColor: colors.surface,
            borderTopLeftRadius: radii.xl,
            borderTopRightRadius: radii.xl,
            paddingBottom: insets.bottom + spacing.md,
            paddingHorizontal: spacing.lg,
            transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }],
          },
        ]}
      >
        <View style={[styles.sheetHandle, { backgroundColor: colors.track }]} />
        {title ? (
          <View style={styles.sheetHeader}>
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: fontSizes.lg, fontWeight: '700', flex: 1 }}>
              {title}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} hitSlop={8}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
        {children}
      </Animated.View>
    </Modal>
  );
}

/* ---------------------------------- ConfirmDialog ---------------------------------- */

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  onConfirm,
  onCancel,
  testID,
}: ConfirmDialogProps) {
  const { colors, radii, spacing, fontSizes } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={[styles.centeredBackdrop, { backgroundColor: colors.overlay }]}>
        <View
          testID={testID}
          style={[
            styles.dialog,
            { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl },
          ]}
        >
          <Text style={{ color: colors.text, fontSize: fontSizes.lg, fontWeight: '700' }}>{title}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: fontSizes.md, marginTop: spacing.sm, lineHeight: 21 }}>
            {message}
          </Text>
          <View style={styles.dialogActions}>
            <Button title={cancelLabel} variant="secondary" onPress={onCancel} style={styles.dialogButton} testID={testID ? `${testID}-cancel` : undefined} />
            <Button
              title={confirmLabel}
              variant={danger ? 'danger' : 'primary'}
              onPress={onConfirm}
              style={styles.dialogButton}
              testID={testID ? `${testID}-confirm` : undefined}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ---------------------------------- ToastHost ---------------------------------- */

const TOAST_ICONS: Record<ToastKind, keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  info: 'information-circle',
};

export function ToastHost() {
  const { toasts, hide } = useToast();
  const { colors, radii, spacing, fontSizes } = useTheme();
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      style={[styles.toastHost, { bottom: insets.bottom + 96 }]}
    >
      {toasts.map((toast) => {
        const tint =
          toast.kind === 'success' ? colors.success : toast.kind === 'error' ? colors.danger : colors.info;
        return (
          <View
            key={toast.id}
            testID={`toast-${toast.id}`}
            style={[
              styles.toast,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderRadius: radii.md,
                padding: spacing.md + 2,
                borderLeftColor: tint,
              },
            ]}
          >
            <Ionicons name={TOAST_ICONS[toast.kind]} size={20} color={tint} />
            <Text style={{ color: colors.text, fontSize: fontSizes.sm, flex: 1, lineHeight: 19 }} numberOfLines={3}>
              {toast.message}
            </Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                hitSlop={8}
                onPress={() => {
                  hide(toast.id);
                  toast.action?.onPress();
                }}
              >
                <Text style={{ color: colors.primary, fontSize: fontSizes.sm, fontWeight: '700' }}>
                  {toast.action.label}
                </Text>
              </Pressable>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Скрыть уведомление" hitSlop={8} onPress={() => hide(toast.id)}>
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginTop: 10,
    marginBottom: 6,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    gap: 12,
  },
  centeredBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
  },
  dialogActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
  },
  dialogButton: {
    flex: 1,
  },
  toastHost: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'stretch',
    gap: 8,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderLeftWidth: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
