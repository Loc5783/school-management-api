'use strict';

process.env.NODE_ENV = 'test';

const http = require('http');
const crypto = require('crypto');
const {
  HikvisionError,
  validateDeviceHost,
  formatHikvisionTime,
  parseDigestChallenge,
  buildDigestAuthHeader,
  parseXml,
  sendIsapiRequest,
  getDeviceInfo,
  getAcsEvents,
  searchPersonInfo
} = require('../src/services/hikvisionIsapiService');

describe('Hikvision ISAPI Client Unit Tests', () => {

  describe('SSRF & IP Safety Guards', () => {
    test('strictly forbids device 192.168.1.22 under all conditions', () => {
      expect(() => validateDeviceHost('192.168.1.22')).toThrow(HikvisionError);
      expect(() => validateDeviceHost('192.168.1.22', { allowLoopbackInTest: true })).toThrow(HikvisionError);
      try {
        validateDeviceHost('192.168.1.22');
      } catch (err) {
        expect(err.code).toBe('FORBIDDEN_DEVICE_IP');
        expect(err.statusCode).toBe(403);
      }
    });

    test('strictly forbids localhost, 127.0.0.1, 0.0.0.0 and link-local when not in test loopback mode', () => {
      ['localhost', '127.0.0.1', '127.0.0.2', '0.0.0.0', '169.254.169.254'].forEach((host) => {
        expect(() => validateDeviceHost(host)).toThrow(HikvisionError);
      });
    });

    test('strictly forbids public internet IPs (SSRF guard)', () => {
      ['8.8.8.8', '1.1.1.1', '142.250.190.46'].forEach((host) => {
        expect(() => validateDeviceHost(host)).toThrow();
        try {
          validateDeviceHost(host);
        } catch (err) {
          expect(err.code).toBe('SSRF_BLOCKED');
        }
      });
    });

    test('allows legitimate private IPv4 LAN addresses', () => {
      expect(validateDeviceHost('192.168.1.8')).toBe('192.168.1.8');
      expect(validateDeviceHost('http://192.168.1.8:80/')).toBe('192.168.1.8');
      expect(validateDeviceHost('10.0.0.15')).toBe('10.0.0.15');
      expect(validateDeviceHost('172.16.5.20')).toBe('172.16.5.20');
    });
  });

  describe('Timezone & Date Formatting', () => {
    test('formats dates with +07:00 offset for Asia/Ho_Chi_Minh', () => {
      const utcDate = new Date('2026-09-16T01:30:45.000Z');
      const formatted = formatHikvisionTime(utcDate, 'Asia/Ho_Chi_Minh');
      // 01:30 UTC + 7 hours = 08:30
      expect(formatted).toBe('2026-09-16T08:30:45+07:00');
    });

    test('handles invalid date gracefully', () => {
      expect(formatHikvisionTime('invalid-date')).toBe('');
    });
  });

  describe('Recursive XML Parser', () => {
    test('parses simple key-value tags', () => {
      const xml = '<DeviceInfo><model>DS-K1T320MX</model><firmware>V3.9.50</firmware></DeviceInfo>';
      const parsed = parseXml(xml);
      expect(parsed.DeviceInfo).toBeDefined();
      expect(parsed.DeviceInfo.model).toBe('DS-K1T320MX');
      expect(parsed.DeviceInfo.firmware).toBe('V3.9.50');
    });

    test('parses repeating sibling elements into an Array', () => {
      const xml = `<AcsEvent>
        <InfoList><major>5</major><minor>75</minor><name>Person A</name></InfoList>
        <InfoList><major>5</major><minor>1</minor><name>Person B</name></InfoList>
      </AcsEvent>`;
      const parsed = parseXml(xml);
      expect(parsed.AcsEvent).toBeDefined();
      expect(Array.isArray(parsed.AcsEvent.InfoList)).toBe(true);
      expect(parsed.AcsEvent.InfoList.length).toBe(2);
      expect(parsed.AcsEvent.InfoList[0].name).toBe('Person A');
      expect(parsed.AcsEvent.InfoList[1].name).toBe('Person B');
    });

    test('correctly unescapes XML entities', () => {
      const xml = '<Item><desc>&lt;B&amp;C&gt; &quot;quoted&quot; &apos;single&apos;</desc></Item>';
      const parsed = parseXml(xml);
      expect(parsed.Item.desc).toBe('<B&C> "quoted" \'single\'');
    });

    test('handles empty input and non-string safely', () => {
      expect(parseXml('')).toEqual({});
      expect(parseXml(null)).toEqual({});
      expect(parseXml(undefined)).toEqual({});
    });
  });

  describe('Digest Authentication Helpers', () => {
    test('correctly parses WWW-Authenticate header challenge', () => {
      const header = 'Digest realm="IP Camera", nonce="4d53...abc", qop="auth", opaque="5ccc069c403ebaf9f0171e9517f40e41"';
      const parsed = parseDigestChallenge(header);
      expect(parsed).not.toBeNull();
      expect(parsed.realm).toBe('IP Camera');
      expect(parsed.nonce).toBe('4d53...abc');
      expect(parsed.qop).toBe('auth');
      expect(parsed.opaque).toBe('5ccc069c403ebaf9f0171e9517f40e41');
    });

    test('builds compliant RFC 2617 / RFC 7616 Digest Authorization header', () => {
      const challenge = {
        realm: 'IP Camera',
        nonce: 'testnonce123',
        qop: 'auth',
        opaque: 'testopaque'
      };
      const authHeader = buildDigestAuthHeader({
        username: 'admin',
        password: 'SecretPassword123',
        method: 'GET',
        uri: '/ISAPI/System/deviceInfo',
        challenge,
        nc: 1,
        cnonce: 'testcnonce'
      });

      expect(authHeader).toContain('Digest username="admin"');
      expect(authHeader).toContain('realm="IP Camera"');
      expect(authHeader).toContain('nonce="testnonce123"');
      expect(authHeader).toContain('uri="/ISAPI/System/deviceInfo"');
      expect(authHeader).toContain('qop=auth');
      expect(authHeader).toContain('nc=00000001');
      expect(authHeader).toContain('cnonce="testcnonce"');
      expect(authHeader).toContain('opaque="testopaque"');
      expect(authHeader).toContain('response=');
    });
  });

  describe('Mock ISAPI Server Digest Handshake, Pagination & Safety Cap', () => {
    let mockServer;
    let mockPort;
    let paginationCallCount = 0;

    beforeAll((done) => {
      mockServer = http.createServer((req, res) => {
        // Timeout simulation
        if (req.url === '/ISAPI/timeout') {
          return;
        }

        // 400 Bad Request simulation
        if (req.url === '/ISAPI/bad-request') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Bad Request' }));
        }

        // 404 Not Found simulation
        if (req.url === '/ISAPI/not-found') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Not Found' }));
        }

        // 500 Internal Error simulation
        if (req.url === '/ISAPI/internal-error') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Internal Error' }));
        }

        const authHeader = req.headers['authorization'];
        if (!authHeader) {
          // Step 1: Challenge with 401 Digest
          res.writeHead(401, {
            'WWW-Authenticate': 'Digest realm="IP Camera", nonce="mocknonce123", qop="auth", opaque="mockopaque"'
          });
          return res.end();
        }

        // Step 2: Verify Digest credentials
        if (authHeader.includes('username="admin"') && authHeader.includes('response=')) {
          if (authHeader.includes('wronguser')) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Unauthorized' }));
          }

          if (req.url === '/ISAPI/System/deviceInfo') {
            res.writeHead(200, { 'Content-Type': 'application/xml' });
            return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<DeviceInfo version="2.0">
  <deviceName>DS-K1T320MX</deviceName>
  <deviceID>mock-device-id</deviceID>
  <model>DS-K1T320MX</model>
  <serialNumber>DS-K1T320MX20260130V3950</serialNumber>
  <macAddress>44:19:b6:aa:bb:cc</macAddress>
  <firmwareVersion>V3.9.50</firmwareVersion>
  <deviceType>AccessControl</deviceType>
</DeviceInfo>`);
          }

          // AcsEvent endpoint with multi-page pagination simulation
          if (req.url.startsWith('/ISAPI/AccessControl/AcsEvent')) {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              paginationCallCount++;
              let cond = {};
              try {
                cond = JSON.parse(body)?.AcsEventCond || {};
              } catch (_) {}

              const pos = Number(cond.searchResultPosition || 0);
              const limit = Number(cond.maxResults || 30);
              const searchID = String(cond.searchID || cond.startTime || '1');

              // Case A: Loop test simulation (device repeats same position and items)
              if (searchID === 'LOOP_TEST') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                  AcsEvent: {
                    searchID: "LOOP_TEST",
                    totalMatches: 100,
                    responseStatusStrg: "OK",
                    InfoList: [
                      {
                        major: 5,
                        minor: 75,
                        time: "2026-09-16T08:00:15+07:00",
                        employeeNoString: "LOOP01",
                        serialNo: "EVT-STUCK-1"
                      }
                    ]
                  }
                }));
              }

              // Case B: 250 Events simulation
              if (searchID === '250_EVENTS_TEST') {
                const total250 = 250;
                const end = Math.min(pos + limit, total250);
                const items = [];
                for (let i = pos + 1; i <= end; i++) {
                  items.push({
                    major: 5,
                    minor: i % 2 === 0 ? 75 : 1,
                    time: `2026-09-16T${String(8 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00+07:00`,
                    cardNo: i % 2 === 0 ? '' : `CARD-${i}`,
                    employeeNoString: `USER-${i}`,
                    name: `Nhan Vien ${i}`,
                    eventDescription: i % 2 === 0 ? 'Authenticated via Face' : 'Authenticated via Card',
                    serialNo: `EVT-${String(i).padStart(4, '0')}`
                  });
                }

                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                  AcsEvent: {
                    searchID: "250_EVENTS_TEST",
                    totalMatches: total250,
                    responseStatusStrg: "OK",
                    InfoList: items
                  }
                }));
              }

              // Case C: Standard 4 events simulation
              if (pos === 0) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                  AcsEvent: {
                    searchID: "1",
                    totalMatches: 4,
                    responseStatusStrg: "OK",
                    InfoList: [
                      {
                        major: 5,
                        minor: 75,
                        time: "2026-09-16T08:00:15+07:00",
                        cardNo: "",
                        employeeNoString: "LOC01",
                        name: "LOC01",
                        eventDescription: "Authenticated via Face",
                        serialNo: "EVT-1001"
                      },
                      {
                        major: 5,
                        minor: 1,
                        time: "2026-09-16T08:05:30+07:00",
                        cardNo: "CARD9988",
                        employeeNoString: "TEACHER02",
                        name: "Co Giao Mai",
                        eventDescription: "Authenticated via Card",
                        serialNo: "EVT-1002"
                      }
                    ]
                  }
                }));
              } else {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({
                  AcsEvent: {
                    searchID: "1",
                    totalMatches: 4,
                    responseStatusStrg: "OK",
                    InfoList: [
                      {
                        major: 5,
                        minor: 75,
                        time: "2026-09-16T17:00:10+07:00",
                        cardNo: "",
                        employeeNoString: "LOC01",
                        name: "LOC01",
                        eventDescription: "Authenticated via Face",
                        serialNo: "EVT-1003"
                      },
                      {
                        major: 5,
                        minor: 1,
                        time: "2026-09-16T17:05:40+07:00",
                        cardNo: "CARD9988",
                        employeeNoString: "TEACHER02",
                        name: "Co Giao Mai",
                        eventDescription: "Authenticated via Card",
                        serialNo: "EVT-1004"
                      }
                    ]
                  }
                }));
              }
            });
            return;
          }

          if (req.url.startsWith('/ISAPI/AccessControl/UserInfo/Search')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
              UserInfoSearch: {
                searchID: "1",
                totalMatches: 1,
                UserInfo: [
                  {
                    employeeNo: "LOC01",
                    name: "LOC01",
                    userType: "normal",
                    numOfCard: 0,
                    numOfFace: 1
                  }
                ]
              }
            }));
          }
        }

        // Invalid credentials fallback
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
      });

      mockServer.listen(0, '127.0.0.1', () => {
        mockPort = mockServer.address().port;
        done();
      });
    });

    afterAll((done) => {
      mockServer.close(done);
    });

    test('successfully fetches and parses deviceInfo using 2-step Digest Auth', async () => {
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'admin',
        password: 'ValidPassword',
        timeoutMs: 3000,
        _allowLoopbackForTesting: true
      };

      const info = await getDeviceInfo(deviceConfig);
      expect(info).toBeDefined();
      expect(info.model).toBe('DS-K1T320MX');
      expect(info.serialNumber).toBe('DS-K1T320MX20260130V3950');
      expect(info.firmwareVersion).toBe('V3.9.50');
    });

    test('paginates AcsEvents across multiple pages to fetch all totalMatches', async () => {
      paginationCallCount = 0;
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'admin',
        password: 'ValidPassword',
        timeoutMs: 3000,
        _allowLoopbackForTesting: true
      };

      const result = await getAcsEvents(deviceConfig, {
        startTime: '2026-09-16T00:00:00+07:00',
        endTime: '2026-09-16T23:59:59+07:00',
        pageSize: 2,
        safetyCap: 10
      });

      expect(result.totalMatches).toBe(4);
      expect(result.events.length).toBe(4);
      expect(result.truncated).toBe(false);
      expect(paginationCallCount).toBeGreaterThanOrEqual(2);

      expect(result.events[0].serialNo).toBe('EVT-1001');
      expect(result.events[1].serialNo).toBe('EVT-1002');
      expect(result.events[2].serialNo).toBe('EVT-1003');
      expect(result.events[3].serialNo).toBe('EVT-1004');
    });

    test('Section III: fetches exactly 250 events across 9 pages without loss or duplicate', async () => {
      paginationCallCount = 0;
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'admin',
        password: 'ValidPassword',
        timeoutMs: 5000,
        _allowLoopbackForTesting: true
      };

      // In real scenario, searchID is passed or ISAPI returns 250 matches
      // We pass startTime with marker 250_EVENTS_TEST so mock knows
      const result = await getAcsEvents(deviceConfig, {
        startTime: '250_EVENTS_TEST',
        pageSize: 30,
        safetyCap: 1000
      });

      // 250 events / 30 per page = 8 full pages of 30 + 1 page of 10 = 9 pages total
      expect(result.totalMatches).toBe(250);
      expect(result.events.length).toBe(250);
      expect(result.truncated).toBe(false);
      expect(result.pageCount).toBe(9);

      // Verify first and last items
      expect(result.events[0].serialNo).toBe('EVT-0001');
      expect(result.events[249].serialNo).toBe('EVT-0250');

      // Verify all serial numbers are distinct
      const serials = new Set(result.events.map(e => e.serialNo));
      expect(serials.size).toBe(250);
    });

    test('Section III: safetyCap smaller than totalMatches sets truncated: true', async () => {
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'admin',
        password: 'ValidPassword',
        timeoutMs: 5000,
        _allowLoopbackForTesting: true
      };

      const result = await getAcsEvents(deviceConfig, {
        startTime: '250_EVENTS_TEST',
        pageSize: 30,
        safetyCap: 50 // Safety cap at 50 items out of 250
      });

      expect(result.totalMatches).toBe(250);
      expect(result.events.length).toBe(50);
      expect(result.truncated).toBe(true);
      expect(result.pageCount).toBe(2); // Page 1 (30) + Page 2 (20 remaining to reach 50)
    });

    test('Section III: anti-loop protects against stuck position or duplicate events from device', async () => {
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'admin',
        password: 'ValidPassword',
        timeoutMs: 3000,
        _allowLoopbackForTesting: true
      };

      // searchID = 'LOOP_TEST' causes mock to return position 0 repeatedly
      const result = await getAcsEvents(deviceConfig, {
        startTime: 'LOOP_TEST',
        pageSize: 10,
        safetyCap: 100,
        maxPages: 10
      });

      // Must terminate gracefully without hanging
      expect(result).toBeDefined();
      expect(result.events.length).toBe(1);
    });

    test('searches person info without downloading biometric templates (metadata only)', async () => {
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'admin',
        password: 'ValidPassword',
        timeoutMs: 3000,
        _allowLoopbackForTesting: true
      };

      const result = await searchPersonInfo(deviceConfig, { employeeNoString: 'LOC01' });
      expect(result.persons.length).toBe(1);
      const person = result.persons[0];
      expect(person.employeeNo).toBe('LOC01');
      expect(person.numOfFace).toBe(1);
      expect(person.faceData).toBeUndefined();
      expect(person.faceUrl).toBeUndefined();
    });

    test('throws DEVICE_BAD_REQUEST on HTTP 400', async () => {
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'admin',
        password: 'ValidPassword',
        timeoutMs: 3000,
        _allowLoopbackForTesting: true
      };

      await expect(sendIsapiRequest(deviceConfig, { path: '/ISAPI/bad-request' })).rejects.toMatchObject({
        code: 'DEVICE_BAD_REQUEST',
        statusCode: 400
      });
    });

    test('throws DEVICE_NOT_FOUND on HTTP 404', async () => {
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'admin',
        password: 'ValidPassword',
        timeoutMs: 3000,
        _allowLoopbackForTesting: true
      };

      await expect(sendIsapiRequest(deviceConfig, { path: '/ISAPI/not-found' })).rejects.toMatchObject({
        code: 'DEVICE_NOT_FOUND',
        statusCode: 404
      });
    });

    test('throws DEVICE_INTERNAL_ERROR on HTTP 500', async () => {
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'admin',
        password: 'ValidPassword',
        timeoutMs: 3000,
        _allowLoopbackForTesting: true
      };

      await expect(sendIsapiRequest(deviceConfig, { path: '/ISAPI/internal-error' })).rejects.toMatchObject({
        code: 'DEVICE_INTERNAL_ERROR',
        statusCode: 500
      });
    });

    test('throws DEVICE_AUTH_FAILED and does not loop when credentials fail', async () => {
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'wronguser',
        password: 'WrongPassword',
        timeoutMs: 3000,
        _allowLoopbackForTesting: true
      };

      await expect(getDeviceInfo(deviceConfig)).rejects.toMatchObject({
        code: 'DEVICE_AUTH_FAILED',
        statusCode: 401
      });
    });

    test('throws DEVICE_TIMEOUT on connection timeout', async () => {
      const deviceConfig = {
        host: '127.0.0.1',
        httpPort: mockPort,
        useHttps: false,
        username: 'admin',
        password: 'ValidPassword',
        timeoutMs: 300,
        _allowLoopbackForTesting: true
      };

      await expect(sendIsapiRequest(deviceConfig, { path: '/ISAPI/timeout' })).rejects.toMatchObject({
        code: 'DEVICE_TIMEOUT',
        statusCode: 504
      });
    });
  });
});
