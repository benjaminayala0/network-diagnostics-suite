import { getDatabase } from './sqliteDriver.ts';
import type { WorkOrder } from './schema.ts';

export class WorkOrdersRepository {
  static async upsert(order: WorkOrder): Promise<void> {
    const db = await getDatabase();
    const sql = `
      INSERT INTO work_orders (
        id, site_name, technician_name, equipment_serial, equipment_model,
        gps_lat, gps_lon, photos_json, notes, pdf_path, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await db.runAsync(sql, [
      order.id,
      order.site_name,
      order.technician_name,
      order.equipment_serial,
      order.equipment_model,
      order.gps_lat ?? null,
      order.gps_lon ?? null,
      order.photos_json,
      order.notes,
      order.pdf_path ?? null,
      order.status,
      order.created_at,
      order.updated_at
    ]);
  }

  static async findById(id: string): Promise<WorkOrder | null> {
    const db = await getDatabase();
    return db.getFirstAsync<WorkOrder>(
      'SELECT * FROM work_orders WHERE id = ? LIMIT 1',
      [id]
    );
  }

  static async listAll(): Promise<WorkOrder[]> {
    const db = await getDatabase();
    return db.getAllAsync<WorkOrder>(
      'SELECT * FROM work_orders ORDER BY updated_at DESC'
    );
  }

  static async updateStatus(id: string, status: WorkOrder['status'], pdfPath?: string): Promise<void> {
    const db = await getDatabase();
    if (pdfPath) {
      await db.runAsync(
        'UPDATE work_orders SET status = ?, pdf_path = ?, updated_at = ? WHERE id = ?',
        [status, pdfPath, Date.now(), id]
      );
    } else {
      await db.runAsync(
        'UPDATE work_orders SET status = ?, updated_at = ? WHERE id = ?',
        [status, Date.now(), id]
      );
    }
  }
}
