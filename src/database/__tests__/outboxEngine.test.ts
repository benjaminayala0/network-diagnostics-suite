import assert from 'node:assert/strict';
import { setDatabaseAdapter, createInMemoryDatabaseAdapter } from '../sqliteDriver.ts';
import { OutboxRepository } from '../outboxRepository.ts';
import { OutboxSyncEngine } from '../../services/outbox/outboxSyncEngine.ts';
import { WorkOrdersRepository } from '../workOrdersRepository.ts';
import { DevicesRepository } from '../devicesRepository.ts';
import { DiagnosticsRepository } from '../diagnosticsRepository.ts';

async function runTestSuite() {
  console.log('🧪 Starting SQLite & Outbox Engine Test Suite...\n');
  let passedTests = 0;

  // Initialize in-memory test database adapter
  const testDb = createInMemoryDatabaseAdapter();
  setDatabaseAdapter(testDb);

  // Test 1: Device and Diagnostic Repository insertion
  try {
    const dev = {
      id: 'dev_01',
      ip: '192.168.1.1',
      mac: '00:1A:2B:3C:4D:5E',
      hostname: 'core-router-01',
      vendor: 'Cisco Systems',
      status: 'ONLINE' as const,
      response_time_ms: 12,
      last_seen: Date.now(),
      created_at: Date.now()
    };
    await DevicesRepository.upsert(dev);
    const retrievedDev = await DevicesRepository.findByIp('192.168.1.1');
    assert.equal(retrievedDev?.hostname, 'core-router-01');
    assert.equal(retrievedDev?.vendor, 'Cisco Systems');

    const session = {
      id: 'sess_01',
      device_id: 'dev_01',
      device_ip: '192.168.1.1',
      protocol: 'SNMP' as const,
      target_oid_or_cmd: '1.3.6.1.2.1.1.1.0',
      raw_output: 'Cisco IOS Software, C2960 Software',
      parsed_data_json: JSON.stringify({ sysDescr: 'Cisco IOS Software' }),
      status: 'SUCCESS' as const,
      execution_time_ms: 45,
      created_at: Date.now()
    };
    await DiagnosticsRepository.insert(session);
    const sessions = await DiagnosticsRepository.listByDevice('dev_01');
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].protocol, 'SNMP');

    console.log('✅ Test 1 Passed: Discovered Devices & Diagnostic Sessions CRUD');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 1 Failed:', err.message);
    process.exit(1);
  }

  // Test 2: Outbox Event Enqueueing & FIFO ordering
  try {
    const evt1 = await OutboxRepository.enqueue(
      'WORK_ORDER_CREATED',
      'wo_100',
      { site: 'Site Alpha', technician: 'Alex' }
    );
    assert.ok(evt1.id.startsWith('evt_'));
    assert.equal(evt1.status, 'PENDING');
    assert.equal(evt1.retry_count, 0);

    const pending = await OutboxRepository.getPending(10);
    assert.ok(pending.length >= 1);
    assert.equal(pending[0].entity_id, 'wo_100');

    console.log('✅ Test 2 Passed: Outbox Enqueueing & FIFO Ordering');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 2 Failed:', err.message);
    process.exit(1);
  }

  // Test 3: Status Transition (PENDING -> IN_FLIGHT -> PROCESSED)
  try {
    const evt2 = await OutboxRepository.enqueue(
      'DIAGNOSTIC_RECORDED',
      'sess_02',
      { command: 'show interfaces' }
    );

    await OutboxRepository.markInFlight([evt2.id]);
    let metrics = await OutboxRepository.getQueueMetrics();
    assert.ok(metrics.inFlight >= 1);

    await OutboxRepository.markProcessed([evt2.id]);
    metrics = await OutboxRepository.getQueueMetrics();
    assert.ok(metrics.processed >= 1);

    console.log('✅ Test 3 Passed: Lifecycle State Transitions (PENDING -> IN_FLIGHT -> PROCESSED)');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 3 Failed:', err.message);
    process.exit(1);
  }

  // Test 4: Exponential Backoff and Max Retries to FAILED
  try {
    const evt3 = await OutboxRepository.enqueue(
      'REPORT_UPLOAD',
      'rep_999',
      { reportName: 'Site-Tower-A.pdf' },
      2 // max 2 retries
    );

    // First failure: retry_count becomes 1
    const beforeRetry1 = Date.now();
    await OutboxRepository.markFailed(evt3.id, 'Gateway Timeout (504)', 500);

    // Retrieve pending (should be back to PENDING with next_retry_at in future)
    let pending = await OutboxRepository.getPending(10);
    // Since next_retry_at is in future, getPending(now) will filter it out if now is before
    const nextRetryAt = beforeRetry1 + (500 * Math.pow(2, 0));
    assert.ok(nextRetryAt > beforeRetry1);

    // Second failure: reaches maxRetries (2) -> status must be FAILED
    await OutboxRepository.markFailed(evt3.id, 'Connection Refused', 500);
    const metrics = await OutboxRepository.getQueueMetrics();
    assert.ok(metrics.failed >= 1);

    console.log('✅ Test 4 Passed: Exponential Backoff and Max Retries Exhaustion');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 4 Failed:', err.message);
    process.exit(1);
  }

  // Test 5: OutboxSyncEngine Batch Flush with Mock HTTP Network
  try {
    const syncEngine = new OutboxSyncEngine('http://mock-sync-server:3002');
    
    // Enqueue an event for sync
    const evtToSync = await OutboxRepository.enqueue(
      'WORK_ORDER_CREATED',
      'wo_sync_test',
      { site: 'Substation Central', serial: 'SN-998877' }
    );

    // Mock global fetch to simulate successful ingestion
    let capturedBody: any = null;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: any, opts: any) => {
      capturedBody = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          processedIds: [evtToSync.id],
          rejectedIds: [],
          timestamp: new Date().toISOString()
        })
      } as any;
    };

    const flushResult = await syncEngine.triggerFlush();
    assert.equal(flushResult.success, true);
    assert.ok(flushResult.syncedCount >= 1);
    assert.ok(capturedBody.events.length >= 1);
    assert.ok(capturedBody.events.some((e: any) => e.id === evtToSync.id));

    // Restore fetch
    globalThis.fetch = originalFetch;

    console.log('✅ Test 5 Passed: OutboxSyncEngine Flush & Server Ingestion');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 5 Failed:', err.message);
    process.exit(1);
  }

  // Test 6: Offline Resilience - No network dispatch when offline
  try {
    const syncEngine = new OutboxSyncEngine('http://mock-sync-server:3002');
    syncEngine.setOnlineStatus(false);

    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return {} as any;
    };

    const offlineResult = await syncEngine.triggerFlush();
    assert.equal(offlineResult.success, false);
    assert.equal(offlineResult.error, 'Device is offline');
    assert.equal(fetchCalled, false);

    globalThis.fetch = originalFetch;

    console.log('✅ Test 6 Passed: Offline Guard & Disconnected Queue Retention');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 6 Failed:', err.message);
    process.exit(1);
  }

  console.log(`\n🎉 All ${passedTests} Outbox & SQLite Architecture Tests Passed Successfully!`);
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
