import dgram from 'dgram';

export interface SnmpOidData {
  oid: string;
  type: 'OCTET_STRING' | 'TIMETICKS' | 'INTEGER' | 'COUNTER32';
  value: string | number;
}

const startTime = Date.now();

// Standard MIB-II Managed Object Database
export const MIB2_DATABASE: Record<string, SnmpOidData> = {
  // sysDescr (1.3.6.1.2.1.1.1.0)
  '1.3.6.1.2.1.1.1.0': {
    oid: '1.3.6.1.2.1.1.1.0',
    type: 'OCTET_STRING',
    value: 'MikroTik RouterOS v7.14.2 (RB5009UG+S+IN) - Telecom Gateway Node',
  },
  // sysObjectID (1.3.6.1.2.1.1.2.0)
  '1.3.6.1.2.1.1.2.0': {
    oid: '1.3.6.1.2.1.1.2.0',
    type: 'OCTET_STRING',
    value: '1.3.6.1.4.1.14988.1',
  },
  // sysUpTime (1.3.6.1.2.1.1.3.0) -> Timeticks in 1/100 of a second
  '1.3.6.1.2.1.1.3.0': {
    oid: '1.3.6.1.2.1.1.3.0',
    type: 'TIMETICKS',
    value: 0, // dynamic
  },
  // sysContact (1.3.6.1.2.1.1.4.0)
  '1.3.6.1.2.1.1.4.0': {
    oid: '1.3.6.1.2.1.1.4.0',
    type: 'OCTET_STRING',
    value: 'NOC Telecom Operations <noc@telecom-infra.net>',
  },
  // sysName (1.3.6.1.2.1.1.5.0)
  '1.3.6.1.2.1.1.5.0': {
    oid: '1.3.6.1.2.1.1.5.0',
    type: 'OCTET_STRING',
    value: 'gw-concepcion-node-01',
  },
  // sysLocation (1.3.6.1.2.1.1.6.0)
  '1.3.6.1.2.1.1.6.0': {
    oid: '1.3.6.1.2.1.1.6.0',
    type: 'OCTET_STRING',
    value: 'Rack A3 - Site 42 (Concepción del Uruguay)',
  },
  // ifInOctets.1 (1.3.6.1.2.1.2.2.1.10.1)
  '1.3.6.1.2.1.2.2.1.10.1': {
    oid: '1.3.6.1.2.1.2.2.1.10.1',
    type: 'COUNTER32',
    value: 849201842,
  },
  // ifOutOctets.1 (1.3.6.1.2.1.2.2.1.16.1)
  '1.3.6.1.2.1.2.2.1.16.1': {
    oid: '1.3.6.1.2.1.2.2.1.16.1',
    type: 'COUNTER32',
    value: 419582103,
  },
  // ifOperStatus.1 (1.3.6.1.2.1.2.2.1.8.1) -> 1 = Up
  '1.3.6.1.2.1.2.2.1.8.1': {
    oid: '1.3.6.1.2.1.2.2.1.8.1',
    type: 'INTEGER',
    value: 1,
  },
};

export function getMibValue(oid: string): SnmpOidData | null {
  const cleanOid = oid.startsWith('.') ? oid.slice(1) : oid;
  const match = MIB2_DATABASE[cleanOid];
  if (!match) return null;

  if (cleanOid === '1.3.6.1.2.1.1.3.0') {
    const elapsedHundredths = Math.floor((Date.now() - startTime) / 10);
    return { ...match, value: elapsedHundredths };
  }
  if (cleanOid === '1.3.6.1.2.1.2.2.1.10.1') {
    const elapsedSecs = Math.floor((Date.now() - startTime) / 1000);
    return { ...match, value: (849201842 + elapsedSecs * 1250000) >>> 0 };
  }
  if (cleanOid === '1.3.6.1.2.1.2.2.1.16.1') {
    const elapsedSecs = Math.floor((Date.now() - startTime) / 1000);
    return { ...match, value: (419582103 + elapsedSecs * 620000) >>> 0 };
  }
  return match;
}

/**
 * Encodes an ASN.1 Length component in Basic Encoding Rules (BER).
 */
export function encodeBerLength(length: number): Buffer {
  if (length < 128) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp = temp >> 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

/**
 * Encodes an OID string (e.g., '1.3.6.1.2.1.1.1.0') into BER binary format.
 */
export function encodeOid(oidStr: string): Buffer {
  const parts = oidStr.split('.').map((p) => parseInt(p, 10));
  if (parts.length < 2) return Buffer.from([0x06, 0x00]);

  const subIdentifiers: number[] = [parts[0] * 40 + parts[1]];
  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    if (val < 128) {
      subIdentifiers.push(val);
    } else {
      const vBytes: number[] = [];
      vBytes.push(val & 0x7f);
      val = val >> 7;
      while (val > 0) {
        vBytes.unshift(0x80 | (val & 0x7f));
        val = val >> 7;
      }
      subIdentifiers.push(...vBytes);
    }
  }

  const lengthBuf = encodeBerLength(subIdentifiers.length);
  return Buffer.concat([Buffer.from([0x06]), lengthBuf, Buffer.from(subIdentifiers)]);
}

/**
 * Builds an SNMP GetResponse PDU buffer given a request-id, community string, and OID data.
 */
export function buildSnmpGetResponse(
  requestId: number,
  community: string,
  oidData: SnmpOidData
): Buffer {
  // 1. Encode Value
  let valueBuffer: Buffer;
  if (oidData.type === 'OCTET_STRING') {
    const strBytes = Buffer.from(String(oidData.value), 'utf8');
    valueBuffer = Buffer.concat([Buffer.from([0x04]), encodeBerLength(strBytes.length), strBytes]);
  } else if (oidData.type === 'TIMETICKS') {
    // 0x43 is Application 3 = TimeTicks
    const num = Number(oidData.value);
    const numBytes = Buffer.alloc(4);
    numBytes.writeUInt32BE(num >>> 0, 0);
    valueBuffer = Buffer.concat([Buffer.from([0x43]), encodeBerLength(4), numBytes]);
  } else if (oidData.type === 'COUNTER32') {
    // 0x41 is Application 1 = Counter32
    const num = Number(oidData.value);
    const numBytes = Buffer.alloc(4);
    numBytes.writeUInt32BE(num >>> 0, 0);
    valueBuffer = Buffer.concat([Buffer.from([0x41]), encodeBerLength(4), numBytes]);
  } else {
    // INTEGER 0x02
    const num = Number(oidData.value);
    valueBuffer = Buffer.from([0x02, 0x01, num & 0xff]);
  }

  // 2. Encode VarBind: SEQUENCE { OID, Value }
  const oidBuffer = encodeOid(oidData.oid);
  const varBindPayload = Buffer.concat([oidBuffer, valueBuffer]);
  const varBind = Buffer.concat([
    Buffer.from([0x30]),
    encodeBerLength(varBindPayload.length),
    varBindPayload,
  ]);

  // 3. VarBindList: SEQUENCE OF VarBind
  const varBindList = Buffer.concat([
    Buffer.from([0x30]),
    encodeBerLength(varBind.length),
    varBind,
  ]);

  // 4. GetResponse PDU: 0xA2 (Context-specific constructed 2)
  const reqIdBuf = Buffer.alloc(4);
  reqIdBuf.writeInt32BE(requestId, 0);
  const reqIdTlv = Buffer.concat([Buffer.from([0x02, 0x04]), reqIdBuf]);
  const errStatusTlv = Buffer.from([0x02, 0x01, 0x00]); // noError (0)
  const errIndexTlv = Buffer.from([0x02, 0x01, 0x00]);  // errorIndex (0)

  const pduPayload = Buffer.concat([reqIdTlv, errStatusTlv, errIndexTlv, varBindList]);
  const pdu = Buffer.concat([Buffer.from([0xa2]), encodeBerLength(pduPayload.length), pduPayload]);

  // 5. Message: SEQUENCE { version, community, PDU }
  const versionTlv = Buffer.from([0x02, 0x01, 0x01]); // SNMP v2c (1)
  const commBytes = Buffer.from(community, 'utf8');
  const commTlv = Buffer.concat([Buffer.from([0x04]), encodeBerLength(commBytes.length), commBytes]);

  const msgPayload = Buffer.concat([versionTlv, commTlv, pdu]);
  return Buffer.concat([Buffer.from([0x30]), encodeBerLength(msgPayload.length), msgPayload]);
}

/**
 * Starts the embedded UDP SNMP mock agent.
 */
export function startSnmpMockAgent(port = 1161): dgram.Socket {
  const server = dgram.createSocket('udp4');

  server.on('message', (msg, rinfo) => {
    try {
      // Basic check for SNMP Sequence 0x30
      if (msg.length < 10 || msg[0] !== 0x30) return;

      // Extract Request ID (assumed near offset 14-18)
      let reqId = 1001;
      for (let i = 4; i < msg.length - 5; i++) {
        if (msg[i] === 0xa0) {
          // Found GetRequest PDU
          if (msg[i + 2] === 0x02 && msg[i + 3] === 0x04) {
            reqId = msg.readInt32BE(i + 4);
          }
          break;
        }
      }

      // Default to sysDescr if OID parsing is partial
      let targetOid = '1.3.6.1.2.1.1.1.0';
      if (msg.includes(Buffer.from([0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x03]))) {
        targetOid = '1.3.6.1.2.1.1.3.0'; // sysUpTime
      } else if (msg.includes(Buffer.from([0x2b, 0x06, 0x01, 0x02, 0x01, 0x01, 0x05]))) {
        targetOid = '1.3.6.1.2.1.1.5.0'; // sysName
      } else if (msg.includes(Buffer.from([0x2b, 0x06, 0x01, 0x02, 0x01, 0x02, 0x02, 0x01, 0x0a]))) {
        targetOid = '1.3.6.1.2.1.2.2.1.10.1'; // ifInOctets.1
      } else if (msg.includes(Buffer.from([0x2b, 0x06, 0x01, 0x02, 0x01, 0x02, 0x02, 0x01, 0x10]))) {
        targetOid = '1.3.6.1.2.1.2.2.1.16.1'; // ifOutOctets.1
      }

      const oidData = getMibValue(targetOid) || {
        oid: targetOid,
        type: 'OCTET_STRING',
        value: 'Unknown Managed Object',
      };

      const responsePacket = buildSnmpGetResponse(reqId, 'public', oidData);
      server.send(responsePacket, rinfo.port, rinfo.address);
    } catch (err) {
      console.warn('[SNMP Mock] Parsing error:', err);
    }
  });

  server.on('listening', () => {
    const addr = server.address();
    console.log(`📡 [SNMP Mock Agent] Listening on UDP ${addr.address}:${addr.port}`);
  });

  server.bind(port);
  return server;
}

