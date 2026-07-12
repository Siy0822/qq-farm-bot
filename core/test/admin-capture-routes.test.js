const test = require('node:test');
const assert = require('node:assert/strict');

const {
  addCapturedValues,
  isCertificateTokenValid,
  mergeKnownFriendGids,
  normalizeApiBase,
} = require('../src/controllers/admin-capture-routes');

test('normalizeApiBase accepts http(s) and removes trailing slashes', () => {
  assert.equal(normalizeApiBase(' http://127.0.0.1:8450/// '), 'http://127.0.0.1:8450');
  assert.equal(normalizeApiBase('https://capture.example.com/base/'), 'https://capture.example.com/base');
  assert.throws(() => normalizeApiBase('file:///tmp/capture'), /仅支持/);
  assert.throws(() => normalizeApiBase('https://user:pass@example.com'), /仅支持/);
});

test('certificate links require the exact temporary flow token', () => {
  const flow = { certificateToken: 'temporary-certificate-token' };
  assert.equal(isCertificateTokenValid(flow, 'temporary-certificate-token'), true);
  assert.equal(isCertificateTokenValid(flow, 'wrong-certificate-token'), false);
  assert.equal(isCertificateTokenValid(flow, ''), false);
});

test('editing an account merges captured friend gids without keeping its own gid', () => {
  const merged = mergeKnownFriendGids(
    [10001, 10002],
    new Set([10002, 10003, 90001]),
    90001,
  );
  assert.deepEqual(merged, [10001, 10002, 10003]);
});

test('addCapturedValues finds non-empty code and accumulates friend gids', () => {
  const flow = {
    platform: 'qq',
    code: '',
    accountGid: '',
    openId: '',
    friendGids: new Set(),
    publicInfo: {},
    proxy: {},
    captureStatus: 'idle',
  };

  addCapturedValues(flow, {
    data: {
      channels: {
        qq: {
          status: 'captured',
          codes: [
            { code: '', gid: '90001' },
            { code: 'login-code', gid: '', openid: 'openid-1' },
          ],
        },
      },
      friends: {
        items: [{ gid: '10001' }, { gid: 'bad' }, { gid: '10002' }],
      },
      proxy: { running: true },
      publicInfo: { host: 'capture.example.com', mitmPort: 8451 },
    },
  });

  addCapturedValues(flow, {
    data: {
      channels: { qq: { status: 'captured', codes: [] } },
      friends: { items: [{ gid: '10003' }, { gid: '10001' }] },
    },
  });

  assert.equal(flow.code, 'login-code');
  assert.equal(flow.accountGid, '90001');
  assert.equal(flow.openId, 'openid-1');
  assert.deepEqual([...flow.friendGids], [10001, 10002, 10003]);
  assert.equal(flow.proxy.running, true);
  assert.equal(flow.publicInfo.mitmPort, 8451);
});
