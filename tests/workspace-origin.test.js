const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { listLegacyPorts, readSavedPort, savePort, selectWorkspacePort } = require('../electron/workspace-origin');

test('旧版随机端口从当前用户数据目录发现，选定端口跨启动保持不变', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-origin-'));
  try {
    const leveldb = path.join(root, 'Local Storage', 'leveldb');
    fs.mkdirSync(leveldb, { recursive: true });
    fs.writeFileSync(path.join(leveldb, '000003.log'), 'META:http://127.0.0.1:57846\0META:http://127.0.0.1:52928\0');
    fs.writeFileSync(path.join(leveldb, 'LOCK'), 'META:http://127.0.0.1:9999');
    assert.deepEqual(listLegacyPorts(root), [57846, 52928]);
    assert.equal(readSavedPort(root), null);
    savePort(root, 57846);
    assert.equal(readSavedPort(root), 57846);
    assert.deepEqual(listLegacyPorts(path.join(root, 'other-profile')), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('无效端口记录明确报错，不创建空工作区覆盖旧数据', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-origin-'));
  try {
    fs.writeFileSync(path.join(root, 'workspace-origin-port.json'), '{"port":0}');
    assert.throws(() => readSavedPort(root), /端口记录/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('首次升级选有任务的旧来源，随后直接恢复同一来源', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-origin-'));
  try {
    const leveldb = path.join(root, 'Local Storage', 'leveldb');
    fs.mkdirSync(leveldb, { recursive: true });
    fs.writeFileSync(path.join(leveldb, '000003.log'), 'META:http://127.0.0.1:57846\0META:http://127.0.0.1:52928');
    const visited = [];
    const probe = async port => {
      visited.push(port);
      return JSON.stringify(port === 57846 ? { promptAgentTasks: [{ id: 'old-task' }] } : { promptAgentTasks: [] });
    };
    assert.equal(await selectWorkspacePort(root, probe), 57846);
    savePort(root, 57846);
    assert.equal(await selectWorkspacePort(root, probe), 57846);
    assert.deepEqual(visited, [57846, 52928]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('多个非空旧来源不得静默丢弃另一个，损坏的旧数据也不得覆盖', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forward-step-origin-'));
  try {
    const leveldb = path.join(root, 'Local Storage', 'leveldb');
    fs.mkdirSync(leveldb, { recursive: true });
    fs.writeFileSync(path.join(leveldb, '000003.log'), 'META:http://127.0.0.1:57846\0META:http://127.0.0.1:52928');
    const probe = async port => JSON.stringify({ projects: [{ id: port }] });
    await assert.rejects(selectWorkspacePort(root, probe), /多个旧工作区/);
    assert.equal(await selectWorkspacePort(root, probe, async ports => ports[1]), 52928);
    await assert.rejects(selectWorkspacePort(root, async () => '{broken'), /旧工作区数据损坏/);
    assert.equal(readSavedPort(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
