import { create } from 'zustand';
import { defaultOutboxSyncEngine } from '../services/outbox/outboxSyncEngine.ts';
import { OutboxSyncState } from '../services/outbox/outboxTypes.ts';

interface OutboxStoreState extends OutboxSyncState {
  backendUrl: string;
  setBackendUrl: (url: string) => void;
  triggerManualSync: () => Promise<void>;
  setOnlineStatus: (online: boolean) => void;
  initSyncEngine: () => () => void;
}

export const useOutboxStore = create<OutboxStoreState>((set, get) => ({
  isSyncing: false,
  isOnline: true,
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
    defaultOutboxSyncEngine.setOnlineStatus(online);
  },

  initSyncEngine: () => {
    const unsubscribe = defaultOutboxSyncEngine.subscribe((engineState) => {
      set({
        isSyncing: engineState.isSyncing,
        isOnline: engineState.isOnline,
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

