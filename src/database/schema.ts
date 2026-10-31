export interface DiscoveredDevice {
  id: string;
  ip: string;
  mac: string;
  hostname: string | null;
  vendor: string | null;
  status: 'ONLINE' | 'OFFLINE';
  response_time_ms: number | null;
  last_seen: number;
  created_at: number;
}

export interface DiagnosticSession {
  id: string;
  device_id: string | null;
  device_ip: string;
  protocol: 'SNMP' | 'SSH' | 'PING';
  target_oid_or_cmd: string;
  raw_output: string;
  parsed_data_json: string | null;
  status: 'SUCCESS' | 'ERROR' | 'TIMEOUT';
  execution_time_ms: number;
  created_at: number;
}

export interface WorkOrder {
  id: string;
  site_name: string;
  technician_name: string;
  equipment_serial: string;
  equipment_model: string;
  gps_lat: number | null;
  gps_lon: number | null;
  photos_json: string;
  notes: string;
  pdf_path: string | null;
  status: 'DRAFT' | 'COMPLETED' | 'SYNCED';
  created_at: number;
  updated_at: number;
}

export type OutboxEventType =
  | 'WORK_ORDER_CREATED'
  | 'DIAGNOSTIC_RECORDED'
  | 'DEVICE_DISCOVERED'
  | 'REPORT_UPLOAD';

export type OutboxStatus = 'PENDING' | 'IN_FLIGHT' | 'PROCESSED' | 'FAILED';

export interface OutboxEvent {
  id: string;
  event_type: OutboxEventType;
  entity_id: string;
  payload_json: string;
  status: OutboxStatus;
  retry_count: number;
  max_retries: number;
  next_retry_at: number;
  last_error: string | null;
  created_at: number;
  updated_at: number;
}

export const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS discovered_devices (
    id TEXT PRIMARY KEY,
    ip TEXT NOT NULL,
    mac TEXT NOT NULL,
    hostname TEXT,
    vendor TEXT,
    status TEXT NOT NULL DEFAULT 'ONLINE',
    response_time_ms INTEGER,
    last_seen INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_devices_ip ON discovered_devices(ip);`,
  `CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON discovered_devices(last_seen DESC);`,

  `CREATE TABLE IF NOT EXISTS diagnostic_sessions (
    id TEXT PRIMARY KEY,
    device_id TEXT,
    device_ip TEXT NOT NULL,
    protocol TEXT NOT NULL,
    target_oid_or_cmd TEXT NOT NULL,
    raw_output TEXT NOT NULL,
    parsed_data_json TEXT,
    status TEXT NOT NULL,
    execution_time_ms INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_diag_device ON diagnostic_sessions(device_id);`,
  `CREATE INDEX IF NOT EXISTS idx_diag_created ON diagnostic_sessions(created_at DESC);`,

  `CREATE TABLE IF NOT EXISTS work_orders (
    id TEXT PRIMARY KEY,
    site_name TEXT NOT NULL,
    technician_name TEXT NOT NULL,
    equipment_serial TEXT NOT NULL,
    equipment_model TEXT NOT NULL,
    gps_lat REAL,
    gps_lon REAL,
    photos_json TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    pdf_path TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_work_orders_serial ON work_orders(equipment_serial);`,
  `CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);`,

  `CREATE TABLE IF NOT EXISTS outbox_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 5,
    next_retry_at INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON outbox_events(status, next_retry_at);`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_created ON outbox_events(created_at ASC);`
];

