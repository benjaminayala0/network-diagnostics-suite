import { getDatabase } from './sqliteDriver.ts';
import type { DiscoveredDevice } from './schema.ts';

export class DevicesRepository {
  static async upsert(device: DiscoveredDevice): Promise<void> {
    const db = await getDatabase();
    const sql = `
      INSERT INTO discovered_devices (id, ip, mac, hostname, vendor, status, response_time_ms, last_seen, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.runAsync(sql, [
      device.id,
      device.ip,
      device.mac,
      device.hostname ?? null,
      device.vendor ?? null,
      device.status,
      device.response_time_ms ?? null,
      device.last_seen,
      device.created_at
    ]);
  }

  static async findByIp(ip: string): Promise<DiscoveredDevice | null> {
    const db = await getDatabase();
    return db.getFirstAsync<DiscoveredDevice>(
      'SELECT * FROM discovered_devices WHERE ip = ? LIMIT 1',
      [ip]
    );
  }

  static async listAll(): Promise<DiscoveredDevice[]> {
    const db = await getDatabase();
    return db.getAllAsync<DiscoveredDevice>(
      'SELECT * FROM discovered_devices ORDER BY last_seen DESC'
    );
  }

  static async updateStatus(ip: string, status: 'ONLINE' | 'OFFLINE'): Promise<void> {
    const db = await getDatabase();
    await db.runAsync(
      'UPDATE discovered_devices SET status = ?, last_seen = ? WHERE ip = ?',
      [status, Date.now(), ip]
    );
  }
}
