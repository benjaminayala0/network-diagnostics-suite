import React, { useState, useEffect } from 'react';
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
import { DevicesRepository } from '../../src/database/devicesRepository.ts';
import { OutboxRepository } from '../../src/database/outboxRepository.ts';
import type { DiscoveredDevice } from '../../src/database/schema.ts';
import { useRouter } from 'expo-router';

export default function DiscoveryScreen() {
  const router = useRouter();
  const [subnet, setSubnet] = useState('192.168.1');
  const [isScanning, setIsScanning] = useState(false);
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);

  const loadDevices = async () => {
    try {
      const list = await DevicesRepository.listAll();
      setDevices(list);
    } catch (err) {
      console.warn('Failed to load devices:', err);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const handleScanSubnet = async () => {
    setIsScanning(true);

    // Mock/Simulated network ARP sweep & ping scan across targeted subnet
    const mockFindings: DiscoveredDevice[] = [
      {
        id: `dev_${subnet}_1`,
        ip: `${subnet}.1`,
        mac: 'C4:72:95:22:11:01',
        hostname: 'gw-core.telecom.net',
        vendor: 'Cisco Systems',
        status: 'ONLINE',
        response_time_ms: 4,
        last_seen: Date.now(),
        created_at: Date.now()
      },
      {
        id: `dev_${subnet}_10`,
        ip: `${subnet}.10`,
        mac: '00:0C:29:84:AA:32',
        hostname: 'edge-switch-01',
        vendor: 'MikroTik RouterOS',
        status: 'ONLINE',
        response_time_ms: 12,
        last_seen: Date.now(),
        created_at: Date.now()
      },
      {
        id: `dev_${subnet}_25`,
        ip: `${subnet}.25`,
        mac: 'E0:63:DA:BC:54:19',
        hostname: 'ont-gpon-station',
        vendor: 'Huawei Technologies',
        status: 'ONLINE',
        response_time_ms: 8,
        last_seen: Date.now(),
        created_at: Date.now()
      },
      {
        id: `dev_${subnet}_50`,
        ip: `${subnet}.50`,
        mac: 'F4:92:BF:AA:01:88',
        hostname: 'ap-sectorial-tower',
        vendor: 'Ubiquiti Networks',
        status: 'ONLINE',
        response_time_ms: 15,
        last_seen: Date.now(),
        created_at: Date.now()
      }
    ];

    // Artificial scan delay
    setTimeout(async () => {
      for (const dev of mockFindings) {
        await DevicesRepository.upsert(dev);
        await OutboxRepository.enqueue('DEVICE_DISCOVERED', dev.id, dev);
      }
      await loadDevices();
      setIsScanning(false);
    }, 1500);
  };

  const handleQuickDiagnose = (ip: string) => {
    router.push({
      pathname: '/diagnostics' as any,
      params: { targetIp: ip }
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTextContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>Network Discovery</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>Subnet ARP & Host Discovery</Text>
        </View>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={loadDevices}
        >
          <Ionicons name="refresh" size={18} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Subnet Input & Scan Bar */}
      <View style={styles.scanControls}>
        <View style={styles.inputContainer}>
          <Ionicons name="git-network-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.subnetInput}
            value={subnet}
            onChangeText={setSubnet}
            placeholder="192.168.1"
            placeholderTextColor={colors.textMuted}
            keyboardType="numeric"
          />
          <Text style={styles.subnetMask}>.0/24</Text>
        </View>

        <TouchableOpacity
          style={[styles.scanButton, isScanning && styles.scanButtonDisabled]}
          onPress={handleScanSubnet}
          disabled={isScanning}
        >
          {isScanning ? (
            <ActivityIndicator size="small" color="#000000" />
          ) : (
            <>
              <Ionicons name="scan-outline" size={16} color="#000000" style={{ marginRight: 6 }} />
              <Text style={styles.scanButtonText}>Scan LAN</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Discovered Devices List */}
      <View style={styles.listSection}>
        <Text style={styles.sectionTitle}>
          Discovered Equipment ({devices.length})
        </Text>

        <FlatList
          data={devices}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="hardware-chip-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyText}>No devices detected</Text>
              <Text style={styles.emptySubtext}>
                Specify your field subnet and tap "Scan LAN" to discover active network nodes.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.deviceCard}>
              <View style={styles.deviceHeader}>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceIp}>{item.ip}</Text>
                  <Text style={styles.deviceHostname}>{item.hostname || 'Unknown hostname'}</Text>
                </View>
                <View style={styles.statusBadge}>
                  <View style={styles.onlineDot} />
                  <Text style={styles.statusText}>{item.status}</Text>
                  {item.response_time_ms !== null && (
                    <Text style={styles.latencyText}>{item.response_time_ms} ms</Text>
                  )}
                </View>
              </View>

              <View style={styles.deviceMeta}>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>VENDOR</Text>
                  <Text style={styles.metaValue}>{item.vendor || 'Generic Network Node'}</Text>
                </View>
                <View style={styles.metaCol}>
                  <Text style={styles.metaLabel}>MAC ADDRESS</Text>
                  <Text style={styles.metaValue}>{item.mac}</Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.diagButton}
                  onPress={() => handleQuickDiagnose(item.ip)}
                >
                  <Ionicons name="pulse" size={14} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text style={styles.diagButtonText}>Run Diagnostics</Text>
                </TouchableOpacity>
              </View>
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
  headerTextContainer: {
    flex: 1,
    marginRight: 10
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
  refreshButton: {
    padding: 8
  },
  scanControls: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  inputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.borderLight
  },
  subnetInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingVertical: 8
  },
  subnetMask: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600'
  },
  scanButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 8
  },
  scanButtonDisabled: {
    opacity: 0.6
  },
  scanButtonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold'
  },
  listSection: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase'
  },
  listContent: {
    paddingBottom: 24,
    gap: 10
  },
  deviceCard: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.border
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8
  },
  deviceInfo: {
    flex: 1
  },
  deviceIp: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.primary
  },
  deviceHostname: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.badgeOnline,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: colors.success
  },
  latencyText: {
    fontSize: 10,
    color: colors.textSecondary,
    marginLeft: 2
  },
  deviceMeta: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceLight,
    padding: 8,
    borderRadius: 6,
    marginBottom: 8,
    gap: 12
  },
  metaCol: {
    flex: 1
  },
  metaLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
    marginBottom: 2
  },
  metaValue: {
    fontSize: 11,
    color: colors.textPrimary,
    fontWeight: '500'
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end'
  },
  diagButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    backgroundColor: 'rgba(0, 210, 255, 0.1)'
  },
  diagButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary
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

