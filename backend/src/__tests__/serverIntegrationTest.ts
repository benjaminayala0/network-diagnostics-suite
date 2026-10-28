async function runIntegrationTest() {
  console.log('🚀 Running Server Integration Test...');
  
  // Dynamic import of server
  await import('../server.js');
  
  // Wait 1.5 seconds for listeners to be ready
  await new Promise((r) => setTimeout(r, 1500));

  try {
    // 1. Test /api/health
    const healthRes = await fetch('http://127.0.0.1:3002/api/health');
    const healthData = (await healthRes.json()) as any;
    console.log('✅ GET /api/health:', healthData);
    if (healthData.status !== 'ONLINE') throw new Error('Health check failed');

    // 2. Test /api/assets/SN-MT-5009-001
    const assetRes = await fetch('http://127.0.0.1:3002/api/assets/SN-MT-5009-001');
    const assetData = (await assetRes.json()) as any;
    console.log('✅ GET /api/assets/SN-MT-5009-001:', assetData.model, '|', assetData.macAddress);
    if (!assetData.model.includes('MikroTik')) throw new Error('Asset lookup failed');

    // 3. Test POST /api/sync/outbox
    const syncRes = await fetch('http://127.0.0.1:3002/api/sync/outbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [
          {
            id: 'outbox-action-01',
            type: 'WORK_ORDER_COMPLETED',
            payload: { technician: 'T-42', site: 'Node Central' },
          },
        ],
      }),
    });
    const syncData = (await syncRes.json()) as any;
    console.log('✅ POST /api/sync/outbox:', syncData);
    if (!syncData.syncedIds.includes('outbox-action-01')) throw new Error('Outbox sync failed');

    // 4. Test POST /api/ssh/execute
    const sshRes = await fetch('http://127.0.0.1:3002/api/ssh/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'show interfaces' }),
    });
    const sshData = (await sshRes.json()) as any;
    console.log('✅ POST /api/ssh/execute:', sshData.output.slice(0, 80).trim() + '...');
    if (!sshData.output.includes('ether1-gateway')) throw new Error('SSH execute failed');

    // 5. Test GET /api/snmp/query
    const snmpRes = await fetch('http://127.0.0.1:3002/api/snmp/query?oid=1.3.6.1.2.1.1.1.0');
    const snmpData = (await snmpRes.json()) as any;
    console.log('✅ GET /api/snmp/query:', snmpData.oid, '->', snmpData.value);
    if (!String(snmpData.value).includes('MikroTik')) throw new Error('SNMP query failed');

    console.log('\n🎉 ALL 5 REST & PROTOCOL ENDPOINTS VALIDATED SUCCESSFULLY!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Integration test error:', err);
    process.exit(1);
  }
}

runIntegrationTest();
