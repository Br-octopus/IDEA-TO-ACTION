const fs = require('node:fs');
const path = require('node:path');

const PORT_FILE = 'workspace-origin-port.json';

function validPort(port) {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function readSavedPort(userDataPath) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(userDataPath, PORT_FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  let port;
  try { port = JSON.parse(raw).port; } catch { /* 损坏时保留原文件以供恢复。 */ }
  if (!validPort(port)) throw new Error('工作区端口记录损坏，未启动空白工作区');
  return port;
}

function savePort(userDataPath, port) {
  if (!validPort(port)) throw new RangeError('工作区端口记录无效');
  const target = path.join(userDataPath, PORT_FILE);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ port }), { flag: 'wx' });
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function listLegacyPorts(userDataPath) {
  const directory = path.join(userDataPath, 'Local Storage', 'leveldb');
  let files;
  try { files = fs.readdirSync(directory); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const ports = new Set();
  for (const file of files) {
    if (!/\.(?:log|ldb)$/.test(file)) continue;
    const content = fs.readFileSync(path.join(directory, file)).toString('latin1');
    for (const match of content.matchAll(/META:http:\/\/127\.0\.0\.1:(\d{1,5})/g)) {
      const port = Number(match[1]);
      if (validPort(port)) ports.add(port);
    }
  }
  return [...ports];
}

async function selectWorkspacePort(userDataPath, probe, choose) {
  const savedPort = readSavedPort(userDataPath);
  if (savedPort !== null) return savedPort;
  const populated = [];
  for (const port of listLegacyPorts(userDataPath)) {
    const raw = await probe(port);
    if (!raw) continue;
    let state;
    try { state = JSON.parse(raw); } catch { throw new Error(`旧工作区数据损坏（端口 ${port}），未启动空白工作区`); }
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error(`旧工作区数据损坏（端口 ${port}），未启动空白工作区`);
    }
    const hasData = Object.entries(state).some(([key, value]) => key !== 'schemaVersion'
      && (Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : Boolean(value)));
    if (hasData) populated.push(port);
  }
  if (populated.length < 2) return populated[0] || 0;
  if (!choose) throw new Error('找到多个旧工作区，需要选择要继续使用的来源');
  const selected = await choose(populated);
  if (!populated.includes(selected)) throw new Error('未选择旧工作区，原有数据保持不变');
  return selected;
}

module.exports = { PORT_FILE, listLegacyPorts, readSavedPort, savePort, selectWorkspacePort };
