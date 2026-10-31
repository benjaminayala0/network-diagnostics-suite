import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme/colors.ts';
import { DiagnosticsRepository } from '../../src/database/diagnosticsRepository.ts';
import { OutboxRepository } from '../../src/database/outboxRepository.ts';
import { useLocalSearchParams } from 'expo-router';
import { useOutboxStore } from '../../src/stores/outboxStore.ts';
import { CredentialStoreService } from '../../src/services/security/credentialStore.ts';
import { formatTimeTicks } from '../../src/services/protocols/snmpParser.ts';

export default function DiagnosticsScreen() {
  const params = useLocalSearchParams();
  const backendUrl = useOutboxStore((state) => state.backendUrl);

  const [targetIp, setTargetIp] = useState((params.targetIp as string) || '127.0.0.1');
  const [protocol, setProtocol] = useState<'SNMP' | 'SSH'>('SNMP');
  const [loading, setLoading] = useState(false);
  const [terminalOutput, setTerminalOutput] = useState<string>('Ready for diagnostic run. Select parameters and execute.');

  // SNMP states
  const [community, setCommunity] = useState('public');
  const [snmpPort, setSnmpPort] = useState('1161');
  const [selectedOid, setSelectedOid] = useState('1.3.6.1.2.1.1.1.0');

  // SSH states
  const [sshPort, setSshPort] = useState('2222');
  const [sshCommand, setSshCommand] = useState('show interfaces');

  // Keystore / Security states
  const [hasSavedCreds, setHasSavedCreds] = useState(false);
  const [showCredModal, setShowCredModal] = useState(false);
  const [keystoreUser, setKeystoreUser] = useState('telecom_admin');
  const [keystorePass, setKeystorePass] = useState('');
  const [keystoreCommunity, setKeystoreCommunity] = useState('public');

  const checkKeystore = async (ip: string) => {
    try {
      const exists = await CredentialStoreService.hasCredentials(ip);
      setHasSavedCreds(exists);
    } catch {
      setHasSavedCreds(false);
    }
  };

  useEffect(() => {
    if (params.targetIp) {
      setTargetIp(params.targetIp as string);
      checkKeystore(params.targetIp as string);
    } else {
      checkKeystore(targetIp);
    }
  }, [params.targetIp, targetIp]);

  const handleLoadSavedCreds = async () => {
    try {
      const creds = await CredentialStoreService.getCredentials(targetIp);
      if (creds) {
        if (creds.snmpCommunity) setCommunity(creds.snmpCommunity);
        if (creds.port) {
          if (protocol === 'SSH') setSshPort(String(creds.port));
          else setSnmpPort(String(creds.port));
        }
        Alert.alert('Keystore Retrieved', `Loaded secure credentials for ${targetIp} (User: ${creds.username}).`);
      }
    } catch {
      Alert.alert('Keystore Error', 'Could not decrypt credentials from secure hardware storage.');
    }
  };

  const handleSaveToKeystore = async () => {
    try {
      await CredentialStoreService.saveCredentials({
        host: targetIp,
        username: keystoreUser,
        authType: 'PASSWORD',
        secret: keystorePass || 'telecom#2026',
        port: parseInt(protocol === 'SSH' ? sshPort : snmpPort, 10),
        snmpCommunity: keystoreCommunity,
        updatedAt: Date.now()
      });
      setHasSavedCreds(true);
      setShowCredModal(false);
      Alert.alert('Keystore Updated', `Hardware-backed secure enclave saved credentials for ${targetIp}.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to save to secure store.');
    }
  };

  const handleRunDiagnostic = async () => {
    setLoading(true);
    setTerminalOutput(`[${new Date().toLocaleTimeString()}] Initiating ${protocol} query to ${targetIp}...\nConnecting...`);

    const startTime = Date.now();
    try {
      let rawResult = '';
      let parsedData: any = null;

      if (protocol === 'SNMP') {
        const queryUrl = `${backendUrl.replace(/\/$/, '')}/api/snmp/query?host=${encodeURIComponent(targetIp)}&port=${snmpPort}&oid=${encodeURIComponent(selectedOid)}&community=${encodeURIComponent(community)}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        let res: Response;
        try {
          res = await fetch(queryUrl, { signal: controller.signal });
        } finally {
          clearTimeout(timeoutId);
        }
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || `SNMP query failed with HTTP ${res.status}`);
        }
        rawResult = JSON.stringify(json, null, 2);
        parsedData = json;
      } else {
        const execUrl = `${backendUrl.replace(/\/$/, '')}/api/ssh/execute`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        let res: Response;
        try {
          res = await fetch(execUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              host: targetIp,
              port: parseInt(sshPort, 10),
              command: sshCommand
            }),
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json.error || `SSH execution failed with HTTP ${res.status}`);
        }
        rawResult = json.output || json.raw || JSON.stringify(json);
        parsedData = json;
      }

      const elapsed = Date.now() - startTime;
      const formattedOutput = `[${new Date().toLocaleTimeString()}] Diagnostics Successful (${elapsed} ms)\nTarget: ${targetIp}\nProtocol: ${protocol}\n----------------------------------------\n${rawResult}`;
      setTerminalOutput(formattedOutput);

      // Persist to local SQLite store
      const session = {
        id: 'sess_' + Date.now().toString(36),
        device_id: null,
        device_ip: targetIp,
        protocol: protocol as any,
        target_oid_or_cmd: protocol === 'SNMP' ? selectedOid : sshCommand,
        raw_output: rawResult,
        parsed_data_json: JSON.stringify(parsedData),
        status: 'SUCCESS' as const,
        execution_time_ms: elapsed,
        created_at: Date.now()
      };
      await DiagnosticsRepository.insert(session);

      // Enqueue to Outbox
      await OutboxRepository.enqueue('DIAGNOSTIC_RECORDED', session.id, session);
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      const isConnectionError =
        err.name === 'AbortError' ||
        err.name === 'TypeError' ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('Network request failed');

      let diagnosticDetails = err.message || 'Network Timeout';
      if (isConnectionError) {
        diagnosticDetails += `\n\n[Diagnostic Engine Notice]\nSync backend at ${backendUrl} is currently offline or unreachable.\nTo test live queries against the mock agents (SNMP:1161 / SSH:2222), start the backend server:\n  cd backend && npm run dev`;
      }

      const errorMsg = `[${new Date().toLocaleTimeString()}] Diagnostic Failed (${elapsed} ms)\nError: ${diagnosticDetails}`;
      setTerminalOutput(errorMsg);

      // Persist error session locally
      try {
        const session = {
          id: 'sess_err_' + Date.now().toString(36),
          device_id: null,
          device_ip: targetIp,
          protocol: protocol as any,
          target_oid_or_cmd: protocol === 'SNMP' ? selectedOid : sshCommand,
          raw_output: err.message || 'Error',
          parsed_data_json: null,
          status: 'ERROR' as const,
          execution_time_ms: elapsed,
          created_at: Date.now()
        };
        await DiagnosticsRepository.insert(session);
        await OutboxRepository.enqueue('DIAGNOSTIC_RECORDED', session.id, session);
      } catch {
        // Fallback
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Field Diagnostics Engine</Text>
          <Text style={styles.headerSubtitle}>SNMP MIB-II & SSH Diagnostic Remote Shell</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Protocol Selector */}
        <View style={styles.protocolTabs}>
          <TouchableOpacity
            style={[styles.protocolTab, protocol === 'SNMP' && styles.protocolTabActive]}
            onPress={() => setProtocol('SNMP')}
          >
            <Ionicons
              name="analytics-outline"
              size={16}
              color={protocol === 'SNMP' ? '#000000' : colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.protocolTabText, protocol === 'SNMP' && styles.protocolTabTextActive]}>
              SNMP Protocol
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.protocolTab, protocol === 'SSH' && styles.protocolTabActive]}
            onPress={() => setProtocol('SSH')}
          >
            <Ionicons
              name="terminal-outline"
              size={16}
              color={protocol === 'SSH' ? '#000000' : colors.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.protocolTabText, protocol === 'SSH' && styles.protocolTabTextActive]}>
              SSH Remote Shell
            </Text>
          </TouchableOpacity>
        </View>

        {/* Target Address Card */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Target Host Configuration</Text>
            {hasSavedCreds ? (
              <TouchableOpacity style={styles.keystoreBadge} onPress={handleLoadSavedCreds}>
                <Ionicons name="lock-closed" size={12} color={colors.success} style={{ marginRight: 4 }} />
                <Text style={styles.keystoreBadgeText}>Keystore Saved</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.keystoreAction} onPress={() => setShowCredModal(true)}>
                <Ionicons name="shield-checkmark-outline" size={12} color={colors.primary} style={{ marginRight: 4 }} />
                <Text style={styles.keystoreActionText}>Store in Keystore</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.row}>
            <View style={{ flex: 2 }}>
              <Text style={styles.inputLabel}>Host / IP Address</Text>
              <TextInput
                style={styles.input}
                value={targetIp}
                onChangeText={setTargetIp}
                placeholder="192.168.1.1"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.inputLabel}>Port</Text>
              <TextInput
                style={styles.input}
                value={protocol === 'SNMP' ? snmpPort : sshPort}
                onChangeText={protocol === 'SNMP' ? setSnmpPort : setSshPort}
                keyboardType="numeric"
              />
            </View>
          </View>
        </View>

        {/* Protocol-Specific Parameters */}
        {protocol === 'SNMP' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>SNMP MIB-II Parameters</Text>
            <Text style={styles.inputLabel}>Community String</Text>
            <TextInput
              style={styles.input}
              value={community}
              onChangeText={setCommunity}
              placeholder="public"
              placeholderTextColor={colors.textMuted}
            />

            <Text style={[styles.inputLabel, { marginTop: 10 }]}>Standard OID Query Preset</Text>
            <View style={styles.presetGrid}>
              {[
                { label: 'sysDescr (1.1.0)', oid: '1.3.6.1.2.1.1.1.0' },
                { label: 'sysUpTime (1.3.0)', oid: '1.3.6.1.2.1.1.3.0' },
                { label: 'sysName (1.5.0)', oid: '1.3.6.1.2.1.1.5.0' },
                { label: 'ifInOctets.1', oid: '1.3.6.1.2.1.2.2.1.10.1' },
                { label: 'ifOutOctets.1', oid: '1.3.6.1.2.1.2.2.1.16.1' },
                { label: 'ifOperStatus.1', oid: '1.3.6.1.2.1.2.2.1.8.1' }
              ].map((item) => (
                <TouchableOpacity
                  key={item.oid}
                  style={[styles.presetChip, selectedOid === item.oid && styles.presetChipActive]}
                  onPress={() => setSelectedOid(item.oid)}
                >
                  <Text style={[styles.presetChipText, selectedOid === item.oid && styles.presetChipTextActive]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Vendor Command Preset</Text>
            <View style={styles.presetGrid}>
              {[
                'show interfaces',
                'show ip route',
                'show version',
                'system resource print',
                'ping 8.8.8.8 count 3'
              ].map((cmd) => (
                <TouchableOpacity
                  key={cmd}
                  style={[styles.presetChip, sshCommand === cmd && styles.presetChipActive]}
                  onPress={() => setSshCommand(cmd)}
                >
                  <Text style={[styles.presetChipText, sshCommand === cmd && styles.presetChipTextActive]}>
                    {cmd}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={[styles.inputLabel, { marginTop: 10 }]}>Command to Execute</Text>
            <TextInput
              style={styles.input}
              value={sshCommand}
              onChangeText={setSshCommand}
              autoCapitalize="none"
            />
          </View>
        )}

        {/* Action Button */}
        <TouchableOpacity
          style={[styles.executeButton, loading && styles.executeButtonDisabled]}
          onPress={handleRunDiagnostic}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#000000" />
          ) : (
            <>
              <Ionicons name="play" size={16} color="#000000" style={{ marginRight: 6 }} />
              <Text style={styles.executeButtonText}>Execute {protocol} Diagnostic</Text>
            </>
          )}
        </TouchableOpacity>

        {/* Monospace Output Terminal */}
        <View style={styles.terminalContainer}>
          <View style={styles.terminalHeader}>
            <View style={styles.terminalDots}>
              <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
              <View style={[styles.dot, { backgroundColor: '#F59E0B' }]} />
              <View style={[styles.dot, { backgroundColor: '#10B981' }]} />
            </View>
            <Text style={styles.terminalTitle}>CONSOLE OUTPUT</Text>
          </View>
          <ScrollView style={styles.terminalBody} nestedScrollEnabled>
            <Text style={styles.terminalText}>{terminalOutput}</Text>
          </ScrollView>
        </View>
      </ScrollView>

      {/* Keystore Modal */}
      <Modal visible={showCredModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="shield-checkmark" size={18} color={colors.primary} />
                <Text style={styles.modalTitle}>Hardware Keystore Storage</Text>
              </View>
              <TouchableOpacity onPress={() => setShowCredModal(false)}>
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 16 }}>
              <Text style={styles.keystoreNote}>
                Credentials are encrypted into hardware-backed Android Keystore / iOS Keychain (OWASP MASVS compliant).
              </Text>

              <Text style={styles.inputLabel}>Host Target</Text>
              <TextInput style={styles.modalInput} value={targetIp} editable={false} />

              <Text style={styles.inputLabel}>SSH Username</Text>
              <TextInput
                style={styles.modalInput}
                value={keystoreUser}
                onChangeText={setKeystoreUser}
                placeholder="admin"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
              />

              <Text style={styles.inputLabel}>SSH Password / Secret</Text>
              <TextInput
                style={styles.modalInput}
                value={keystorePass}
                onChangeText={setKeystorePass}
                placeholder="••••••••••••"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
              />

              <Text style={styles.inputLabel}>SNMP Community String</Text>
              <TextInput
                style={styles.modalInput}
                value={keystoreCommunity}
                onChangeText={setKeystoreCommunity}
                placeholder="public"
                placeholderTextColor={colors.textMuted}
              />

              <TouchableOpacity style={styles.modalSaveButton} onPress={handleSaveToKeystore}>
                <Ionicons name="lock-closed" size={16} color="#000000" style={{ marginRight: 6 }} />
                <Text style={styles.modalSaveButtonText}>Encrypt & Save to Keystore</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10
  },
  keystoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.badgeOnline,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12
  },
  keystoreBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: colors.success
  },
  keystoreAction: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 210, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12
  },
  keystoreActionText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: colors.primary
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: 'center',
    padding: Platform.OS === 'web' ? 20 : 0
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderBottomLeftRadius: Platform.OS === 'web' ? 16 : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? 16 : 0,
    padding: 16,
    maxHeight: '85%',
    width: '100%',
    maxWidth: 540
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 10
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textPrimary
  },
  keystoreNote: {
    fontSize: 11,
    color: colors.textSecondary,
    backgroundColor: colors.surfaceLight,
    padding: 8,
    borderRadius: 6,
    lineHeight: 16
  },
  modalInput: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    color: colors.textPrimary,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.borderLight
  },
  modalSaveButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8
  },
  modalSaveButtonText: {
    color: '#000000',
    fontSize: 13,
    fontWeight: 'bold'
  },
  container: {
    flex: 1,
    backgroundColor: colors.background
  },
  header: {
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
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 32
  },
  protocolTabs: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 4,
    borderWidth: 1,
    borderColor: colors.border
  },
  protocolTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 6
  },
  protocolTabActive: {
    backgroundColor: colors.primary
  },
  protocolTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary
  },
  protocolTabTextActive: {
    color: '#000000'
  },
  card: {
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 10,
    textTransform: 'uppercase'
  },
  row: {
    flexDirection: 'row',
    gap: 10
  },
  inputLabel: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 4
  },
  input: {
    backgroundColor: colors.surfaceLight,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: colors.textPrimary,
    fontSize: 13,
    borderWidth: 1,
    borderColor: colors.borderLight
  },
  presetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6
  },
  presetChip: {
    backgroundColor: colors.surfaceLight,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderLight
  },
  presetChipActive: {
    backgroundColor: 'rgba(0, 210, 255, 0.2)',
    borderColor: colors.primary
  },
  presetChipText: {
    fontSize: 11,
    color: colors.textSecondary
  },
  presetChipTextActive: {
    color: colors.primary,
    fontWeight: 'bold'
  },
  executeButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 4
  },
  executeButtonDisabled: {
    opacity: 0.6
  },
  executeButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold'
  },
  terminalContainer: {
    backgroundColor: '#05070D',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1E293B',
    overflow: 'hidden',
    marginTop: 6
  },
  terminalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B'
  },
  terminalDots: {
    flexDirection: 'row',
    gap: 6,
    marginRight: 10
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5
  },
  terminalTitle: {
    fontSize: 10,
    fontWeight: 'bold',
    color: '#64748B',
    letterSpacing: 1
  },
  terminalBody: {
    minHeight: 180,
    maxHeight: 280,
    padding: 12
  },
  terminalText: {
    fontFamily: 'monospace',
    color: '#38BDF8',
    fontSize: 12,
    lineHeight: 18
  }
});

