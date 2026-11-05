import { create } from 'zustand';
import { defaultOutboxSyncEngine } from '../services/outbox/outboxSyncEngine.ts';
import { OutboxSyncState } from '../services/outbox/outboxTypes.ts';
import { OutboxRepository } from '../database/outboxRepository.ts';

interface OutboxStoreState extends OutboxSyncState {
  backendUrl: string;
  isSimulatedOffline: boolean;
  setBackendUrl: (url: string) => void;
  triggerManualSync: () => Promise<void>;
  setOnlineStatus: (online: boolean) => void;
  toggleOfflineMode: () => boolean;
  reclaimInFlight: () => Promise<number>;
  initSyncEngine: () => () => void;
}

export const useOutboxStore = create<OutboxStoreState>((set, get) => ({
  isSyncing: false,
  isOnline: true,
  isSimulatedOffline: defaultOutboxSyncEngine.isSimulatingOffline(),
  pendingCount: 0,
  inFlightCount: 0,
  processedCount: 0,
  failedCount: 0,
  lastSyncTimestamp: null,
  lastError: null,
  backendUrl: defaultOutboxSyncEngine.getBackendUrl(),

  setBackendUrl: (url: string) => {
    defaultOutboxSyncEngine.setBackendUrl(url);
    set({ backendUrl: url });
  },

  triggerManualSync: async () => {
    await defaultOutboxSyncEngine.triggerFlush();
  },

  setOnlineStatus: (online: boolean) => {
    defaultOutboxSyncEngine.setOnlineStatus(online, true);
    set({
      isOnline: online,
      isSimulatedOffline: defaultOutboxSyncEngine.isSimulatingOffline()
    });
  },

  toggleOfflineMode: () => {
    const isOffline = defaultOutboxSyncEngine.toggleSimulatedOffline();
    set({
      isSimulatedOffline: isOffline,
      isOnline: !isOffline
    });
    if (!isOffline) {
      defaultOutboxSyncEngine.triggerFlush().catch(() => {});
    }
    return isOffline;
  },

  reclaimInFlight: async () => {
    const reclaimed = await OutboxRepository.reclaimStaleInFlight(0);
    const metrics = await OutboxRepository.getQueueMetrics();
    set({
      pendingCount: metrics.pending,
      inFlightCount: metrics.inFlight,
      processedCount: metrics.processed,
      failedCount: metrics.failed
    });
    return reclaimed;
  },

  initSyncEngine: () => {
    const unsubscribe = defaultOutboxSyncEngine.subscribe((engineState) => {
      set({
        isSyncing: engineState.isSyncing,
        isOnline: engineState.isOnline,
        isSimulatedOffline: defaultOutboxSyncEngine.isSimulatingOffline(),
        pendingCount: engineState.pendingCount,
        inFlightCount: engineState.inFlightCount,
        processedCount: engineState.processedCount,
        failedCount: engineState.failedCount,
        lastSyncTimestamp: engineState.lastSyncTimestamp,
        lastError: engineState.lastError
      });
    });

    defaultOutboxSyncEngine.startAutoSync(20000);

    return () => {
      unsubscribe();
      defaultOutboxSyncEngine.stopAutoSync();
    };
  }
}));

