(function exposePdfTextAnchor(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepPdfTextAnchor = api;
})(typeof globalThis === "undefined" ? this : globalThis, function createPdfTextAnchorApi() {
  function limitContext(value, fromEnd) {
    let points = Array.from(String(value || ""));
    points = fromEnd ? points.slice(-120) : points.slice(0, 120);
    while (points.join("").length > 120) fromEnd ? points.shift() : points.pop();
    return points.join("");
  }

  function createTextAnchor({ text, before, selected, after, selector = ".textLayer" } = {}) {
    const selection = String(selected || "");
    const exact = selection.trim();
    if (!exact || exact.length > 2000) throw new TypeError("PDF 文字选区为空或超长");
    const leading = selection.slice(0, selection.length - selection.trimStart().length);
    const trailing = selection.slice(selection.trimEnd().length);
    const pageText = Array.from(String(text || ""));
    let start = Array.from(`${before || ""}${leading}`).length;
    let end = start + Array.from(exact).length;
    if (pageText.slice(start, end).join("") !== exact) {
      const matches = [];
      const points = Array.from(exact);
      for (let index = 0; index <= pageText.length - points.length; index += 1) {
        if (pageText.slice(index, index + points.length).join("") === exact) matches.push(index);
        if (matches.length > 1) break;
      }
      if (matches.length === 1) {
        start = matches[0];
        end = start + points.length;
      } else {
        start = -1;
        end = -1;
      }
    }
    return {
      kind: "text",
      selector,
      exact,
      prefix: limitContext(`${before || ""}${leading}`, true),
      suffix: limitContext(`${trailing}${after || ""}`, false),
      ...(start >= 0 ? { start, end } : {})
    };
  }

  function resolveTextAnchor(text, target) {
    const points = Array.from(String(text || ""));
    const exact = Array.from(String(target?.exact || ""));
    if (!exact.length || exact.length > 2000) return { status: "missing" };
    const prefix = Array.from(String(target.prefix || ""));
    const suffix = Array.from(String(target.suffix || ""));
    const contextMatches = start => points.slice(Math.max(0, start - prefix.length), start).join("").endsWith(prefix.join("") )
      && points.slice(start + exact.length, start + exact.length + suffix.length).join("").startsWith(suffix.join(""));
    if (Number.isSafeInteger(target.start) && Number.isSafeInteger(target.end)
      && target.start >= 0 && target.end - target.start === exact.length
      && points.slice(target.start, target.end).join("") === exact.join("") && contextMatches(target.start)) {
      return { status: "found", start: target.start, end: target.end };
    }
    const candidates = [];
    for (let start = 0; start <= points.length - exact.length; start += 1) {
      if (points.slice(start, start + exact.length).join("") === exact.join("")) candidates.push(start);
      if (candidates.length > 100) return { status: "ambiguous" };
    }
    if (!candidates.length) return { status: "missing" };
    const hasContext = prefix.length > 0 || suffix.length > 0;
    const contextual = candidates.filter(contextMatches);
    if (hasContext && !contextual.length) return { status: "context-mismatch" };
    const matches = hasContext ? contextual : candidates;
    if (matches.length !== 1) return { status: "ambiguous" };
    return { status: "found", start: matches[0], end: matches[0] + exact.length };
  }

  function createRange(root, start, end) {
    if (!root?.ownerDocument || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) return null;
    const document = root.ownerDocument;
    const walker = document.createTreeWalker(root, document.defaultView?.NodeFilter?.SHOW_TEXT || 4);
    const nodes = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.nodeValue) nodes.push(node);
    const boundary = offset => {
      let remaining = offset;
      for (const node of nodes) {
        const points = Array.from(node.nodeValue);
        if (remaining <= points.length) return { node, offset: points.slice(0, remaining).join("").length };
        remaining -= points.length;
      }
      return null;
    };
    const startBoundary = boundary(start);
    const endBoundary = boundary(end);
    if (!startBoundary || !endBoundary) return null;
    const range = document.createRange();
    range.setStart(startBoundary.node, startBoundary.offset);
    range.setEnd(endBoundary.node, endBoundary.offset);
    return range;
  }

  return { createTextAnchor, resolveTextAnchor, createRange };
});
