import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme/colors.ts';
import { useOutboxStore } from '../../src/stores/outboxStore.ts';
import { OutboxRepository } from '../../src/database/outboxRepository.ts';
import { getDatabase } from '../../src/database/sqliteDriver.ts';
import type { OutboxEvent } from '../../src/database/schema.ts';

export default function OutboxScreen() {
  const {
    isSyncing,
    isOnline,
    pendingCount,
    inFlightCount,
    processedCount,
    failedCount,
    lastSyncTimestamp,
    lastError,
    backendUrl,
    setBackendUrl,
    triggerManualSync,
    setOnlineStatus
  } = useOutboxStore();

  const [events, setEvents] = useState<OutboxEvent[]>([]);
  const [editingUrl, setEditingUrl] = useState(backendUrl);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setEditingUrl(backendUrl);
  }, [backendUrl]);

  const loadQueue = useCallback(async () => {
    try {
      const db = await getDatabase();
      const rows = await db.getAllAsync<OutboxEvent>(
        'SELECT * FROM outbox_events ORDER BY created_at DESC LIMIT 50'
      );
      setEvents(rows);
    } catch {
      // Fallback
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue, pendingCount, inFlightCount, processedCount, failedCount]);

  const handleManualSync = async () => {
    setRefreshing(true);
    await triggerManualSync();
    await loadQueue();
    setRefreshing(false);
  };

  const handleSimulateOfflineToggle = () => {
    const nextStatus = !isOnline;
    setOnlineStatus(nextStatus);
    Alert.alert(
      nextStatus ? 'Online Mode Restored' : 'Simulated Offline Mode',
      nextStatus
        ? 'Connected to network. Outbox will automatically push queued events.'
        : 'Network disconnected. All reports and diagnostics will be safely queued locally in SQLite.'
    );
  };

  const renderStatusBadge = (status: OutboxEvent['status']) => {
    let bg = colors.badgePending;
    let textColor = colors.warning;
    let icon: any = 'time-outline';

    if (status === 'PROCESSED') {
      bg = colors.badgeOnline;
      textColor = colors.success;
      icon = 'checkmark-circle-outline';
    } else if (status === 'IN_FLIGHT') {
      bg = colors.badgeInFlight;
      textColor = colors.info;
      icon = 'cloud-upload-outline';
    } else if (status === 'FAILED') {
      bg = colors.badgeOffline;
      textColor = colors.danger;
      icon = 'alert-circle-outline';
    }

    return (
      <View style={[styles.badgeContainer, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={13} color={textColor} style={{ marginRight: 4 }} />
        <Text style={[styles.badgeText, { color: textColor }]}>{status}</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Outbox Queue Manager</Text>
          <Text style={styles.headerSubtitle}>Offline-First Deferred Synchronization</Text>
        </View>
        <TouchableOpacity
          style={[styles.networkToggle, { backgroundColor: isOnline ? colors.badgeOnline : colors.badgeOffline }]}
          onPress={handleSimulateOfflineToggle}
        >
          <Ionicons
            name={isOnline ? 'wifi' : 'cloud-offline-outline'}
            size={16}
            color={isOnline ? colors.success : colors.danger}
          />
          <Text style={[styles.networkToggleText, { color: isOnline ? colors.success : colors.danger }]}>
            {isOnline ? 'ONLINE' : 'OFFLINE'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Metrics Row */}
      <View style={styles.metricsContainer}>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Pending</Text>
          <Text style={[styles.metricValue, { color: colors.warning }]}>{pendingCount}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>In Flight</Text>
          <Text style={[styles.metricValue, { color: colors.info }]}>{inFlightCount}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Synced</Text>
          <Text style={[styles.metricValue, { color: colors.success }]}>{processedCount}</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricLabel}>Failed</Text>
          <Text style={[styles.metricValue, { color: colors.danger }]}>{failedCount}</Text>
        </View>
      </View>

      {/* Server Config & Manual Sync Button */}
      <View style={styles.configCard}>
        <Text style={styles.configLabel}>Sync Endpoint API</Text>
        <View style={styles.urlInputRow}>
          <TextInput
            style={styles.urlInput}
            value={editingUrl}
            onChangeText={setEditingUrl}
            onBlur={() => setBackendUrl(editingUrl)}
            placeholder="http://10.0.2.2:3002"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
          />
          <TouchableOpacity
            style={[styles.syncButton, (isSyncing || refreshing) && styles.syncButtonDisabled]}
            onPress={handleManualSync}
            disabled={isSyncing || refreshing}
          >
            {isSyncing || refreshing ? (
              <ActivityIndicator size="small" color="#000000" />
            ) : (
              <>
                <Ionicons name="sync" size={16} color="#000000" style={{ marginRight: 6 }} />
                <Text style={styles.syncButtonText}>Sync Now</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {lastSyncTimestamp && (
          <Text style={styles.lastSyncText}>
            Last successful sync: {new Date(lastSyncTimestamp).toLocaleTimeString()}
          </Text>
        )}
        {lastError && (
          <View style={styles.errorBox}>
            <Ionicons name="warning-outline" size={14} color={colors.danger} />
            <Text style={styles.errorText} numberOfLines={2}>
              {lastError}
            </Text>
          </View>
        )}
      </View>

      {/* Event List */}
      <View style={styles.listSection}>
        <View style={styles.listHeaderRow}>
          <Text style={styles.listSectionTitle}>Queued Events ({events.length})</Text>
          <TouchableOpacity onPress={loadQueue}>
            <Ionicons name="refresh" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={events}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="file-tray-outline" size={44} color={colors.textMuted} />
              <Text style={styles.emptyText}>Outbox is clear</Text>
              <Text style={styles.emptySubtext}>New reports and diagnostics will appear here when offline.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.eventCard}>
              <View style={styles.eventTopRow}>
                <View style={styles.eventTypeContainer}>
                  <Text style={styles.eventTypeText}>{item.event_type}</Text>
                  <Text style={styles.entityIdText}>ID: {item.entity_id}</Text>
                </View>
                {renderStatusBadge(item.status)}
              </View>

              <View style={styles.eventMetaRow}>
                <Text style={styles.metaLabel}>Retries: {item.retry_count}/{item.max_retries}</Text>
                <Text style={styles.metaLabel}>
                  {new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </Text>
              </View>

              {item.last_error && (
                <Text style={styles.eventErrorText} numberOfLines={2}>
                  Error: {item.last_error}
                </Text>
              )}
            </View>
          )}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.textPrimary
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2
  },
  networkToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 16
  },
  networkToggleText: {
    fontSize: 11,
    fontWeight: '700',
    marginLeft: 4
  },
  metricsContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border
  },
  metricLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
    textTransform: 'uppercase'
  },
  metricValue: {
    fontSize: 20,
    fontWeight: 'bold'
  },
  configCard: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12
  },
  configLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 6,
    textTransform: 'uppercase'
  },
  urlInputRow: {
    flexDirection: 'row',
    gap: 8
  },
  urlInput: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.borderLight
  },
  syncButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 6
  },
  syncButtonDisabled: {
    opacity: 0.6
  },
  syncButtonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold'
  },
  lastSyncText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 6
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    padding: 6,
    backgroundColor: colors.badgeOffline,
    borderRadius: 4,
    gap: 6
  },
  errorText: {
    fontSize: 11,
    color: colors.danger,
    flex: 1
  },
  listSection: {
    flex: 1,
    paddingHorizontal: 16
  },
  listHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8
  },
  listSectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary
  },
  listContent: {
    paddingBottom: 24,
    gap: 8
  },
  eventCard: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border
  },
  eventTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 6
  },
  eventTypeContainer: {
    flex: 1
  },
  eventTypeText: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.primary
  },
  entityIdText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12
  },
  badgeText: {
    fontSize: 10,
    fontWeight: 'bold'
  },
  eventMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4
  },
  metaLabel: {
    fontSize: 11,
    color: colors.textMuted
  },
  eventErrorText: {
    fontSize: 11,
    color: colors.danger,
    marginTop: 4
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: 8
  },
  emptySubtext: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    paddingHorizontal: 20
  }
});

