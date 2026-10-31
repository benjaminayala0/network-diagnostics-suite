/**
 * SNMP v1/v2c Protocol Engine & ASN.1 BER Binary Encoder/Decoder
 * Compliant with RFC 1157 (SNMP), RFC 1213 (MIB-II), and X.690 (BER).
 */

export const ASN1_TAGS = {
  INTEGER: 0x02,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OBJECT_IDENTIFIER: 0x06,
  SEQUENCE: 0x30,
  // SNMP Application specific tags
  IP_ADDRESS: 0x40,
  COUNTER32: 0x41,
  GAUGE32: 0x42,
  TIMETICKS: 0x43,
  OPAQUE: 0x44,
  COUNTER64: 0x46,
  // SNMP PDU Types
  GET_REQUEST: 0xA0,
  GET_NEXT_REQUEST: 0xA1,
  GET_RESPONSE: 0xA2,
  SET_REQUEST: 0xA3,
  TRAP: 0xA4
} as const;

export const SNMP_ERROR_STATUS = {
  0: 'noError',
  1: 'tooBig',
  2: 'noSuchName',
  3: 'badValue',
  4: 'readOnly',
  5: 'genErr'
} as const;

export interface SnmpVarBind {
  oid: string;
  type: string;
  tag: number;
  value: string | number | null;
  formattedValue?: string;
}

export interface SnmpGetRequestParams {
  version?: 0 | 1; // 0 = SNMPv1, 1 = SNMPv2c
  community: string;
  requestId: number;
  oid: string;
}

export interface SnmpResponsePacket {
  version: number;
  versionName: 'v1' | 'v2c' | 'v3';
  community: string;
  pduType: number;
  requestId: number;
  errorStatus: number;
  errorStatusText: string;
  errorIndex: number;
  varBinds: SnmpVarBind[];
}

/**
 * Encodes an ASN.1 Length component in Basic Encoding Rules (BER).
 */
export function encodeBerLength(length: number): Uint8Array {
  if (length < 128) {
    return new Uint8Array([length]);
  }
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) {
    bytes.unshift(temp & 0xFF);
    temp = temp >> 8;
  }
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

/**
 * Decodes an ASN.1 BER length component from a byte array.
 */
export function decodeBerLength(
  data: Uint8Array,
  offset: number
): { length: number; bytesRead: number } {
  if (offset >= data.length) {
    throw new Error(`BER decode error: offset ${offset} exceeds buffer length ${data.length}`);
  }
  const initial = data[offset];
  if ((initial & 0x80) === 0) {
    return { length: initial, bytesRead: 1 };
  }

  const lengthOfLength = initial & 0x7F;
  if (lengthOfLength === 0) {
    throw new Error('BER decode error: indefinite length encoding is unsupported in SNMP');
  }
  if (offset + 1 + lengthOfLength > data.length) {
    throw new Error('BER decode error: length descriptor exceeds buffer size');
  }

  let totalLength = 0;
  for (let i = 0; i < lengthOfLength; i++) {
    totalLength = (totalLength << 8) | data[offset + 1 + i];
  }
  return { length: totalLength, bytesRead: 1 + lengthOfLength };
}

/**
 * Encodes a dotted decimal OID string (e.g. "1.3.6.1.2.1.1.1.0") to BER TLV.
 */
export function encodeOid(oidStr: string): Uint8Array {
  const cleanOid = oidStr.startsWith('.') ? oidStr.slice(1) : oidStr;
  const parts = cleanOid.split('.').map(p => {
    const val = parseInt(p, 10);
    if (isNaN(val)) throw new Error(`Invalid OID segment "${p}" in "${oidStr}"`);
    return val;
  });

  if (parts.length < 2) {
    return new Uint8Array([ASN1_TAGS.OBJECT_IDENTIFIER, 0x00]);
  }

  // First two sub-identifiers are combined: (parts[0] * 40) + parts[1]
  const subIds: number[] = [parts[0] * 40 + parts[1]];

  for (let i = 2; i < parts.length; i++) {
    let val = parts[i];
    if (val < 128) {
      subIds.push(val);
    } else {
      const vBytes: number[] = [];
      vBytes.push(val & 0x7F);
      val = val >> 7;
      while (val > 0) {
        vBytes.unshift(0x80 | (val & 0x7F));
        val = val >> 7;
      }
      subIds.push(...vBytes);
    }
  }

  const lengthBuf = encodeBerLength(subIds.length);
  return concatBytes(new Uint8Array([ASN1_TAGS.OBJECT_IDENTIFIER]), lengthBuf, new Uint8Array(subIds));
}

/**
 * Decodes a BER OID byte sequence to a dotted decimal string.
 */
export function decodeOid(data: Uint8Array, offset: number, length: number): string {
  if (length === 0) return '';
  const firstByte = data[offset];
  const firstNode = Math.floor(firstByte / 40);
  const secondNode = firstByte % 40;
  const nodes: number[] = [firstNode, secondNode];

  let currentVal = 0;
  for (let i = 1; i < length; i++) {
    const byte = data[offset + i];
    currentVal = (currentVal << 7) | (byte & 0x7F);
    if ((byte & 0x80) === 0) {
      nodes.push(currentVal);
      currentVal = 0;
    }
  }

  return nodes.join('.');
}

/**
 * Encodes an integer value as ASN.1 INTEGER TLV.
 */
export function encodeInteger(num: number, is32Bit: boolean = false): Uint8Array {
  const bytes: number[] = [];
  if (is32Bit) {
    const unsigned = num >>> 0;
    bytes.push((unsigned >> 24) & 0xFF);
    bytes.push((unsigned >> 16) & 0xFF);
    bytes.push((unsigned >> 8) & 0xFF);
    bytes.push(unsigned & 0xFF);
    // Add leading zero if MSB is set to ensure positive ASN.1 integer
    if (bytes[0] >= 0x80) {
      bytes.unshift(0x00);
    }
  } else {
    let temp = num;
    if (temp === 0) {
      bytes.push(0);
    } else {
      while (temp > 0 || (temp < 0 && temp !== -1)) {
        bytes.unshift(temp & 0xFF);
        temp = temp >> 8;
      }
      if (temp === -1 && (bytes.length === 0 || (bytes[0] & 0x80) === 0)) {
        bytes.unshift(0xFF);
      } else if (temp === 0 && (bytes[0] & 0x80) !== 0) {
        bytes.unshift(0x00);
      }
    }
  }
  const lenBuf = encodeBerLength(bytes.length);
  return concatBytes(new Uint8Array([ASN1_TAGS.INTEGER]), lenBuf, new Uint8Array(bytes));
}

/**
 * Encodes a string as ASN.1 OCTET STRING TLV.
 */
export function encodeOctetString(str: string): Uint8Array {
  const encoder = new TextEncoder();
  const utf8Bytes = encoder.encode(str);
  const lenBuf = encodeBerLength(utf8Bytes.length);
  return concatBytes(new Uint8Array([ASN1_TAGS.OCTET_STRING]), lenBuf, utf8Bytes);
}

/**
 * Builds a complete binary SNMP GetRequest packet (RFC 1157).
 */
export function buildSnmpGetRequest(params: SnmpGetRequestParams): Uint8Array {
  const version = params.version ?? 1; // Default to SNMPv2c
  const versionTlv = encodeInteger(version);
  const communityTlv = encodeOctetString(params.community);

  // 1. Build VarBind: SEQUENCE { OID, NULL }
  const oidTlv = encodeOid(params.oid);
  const nullTlv = new Uint8Array([ASN1_TAGS.NULL, 0x00]);
  const varBindPayload = concatBytes(oidTlv, nullTlv);
  const varBindSeq = concatBytes(
    new Uint8Array([ASN1_TAGS.SEQUENCE]),
    encodeBerLength(varBindPayload.length),
    varBindPayload
  );

  // 2. Build VarBindList: SEQUENCE OF VarBind
  const varBindList = concatBytes(
    new Uint8Array([ASN1_TAGS.SEQUENCE]),
    encodeBerLength(varBindSeq.length),
    varBindSeq
  );

  // 3. Build GetRequest PDU: 0xA0
  const reqIdTlv = encodeInteger(params.requestId, true);
  const errStatusTlv = encodeInteger(0);
  const errIndexTlv = encodeInteger(0);
  const pduPayload = concatBytes(reqIdTlv, errStatusTlv, errIndexTlv, varBindList);
  const pduTlv = concatBytes(
    new Uint8Array([ASN1_TAGS.GET_REQUEST]),
    encodeBerLength(pduPayload.length),
    pduPayload
  );

  // 4. Wrap into root SNMP Message SEQUENCE
  const messagePayload = concatBytes(versionTlv, communityTlv, pduTlv);
  return concatBytes(
    new Uint8Array([ASN1_TAGS.SEQUENCE]),
    encodeBerLength(messagePayload.length),
    messagePayload
  );
}

/**
 * Parses an SNMP GetResponse binary packet into structured diagnostic data.
 */
export function parseSnmpGetResponse(bytes: Uint8Array): SnmpResponsePacket {
  if (bytes.length < 10) {
    throw new Error('SNMP Packet too short (< 10 bytes)');
  }
  if (bytes[0] !== ASN1_TAGS.SEQUENCE) {
    throw new Error(`Invalid root tag: expected 0x30, received 0x${bytes[0].toString(16)}`);
  }

  let offset = 1;
  const rootLen = decodeBerLength(bytes, offset);
  offset += rootLen.bytesRead;

  // 1. Version
  if (bytes[offset] !== ASN1_TAGS.INTEGER) {
    throw new Error('Expected INTEGER tag for SNMP version');
  }
  offset++;
  const verLen = decodeBerLength(bytes, offset);
  offset += verLen.bytesRead;
  let version = 0;
  for (let i = 0; i < verLen.length; i++) {
    version = (version << 8) | bytes[offset + i];
  }
  offset += verLen.length;

  // 2. Community String
  if (bytes[offset] !== ASN1_TAGS.OCTET_STRING) {
    throw new Error('Expected OCTET_STRING tag for SNMP community');
  }
  offset++;
  const commLen = decodeBerLength(bytes, offset);
  offset += commLen.bytesRead;
  const commBytes = bytes.slice(offset, offset + commLen.length);
  const community = new TextDecoder('utf-8').decode(commBytes);
  offset += commLen.length;

  // 3. PDU Tag
  const pduType = bytes[offset];
  if (pduType !== ASN1_TAGS.GET_RESPONSE) {
    throw new Error(`Expected GetResponse PDU (0xA2), received 0x${pduType.toString(16)}`);
  }
  offset++;
  const pduLen = decodeBerLength(bytes, offset);
  offset += pduLen.bytesRead;

  // 4. Request ID
  if (bytes[offset] !== ASN1_TAGS.INTEGER) {
    throw new Error('Expected INTEGER tag for Request ID');
  }
  offset++;
  const reqIdLen = decodeBerLength(bytes, offset);
  offset += reqIdLen.bytesRead;
  let requestId = 0;
  for (let i = 0; i < reqIdLen.length; i++) {
    requestId = (requestId << 8) | bytes[offset + i];
  }
  offset += reqIdLen.length;

  // 5. Error Status
  offset++; // Tag
  const errStatusLen = decodeBerLength(bytes, offset);
  offset += errStatusLen.bytesRead;
  let errorStatus = 0;
  for (let i = 0; i < errStatusLen.length; i++) {
    errorStatus = (errorStatus << 8) | bytes[offset + i];
  }
  offset += errStatusLen.length;

  // 6. Error Index
  offset++; // Tag
  const errIndexLen = decodeBerLength(bytes, offset);
  offset += errIndexLen.bytesRead;
  let errorIndex = 0;
  for (let i = 0; i < errIndexLen.length; i++) {
    errorIndex = (errorIndex << 8) | bytes[offset + i];
  }
  offset += errIndexLen.length;

  // 7. VarBindList (SEQUENCE OF VarBind)
  if (bytes[offset] !== ASN1_TAGS.SEQUENCE) {
    throw new Error('Expected SEQUENCE tag for VarBindList');
  }
  offset++;
  const varBindListLen = decodeBerLength(bytes, offset);
  offset += varBindListLen.bytesRead;

  const endOfList = offset + varBindListLen.length;
  const varBinds: SnmpVarBind[] = [];

  while (offset < endOfList && offset < bytes.length) {
    if (bytes[offset] !== ASN1_TAGS.SEQUENCE) {
      break;
    }
    offset++;
    const vbLen = decodeBerLength(bytes, offset);
    offset += vbLen.bytesRead;
    const endOfVb = offset + vbLen.length;

    // Decode OID
    if (bytes[offset] !== ASN1_TAGS.OBJECT_IDENTIFIER) {
      throw new Error('Expected OBJECT_IDENTIFIER tag in VarBind');
    }
    offset++;
    const oidLen = decodeBerLength(bytes, offset);
    offset += oidLen.bytesRead;
    const oid = decodeOid(bytes, offset, oidLen.length);
    offset += oidLen.length;

    // Decode Value
    const valTag = bytes[offset];
    offset++;
    const valLen = decodeBerLength(bytes, offset);
    offset += valLen.bytesRead;

    let value: string | number | null = null;
    let typeName = 'UNKNOWN';
    let formatted: string | undefined;

    if (valTag === ASN1_TAGS.OCTET_STRING) {
      typeName = 'OCTET_STRING';
      const valBytes = bytes.slice(offset, offset + valLen.length);
      value = new TextDecoder('utf-8').decode(valBytes);
      formatted = value;
    } else if (valTag === ASN1_TAGS.TIMETICKS) {
      typeName = 'TIMETICKS';
      let num = 0;
      for (let i = 0; i < valLen.length; i++) {
        num = (num * 256) + bytes[offset + i];
      }
      value = num >>> 0;
      formatted = formatTimeTicks(value);
    } else if (valTag === ASN1_TAGS.COUNTER32) {
      typeName = 'COUNTER32';
      let num = 0;
      for (let i = 0; i < valLen.length; i++) {
        num = (num * 256) + bytes[offset + i];
      }
      value = num >>> 0;
      formatted = `${value.toLocaleString()} octets`;
    } else if (valTag === ASN1_TAGS.GAUGE32) {
      typeName = 'GAUGE32';
      let num = 0;
      for (let i = 0; i < valLen.length; i++) {
        num = (num * 256) + bytes[offset + i];
      }
      value = num >>> 0;
      formatted = String(value);
    } else if (valTag === ASN1_TAGS.INTEGER) {
      typeName = 'INTEGER';
      let num = 0;
      for (let i = 0; i < valLen.length; i++) {
        num = (num << 8) | bytes[offset + i];
      }
      value = num;
      formatted = String(num);
    } else if (valTag === ASN1_TAGS.NULL) {
      typeName = 'NULL';
      value = null;
      formatted = 'NULL';
    } else {
      typeName = `TAG_0x${valTag.toString(16).toUpperCase()}`;
      value = `[raw ${valLen.length} bytes]`;
      formatted = String(value);
    }

    offset = endOfVb;

    varBinds.push({
      oid,
      type: typeName,
      tag: valTag,
      value,
      formattedValue: formatted
    });
  }

  return {
    version,
    versionName: version === 1 ? 'v2c' : version === 0 ? 'v1' : 'v3',
    community,
    pduType,
    requestId,
    errorStatus,
    errorStatusText: SNMP_ERROR_STATUS[errorStatus as keyof typeof SNMP_ERROR_STATUS] || 'unknownError',
    errorIndex,
    varBinds
  };
}

/**
 * Formats SNMP TimeTicks (in hundredths of a second) into a human readable uptime string.
 */
export function formatTimeTicks(hundredths: number): string {
  const totalSeconds = Math.floor(hundredths / 100);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${days}d ${hours}h ${minutes}m ${seconds}s (${hundredths} hundredths)`;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, curr) => acc + curr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

