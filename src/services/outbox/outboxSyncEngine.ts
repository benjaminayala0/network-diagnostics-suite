import { OutboxRepository } from '../../database/outboxRepository.ts';
import type { OutboxBatchRequest, OutboxBatchResponse, OutboxSyncState } from './outboxTypes.ts';

type SyncListener = (state: OutboxSyncState) => void;

export function getDefaultBackendUrl(): string {
  if (typeof window !== 'undefined' && typeof window.location !== 'undefined') {
    const hostname = window.location.hostname || 'localhost';
    return `http://${hostname}:3002`;
  }
  return 'http://10.0.2.2:3002';
}

export class OutboxSyncEngine {
  private backendUrl: string;
  private isSyncing: boolean = false;
  private isOnline: boolean = true;
  private lastSyncTimestamp: number | null = null;
  private lastError: string | null = null;
  private syncTimer: any = null;
  private listeners: Set<SyncListener> = new Set();
  private unsubscribeNetInfo: (() => void) | null = null;

  constructor(backendUrl?: string) {
    this.backendUrl = backendUrl || getDefaultBackendUrl();
  }

  public setBackendUrl(url: string): void {
    this.backendUrl = url;
  }

  public getBackendUrl(): string {
    return this.backendUrl;
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    this.emitState();
    return () => {
      this.listeners.delete(listener);
    };
  }

  public setOnlineStatus(online: boolean): void {
    if (this.isOnline === online) return;
    this.isOnline = online;
    this.emitState();
    if (online) {
      this.triggerFlush();
    }
  }

  public async startAutoSync(intervalMs: number = 30000): Promise<void> {
    try {
      const NetInfo = await import('@react-native-community/netinfo');
      if (NetInfo && NetInfo.default && typeof NetInfo.default.addEventListener === 'function') {
        this.unsubscribeNetInfo = NetInfo.default.addEventListener((state: any) => {
          const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
          this.setOnlineStatus(connected);
        });
      }
    } catch {
      // In tests or non-native runtimes, NetInfo may not be present
    }

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    this.syncTimer = setInterval(() => {
      if (this.isOnline && !this.isSyncing) {
        this.triggerFlush();
      }
    }, intervalMs);

    await this.triggerFlush();
  }

  public stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
      this.unsubscribeNetInfo = null;
    }
  }

  public async triggerFlush(batchSize: number = 25): Promise<{
    success: boolean;
    syncedCount: number;
    error?: string;
  }> {
    if (this.isSyncing) {
      return { success: false, syncedCount: 0, error: 'Sync already in progress' };
    }

    if (!this.isOnline) {
      return { success: false, syncedCount: 0, error: 'Device is offline' };
    }

    this.isSyncing = true;
    this.emitState();

    try {
      const pendingEvents = await OutboxRepository.getPending(batchSize);
      if (pendingEvents.length === 0) {
        this.isSyncing = false;
        this.emitState();
        return { success: true, syncedCount: 0 };
      }

      const ids = pendingEvents.map(e => e.id);
      await OutboxRepository.markInFlight(ids);
      this.emitState();

      const batchPayload: OutboxBatchRequest = {
        events: pendingEvents.map(e => {
          let parsedPayload = e.payload_json;
          try {
            parsedPayload = JSON.parse(e.payload_json);
          } catch {
            // keep raw string if not JSON
          }
          return {
            id: e.id,
            eventType: e.event_type,
            entityId: e.entity_id,
            payload: parsedPayload,
            createdAt: e.created_at
          };
        })
      };

      const syncUrl = `${this.backendUrl.replace(/\/$/, '')}/api/sync/outbox`;
      const response = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(batchPayload)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Sync backend returned HTTP ${response.status}: ${errorText}`);
      }

      const result: OutboxBatchResponse = await response.json();

      if (result.processedIds && result.processedIds.length > 0) {
        await OutboxRepository.markProcessed(result.processedIds);
      }

      if (result.rejectedIds && result.rejectedIds.length > 0) {
        for (const rejected of result.rejectedIds) {
          await OutboxRepository.markFailed(rejected.id, rejected.reason || 'Server rejected');
        }
      }

      this.lastSyncTimestamp = Date.now();
      this.lastError = null;
      this.isSyncing = false;
      this.emitState();

      return {
        success: true,
        syncedCount: result.processedIds ? result.processedIds.length : 0
      };
    } catch (err: any) {
      const errorMsg = err.message || 'Unknown network error during outbox sync';
      this.lastError = errorMsg;

      // Handle failed batch items: re-evaluate pending items that were set to IN_FLIGHT
      try {
        const pendingEvents = await OutboxRepository.getPending(batchSize);
        for (const evt of pendingEvents) {
          await OutboxRepository.markFailed(evt.id, errorMsg);
        }
      } catch {
        // Suppress secondary DB errors
      }

      this.isSyncing = false;
      this.emitState();

      return { success: false, syncedCount: 0, error: errorMsg };
    }
  }

  public async getState(): Promise<OutboxSyncState> {
    const metrics = await OutboxRepository.getQueueMetrics();
    return {
      isSyncing: this.isSyncing,
      isOnline: this.isOnline,
      pendingCount: metrics.pending,
      inFlightCount: metrics.inFlight,
      processedCount: metrics.processed,
      failedCount: metrics.failed,
      lastSyncTimestamp: this.lastSyncTimestamp,
      lastError: this.lastError
    };
  }

  private async emitState(): Promise<void> {
    if (this.listeners.size === 0) return;
    const state = await this.getState();
    this.listeners.forEach(fn => fn(state));
  }
}

export const defaultOutboxSyncEngine = new OutboxSyncEngine();
