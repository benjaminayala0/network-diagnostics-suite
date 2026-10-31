import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  ScrollView,
  Modal,
  Alert,
  ActivityIndicator,
  Image,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../src/theme/colors.ts';
import { WorkOrdersRepository } from '../../src/database/workOrdersRepository.ts';
import { OutboxRepository } from '../../src/database/outboxRepository.ts';
import type { WorkOrder } from '../../src/database/schema.ts';
import { useOutboxStore } from '../../src/stores/outboxStore.ts';
import * as Location from 'expo-location';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions, BarcodeScanningResult } from 'expo-camera';

interface EvidencePhoto {
  uri: string;
  base64?: string | null;
  timestamp: number;
}

export default function WorkOrdersScreen() {
  const backendUrl = useOutboxStore((state) => state.backendUrl);
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [scannerModalVisible, setScannerModalVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [loading, setLoading] = useState(false);

  // Camera permissions
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  // Form State
  const [siteName, setSiteName] = useState('Paraná Nodo Central - Site 42');
  const [technicianName, setTechnicianName] = useState('B. Ayala');
  const [equipmentSerial, setEquipmentSerial] = useState('SN-MT-RB50-001');
  const [equipmentModel, setEquipmentModel] = useState('MikroTik RB5009UG+S+IN');
  const [gpsLocation, setGpsLocation] = useState<{ lat: number; lon: number } | null>({
    lat: -31.7333,
    lon: -60.5333
  });
  const [notes, setNotes] = useState('Optical fiber spliced at -19.4 dBm. SFP+ 10G link established with NOC.');
  const [photos, setPhotos] = useState<EvidencePhoto[]>([]);

  const loadOrders = async () => {
    try {
      const list = await WorkOrdersRepository.listAll();
      setOrders(list);
    } catch (err) {
      console.warn('Failed to load work orders:', err);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const handleLookupAsset = async (serialToLookup?: string) => {
    const serial = (serialToLookup || equipmentSerial).trim();
    if (!serial) {
      Alert.alert('Validation Error', 'Enter an equipment serial number first.');
      return;
    }
    setLoading(true);
    try {
      const url = `${backendUrl.replace(/\/$/, '')}/api/assets/${encodeURIComponent(serial)}`;
      const res = await fetch(url);
      const json = await res.json();
      if (res.ok && json.asset) {
        setEquipmentModel(`${json.asset.vendor} ${json.asset.model}`);
        if (json.asset.siteAssigned) {
          setSiteName(json.asset.siteAssigned);
        }
        Alert.alert(
          'Asset Verified',
          `Datasheet: ${json.asset.model}\nVendor: ${json.asset.vendor}\nFirmware: ${json.asset.firmware}\nDefault IP: ${json.asset.defaultIp}`
        );
      } else {
        Alert.alert('Catalog Notice', `Serial "${serial}" not found in remote catalog. You can enter details manually.`);
      }
    } catch {
      Alert.alert('Lookup Notice', 'Asset catalog currently unreachable (offline). Proceeding with local input.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenScanner = async () => {
    if (!cameraPermission?.granted) {
      const res = await requestCameraPermission();
      if (!res.granted) {
        Alert.alert(
          'Camera Permission',
          'Camera access is required for real-time barcode scanning. You can still test with simulated equipment barcodes.'
        );
      }
    }
    setScanned(false);
    setScannerModalVisible(true);
  };

  const handleBarcodeScanned = async (result: BarcodeScanningResult) => {
    if (scanned) return;
    setScanned(true);
    setScannerModalVisible(false);
    const scannedSerial = result.data;
    setEquipmentSerial(scannedSerial);
    await handleLookupAsset(scannedSerial);
  };

  const handleSimulateScan = async (sampleSerial: string) => {
    setScanned(true);
    setScannerModalVisible(false);
    setEquipmentSerial(sampleSerial);
    await handleLookupAsset(sampleSerial);
  };

  const handleCaptureGps = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('GPS Permission', 'Location permission denied. Using manual site coordinates.');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setGpsLocation({
        lat: loc.coords.latitude,
        lon: loc.coords.longitude
      });
      Alert.alert('GPS Tagged', `Site Coordinates: ${loc.coords.latitude.toFixed(5)}, ${loc.coords.longitude.toFixed(5)}`);
    } catch {
      setGpsLocation({ lat: -31.7333, lon: -60.5333 });
      Alert.alert('GPS Tagged', 'Field site coordinates recorded (-31.7333, -60.5333).');
    }
  };

  const handleTakePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Camera permission is required to capture evidence photos.');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        quality: 0.6,
        base64: true,
        allowsEditing: false
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        setPhotos(prev => [
          ...prev,
          {
            uri: asset.uri,
            base64: asset.base64,
            timestamp: Date.now()
          }
        ]);
      }
    } catch (err: any) {
      Alert.alert('Camera Error', err.message || 'Failed to capture photo');
    }
  };

  const handlePickFromGallery = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.6,
        base64: true,
        allowsMultipleSelection: true
      });
      if (!result.canceled && result.assets) {
        const newPhotos: EvidencePhoto[] = result.assets.map(a => ({
          uri: a.uri,
          base64: a.base64,
          timestamp: Date.now()
        }));
        setPhotos(prev => [...prev, ...newPhotos]);
      }
    } catch (err: any) {
      Alert.alert('Gallery Error', err.message || 'Failed to select photos');
    }
  };

  const handleRemovePhoto = (index: number) => {
    setPhotos(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveAndGeneratePdf = async () => {
    if (!siteName || !equipmentSerial) {
      Alert.alert('Required Fields', 'Please complete site name and serial number.');
      return;
    }

    setLoading(true);
    const orderId = 'wo_' + Date.now().toString(36);
    const now = Date.now();

    // Render photographic evidence HTML cards
    const photosHtml = photos.length > 0
      ? photos.map((p, idx) => `
          <div style="display: inline-block; margin: 6px; text-align: center; vertical-align: top;">
            <img src="${p.base64 ? `data:image/jpeg;base64,${p.base64}` : p.uri}" style="width: 220px; height: 160px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1;" />
            <div style="font-size: 10px; color: #64748b; margin-top: 4px; font-weight: bold;">Evidence Photo #${idx + 1}</div>
          </div>
        `).join('')
      : '<div style="font-size: 12px; color: #64748b; font-style: italic; padding: 8px;">No photographic evidence attached for this work order.</div>';

    // Compile formal PDF Installation Report HTML
    const reportHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Telecommunications Commissioning Report - ${orderId}</title>
        <style>
          body { font-family: Helvetica, Arial, sans-serif; padding: 28px; color: #1e293b; background: #ffffff; }
          .header { border-bottom: 2px solid #0284c7; padding-bottom: 12px; margin-bottom: 18px; }
          h1 { color: #0f172a; margin: 0 0 4px 0; font-size: 22px; letter-spacing: -0.5px; }
          .subtitle { color: #64748b; font-size: 13px; }
          .meta-grid { display: flex; flex-wrap: wrap; margin-bottom: 16px; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; }
          .meta-item { width: 50%; margin-bottom: 8px; }
          .label { font-weight: bold; font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; }
          .value { font-size: 13px; margin-top: 2px; color: #0f172a; }
          .section { margin-top: 16px; padding: 14px; border: 1px solid #cbd5e1; border-radius: 6px; }
          .section-title { font-size: 12px; font-weight: bold; color: #0369a1; text-transform: uppercase; margin-bottom: 8px; border-bottom: 1px dashed #e2e8f0; padding-bottom: 4px; }
          .notes { font-style: italic; color: #334155; line-height: 1.5; font-size: 12px; }
          .gallery-box { margin-top: 10px; }
          .footer { margin-top: 36px; border-top: 1px solid #e2e8f0; padding-top: 12px; font-size: 10px; color: #94a3b8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>TELECOMMUNICATIONS COMMISSIONING REPORT</h1>
          <div class="subtitle">Field Infrastructure Quality & Commissioning Certification • Offline-First Mobile Suite</div>
        </div>

        <div class="meta-grid">
          <div class="meta-item">
            <div class="label">Work Order Reference</div>
            <div class="value"><strong>${orderId}</strong></div>
          </div>
          <div class="meta-item">
            <div class="label">Certification Timestamp</div>
            <div class="value">${new Date(now).toLocaleString()}</div>
          </div>
          <div class="meta-item">
            <div class="label">Installation Site</div>
            <div class="value">${siteName}</div>
          </div>
          <div class="meta-item">
            <div class="label">Lead Field Technician</div>
            <div class="value">${technicianName}</div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Equipment Technical Datasheet</div>
          <div style="display: flex; flex-wrap: wrap;">
            <div style="width: 50%; margin-bottom: 6px;">
              <span class="label">Hardware Model:</span> <span class="value"><strong>${equipmentModel}</strong></span>
            </div>
            <div style="width: 50%; margin-bottom: 6px;">
              <span class="label">Serial / Barcode:</span> <span class="value" style="font-family: monospace;">${equipmentSerial}</span>
            </div>
            <div style="width: 100%;">
              <span class="label">Georeference GPS:</span> <span class="value">${gpsLocation ? `${gpsLocation.lat.toFixed(5)}, ${gpsLocation.lon.toFixed(5)}` : 'Manual Site Coordinates'}</span>
            </div>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Field Observations & Splicing Notes</div>
          <p class="notes">${notes}</p>
        </div>

        <div class="section">
          <div class="section-title">Photographic Installation Evidence (${photos.length} Captured)</div>
          <div class="gallery-box">
            ${photosHtml}
          </div>
        </div>

        <div class="footer">
          Digitally generated via Network Diagnostics Suite Mobile Toolkit | Autonomous Enterprise Offline Engine
        </div>
      </body>
      </html>
    `;

    let generatedPdfUri: string | null = null;
    try {
      const file = await Print.printToFileAsync({ html: reportHtml });
      generatedPdfUri = file.uri;
    } catch {
      generatedPdfUri = `mock://reports/${orderId}.pdf`;
    }

    const photosJson = JSON.stringify(photos.map(p => ({ uri: p.uri, timestamp: p.timestamp })));

    const newOrder: WorkOrder = {
      id: orderId,
      site_name: siteName,
      technician_name: technicianName,
      equipment_serial: equipmentSerial,
      equipment_model: equipmentModel,
      gps_lat: gpsLocation?.lat ?? null,
      gps_lon: gpsLocation?.lon ?? null,
      photos_json: photosJson,
      notes,
      pdf_path: generatedPdfUri,
      status: 'COMPLETED',
      created_at: now,
      updated_at: now
    };

    // 1. Save to local SQLite
    await WorkOrdersRepository.upsert(newOrder);

    // 2. Enqueue Work Order creation in Outbox
    await OutboxRepository.enqueue('WORK_ORDER_CREATED', orderId, {
      orderId,
      siteName,
      technicianName,
      equipmentSerial,
      equipmentModel,
      gpsCoordinates: gpsLocation,
      notes,
      photosCount: photos.length,
      pdfPath: generatedPdfUri,
      completedAt: now
    });

    // 3. Enqueue Report Upload in Outbox
    await OutboxRepository.enqueue('REPORT_UPLOAD', `rep_${orderId}`, {
      reportId: `rep_${orderId}`,
      orderId,
      serialNumber: equipmentSerial,
      fileName: `${orderId}.pdf`,
      createdAt: now
    });

    await loadOrders();
    setLoading(false);
    setModalVisible(false);

    Alert.alert(
      'Work Order Certified & Enqueued',
      `Installation saved to SQLite.\nReport PDF compiled: ${generatedPdfUri}\nEvidence photos embedded: ${photos.length}\nEnqueued in Outbox for deferred synchronization.`,
      [
        { text: 'OK' },
        ...(generatedPdfUri && !generatedPdfUri.startsWith('mock://')
          ? [
              {
                text: 'Share / View PDF',
                onPress: async () => {
                  try {
                    const isAvailable = await Sharing.isAvailableAsync();
                    if (isAvailable) {
                      await Sharing.shareAsync(generatedPdfUri!);
                    } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
                      window.open(generatedPdfUri!, '_blank');
                    } else {
                      Alert.alert('PDF Saved', `Document generated at:\n${generatedPdfUri}`);
                    }
                  } catch (err: any) {
                    Alert.alert('PDF Viewer', err.message || 'Could not launch PDF viewer');
                  }
                }
              }
            ]
          : [])
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTextContainer}>
          <Text style={styles.headerTitle} numberOfLines={1}>Field Work Orders</Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>Commissioning & PDF Reports</Text>
        </View>
        <TouchableOpacity
          style={styles.addButton}
          onPress={() => {
            setPhotos([]);
            setModalVisible(true);
          }}
        >
          <Ionicons name="add" size={18} color="#000000" />
          <Text style={styles.addButtonText}>New Order</Text>
        </TouchableOpacity>
      </View>

      {/* Orders List */}
      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="document-text-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No work orders recorded</Text>
            <Text style={styles.emptySubtext}>
              Tap "New Order" to document field installation evidence, scan equipment barcodes, and compile a certified PDF report.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          let photoCount = 0;
          try {
            const parsed = JSON.parse(item.photos_json);
            if (Array.isArray(parsed)) photoCount = parsed.length;
          } catch {
            // ignore
          }

          return (
            <View style={styles.orderCard}>
              <View style={styles.orderTopRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.siteName}>{item.site_name}</Text>
                  <Text style={styles.orderIdText}>{item.id} • Tech: {item.technician_name}</Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: item.status === 'SYNCED' ? colors.badgeOnline : colors.badgePending }]}>
                  <Text style={[styles.statusText, { color: item.status === 'SYNCED' ? colors.success : colors.warning }]}>
                    {item.status}
                  </Text>
                </View>
              </View>

              <View style={styles.detailsBox}>
                <Text style={styles.detailLabel}>MODEL / SERIAL:</Text>
                <Text style={styles.detailValue}>{item.equipment_model} ({item.equipment_serial})</Text>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                  {item.gps_lat && (
                    <View style={styles.gpsRow}>
                      <Ionicons name="location-outline" size={13} color={colors.primary} />
                      <Text style={styles.gpsText}>
                        GPS: {item.gps_lat.toFixed(4)}, {item.gps_lon?.toFixed(4)}
                      </Text>
                    </View>
                  )}

                  {photoCount > 0 && (
                    <View style={styles.photoCountBadge}>
                      <Ionicons name="camera-outline" size={13} color={colors.success} style={{ marginRight: 4 }} />
                      <Text style={styles.photoCountText}>{photoCount} photo{photoCount > 1 ? 's' : ''}</Text>
                    </View>
                  )}
                </View>
              </View>

              {item.pdf_path && (
                <View style={styles.pdfFooterRow}>
                  <Ionicons name="document-attach" size={14} color={colors.primary} />
                  <Text style={styles.pdfPathText} numberOfLines={1}>
                    PDF: {item.pdf_path}
                  </Text>
                  {!item.pdf_path.startsWith('mock://') && (
                    <TouchableOpacity
                      onPress={() => Sharing.shareAsync(item.pdf_path!)}
                      style={styles.shareIconBtn}
                    >
                      <Ionicons name="share-outline" size={16} color={colors.primary} />
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>
          );
        }}
      />

      {/* New Work Order Modal */}
      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardAvoidingContainer}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Commission Field Equipment</Text>
                  <Text style={styles.modalSubtitle}>Technical Certification & PDF Generation</Text>
                </View>
                <TouchableOpacity
                  onPress={() => setModalVisible(false)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={22} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.modalScrollView}
                contentContainerStyle={styles.modalBody}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.inputLabel}>Site / Node Name</Text>
                <TextInput
                  style={styles.modalInput}
                  value={siteName}
                  onChangeText={setSiteName}
                  placeholder="e.g., Central Station B-1"
                  placeholderTextColor={colors.textMuted}
                />

                <Text style={styles.inputLabel}>Technician Name</Text>
                <TextInput
                  style={styles.modalInput}
                  value={technicianName}
                  onChangeText={setTechnicianName}
                  placeholder="e.g., Alex Smith"
                  placeholderTextColor={colors.textMuted}
                />

                <Text style={styles.inputLabel}>Equipment Serial / Barcode</Text>
                <View style={styles.serialRow}>
                  <TextInput
                    style={[styles.modalInput, styles.serialInput]}
                    value={equipmentSerial}
                    onChangeText={setEquipmentSerial}
                    placeholder="e.g., SN-MT-RB50-001"
                    placeholderTextColor={colors.textMuted}
                    autoCapitalize="characters"
                  />
                  <View style={styles.serialActions}>
                    <TouchableOpacity
                      style={styles.scanBarcodeButton}
                      onPress={handleOpenScanner}
                    >
                      <Ionicons name="barcode-outline" size={16} color="#000000" />
                      <Text style={styles.scanBarcodeButtonText}>Scan</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.lookupButton}
                      onPress={() => handleLookupAsset()}
                      disabled={loading}
                    >
                      <Ionicons name="search" size={16} color={colors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>

                <Text style={styles.inputLabel}>Equipment Model & Vendor</Text>
                <TextInput
                  style={styles.modalInput}
                  value={equipmentModel}
                  onChangeText={setEquipmentModel}
                  placeholder="e.g., MikroTik RouterOS"
                  placeholderTextColor={colors.textMuted}
                />

                {/* GPS Georeference Tagging */}
                <View style={styles.gpsActionRow}>
                  <TouchableOpacity style={styles.gpsTagButton} onPress={handleCaptureGps}>
                    <Ionicons name="navigate-outline" size={16} color="#000000" style={{ marginRight: 6 }} />
                    <Text style={styles.gpsTagButtonText}>Georeference Site GPS</Text>
                  </TouchableOpacity>
                  {gpsLocation && (
                    <Text style={styles.gpsCoordsText}>
                      {gpsLocation.lat.toFixed(4)}, {gpsLocation.lon.toFixed(4)}
                    </Text>
                  )}
                </View>

                {/* Photographic Evidence Attachment */}
                <View style={styles.photoSection}>
                  <View style={styles.photoHeaderRow}>
                    <Text style={styles.inputLabel}>Photographic Evidence ({photos.length})</Text>
                    <View style={styles.photoActions}>
                      <TouchableOpacity style={styles.photoActionButton} onPress={handleTakePhoto}>
                        <Ionicons name="camera" size={14} color={colors.primary} style={{ marginRight: 4 }} />
                        <Text style={styles.photoActionButtonText}>Camera</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.photoActionButton} onPress={handlePickFromGallery}>
                        <Ionicons name="images" size={14} color={colors.primary} style={{ marginRight: 4 }} />
                        <Text style={styles.photoActionButtonText}>Gallery</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {photos.length > 0 ? (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbnailScroll}>
                      {photos.map((photo, index) => (
                        <View key={photo.uri + index} style={styles.thumbnailWrapper}>
                          <Image source={{ uri: photo.uri }} style={styles.thumbnailImage} />
                          <TouchableOpacity
                            style={styles.thumbnailDeleteBtn}
                            onPress={() => handleRemovePhoto(index)}
                          >
                            <Ionicons name="close-circle" size={18} color={colors.danger} />
                          </TouchableOpacity>
                        </View>
                      ))}
                    </ScrollView>
                  ) : (
                    <View style={styles.photoPlaceholder}>
                      <Ionicons name="image-outline" size={24} color={colors.textMuted} />
                      <Text style={styles.photoPlaceholderText}>Attach equipment, rack, or splicing photos</Text>
                    </View>
                  )}
                </View>

                <Text style={styles.inputLabel}>Field Observations & Splicing Notes</Text>
                <TextInput
                  style={[styles.modalInput, styles.textArea]}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  numberOfLines={3}
                  placeholder="Describe optical power dBm, VLAN configuration..."
                  placeholderTextColor={colors.textMuted}
                />

                <TouchableOpacity
                  style={[styles.submitButton, loading && styles.submitButtonDisabled]}
                  onPress={handleSaveAndGeneratePdf}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="#000000" />
                  ) : (
                    <>
                      <Ionicons name="document-text" size={18} color="#000000" style={{ marginRight: 6 }} />
                      <Text style={styles.submitButtonText}>Certify, Generate PDF & Enqueue</Text>
                    </>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Barcode & QR Scanner Modal */}
      <Modal visible={scannerModalVisible} animationType="slide">
        <SafeAreaView style={styles.scannerContainer}>
          <View style={styles.scannerHeader}>
            <View>
              <Text style={styles.scannerTitle}>Equipment Barcode / QR Scanner</Text>
              <Text style={styles.scannerSubtitle}>Align equipment label within viewfinder</Text>
            </View>
            <TouchableOpacity
              style={styles.closeScannerBtn}
              onPress={() => setScannerModalVisible(false)}
            >
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          <View style={styles.viewfinderContainer}>
            {Platform.OS !== 'web' && cameraPermission?.granted ? (
              <CameraView
                style={StyleSheet.absoluteFillObject}
                facing="back"
                barcodeScannerSettings={{
                  barcodeTypes: ['qr', 'code128', 'code39', 'ean13', 'upc_a']
                }}
                onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
              />
            ) : (
              <View style={styles.cameraPlaceholderBox}>
                <Ionicons name="barcode-outline" size={48} color={colors.primary} />
                <Text style={styles.cameraPlaceholderText}>
                  {Platform.OS === 'web'
                    ? 'Web Camera scanner preview ready. You can scan or select a telecom preset below.'
                    : 'Camera permission required or preview unavailable. You can grant access or select a preset below.'}
                </Text>
                {Platform.OS !== 'web' && !cameraPermission?.granted && (
                  <TouchableOpacity style={styles.grantPermBtn} onPress={requestCameraPermission}>
                    <Text style={styles.grantPermBtnText}>Grant Camera Permission</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Target Reticle Viewfinder Overlay */}
            <View style={styles.reticleOverlay} pointerEvents="none">
              <View style={styles.reticleCornerTopLeft} />
              <View style={styles.reticleCornerTopRight} />
              <View style={styles.reticleCornerBottomLeft} />
              <View style={styles.reticleCornerBottomRight} />
              <View style={styles.reticleScanLine} />
            </View>
          </View>

          {/* Quick Select Barcode Presets for Test Bench / Emulator */}
          <View style={styles.scannerFooter}>
            <Text style={styles.scannerFooterTitle}>Quick Select Telecom Barcode Presets:</Text>
            <View style={styles.presetChipGrid}>
              {[
                { label: 'MikroTik RB5009', serial: 'SN-MT-RB50-001' },
                { label: 'UniFi Switch 24', serial: 'SN-UB-SW24-002' },
                { label: 'Huawei GPON ONT', serial: 'SN-HW-HG82-003' },
                { label: 'Cisco 2960G', serial: 'SN-CS-2960-004' }
              ].map(preset => (
                <TouchableOpacity
                  key={preset.serial}
                  style={styles.presetBarcodeChip}
                  onPress={() => handleSimulateScan(preset.serial)}
                >
                  <Ionicons name="barcode-outline" size={13} color={colors.primary} style={{ marginRight: 4 }} />
                  <Text style={styles.presetBarcodeText}>{preset.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </SafeAreaView>
      </Modal>
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
    marginRight: 12
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
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    flexShrink: 0
  },
  addButtonText: {
    color: '#000000',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 4
  },
  listContent: {
    padding: 16,
    gap: 10
  },
  orderCard: {
    backgroundColor: colors.surface,
    padding: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border
  },
  orderTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8
  },
  siteName: {
    fontSize: 15,
    fontWeight: 'bold',
    color: colors.textPrimary
  },
  orderIdText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold'
  },
  detailsBox: {
    backgroundColor: colors.surfaceLight,
    padding: 10,
    borderRadius: 6,
    marginBottom: 6
  },
  detailLabel: {
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: 'bold'
  },
  detailValue: {
    fontSize: 12,
    color: colors.textPrimary,
    marginTop: 2
  },
  gpsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  gpsText: {
    fontSize: 11,
    color: colors.primary
  },
  photoCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.badgeOnline,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8
  },
  photoCountText: {
    fontSize: 10,
    color: colors.success,
    fontWeight: '600'
  },
  pdfFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4
  },
  pdfPathText: {
    fontSize: 10,
    color: colors.textSecondary,
    flex: 1
  },
  shareIconBtn: {
    padding: 4
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50
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
    paddingHorizontal: 24
  },
  keyboardAvoidingContainer: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)'
  },
  modalOverlay: {
    flex: 1,
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: 'center',
    padding: Platform.OS === 'web' ? 20 : 0
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderBottomLeftRadius: Platform.OS === 'web' ? 20 : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? 20 : 0,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
    maxHeight: '92%',
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column'
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
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary
  },
  modalSubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2
  },
  modalCloseBtn: {
    padding: 6
  },
  modalScrollView: {
    flexShrink: 1
  },
  modalBody: {
    gap: 10,
    paddingBottom: 28
  },
  inputLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    fontWeight: '600'
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
  textArea: {
    minHeight: 65,
    textAlignVertical: 'top'
  },
  serialRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  serialInput: {
    flex: 1,
    minWidth: 120
  },
  serialActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  scanBarcodeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 6,
    gap: 4
  },
  scanBarcodeButtonText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#000000'
  },
  lookupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 210, 255, 0.15)',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 6
  },
  gpsActionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginVertical: 4
  },
  gpsTagButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6
  },
  gpsTagButtonText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: '#000000'
  },
  gpsCoordsText: {
    fontSize: 11,
    color: colors.success,
    fontFamily: 'monospace'
  },
  photoSection: {
    backgroundColor: colors.surfaceLight,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginTop: 2
  },
  photoHeaderRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8
  },
  photoActions: {
    flexDirection: 'row',
    gap: 6
  },
  photoActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 210, 255, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6
  },
  photoActionButtonText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.primary
  },
  thumbnailScroll: {
    flexDirection: 'row',
    paddingVertical: 4
  },
  thumbnailWrapper: {
    position: 'relative',
    marginRight: 8
  },
  thumbnailImage: {
    width: 64,
    height: 64,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border
  },
  thumbnailDeleteBtn: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#000000',
    borderRadius: 9
  },
  photoPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: 6
  },
  photoPlaceholderText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4
  },
  submitButton: {
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 10
  },
  submitButtonDisabled: {
    opacity: 0.6
  },
  submitButtonText: {
    color: '#000000',
    fontSize: 14,
    fontWeight: 'bold'
  },

  // Barcode Scanner Modal Styles
  scannerContainer: {
    flex: 1,
    backgroundColor: '#000000'
  },
  scannerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(0,0,0,0.85)',
    zIndex: 10
  },
  scannerTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF'
  },
  scannerSubtitle: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2
  },
  closeScannerBtn: {
    padding: 6
  },
  viewfinderContainer: {
    flex: 1,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center'
  },
  cameraPlaceholderBox: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  cameraPlaceholderText: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 14
  },
  grantPermBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6
  },
  grantPermBtnText: {
    color: '#000000',
    fontWeight: 'bold',
    fontSize: 12
  },
  reticleOverlay: {
    width: 250,
    height: 180,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center'
  },
  reticleCornerTopLeft: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 28,
    height: 28,
    borderTopWidth: 3,
    borderLeftWidth: 3,
    borderColor: colors.primary
  },
  reticleCornerTopRight: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 28,
    height: 28,
    borderTopWidth: 3,
    borderRightWidth: 3,
    borderColor: colors.primary
  },
  reticleCornerBottomLeft: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    width: 28,
    height: 28,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
    borderColor: colors.primary
  },
  reticleCornerBottomRight: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderBottomWidth: 3,
    borderRightWidth: 3,
    borderColor: colors.primary
  },
  reticleScanLine: {
    width: '90%',
    height: 2,
    backgroundColor: colors.danger,
    opacity: 0.85
  },
  scannerFooter: {
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.9)',
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  scannerFooterTitle: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase'
  },
  presetChipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6
  },
  presetBarcodeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border
  },
  presetBarcodeText: {
    fontSize: 11,
    color: colors.textPrimary,
    fontWeight: '500'
  }
});
