import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { getDatabase } from '../src/database/sqliteDriver.ts';
import { useOutboxStore } from '../src/stores/outboxStore.ts';
import { colors } from '../src/theme/colors.ts';

export default function RootLayout() {
  useEffect(() => {
    let cleanupSync: (() => void) | undefined;
    (async () => {
      try {
        await getDatabase();
        cleanupSync = useOutboxStore.getState().initSyncEngine();
      } catch (err) {
        console.warn('[RootLayout] Local database init deferred:', err);
      }
    })();

    return () => {
      if (cleanupSync) cleanupSync();
    };
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background }
        }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
    </SafeAreaProvider>
  );
}

