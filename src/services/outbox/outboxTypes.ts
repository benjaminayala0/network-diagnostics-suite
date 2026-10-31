import type { OutboxEventType, OutboxStatus } from '../../database/schema.ts';

export interface WorkOrderPayload {
  orderId: string;
  siteName: string;
  technicianName: string;
  equipmentSerial: string;
  equipmentModel: string;
  gpsCoordinates?: {
    latitude: number;
    longitude: number;
  };
  photos: string[];
  notes: string;
  pdfPath?: string;
  completedAt: number;
}

export interface DiagnosticPayload {
  sessionId: string;
  deviceIp: string;
  protocol: 'SNMP' | 'SSH' | 'PING';
  commandOrOid: string;
  rawOutput: string;
  parsedData?: any;
  status: 'SUCCESS' | 'ERROR' | 'TIMEOUT';
  timestamp: number;
}

export interface DeviceDiscoveredPayload {
  ip: string;
  mac: string;
  hostname?: string;
  vendor?: string;
  discoveredAt: number;
}

export interface ReportUploadPayload {
  reportId: string;
  orderId: string;
  serialNumber: string;
  fileName: string;
  fileBase64?: string;
  fileSize?: number;
  createdAt: number;
}

export interface OutboxBatchRequest {
  events: Array<{
    id: string;
    eventType: OutboxEventType;
    entityId: string;
    payload: any;
    createdAt: number;
  }>;
}

export interface OutboxBatchResponse {
  processedIds: string[];
  rejectedIds: Array<{ id: string; reason: string }>;
  timestamp: string;
}

export interface OutboxSyncState {
  isSyncing: boolean;
  isOnline: boolean;
  pendingCount: number;
  inFlightCount: number;
  processedCount: number;
  failedCount: number;
  lastSyncTimestamp: number | null;
  lastError: string | null;
}
