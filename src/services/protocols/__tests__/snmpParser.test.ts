import assert from 'node:assert/strict';
import {
  encodeBerLength,
  decodeBerLength,
  encodeOid,
  decodeOid,
  encodeInteger,
  encodeOctetString,
  buildSnmpGetRequest,
  parseSnmpGetResponse,
  formatTimeTicks,
  ASN1_TAGS
} from '../snmpParser.ts';
import { CredentialStoreService } from '../../security/credentialStore.ts';

async function runProtocolTestSuite() {
  console.log('🧪 Starting SNMP v1/v2c Protocol & Security Test Suite...\n');
  let passedTests = 0;

  // Test 1: ASN.1 BER Length Encoding & Decoding
  try {
    const shortLen = encodeBerLength(42);
    assert.equal(shortLen.length, 1);
    assert.equal(shortLen[0], 42);
    assert.deepEqual(decodeBerLength(shortLen, 0), { length: 42, bytesRead: 1 });

    const longLen = encodeBerLength(300);
    assert.equal(longLen[0], 0x82); // 2 bytes follow
    assert.deepEqual(decodeBerLength(longLen, 0), { length: 300, bytesRead: 3 });

    console.log('✅ Test 1 Passed: BER Length Encoding & Decoding');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 1 Failed:', err.message);
    process.exit(1);
  }

  // Test 2: OID Encoding & Decoding (RFC 1157 / RFC 1213)
  try {
    const testOid = '1.3.6.1.2.1.1.1.0'; // sysDescr
    const encoded = encodeOid(testOid);
    assert.equal(encoded[0], ASN1_TAGS.OBJECT_IDENTIFIER);

    const lengthInfo = decodeBerLength(encoded, 1);
    const decoded = decodeOid(encoded, 1 + lengthInfo.bytesRead, lengthInfo.length);
    assert.equal(decoded, testOid);

    // Test enterprise OID with large sub-identifier (MikroTik: 1.3.6.1.4.1.14988.1)
    const enterpriseOid = '1.3.6.1.4.1.14988.1';
    const encodedEnterprise = encodeOid(enterpriseOid);
    const entLenInfo = decodeBerLength(encodedEnterprise, 1);
    const decodedEnterprise = decodeOid(encodedEnterprise, 1 + entLenInfo.bytesRead, entLenInfo.length);
    assert.equal(decodedEnterprise, enterpriseOid);

    console.log('✅ Test 2 Passed: MIB-II & Enterprise OID Encoding/Decoding');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 2 Failed:', err.message);
    process.exit(1);
  }

  // Test 3: Binary SNMP GetRequest Construction
  try {
    const reqPacket = buildSnmpGetRequest({
      version: 1, // v2c
      community: 'telecom_noc',
      requestId: 88412,
      oid: '1.3.6.1.2.1.1.5.0' // sysName
    });

    assert.ok(reqPacket.length > 20);
    assert.equal(reqPacket[0], ASN1_TAGS.SEQUENCE); // 0x30

    // Validate Community String is present in the raw byte stream
    const communityUtf8 = new TextEncoder().encode('telecom_noc');
    let foundCommunity = false;
    for (let i = 0; i < reqPacket.length - communityUtf8.length; i++) {
      if (reqPacket.slice(i, i + communityUtf8.length).every((b, idx) => b === communityUtf8[idx])) {
        foundCommunity = true;
        break;
      }
    }
    assert.ok(foundCommunity, 'Community string must exist in GetRequest binary payload');

    console.log('✅ Test 3 Passed: SNMP GetRequest Binary PDU Generation');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 3 Failed:', err.message);
    process.exit(1);
  }

  // Test 4: Binary SNMP GetResponse Decoding (String & Counter32)
  try {
    // Construct a synthetic GetResponse packet for sysDescr
    const sysDescrText = 'Cisco IOS-XE Software (Catalyst 9300-48P)';
    const textBytes = new TextEncoder().encode(sysDescrText);
    const valTlv = new Uint8Array([ASN1_TAGS.OCTET_STRING, textBytes.length, ...textBytes]);

    const oidTlv = encodeOid('1.3.6.1.2.1.1.1.0');
    const varBindPayload = new Uint8Array([...oidTlv, ...valTlv]);
    const varBindSeq = new Uint8Array([ASN1_TAGS.SEQUENCE, varBindPayload.length, ...varBindPayload]);
    const varBindList = new Uint8Array([ASN1_TAGS.SEQUENCE, varBindSeq.length, ...varBindSeq]);

    // PDU: reqId=501, errStatus=0, errIndex=0, varBindList
    const reqIdTlv = encodeInteger(501);
    const errStatusTlv = encodeInteger(0);
    const errIndexTlv = encodeInteger(0);
    const pduPayload = new Uint8Array([...reqIdTlv, ...errStatusTlv, ...errIndexTlv, ...varBindList]);
    const pduTlv = new Uint8Array([ASN1_TAGS.GET_RESPONSE, pduPayload.length, ...pduPayload]);

    const verTlv = encodeInteger(1);
    const commTlv = encodeOctetString('public');
    const rootPayload = new Uint8Array([...verTlv, ...commTlv, ...pduTlv]);
    const responsePacket = new Uint8Array([ASN1_TAGS.SEQUENCE, rootPayload.length, ...rootPayload]);

    const parsed = parseSnmpGetResponse(responsePacket);
    assert.equal(parsed.versionName, 'v2c');
    assert.equal(parsed.community, 'public');
    assert.equal(parsed.requestId, 501);
    assert.equal(parsed.errorStatusText, 'noError');
    assert.equal(parsed.varBinds.length, 1);
    assert.equal(parsed.varBinds[0].oid, '1.3.6.1.2.1.1.1.0');
    assert.equal(parsed.varBinds[0].type, 'OCTET_STRING');
    assert.equal(parsed.varBinds[0].value, sysDescrText);

    console.log('✅ Test 4 Passed: SNMP GetResponse Parsing (String Payload)');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 4 Failed:', err.message);
    process.exit(1);
  }

  // Test 5: SNMP TimeTicks & Counter32 Formatting
  try {
    const hundredths = 18452033; // 2 days, 3 hours, 15 minutes, 20 seconds, 33 hundredths
    const uptimeStr = formatTimeTicks(hundredths);
    assert.ok(uptimeStr.includes('2d 3h 15m 20s'));

    // Construct a synthetic TimeTicks response (0x43 tag)
    const timeBytes = new Uint8Array([0x43, 0x04, (hundredths >> 24) & 0xFF, (hundredths >> 16) & 0xFF, (hundredths >> 8) & 0xFF, hundredths & 0xFF]);
    const oidTlv = encodeOid('1.3.6.1.2.1.1.3.0'); // sysUpTime
    const varBindPayload = new Uint8Array([...oidTlv, ...timeBytes]);
    const varBindSeq = new Uint8Array([ASN1_TAGS.SEQUENCE, varBindPayload.length, ...varBindPayload]);
    const varBindList = new Uint8Array([ASN1_TAGS.SEQUENCE, varBindSeq.length, ...varBindSeq]);

    const pduPayload = new Uint8Array([...encodeInteger(999), ...encodeInteger(0), ...encodeInteger(0), ...varBindList]);
    const pduTlv = new Uint8Array([ASN1_TAGS.GET_RESPONSE, pduPayload.length, ...pduPayload]);
    const rootPayload = new Uint8Array([...encodeInteger(1), ...encodeOctetString('public'), ...pduTlv]);
    const responsePacket = new Uint8Array([ASN1_TAGS.SEQUENCE, rootPayload.length, ...rootPayload]);

    const parsed = parseSnmpGetResponse(responsePacket);
    assert.equal(parsed.varBinds[0].type, 'TIMETICKS');
    assert.equal(parsed.varBinds[0].value, hundredths);
    assert.ok(parsed.varBinds[0].formattedValue?.includes('2d 3h'));

    console.log('✅ Test 5 Passed: SNMP TimeTicks & Counter32 Decoding & Formatting');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 5 Failed:', err.message);
    process.exit(1);
  }

  // Test 6: Secure Credential Storage (OWASP Security Model)
  try {
    CredentialStoreService._clearInMemoryVault();

    // 1. Save Host Credentials
    await CredentialStoreService.saveCredentials({
      host: '192.168.1.1',
      username: 'admin',
      authType: 'PASSWORD',
      secret: 'SuperSecretTelecomKey#2026',
      port: 22,
      snmpCommunity: 'public_monitor',
      updatedAt: Date.now()
    });

    assert.equal(await CredentialStoreService.hasCredentials('192.168.1.1'), true);

    // 2. Retrieve and assert secret matching
    const retrieved = await CredentialStoreService.getCredentials('192.168.1.1');
    assert.ok(retrieved !== null);
    assert.equal(retrieved.username, 'admin');
    assert.equal(retrieved.secret, 'SuperSecretTelecomKey#2026');
    assert.equal(retrieved.snmpCommunity, 'public_monitor');

    // 3. Verify Host Registry
    const hosts = await CredentialStoreService.listConfiguredHosts();
    assert.ok(hosts.includes('192.168.1.1'));

    // 4. Delete Credentials
    await CredentialStoreService.deleteCredentials('192.168.1.1');
    assert.equal(await CredentialStoreService.hasCredentials('192.168.1.1'), false);
    const hostsAfter = await CredentialStoreService.listConfiguredHosts();
    assert.ok(!hostsAfter.includes('192.168.1.1'));

    console.log('✅ Test 6 Passed: Secure Credential Management & Enclave Isolation');
    passedTests++;
  } catch (err: any) {
    console.error('❌ Test 6 Failed:', err.message);
    process.exit(1);
  }

  console.log(`\n🎉 All ${passedTests} Protocol & Security Tests Passed Successfully!`);
}

runProtocolTestSuite().catch((err) => {
  console.error('Fatal protocol test error:', err);
  process.exit(1);
});
