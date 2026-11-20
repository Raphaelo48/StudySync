/**
 * Нижняя навигация: Главная · Расписание · Задачи · Прогресс · Профиль.
 */
import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/state/AppContexts';
import { useT } from '../../src/i18n/useT';

export default function TabsLayout() {
  const { colors, fontSizes } = useTheme();
  const t = useT();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.borderSoft,
        },
        tabBarLabelStyle: {
          fontSize: fontSizes.xs - 1,
          fontWeight: '600',
        },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color as string} />
          ),
          tabBarAccessibilityLabel: t('tabs.home'),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: t('tabs.schedule'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'calendar' : 'calendar-outline'} size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: t('tabs.tasks'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'checkbox' : 'checkbox-outline'} size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: t('tabs.progress'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'stats-chart' : 'stats-chart-outline'} size={size} color={color as string} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color as string} />
          ),
        }}
      />
    </Tabs>
  );
}
