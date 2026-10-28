import { getMibValue, buildSnmpGetResponse, encodeOid } from '../snmpMock.js';
import { executeCommand } from '../sshMock.js';

console.log('🧪 Starting Backend & Protocol Unit Validation...\n');

// 1. Test SNMP MIB-II Mock Values
console.log('--- 1. Testing SNMP MIB-II Engine ---');
const sysDescr = getMibValue('1.3.6.1.2.1.1.1.0');
console.log('sysDescr (1.3.6.1.2.1.1.1.0):', sysDescr?.value);
if (!sysDescr || !String(sysDescr.value).includes('MikroTik')) {
  throw new Error('FAIL: sysDescr did not return expected MikroTik description');
}

const sysUpTime = getMibValue('1.3.6.1.2.1.1.3.0');
console.log('sysUpTime (1.3.6.1.2.1.1.3.0):', sysUpTime?.value, 'hundredths of a sec');
if (typeof sysUpTime?.value !== 'number') {
  throw new Error('FAIL: sysUpTime was not a number');
}

const ifIn = getMibValue('1.3.6.1.2.1.2.2.1.10.1');
console.log('ifInOctets.1 (1.3.6.1.2.1.2.2.1.10.1):', ifIn?.value, 'bytes');

// 2. Test BER OID Encoding & Packet Construction
console.log('\n--- 2. Testing ASN.1/BER Encoding ---');
const encodedOid = encodeOid('1.3.6.1.2.1.1.1.0');
console.log('Encoded OID bytes (hex):', encodedOid.toString('hex'));
if (encodedOid[0] !== 0x06) {
  throw new Error('FAIL: OID tag must be 0x06 (OBJECT IDENTIFIER)');
}

const snmpPacket = buildSnmpGetResponse(1042, 'public', sysDescr);
console.log('Constructed SNMP GetResponse packet length:', snmpPacket.length, 'bytes');
console.log('SNMP packet header (hex):', snmpPacket.subarray(0, 12).toString('hex'));
if (snmpPacket[0] !== 0x30) {
  throw new Error('FAIL: SNMP message must start with 0x30 (SEQUENCE)');
}

// 3. Test SSH Command Dispatcher
console.log('\n--- 3. Testing SSH Command Dispatcher ---');
const intOut = executeCommand('show interfaces');
console.log('Command "show interfaces" returned length:', intOut.length, 'chars');
if (!intOut.includes('ether1-gateway') || !intOut.includes('DC:2C:6E:4A:12:01')) {
  throw new Error('FAIL: show interfaces did not contain expected interface list');
}

const resOut = executeCommand('system resource print');
console.log('Command "system resource print" returned version:', resOut.includes('7.14.2'));
if (!resOut.includes('7.14.2')) {
  throw new Error('FAIL: system resource print did not contain RouterOS version');
}

console.log('\n✅ All Backend Protocols & Mock Engines passed validation successfully!');

