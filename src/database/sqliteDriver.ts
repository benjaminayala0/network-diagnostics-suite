import { SCHEMA_SQL } from './schema.ts';

export interface DatabaseAdapter {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params?: any[]): Promise<{ lastInsertRowId: number; changes: number }>;
  getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]>;
  getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null>;
  closeAsync?(): Promise<void>;
}

let dbInstance: DatabaseAdapter | null = null;

export function setDatabaseAdapter(adapter: DatabaseAdapter): void {
  dbInstance = adapter;
}

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (dbInstance) {
    return dbInstance;
  }

  try {
    const SQLite = await import('expo-sqlite');
    const nativeDb = SQLite.openDatabaseSync('network_diagnostics.db');

    try {
      nativeDb.execSync('PRAGMA journal_mode = WAL;');
      nativeDb.execSync('PRAGMA synchronous = NORMAL;');
    } catch {
      // PRAGMA may not be supported in all environments
    }

    const adapter: DatabaseAdapter = {
      async execAsync(sql: string) {
        nativeDb.execSync(sql);
      },
      async runAsync(sql: string, params: any[] = []) {
        const result = nativeDb.runSync(sql, params);
        return {
          lastInsertRowId: result.lastInsertRowId,
          changes: result.changes
        };
      },
      async getAllAsync<T = any>(sql: string, params: any[] = []) {
        return nativeDb.getAllSync<T>(sql, params);
      },
      async getFirstAsync<T = any>(sql: string, params: any[] = []) {
        return nativeDb.getFirstSync<T>(sql, params);
      }
    };

    dbInstance = adapter;
    await initializeSchema(dbInstance);
    return dbInstance;
  } catch (error) {
    console.warn('[Database] Native expo-sqlite not available, using in-memory mock fallback', error);
    dbInstance = createInMemoryDatabaseAdapter();
    await initializeSchema(dbInstance);
    return dbInstance;
  }
}

export async function initializeSchema(db: DatabaseAdapter): Promise<void> {
  for (const sql of SCHEMA_SQL) {
    await db.execAsync(sql);
  }
}

export function createInMemoryDatabaseAdapter(): DatabaseAdapter {
  const tables: Record<string, any[]> = {
    discovered_devices: [],
    diagnostic_sessions: [],
    work_orders: [],
    outbox_events: []
  };

  return {
    async execAsync(sql: string) {
      // In-memory schema statements are handled by initializing table stores
    },
    async runAsync(sql: string, params: any[] = []) {
      const trimmed = sql.trim();
      const upper = trimmed.toUpperCase();

      if (upper.startsWith('INSERT INTO DISCOVERED_DEVICES')) {
        const [id, ip, mac, hostname, vendor, status, response_time_ms, last_seen, created_at] = params;
        const existingIdx = tables.discovered_devices.findIndex(d => d.id === id || d.ip === ip);
        const item = { id, ip, mac, hostname, vendor, status, response_time_ms, last_seen, created_at };
        if (existingIdx >= 0) {
          tables.discovered_devices[existingIdx] = item;
        } else {
          tables.discovered_devices.push(item);
        }
        return { lastInsertRowId: 1, changes: 1 };
      }

      if (upper.startsWith('INSERT INTO DIAGNOSTIC_SESSIONS')) {
        const [id, device_id, device_ip, protocol, target_oid_or_cmd, raw_output, parsed_data_json, status, execution_time_ms, created_at] = params;
        tables.diagnostic_sessions.push({
          id, device_id, device_ip, protocol, target_oid_or_cmd, raw_output, parsed_data_json, status, execution_time_ms, created_at
        });
        return { lastInsertRowId: 1, changes: 1 };
      }

      if (upper.startsWith('INSERT INTO WORK_ORDERS')) {
        const [id, site_name, technician_name, equipment_serial, equipment_model, gps_lat, gps_lon, photos_json, notes, pdf_path, status, created_at, updated_at] = params;
        const existingIdx = tables.work_orders.findIndex(w => w.id === id);
        const item = { id, site_name, technician_name, equipment_serial, equipment_model, gps_lat, gps_lon, photos_json, notes, pdf_path, status, created_at, updated_at };
        if (existingIdx >= 0) {
          tables.work_orders[existingIdx] = item;
        } else {
          tables.work_orders.push(item);
        }
        return { lastInsertRowId: 1, changes: 1 };
      }

      if (upper.startsWith('INSERT INTO OUTBOX_EVENTS')) {
        const [id, event_type, entity_id, payload_json, status, retry_count, max_retries, next_retry_at, last_error, created_at, updated_at] = params;
        tables.outbox_events.push({
          id, event_type, entity_id, payload_json, status, retry_count, max_retries, next_retry_at, last_error, created_at, updated_at
        });
        return { lastInsertRowId: 1, changes: 1 };
      }

      if (upper.startsWith('UPDATE OUTBOX_EVENTS')) {
        if (upper.includes("SET STATUS = 'IN_FLIGHT'")) {
          const ids = params.slice(1);
          let changes = 0;
          tables.outbox_events.forEach(evt => {
            if (ids.includes(evt.id)) {
              evt.status = 'IN_FLIGHT';
              evt.updated_at = params[0] || Date.now();
              changes++;
            }
          });
          return { lastInsertRowId: 0, changes };
        }

        if (upper.includes("SET STATUS = 'PROCESSED'")) {
          const ids = params.slice(1);
          let changes = 0;
          tables.outbox_events.forEach(evt => {
            if (ids.includes(evt.id)) {
              evt.status = 'PROCESSED';
              evt.updated_at = params[0] || Date.now();
              changes++;
            }
          });
          return { lastInsertRowId: 0, changes };
        }

        if (upper.includes("SET STATUS = 'FAILED'")) {
          const [retryCount, lastError, updatedAt, id] = params;
          const evt = tables.outbox_events.find(e => e.id === id);
          if (evt) {
            evt.status = 'FAILED';
            evt.retry_count = retryCount;
            evt.last_error = lastError;
            evt.updated_at = updatedAt;
            return { lastInsertRowId: 0, changes: 1 };
          }
          return { lastInsertRowId: 0, changes: 0 };
        }

        if (upper.includes("SET STATUS = 'PENDING'")) {
          const [retryCount, nextRetryAt, lastError, updatedAt, id] = params;
          const evt = tables.outbox_events.find(e => e.id === id);
          if (evt) {
            evt.status = 'PENDING';
            evt.retry_count = retryCount;
            evt.next_retry_at = nextRetryAt;
            evt.last_error = lastError;
            evt.updated_at = updatedAt;
            return { lastInsertRowId: 0, changes: 1 };
          }
          return { lastInsertRowId: 0, changes: 0 };
        }
      }

      return { lastInsertRowId: 0, changes: 0 };
    },
    async getAllAsync<T = any>(sql: string, params: any[] = []) {
      const upper = sql.trim().toUpperCase();
      if (upper.includes('FROM DISCOVERED_DEVICES')) {
        return [...tables.discovered_devices] as unknown as T[];
      }
      if (upper.includes('FROM DIAGNOSTIC_SESSIONS')) {
        if (upper.includes('WHERE DEVICE_ID =') || upper.includes('WHERE DEVICE_IP =')) {
          const target = params[0];
          return tables.diagnostic_sessions.filter(s => s.device_id === target || s.device_ip === target) as unknown as T[];
        }
        return [...tables.diagnostic_sessions] as unknown as T[];
      }
      if (upper.includes('FROM WORK_ORDERS')) {
        return [...tables.work_orders] as unknown as T[];
      }
      if (upper.includes('FROM OUTBOX_EVENTS')) {
        if (upper.includes('GROUP BY STATUS')) {
          const counts: Record<string, number> = {};
          for (const evt of tables.outbox_events) {
            counts[evt.status] = (counts[evt.status] || 0) + 1;
          }
          return Object.entries(counts).map(([status, count]) => ({ status, count })) as unknown as T[];
        }
        if (upper.includes('WHERE ID =')) {
          const targetId = params[0];
          return tables.outbox_events.filter(e => e.id === targetId) as unknown as T[];
        }
        if (upper.includes("STATUS = 'PENDING'")) {
          const now = params[0] || Date.now();
          return tables.outbox_events.filter(e => e.status === 'PENDING' && e.next_retry_at <= now) as unknown as T[];
        }
        return [...tables.outbox_events] as unknown as T[];
      }
      return [] as T[];
    },
    async getFirstAsync<T = any>(sql: string, params: any[] = []) {
      const all = await this.getAllAsync<T>(sql, params);
      return all.length > 0 ? all[0] : null;
    }
  };
}
