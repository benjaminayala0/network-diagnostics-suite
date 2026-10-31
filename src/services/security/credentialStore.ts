/**
 * Secure Credential Storage Service
 * Compliant with OWASP Mobile Application Security Verification Standard (MASVS).
 * Leverages Hardware-backed Android Keystore and iOS Keychain via expo-secure-store.
 */

export interface EquipmentCredentials {
  host: string;
  username: string;
  authType: 'PASSWORD' | 'SSH_KEY';
  secret: string; // Password or Private Key
  port?: number;
  snmpCommunity?: string;
  updatedAt: number;
}

const SECURE_STORE_PREFIX = 'telecom_cred_';
const HOST_REGISTRY_KEY = 'telecom_configured_hosts';

// In-memory cipher/fallback for Node.js test environments or non-native runtimes
const inMemorySecureVault: Map<string, string> = new Map();

async function getSecureStoreModule() {
  try {
    const SecureStore = await import('expo-secure-store');
    if (SecureStore && typeof SecureStore.setItemAsync === 'function') {
      return SecureStore;
    }
    return null;
  } catch {
    return null;
  }
}

export class CredentialStoreService {
  /**
   * Securely saves credentials for a given network node.
   * Keys are isolated per host in the hardware keystore.
   */
  static async saveCredentials(creds: EquipmentCredentials): Promise<void> {
    const cleanHost = creds.host.trim().toLowerCase();
    const storageKey = `${SECURE_STORE_PREFIX}${cleanHost.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const payload = JSON.stringify({
      ...creds,
      host: cleanHost,
      updatedAt: Date.now()
    });

    const SecureStore = await getSecureStoreModule();
    if (SecureStore) {
      await SecureStore.setItemAsync(storageKey, payload, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
      });
    } else {
      inMemorySecureVault.set(storageKey, payload);
    }

    await this.registerHost(cleanHost);
  }

  /**
   * Retrieves decrypted credentials for a given network host.
   */
  static async getCredentials(host: string): Promise<EquipmentCredentials | null> {
    const cleanHost = host.trim().toLowerCase();
    const storageKey = `${SECURE_STORE_PREFIX}${cleanHost.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    let raw: string | null = null;
    const SecureStore = await getSecureStoreModule();
    if (SecureStore) {
      raw = await SecureStore.getItemAsync(storageKey);
    } else {
      raw = inMemorySecureVault.get(storageKey) || null;
    }

    if (!raw) return null;
    try {
      return JSON.parse(raw) as EquipmentCredentials;
    } catch {
      return null;
    }
  }

  /**
   * Securely purges credentials for a host from the secure hardware enclave.
   */
  static async deleteCredentials(host: string): Promise<void> {
    const cleanHost = host.trim().toLowerCase();
    const storageKey = `${SECURE_STORE_PREFIX}${cleanHost.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

    const SecureStore = await getSecureStoreModule();
    if (SecureStore) {
      await SecureStore.deleteItemAsync(storageKey);
    } else {
      inMemorySecureVault.delete(storageKey);
    }

    await this.unregisterHost(cleanHost);
  }

  /**
   * Checks whether credentials exist for a target host.
   */
  static async hasCredentials(host: string): Promise<boolean> {
    const creds = await this.getCredentials(host);
    return creds !== null;
  }

  /**
   * Lists all hosts currently configured with saved credentials.
   */
  static async listConfiguredHosts(): Promise<string[]> {
    let raw: string | null = null;
    const SecureStore = await getSecureStoreModule();
    if (SecureStore) {
      raw = await SecureStore.getItemAsync(HOST_REGISTRY_KEY);
    } else {
      raw = inMemorySecureVault.get(HOST_REGISTRY_KEY) || null;
    }

    if (!raw) return [];
    try {
      const list = JSON.parse(raw);
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private static async registerHost(host: string): Promise<void> {
    const current = await this.listConfiguredHosts();
    if (!current.includes(host)) {
      const updated = [...current, host];
      const payload = JSON.stringify(updated);
      const SecureStore = await getSecureStoreModule();
      if (SecureStore) {
        await SecureStore.setItemAsync(HOST_REGISTRY_KEY, payload);
      } else {
        inMemorySecureVault.set(HOST_REGISTRY_KEY, payload);
      }
    }
  }

  private static async unregisterHost(host: string): Promise<void> {
    const current = await this.listConfiguredHosts();
    const updated = current.filter(h => h !== host);
    const payload = JSON.stringify(updated);
    const SecureStore = await getSecureStoreModule();
    if (SecureStore) {
      await SecureStore.setItemAsync(HOST_REGISTRY_KEY, payload);
    } else {
      inMemorySecureVault.set(HOST_REGISTRY_KEY, payload);
    }
  }

  /**
   * Purges all keys from test memory vault (used in unit test cleanup).
   */
  static _clearInMemoryVault(): void {
    inMemorySecureVault.clear();
  }
}

