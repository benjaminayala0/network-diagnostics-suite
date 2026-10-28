import { Server, ServerChannel } from 'ssh2';
import crypto from 'crypto';

// Generate or use a standard test RSA host key
const hostKey = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
}).privateKey;

export const COMMAND_RESPONSES: Record<string, string> = {
  'show interfaces': `
Flags: D - DYNAMIC; X - DISABLED, I - INVALID, R - RUNNING
 #    NAME                  TYPE       ACTUAL-MTU  MAC-ADDRESS        TX-PACKET   RX-PACKET
 0  R ether1-gateway        ether      1500        DC:2C:6E:4A:12:01  1,842,910   3,109,421
 1  R ether2-local          ether      1500        DC:2C:6E:4A:12:02    429,180     892,105
 2    ether3-spare          ether      1500        DC:2C:6E:4A:12:03          0           0
 3  R sfp-sfpplus1-trunk    ether      1500        DC:2C:6E:4A:12:04  9,421,092  14,921,801
 4  R vlan10-mgmt           vlan       1500        DC:2C:6E:4A:12:01     12,409      18,920
`,
  '/interface print': `
Flags: D - DYNAMIC; X - DISABLED, I - INVALID, R - RUNNING
 #    NAME                  TYPE       ACTUAL-MTU  MAC-ADDRESS        TX-PACKET   RX-PACKET
 0  R ether1-gateway        ether      1500        DC:2C:6E:4A:12:01  1,842,910   3,109,421
 1  R ether2-local          ether      1500        DC:2C:6E:4A:12:02    429,180     892,105
 2    ether3-spare          ether      1500        DC:2C:6E:4A:12:03          0           0
 3  R sfp-sfpplus1-trunk    ether      1500        DC:2C:6E:4A:12:04  9,421,092  14,921,801
`,
  'show ip route': `
Codes: C - connected, S - static, R - RIP, B - BGP, O - OSPF
Gateway of last resort is 192.168.1.1 to network 0.0.0.0

S*    0.0.0.0/0 [1/0] via 192.168.1.1, ether1-gateway
C     192.168.1.0/24 is directly connected, ether1-gateway
C     10.10.42.0/24 is directly connected, ether2-local
O     172.16.0.0/16 [110/20] via 10.10.42.254, sfp-sfpplus1-trunk
`,
  '/ip route print': `
Flags: A - ACTIVE; C - CONNECT, S - STATIC, o - OSPF
 #      DST-ADDRESS        PREF-SRC        GATEWAY         DISTANCE
 0 A S  0.0.0.0/0                          192.168.1.1            1
 1 A C  192.168.1.0/24     192.168.1.50    ether1-gateway         0
 2 A C  10.10.42.0/24      10.10.42.1      ether2-local           0
`,
  'system resource print': `
                   uptime: 4w2d18h42m12s
                  version: 7.14.2 (stable)
               build-time: 2026-03-12 10:14:00
         factory-software: 7.6
              free-memory: 894.2MiB
             total-memory: 1024.0MiB
                      cpu: ARM64
                cpu-count: 4
            cpu-frequency: 1400MHz
                 cpu-load: 12%
           free-hdd-space: 112.4MiB
          total-hdd-space: 128.0MiB
`,
  'show version': `
Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE4, RELEASE SOFTWARE (fc1)
Technical Support: http://www.cisco.com/techsupport
Copyright (c) 1986-2026 by Cisco Systems, Inc.

ROM: Bootstrap program is C2960 boot loader
BOOTLDR: C2960 Boot Loader (C2960-HBOOT-M) Version 12.2(44)SE5

System returned to reload by power-on
System image file is "flash:/c2960-lanbasek9-mz.150-2.SE4.bin"
cisco WS-C2960G-24TC-L (PowerPC405) processor with 65536K bytes of memory.
24 Gigabit Ethernet interfaces
The password-recovery mechanism is enabled.
`,
  'ping 8.8.8.8 count 3': `
PING 8.8.8.8 (8.8.8.8) 56(84) bytes of data.
64 bytes from 8.8.8.8: icmp_seq=1 ttl=118 time=14.2 ms
64 bytes from 8.8.8.8: icmp_seq=2 ttl=118 time=14.6 ms
64 bytes from 8.8.8.8: icmp_seq=3 ttl=118 time=14.1 ms

--- 8.8.8.8 ping statistics ---
3 packets transmitted, 3 received, 0% packet loss, time 2003ms
rtt min/avg/max/mdev = 14.120/14.312/14.640/0.231 ms
`,
};

export function executeCommand(cmd: string): string {
  const trimmed = cmd.trim();
  const lower = trimmed.toLowerCase();

  for (const [key, val] of Object.entries(COMMAND_RESPONSES)) {
    if (lower === key.toLowerCase() || lower.startsWith(key.toLowerCase())) {
      return val;
    }
  }

  if (lower === 'help' || lower === '?') {
    return `
Available Diagnostic Commands:
  show interfaces        Display interface link status and packet counters
  show ip route         Display active routing table
  system resource print Display CPU, memory, uptime, and firmware
  show version          Display hardware model and OS build
  ping 8.8.8.8 count 3  Execute ICMP ping test towards public DNS
`;
  }

  return `\nCommand not recognized: "${trimmed}". Type 'help' for diagnostics catalog.\n`;
}

/**
 * Starts the embedded SSH daemon for testing remote command execution.
 */
export function startSshMockServer(port = 2222): Server {
  const sshServer = new Server({ hostKeys: [hostKey] }, (client) => {
    client.on('authentication', (ctx) => {
      // Accept any user/password for mock testing (e.g. admin/admin)
      ctx.accept();
    });

    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept();

        // Exec command (single command execution)
        session.on('exec', (accept, reject, info) => {
          const stream = accept();
          const response = executeCommand(info.command);
          stream.write(response + '\r\n');
          stream.exit(0);
          stream.end();
        });

        // Interactive shell session
        session.on('shell', (accept) => {
          const stream = accept();
          stream.write('\r\n[Telecom Node Gateway] Connected via SSH (Terminal)\r\nType "help" for diagnostic commands.\r\n> ');

          let currentLine = '';
          stream.on('data', (data: Buffer) => {
            const char = data.toString('utf8');
            if (char === '\r' || char === '\n') {
              stream.write('\r\n');
              const output = executeCommand(currentLine);
              stream.write(output + '\r\n> ');
              currentLine = '';
            } else if (char === '\u0003') { // Ctrl+C
              stream.write('^C\r\n> ');
              currentLine = '';
            } else if (char === '\u007f' || char === '\b') { // Backspace
              if (currentLine.length > 0) {
                currentLine = currentLine.slice(0, -1);
                stream.write('\b \b');
              }
            } else {
              currentLine += char;
              stream.write(char);
            }
          });
        });
      });
    });
  });

  sshServer.listen(port, '0.0.0.0', () => {
    console.log(`🔒 [SSH Mock Daemon] Listening on TCP 0.0.0.0:${port}`);
  });

  return sshServer;
}

