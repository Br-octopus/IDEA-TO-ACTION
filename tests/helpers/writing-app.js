const vm = require('node:vm');
const fs = require('node:fs');
const { createWritingDOM } = require('./writing-dom.js');
const storage = require('../../prototype/storage.js');
const promptUI = require('../../prototype/prompt-agent-ui.js');
const coordinatorAPI = require('../../prototype/writing-workbench-coordinator.js');

function createWritingApp(options = {}) {
  const dom = createWritingDOM();
  const elements = new Map();
  const listeners = new Map();
  const clicks = [];
  const makeElement = id => ({ id, value: '', textContent: '', innerHTML: '', hidden: false, checked: false, disabled: false, dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, callback) { listeners.set(`${id}:${type}`, callback); },
    querySelectorAll() { return []; }, querySelector() { return element('send-risk-checkbox'); }, setAttribute() {}, scrollIntoView() {}, focus() {}, click() { clicks.push(id); }, select() {}, remove() {} });
  const element = id => { if (!elements.has(id)) elements.set(id, makeElement(id)); return elements.get(id); };
  // 从真实页面读取表单默认值，避免替身凭空赋值掩盖空选择器等问题。
  const pageHTML = fs.readFileSync(require.resolve('../../prototype/index.html'), 'utf8');
  const knowledgeForms = [...pageHTML.matchAll(/<form\b[^>]*id="knowledge-entry-form"[^>]*>[\s\S]*?<\/form>/g)].map(match => match[0]);
  const formDOM = createWritingDOM();
  formDOM.mount.innerHTML = knowledgeForms[0] || '';
  const formControls = formDOM.mount.querySelectorAll('[id]');
  for (const control of formControls) Object.assign(element(control.id), { value: control.value });
  element('knowledge-entry-form').hidden = true;
  element('knowledge-entry-form').reset = () => {
    for (const control of formControls) element(control.id).value = control.value;
  };
  const scenes = ['task', 'writing', 'ppt'].map(scene => Object.assign(element(`scene-${scene}`), { dataset: { agentScene: scene } }));
  const nav = ['article', 'prompt-agent'].map(view => Object.assign(element(`nav-${view}`), { dataset: { view } }));
  const document = {
    getElementById(id) { return dom.document.getElementById(id) || element(id); },
    querySelectorAll(selector) { return selector === '[data-agent-scene]' ? scenes : selector === '[data-view]' ? nav : []; },
    createElement() { return makeElement('created'); }, body: { append() {} }, execCommand() { return true; }
  };
  let failSave = false;
  let failWriteAt = 0;
  let requests = 0;
  let writes = 0;
  const exports = [];
  const disk = new Map();
  let state = options.initialState || storage.createEmptyState();
  let coordinator;
  let backupRaw;
  const localStorage = { getItem: key => disk.get(key) || null, setItem(key, value) { if (failSave || writes === failWriteAt) throw new Error('磁盘已满'); disk.set(key, value); } };
  const window = {
    ForwardStepStorage: { ...storage, loadState() { if (options.readBlocked) throw new Error('读取失败'); return { state }; }, saveState(store, next, opts) { writes++; const result = storage.saveState(store, next, opts); state = result; return result; } },
    ForwardStepResearchCatalog: require('../../prototype/research-catalog.js'),
    ForwardStepMethodCards: require('../../prototype/method-cards.js'),
    ForwardStepPromptEngine: require('../../prototype/prompt-engine.js'),
    ForwardStepSendSafety: require('../../prototype/send-safety.js'),
    ForwardStepWorkspaceBackup: require('../../prototype/workspace-backup.js'),
    ForwardStepKnowledgeSchema: require('../../prototype/knowledge-schema.js'),
    ForwardStepPromptAgentCoordinator: options.realMaterials ? require('../../prototype/prompt-agent-coordinator.js') : { createPromptAgentCoordinator: () => ({ selectMaterials: async () => [] }) },
    ForwardStepPromptAgentUI: { createPromptAgentUI: () => ({ render() {} }), createPromptAgentScenes: promptUI.createPromptAgentScenes },
    WritingWorkbenchCoordinator: { createWritingWorkbenchCoordinator(deps) { coordinator = coordinatorAPI.createWritingWorkbenchCoordinator(deps); return coordinator; } },
    WritingWorkbenchUI: require('../../prototype/writing-workbench-ui.js'),
    desktopApi: { getConfig: async () => ({ model: { configured: true, name: '测试模型' }, search: {} }), requestModel: async () => { requests++; return { text: '真实预览确认后的模型诊断' }; }, importBackup: async () => backupRaw, exportBackup: async content => {
      exports.push(JSON.parse(content));
      return options.exportBackup ? options.exportBackup(content) : { canceled: false, filePath: 'C:/backups/workspace.json' };
    } },
    confirm: message => options.confirm ? options.confirm(message) : true,
    scrollTo() {}
  };
  const context = { window, document, localStorage, navigator: { clipboard: { writeText: async () => {} } }, crypto: globalThis.crypto,
    fetch: async () => ({ ok: true, json: async () => ({}) }), setTimeout: () => 1, clearTimeout() {}, Date, console, URL, Blob };
  if (options.browser) delete window.desktopApi;
  vm.runInNewContext(fs.readFileSync(require.resolve('../../prototype/app.js'), 'utf8'), context);
  return { ...dom, window, element, listeners, exports, clicks, pageHTML, knowledgeForms, get coordinator() { return coordinator; }, get state() { return state; }, get diskState() { return JSON.parse(disk.get(storage.STORAGE_KEY) || 'null'); }, get requests() { return requests; }, get writes() { return writes; }, set failSave(value) { failSave = value; }, set failWriteAt(value) { failWriteAt = value; }, async settle() { await new Promise(resolve => setImmediate(resolve)); },
    async import(backup) { backupRaw = JSON.stringify(backup); await listeners.get('knowledge-import-open:click')(); },
    event(id, type = 'click', event = {}) { return listeners.get(`${id}:${type}`)?.({ target: element(id), preventDefault() {}, ...event }); } };
}
module.exports = { createWritingApp };
