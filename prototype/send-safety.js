(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ForwardStepSendSafety = api;
})(typeof globalThis === "undefined" ? this : globalThis, function () {
  const HIGH_RISK = "high";
  const MEDIUM_RISK = "medium";
  const PASSWORD_PLACEHOLDERS = new Set([
    "true", "false", "example", "test", "changeme", "change-me",
    "your-password", "your_password", "your password"
  ]);

  function asText(value) {
    return String(value == null ? "" : value);
  }

  function estimateTokenCount(value) {
    const text = asText(value);
    if (!text) return 0;
    const cjkCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const latinCount = (text.match(/[A-Za-z0-9]+/g) || [])
      .reduce((total, word) => total + Math.max(1, Math.ceil(word.length / 4)), 0);
    const otherCount = (text.match(/[^\s\u3400-\u9fffA-Za-z0-9]/g) || []).length;
    return Math.max(1, cjkCount + latinCount + Math.ceil(otherCount / 4));
  }

  function addFindings(findings, text, source, kind, severity, pattern, fragmentIndex = 0) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const matcher = new RegExp(pattern.source, flags);
    let match;
    while ((match = matcher.exec(text))) {
      const fragment = match[0];
      findings.push({
        kind,
        severity,
        source,
        start: match.index,
        end: match.index + fragment.length,
        fragment: fragment.slice(fragmentIndex)
      });
      if (!fragment) matcher.lastIndex += 1;
    }
  }

  function isPasswordPlaceholder(value) {
    let normalized = asText(value).trim().toLocaleLowerCase();
    if (normalized.startsWith("<") && normalized.endsWith(">")) {
      normalized = normalized.slice(1, -1).trim();
    }
    return PASSWORD_PLACEHOLDERS.has(normalized)
      || /^\$\{[a-z_][a-z0-9_]*\}$/.test(normalized)
      || /^\$[a-z_][a-z0-9_]*$/.test(normalized)
      || /^%[a-z_][a-z0-9_]*%$/.test(normalized)
      || /^\{\{[a-z_][a-z0-9_]*\}\}$/.test(normalized);
  }

  function addPasswordFindings(findings, text, source) {
    const matcher = /\b(?:password|passwd|pwd)\s*[:=]\s*(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^\s"'`,;]+))/gi;
    let match;
    while ((match = matcher.exec(text))) {
      const fragment = match[0];
      const value = match[1] ?? match[2] ?? match[3];
      findings.push({
        kind: "password",
        severity: isPasswordPlaceholder(value) ? MEDIUM_RISK : HIGH_RISK,
        source,
        start: match.index,
        end: match.index + fragment.length,
        fragment
      });
      if (!fragment) matcher.lastIndex += 1;
    }
  }

  function detectSensitiveContent(value, options = {}) {
    const text = asText(value);
    const source = asText(options && options.source) || "未标注来源";
    if (!text) return [];
    const findings = [];
    addFindings(findings, text, source, "privateKey", HIGH_RISK, /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g);
    addFindings(findings, text, source, "databaseConnection", HIGH_RISK, /(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s"'<>]+/gi);
    addFindings(findings, text, source, "authorization", HIGH_RISK, /\bAuthorization\s*:[ \t]*(?:\r?\n[ \t]+)?[^\r\n]+(?:\r?\n[ \t]+[^\r\n]+)*/gi);
    addFindings(findings, text, source, "apiKey", HIGH_RISK, /\b(?:api[_ -]?key|x-api-key)\s*[:=]\s*["']?[A-Za-z0-9_\-]{8,}["']?|\b(?:sk-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/gi);
    addPasswordFindings(findings, text, source);
    addFindings(findings, text, source, "idCard", MEDIUM_RISK, /(?<!\d)(?:\d{17}[\dXx]|\d{15})(?!\d)/g);
    addFindings(findings, text, source, "phone", MEDIUM_RISK, /(?<!\d)1[3-9]\d{9}(?!\d)/g);
    addFindings(findings, text, source, "email", MEDIUM_RISK, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi);
    return findings.sort((left, right) => left.start - right.start || left.kind.localeCompare(right.kind));
  }

  function normalizeSegment(segment) {
    if (!segment || typeof segment !== "object") return null;
    const text = asText(segment.text);
    const source = asText(segment.source) || "未标注来源";
    const findings = detectSensitiveContent(text, { source });
    return {
      source,
      text,
      characters: text.length,
      tokenCount: estimateTokenCount(text),
      findings
    };
  }

  function buildSendReport(input) {
    const segments = (Array.isArray(input) ? input : [])
      .map(normalizeSegment)
      .filter(Boolean);
    const text = segments.map(segment => segment.text).join("");
    const findings = segments.flatMap(segment => segment.findings);
    const highRiskCount = findings.filter(item => item.severity === HIGH_RISK).length;
    return {
      text,
      segments,
      characters: text.length,
      tokenCount: estimateTokenCount(text),
      findings,
      highRiskCount,
      requiresConfirmation: highRiskCount > 0,
      blocked: false,
      safetyUnavailable: false
    };
  }

  return { estimateTokenCount, detectSensitiveContent, buildSendReport };
});
