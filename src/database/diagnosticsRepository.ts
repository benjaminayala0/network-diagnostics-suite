import { getDatabase } from './sqliteDriver.ts';
import type { DiagnosticSession } from './schema.ts';

export class DiagnosticsRepository {
  static async insert(session: DiagnosticSession): Promise<void> {
    const db = await getDatabase();
    const sql = `
      INSERT INTO diagnostic_sessions (
        id, device_id, device_ip, protocol, target_oid_or_cmd, raw_output,
        parsed_data_json, status, execution_time_ms, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.runAsync(sql, [
      session.id,
      session.device_id ?? null,
      session.device_ip,
      session.protocol,
      session.target_oid_or_cmd,
      session.raw_output,
      session.parsed_data_json ?? null,
      session.status,
      session.execution_time_ms,
      session.created_at
    ]);
  }

  static async listByDevice(deviceIpOrId: string): Promise<DiagnosticSession[]> {
    const db = await getDatabase();
    return db.getAllAsync<DiagnosticSession>(
      'SELECT * FROM diagnostic_sessions WHERE device_id = ? OR device_ip = ? ORDER BY created_at DESC',
      [deviceIpOrId]
    );
  }

  static async listRecent(limit: number = 50): Promise<DiagnosticSession[]> {
    const db = await getDatabase();
    return db.getAllAsync<DiagnosticSession>(
      'SELECT * FROM diagnostic_sessions ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
  }
}
