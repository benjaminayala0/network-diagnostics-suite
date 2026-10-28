import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { startSnmpMockAgent, getMibValue, MIB2_DATABASE } from './snmpMock.js';
import { startSshMockServer, executeCommand, COMMAND_RESPONSES } from './sshMock.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3002;
const SNMP_PORT = process.env.SNMP_PORT ? parseInt(process.env.SNMP_PORT, 10) : 1161;
const SSH_PORT = process.env.SSH_PORT ? parseInt(process.env.SSH_PORT, 10) : 2222;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure upload directory exists
const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'reports');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage for PDF reports
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `report_${timestamp}_${cleanName}`);
  },
});
const upload = multer({ storage });

// In-Memory Storage for Outbox Sync & Assets
const syncedOutboxRecords: Array<{
  id: string;
  type: string;
  payload: any;
  receivedAt: number;
}> = [];

// Pre-seeded asset catalog matching barcode/QR codes on field equipment
const ASSET_CATALOG: Record<
  string,
  {
    serialNumber: string;
    model: string;
    vendor: string;
    firmware: string;
    macAddress: string;
    deviceType: 'ROUTER' | 'SWITCH' | 'ONT' | 'ANTENNA';
    defaultIp: string;
    ports: number;
    siteAssigned: string;
  }
> = {
  'SN-MT-5009-001': {
    serialNumber: 'SN-MT-5009-001',
    model: 'MikroTik RB5009UG+S+IN',
    vendor: 'MikroTik',
    firmware: 'RouterOS v7.14.2',
    macAddress: 'DC:2C:6E:4A:12:01',
    deviceType: 'ROUTER',
    defaultIp: '192.168.1.1',
    ports: 8,
    siteAssigned: 'Site 42 - Node Central',
  },
  'SN-UB-SW24-002': {
    serialNumber: 'SN-UB-SW24-002',
    model: 'Ubiquiti UniFi Switch Pro 24 PoE',
    vendor: 'Ubiquiti',
    firmware: 'UniFi OS 3.2.12',
    macAddress: '74:83:C2:B1:09:44',
    deviceType: 'SWITCH',
    defaultIp: '192.168.1.2',
    ports: 24,
    siteAssigned: 'Site 42 - Distribution Rack B',
  },
  'SN-HW-HG82-003': {
    serialNumber: 'SN-HW-HG82-003',
    model: 'Huawei EchoLife HG8245H5 GPON ONT',
    vendor: 'Huawei',
    firmware: 'V5R019C00S105',
    macAddress: '48:46:FB:89:22:A1',
    deviceType: 'ONT',
    defaultIp: '192.168.100.1',
    ports: 4,
    siteAssigned: 'Subscriber Site - Client 109',
  },
  'SN-CS-2960-004': {
    serialNumber: 'SN-CS-2960-004',
    model: 'Cisco Catalyst 2960G-24TC-L',
    vendor: 'Cisco',
    firmware: 'IOS 15.0(2)SE4',
    macAddress: '00:26:0B:44:81:70',
    deviceType: 'SWITCH',
    defaultIp: '192.168.1.254',
    ports: 24,
    siteAssigned: 'Core Telecom Shelter',
  },
};

/**
 * Health & Diagnostics Status
 */
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ONLINE',
    service: 'Network Diagnostics Synchronization Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    mockServices: {
      snmpAgentPort: SNMP_PORT,
      sshDaemonPort: SSH_PORT,
      restApiPort: PORT,
    },
    syncedRecordsCount: syncedOutboxRecords.length,
  });
});

/**
 * Outbox Sync Endpoint (Atomic Batch Ingestion)
 */
app.post('/api/sync/outbox', (req: Request, res: Response) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({
      error: 'Invalid request payload: "items" must be an array of outbox actions.',
    });
  }

  const syncedIds: string[] = [];
  const now = Date.now();

  for (const item of items) {
    if (!item.id || !item.type) continue;

    // Idempotent ingestion: replace or add
    const existingIndex = syncedOutboxRecords.findIndex((r) => r.id === item.id);
    const record = {
      id: item.id,
      type: item.type,
      payload: item.payload || {},
      receivedAt: now,
    };

    if (existingIndex >= 0) {
      syncedOutboxRecords[existingIndex] = record;
    } else {
      syncedOutboxRecords.push(record);
    }

    syncedIds.push(item.id);
  }

  console.log(`[Outbox Sync] Ingested ${syncedIds.length} actions from field client.`);

  return res.json({
    status: 'SUCCESS',
    syncedIds,
    processedCount: syncedIds.length,
    serverTimestamp: now,
  });
});

/**
 * Asset Catalog Query by QR/Barcode Serial
 */
app.get('/api/assets/:serial', (req: Request, res: Response) => {
  const serial = req.params.serial.trim().toUpperCase();
  const asset = ASSET_CATALOG[serial];

  if (!asset) {
    // Generate fallback dynamic profile for any valid serial scan
    return res.json({
      serialNumber: serial,
      model: 'Generic Enterprise Telecom Equipment',
      vendor: 'Generic / Unknown Vendor',
      firmware: 'v1.0.0-PROD',
      macAddress: '00:1A:2B:' + Math.random().toString(16).substring(2, 8).toUpperCase(),
      deviceType: 'ROUTER',
      defaultIp: '192.168.1.1',
      ports: 4,
      siteAssigned: 'Field Deployment',
    });
  }

  return res.json(asset);
});

/**
 * Upload Installation Report PDF
 */
app.post('/api/reports', upload.single('reportPdf'), (req: Request, res: Response) => {
  const meta = req.body;
  const file = req.file;

  console.log('[Report Upload] Received installation report:', {
    technician: meta.technician,
    site: meta.site,
    serialNumber: meta.serialNumber,
    file: file ? file.filename : 'base64-payload',
  });

  return res.json({
    status: 'STORED',
    reportId: 'rep-' + Date.now(),
    fileName: file ? file.filename : 'inline_report.pdf',
    downloadUrl: file ? `/api/reports/download/${file.filename}` : null,
    timestamp: Date.now(),
  });
});

/**
 * Download Report PDF
 */
app.get('/api/reports/download/:filename', (req: Request, res: Response) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Report not found' });
  }
  return res.download(filePath);
});

/**
 * List Archived Reports
 */
app.get('/api/reports', (_req: Request, res: Response) => {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    const reports = files.map((f) => ({
      fileName: f,
      sizeBytes: fs.statSync(path.join(UPLOADS_DIR, f)).size,
      downloadUrl: `/api/reports/download/${f}`,
    }));
    return res.json({ count: reports.length, reports });
  } catch {
    return res.json({ count: 0, reports: [] });
  }
});

/**
 * REST Endpoint for Diagnostic SSH Command Execution (Proxy Fallback)
 */
app.post('/api/ssh/execute', (req: Request, res: Response) => {
  const { command, host, user } = req.body;
  if (!command) {
    return res.status(400).json({ error: 'Missing "command" in request body.' });
  }

  const output = executeCommand(command);
  return res.json({
    command,
    host: host || '127.0.0.1',
    user: user || 'admin',
    output,
    exitCode: 0,
    timestamp: Date.now(),
  });
});

/**
 * REST Endpoint for SNMP MIB-II Query (Diagnostic Proxy)
 */
app.get('/api/snmp/query', (req: Request, res: Response) => {
  const oid = String(req.query.oid || '1.3.6.1.2.1.1.1.0');
  const result = getMibValue(oid);

  if (!result) {
    return res.status(404).json({
      oid,
      error: 'OID not found in MIB-II database.',
      availableOids: Object.keys(MIB2_DATABASE),
    });
  }

  return res.json({
    host: req.query.host || '127.0.0.1',
    community: req.query.community || 'public',
    oid: result.oid,
    type: result.type,
    value: result.value,
    timestamp: Date.now(),
  });
});

// Graceful Error Handler (catches malformed JSON payloads)
app.use((err: any, _req: Request, res: Response, next: any) => {
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ error: 'Malformed JSON payload in request body' });
  }
  return next(err);
});

// Start Express Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 [Diagnostics API] Running on http://0.0.0.0:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health`);
  console.log(`   Outbox Sync: POST http://localhost:${PORT}/api/sync/outbox`);
});

// Start UDP SNMP Mock Agent & SSH Daemon
try {
  startSnmpMockAgent(SNMP_PORT);
  startSshMockServer(SSH_PORT);
} catch (err) {
  console.warn('Mock agent startup warning:', err);
}

