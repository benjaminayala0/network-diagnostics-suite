import { getDatabase } from './sqliteDriver.ts';
import type { OutboxEvent, OutboxEventType, OutboxStatus } from './schema.ts';

export class OutboxRepository {
  static generateUuid(): string {
    return 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
  }

  static async enqueue(
    eventType: OutboxEventType,
    entityId: string,
    payload: any,
    maxRetries: number = 5
  ): Promise<OutboxEvent> {
    const db = await getDatabase();
    const now = Date.now();
    const event: OutboxEvent = {
      id: this.generateUuid(),
      event_type: eventType,
      entity_id: entityId,
      payload_json: typeof payload === 'string' ? payload : JSON.stringify(payload),
      status: 'PENDING',
      retry_count: 0,
      max_retries: maxRetries,
      next_retry_at: now,
      last_error: null,
      created_at: now,
      updated_at: now
    };

    const sql = `
      INSERT INTO outbox_events (
        id, event_type, entity_id, payload_json, status,
        retry_count, max_retries, next_retry_at, last_error, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.runAsync(sql, [
      event.id,
      event.event_type,
      event.entity_id,
      event.payload_json,
      event.status,
      event.retry_count,
      event.max_retries,
      event.next_retry_at,
      event.last_error,
      event.created_at,
      event.updated_at
    ]);

    return event;
  }

  static async getPending(limit: number = 20): Promise<OutboxEvent[]> {
    const db = await getDatabase();
    const now = Date.now();
    return db.getAllAsync<OutboxEvent>(
      `SELECT * FROM outbox_events 
       WHERE status = 'PENDING' AND next_retry_at <= ? 
       ORDER BY created_at ASC 
       LIMIT ?`,
      [now, limit]
    );
  }

  static async markInFlight(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const now = Date.now();
    await db.runAsync(
      `UPDATE outbox_events SET status = 'IN_FLIGHT', updated_at = ? WHERE id IN (${placeholders})`,
      [now, ...ids]
    );
  }

  static async markProcessed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDatabase();
    const placeholders = ids.map(() => '?').join(',');
    const now = Date.now();
    await db.runAsync(
      `UPDATE outbox_events SET status = 'PROCESSED', updated_at = ? WHERE id IN (${placeholders})`,
      [now, ...ids]
    );
  }

  static async markFailed(
    id: string,
    error: string,
    backoffBaseMs: number = 1000
  ): Promise<void> {
    const db = await getDatabase();
    const current = await db.getFirstAsync<OutboxEvent>(
      'SELECT * FROM outbox_events WHERE id = ? LIMIT 1',
      [id]
    );
    if (!current) return;

    const nextRetryCount = current.retry_count + 1;
    const now = Date.now();

    if (nextRetryCount >= current.max_retries) {
      await db.runAsync(
        `UPDATE outbox_events 
         SET status = 'FAILED', retry_count = ?, last_error = ?, updated_at = ? 
         WHERE id = ?`,
        [nextRetryCount, error, now, id]
      );
    } else {
      // Exponential backoff: base * 2^retry_count (e.g., 1s, 2s, 4s, 8s, 16s)
      const delayMs = backoffBaseMs * Math.pow(2, current.retry_count);
      const nextRetryAt = now + delayMs;

      await db.runAsync(
        `UPDATE outbox_events 
         SET status = 'PENDING', retry_count = ?, next_retry_at = ?, last_error = ?, updated_at = ? 
         WHERE id = ?`,
        [nextRetryCount, nextRetryAt, error, now, id]
      );
    }
  }

  static async getQueueMetrics(): Promise<{
    pending: number;
    inFlight: number;
    processed: number;
    failed: number;
    total: number;
  }> {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ status: OutboxStatus; count: number }>(
      'SELECT status, COUNT(*) as count FROM outbox_events GROUP BY status'
    );

    const metrics = {
      pending: 0,
      inFlight: 0,
      processed: 0,
      failed: 0,
      total: 0
    };

    for (const r of rows) {
      if (r.status === 'PENDING') metrics.pending = r.count;
      else if (r.status === 'IN_FLIGHT') metrics.inFlight = r.count;
      else if (r.status === 'PROCESSED') metrics.processed = r.count;
      else if (r.status === 'FAILED') metrics.failed = r.count;
      metrics.total += r.count;
    }

    return metrics;
  }
}
