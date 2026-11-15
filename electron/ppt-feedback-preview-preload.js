const { ipcRenderer } = require('electron');

function codePointCount(value) {
  let count = 0;
  for (const _character of value) count += 1;
  return count;
}

function takeCodePointText(value, maxCodeUnits, fromEnd = false) {
  if (!fromEnd) {
    let result = '';
    for (const character of value) {
      if (result.length + character.length > maxCodeUnits) break;
      result += character;
    }
    return result;
  }
  let result = '';
  for (let end = value.length; end > 0;) {
    let start = end - 1;
    const lastUnit = value.charCodeAt(start);
    if (lastUnit >= 0xdc00 && lastUnit <= 0xdfff && start > 0) {
      const previousUnit = value.charCodeAt(start - 1);
      if (previousUnit >= 0xd800 && previousUnit <= 0xdbff) start -= 1;
    }
    const character = value.slice(start, end);
    if (result.length + character.length > maxCodeUnits) break;
    result = character + result;
    end = start;
  }
  return result;
}

function codePointToCodeUnitOffset(value, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  let codePoints = 0;
  let codeUnits = 0;
  for (const character of value) {
    if (codePoints === offset) return codeUnits;
    codePoints += 1;
    codeUnits += character.length;
  }
  return codePoints === offset ? codeUnits : null;
}

function codeUnitToCodePointOffset(value, offset) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > value.length) return null;
  let codePoints = 0;
  let codeUnits = 0;
  for (const character of value) {
    if (codeUnits === offset) return codePoints;
    codeUnits += character.length;
    if (codeUnits > offset) return null;
    codePoints += 1;
  }
  return codeUnits === offset ? codePoints : null;
}

function sliceByCodePoint(value, start, end) {
  let result = '';
  let codePointIndex = 0;
  for (const character of value) {
    if (codePointIndex >= end) break;
    if (codePointIndex >= start) result += character;
    codePointIndex += 1;
  }
  return result;
}

function textNodesWithin(root) {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node);
  return nodes;
}

function textBoundary(nodes, offset) {
  let remaining = offset;
  for (const node of nodes) {
    const value = node.nodeValue || '';
    const count = codePointCount(value);
    if (remaining <= count) return { node, offset: codePointToCodeUnitOffset(value, remaining) };
    remaining -= count;
  }
  return null;
}

function makeTextRange(nodes, start, end) {
  const startBoundary = textBoundary(nodes, start);
  const endBoundary = textBoundary(nodes, end);
  if (!startBoundary || !endBoundary || startBoundary.offset === null || endBoundary.offset === null) return null;
  const range = (nodes[0]?.ownerDocument || document).createRange();
  range.setStart(startBoundary.node, startBoundary.offset);
  range.setEnd(endBoundary.node, endBoundary.offset);
  return range;
}

function resolveTextRange(root, target, allowPosition) {
  const nodes = textNodesWithin(root);
  const text = nodes.map(node => node.nodeValue || '').join('');
  if (allowPosition && Number.isSafeInteger(target.start) && Number.isSafeInteger(target.end)) {
    const startUnit = codePointToCodeUnitOffset(text, target.start);
    const endUnit = codePointToCodeUnitOffset(text, target.end);
    const before = startUnit === null ? '' : text.slice(0, startUnit);
    const after = endUnit === null ? '' : text.slice(endUnit);
    const contextMatches = (!target.prefix || before.endsWith(target.prefix))
      && (!target.suffix || after.startsWith(target.suffix));
    if (startUnit !== null && endUnit !== null && text.slice(startUnit, endUnit) === target.exact && contextMatches) {
      return { status: 'found', range: makeTextRange(nodes, target.start, target.end) };
    }
  }

  const candidates = [];
  for (let unitIndex = text.indexOf(target.exact); unitIndex >= 0; unitIndex = text.indexOf(target.exact, unitIndex + 1)) {
    const endUnit = unitIndex + target.exact.length;
    const start = codeUnitToCodePointOffset(text, unitIndex);
    const end = codeUnitToCodePointOffset(text, endUnit);
    if (start === null || end === null) continue;
    const before = text.slice(Math.max(0, unitIndex - (target.prefix || '').length), unitIndex);
    const after = text.slice(endUnit, endUnit + (target.suffix || '').length);
    candidates.push({ start, end, contextMatches: (!target.prefix || before.endsWith(target.prefix)) && (!target.suffix || after.startsWith(target.suffix)) });
    if (candidates.length > 100) return { status: 'ambiguous' };
  }
  if (!candidates.length) return { status: 'missing' };
  const contextual = candidates.filter(candidate => candidate.contextMatches);
  const hasContext = Boolean(target.prefix || target.suffix);
  if (hasContext && !contextual.length) return { status: 'context-mismatch' };
  const matches = hasContext ? contextual : candidates;
  if (matches.length !== 1) return { status: 'ambiguous' };
  return { status: 'found', range: makeTextRange(nodes, matches[0].start, matches[0].end) };
}

function showLocationStatus(message) {
  let status = document.getElementById('forward-step-annotation-status');
  if (!status) {
    status = document.createElement('div');
    status.id = 'forward-step-annotation-status';
    Object.assign(status.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '2147483647',
      maxWidth: 'min(420px, calc(100vw - 24px))', padding: '9px 12px',
      borderRadius: '8px', background: '#173d32', color: '#fff',
      font: '14px/1.45 sans-serif', boxShadow: '0 3px 14px #0004', pointerEvents: 'none'
    });
    document.body.appendChild(status);
  }
  status.textContent = message;
}

function locateTarget(target, targetDocument = document, targetWindow = window) {
  if (!target || typeof target.selector !== 'string') return;
  let matches = [];
  try { matches = Array.from(targetDocument.querySelectorAll(target.selector)); } catch {}
  if (target.kind === 'text') {
    if (matches.length !== 1 || matches[0] === targetDocument.body) {
      showLocationStatus(matches.length ? '原文定位路径有多处匹配，请重新选择目标文字。' : '未找到原文定位范围，请重新选择资料内容。');
      return;
    }
    const root = matches[0];
    const result = resolveTextRange(root, target, true);
    if (result.status !== 'found' || !result.range) {
      const message = result.status === 'ambiguous' ? '原文有多处可能位置，请重新选择目标文字。'
        : result.status === 'context-mismatch' ? '原文上下文已变化，请检查资料后重新选择目标文字。'
          : '未找到原文定位目标，请重新选择资料内容。';
      showLocationStatus(message);
      return;
    }
    const selection = targetWindow.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(result.range);
    root.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    showLocationStatus('已定位并选中原文。');
    return;
  }
  if (target.kind === 'element') {
    if (matches.length !== 1) {
      showLocationStatus(matches.length ? '网页元素路径有多处匹配，请重新选择目标。' : '未找到原网页元素，请重新选择资料内容。');
      return;
    }
    const element = matches[0];
    const excerpt = String(target.excerpt || '');
    const content = String(element.innerText || element.textContent || '').trim();
    if (excerpt && !content.includes(excerpt)) {
      showLocationStatus('网页元素内容已变化，请检查原文后重新选择。');
      return;
    }
    element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    const previousOutline = element.style.outline;
    element.style.outline = '3px solid #b86636';
    setTimeout(() => { element.style.outline = previousOutline; }, 2500);
    showLocationStatus('已定位到原网页元素。');
  }
}

function selectorFor(element, targetDocument = document) {
  const parts = [];
  let current = element;
  while (current && current.nodeType === 1 && current !== targetDocument.body) {
    const tag = current.localName.toLowerCase();
    const siblings = current.parentElement
      ? Array.from(current.parentElement.children).filter(item => item.localName === current.localName)
      : [];
    const index = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag);
    const selector = `body > ${parts.join(' > ')}`;
    try {
      if (targetDocument.querySelectorAll(selector).length === 1) return selector;
    } catch {}
    current = current.parentElement;
  }
  return current === targetDocument.body ? 'body' : '';
}

function anchorElement(node) {
  const element = node?.nodeType === 1 ? node : node?.parentElement;
  return element?.closest?.('p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,article,section,div') || element;
}

function targetFor(event, targetDocument = document, targetWindow = window) {
  if (event.target?.closest?.('#forward-step-preview-info')) return null;
  const selection = targetWindow.getSelection();
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const selectedText = range?.toString() || '';
  if (selectedText.trim()) {
    const block = anchorElement(range.commonAncestorContainer);
    if (!block || !targetDocument.body.contains(block)) return null;
    const selector = selectorFor(block, targetDocument);
    if (!selector) return null;
    const before = targetDocument.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    if (block === document.body) return null;
    const fullText = block.textContent || '';
    const beforeText = before.toString();
    const after = targetDocument.createRange();
    after.selectNodeContents(block);
    after.setStart(range.endContainer, range.endOffset);
    const afterText = after.toString();
    const leadingText = selectedText.slice(0, selectedText.length - selectedText.trimStart().length);
    const trailingText = selectedText.slice(selectedText.trimEnd().length);
    const selectedTextTrimmed = selectedText.trim();
    const exact = takeCodePointText(selectedTextTrimmed, 2000);
    const selectedTextRemainder = selectedTextTrimmed.slice(exact.length);
    let start = codePointCount(beforeText) + codePointCount(leadingText);
    const end = start + codePointCount(exact);
    let hasPosition = sliceByCodePoint(fullText, start, end) === exact;
    if (!hasPosition) {
      const first = fullText.indexOf(exact);
      if (first >= 0 && fullText.indexOf(exact, first + 1) < 0) {
        start = codeUnitToCodePointOffset(fullText, first);
        hasPosition = start !== null;
      }
    }
    const prefix = takeCodePointText(`${beforeText}${leadingText}`, 120, true);
    const suffix = takeCodePointText(`${selectedTextRemainder}${trailingText}${afterText}`, 120);
    return {
      kind: 'text',
      selector,
      exact,
      prefix,
      suffix,
      ...(hasPosition ? { start, end } : {})
    };
  }

  const element = anchorElement(event.target);
  if (!element || element === targetDocument.body || !targetDocument.body.contains(element)) return null;
  const selector = selectorFor(element, targetDocument);
  if (!selector) return null;
  return { kind: 'element', selector, excerpt: String(element.innerText || element.textContent || '').trim().slice(0, 500) };
}

function attachSelectionHandler(targetDocument) {
  targetDocument.addEventListener('pointerup', event => {
    if (event.button !== 0) return;
    setTimeout(() => {
      const target = targetFor(event, targetDocument, targetDocument.defaultView);
      if (target) ipcRenderer.send('ppt-feedback:preview-target', target);
    }, 0);
  }, true);
}

function initializeSnapshotDocument() {
  const payload = document.getElementById('forward-step-preview-source');
  if (!payload) return;
  try {
    const bytes = Uint8Array.from(atob(payload.value.trim()), character => character.charCodeAt(0));
    const source = new TextDecoder().decode(bytes);
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    parsed.querySelectorAll('script,iframe,frame,frameset,object,embed,portal,form,base,link,meta').forEach(element => element.remove());
    parsed.querySelectorAll('*').forEach(element => {
      for (const attribute of Array.from(element.attributes)) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || ['src', 'srcset', 'href', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'background', 'autofocus', 'contenteditable'].includes(name)) {
          element.removeAttribute(attribute.name);
        }
      }
    });
    const policy = parsed.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = "default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
    parsed.head.prepend(policy);
    const info = document.getElementById('forward-step-preview-info');
    // 与本地 HTML 共用主文档事件和定位，避免跨 iframe 丢失选区。
    document.head.append(...Array.from(parsed.head.childNodes));
    for (const attribute of Array.from(parsed.body.attributes)) document.body.setAttribute(attribute.name, attribute.value);
    document.body.replaceChildren(info, ...Array.from(parsed.body.childNodes));
  } catch {
    showLocationStatus('网页静态快照载入失败，请重新读取网页。');
  }
}

attachSelectionHandler(document);
document.addEventListener('DOMContentLoaded', initializeSnapshotDocument, { once: true });
if (document.readyState !== 'loading') initializeSnapshotDocument();

ipcRenderer.on('ppt-feedback:preview-locate', (_event, target) => {
  locateTarget(target);
});
