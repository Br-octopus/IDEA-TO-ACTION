'use strict';

const dns = require('node:dns').promises;
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');

const MAX_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 12_000;
const MIN_TEXT_CHARS = 80;
const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
].map(([base, bits]) => [ipv4Number(base), bits]);

function ipv4Number(address) {
  return address.split('.').reduce((result, part) => ((result << 8) | Number(part)) >>> 0, 0);
}

function ipv6Number(address) {
  if (address.includes('%')) return null;
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return null;
  const parseHalf = half => half ? half.split(':').map(part => parseInt(part, 16)) : [];
  let groups = [...parseHalf(halves[0])];
  if (halves.length === 2) groups.push(...Array(8 - groups.length - parseHalf(halves[1]).length).fill(0), ...parseHalf(halves[1]));
  if (groups.length !== 8 || groups.some(part => !Number.isInteger(part) || part < 0 || part > 0xffff)) return null;
  return groups.reduce((result, part) => (result << 16n) | BigInt(part), 0n);
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const number = ipv4Number(address);
    return !BLOCKED_V4.some(([base, bits]) => number >>> (32 - bits) === base >>> (32 - bits));
  }
  if (family !== 6) return false;
  const number = ipv6Number(address);
  if (number === null || (number >> 125n) !== 1n) return false;
  const blocked = [
    ['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]
  ];
  return !blocked.some(([base, bits]) => {
    const baseNumber = ipv6Number(base);
    return (number >> BigInt(128 - bits)) === (baseNumber >> BigInt(128 - bits));
  });
}

function validateUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
  url.hash = '';
  const defaultPort = url.protocol === 'https:' ? '443' : '80';
  if (url.port && url.port !== defaultPort) return null;
  url.port = '';
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || hostname.endsWith('.') || (!net.isIP(hostname) && (!hostname.includes('.') || hostname === 'localhost' || hostname.endsWith('.localhost')))) return null;
  if (net.isIP(hostname) && !isPublicAddress(hostname)) return null;
  return url;
}

function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (whole, entity) => {
    if (entity[0] === '#') {
      const value = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      try { return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : ''; } catch { return ''; }
    }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[entity.toLowerCase()];
  });
}

function extractHtml(html) {
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  const title = decodeEntities((titleMatch?.[1] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 240);
  const text = decodeEntities(html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript|svg|iframe|object|head)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|article|section|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n+ */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { title, text };
}

function requestPinned(url, address, family, signal, maxBytes = MAX_BYTES) {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.request(url, {
      method: 'GET', signal, agent: false,
      headers: { 'user-agent': 'ForwardStep/1.0 (public page text reader)', accept: 'text/html, application/xhtml+xml', 'accept-encoding': 'identity', connection: 'close' },
      lookup: (_hostname, _options, callback) => callback(null, address, family)
    }, response => {
      const chunks = [];
      let size = 0;
      const encoding = String(response.headers['content-encoding'] || 'identity').toLowerCase();
      if (encoding !== 'identity') {
        response.destroy();
        return resolve({ statusCode: response.statusCode, headers: response.headers, body: null, tooLarge: false, unsupportedEncoding: true });
      }
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy();
          resolve({ statusCode: response.statusCode, headers: response.headers, body: null, tooLarge: true });
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve({ statusCode: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on('error', error => { if (!signal.aborted && size <= maxBytes) reject(error); });
    });
    request.once('error', reject);
    request.end();
  });
}

function createWebPageReader({ lookupImpl = dns.lookup, requestImpl = requestPinned, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, maxRedirects = MAX_REDIRECTS } = {}) {
  let active = 0;
  return {
    async read(value, { signal } = {}) {
      if (active >= 2) return { ok: false, code: 'BUSY', message: '网页读取较忙，请稍后重试。' };
      active++;
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      try {
        let url = validateUrl(value);
        if (!url) return { ok: false, code: 'INVALID_URL', message: '链接格式或目标地址不受支持。' };
        for (let redirects = 0; redirects <= maxRedirects; redirects++) {
          if (controller.signal.aborted) return { ok: false, code: signal?.aborted ? 'CANCELLED' : 'TIMEOUT', message: signal?.aborted ? '网页读取已取消。' : '网页读取超时。' };
          const hostname = url.hostname.replace(/^\[|\]$/g, '');
          let addresses;
          try {
            addresses = net.isIP(hostname) ? [{ address: hostname, family: net.isIP(hostname) }]
              : await Promise.race([
                lookupImpl(hostname, { all: true, verbatim: true }),
                new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
              ]);
          } catch {
            if (controller.signal.aborted) return { ok: false, code: signal?.aborted ? 'CANCELLED' : 'TIMEOUT', message: signal?.aborted ? '网页读取已取消。' : '网页读取超时。' };
            return { ok: false, code: 'UNAVAILABLE', message: '无法连接该公开网页。' };
          }
          if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) {
            return { ok: false, code: 'BLOCKED_ADDRESS', message: '链接解析到非公开网络地址，已阻止读取。' };
          }
          const chosen = addresses[0];
          let response;
          try { response = await requestImpl(url, chosen.address, chosen.family, controller.signal, maxBytes); }
          catch {
            if (controller.signal.aborted) return { ok: false, code: signal?.aborted ? 'CANCELLED' : 'TIMEOUT', message: signal?.aborted ? '网页读取已取消。' : '网页读取超时。' };
            return { ok: false, code: 'UNAVAILABLE', message: '无法读取该网页。' };
          }
          if (response.tooLarge) return { ok: false, code: 'TOO_LARGE', message: '网页内容超过 1 MiB 读取上限。' };
          if (response.unsupportedEncoding || !['', 'identity'].includes(String(response.headers['content-encoding'] || '').toLowerCase())) {
            return { ok: false, code: 'UNSUPPORTED_CONTENT', message: '网页返回了不支持的压缩内容。' };
          }
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            if (redirects === maxRedirects) return { ok: false, code: 'TOO_MANY_REDIRECTS', message: '网页跳转次数超过上限。' };
            const location = response.headers.location;
            if (!location) return { ok: false, code: 'UNAVAILABLE', message: '网页跳转地址无效。' };
            const target = validateUrl(new URL(location, url).href);
            if (!target || (url.protocol === 'https:' && target.protocol !== 'https:')) {
              return { ok: false, code: 'BLOCKED_REDIRECT', message: '网页跳转目标不受支持，已停止读取。' };
            }
            url = target;
            continue;
          }
          if (response.statusCode === 401 || response.statusCode === 403) return { ok: false, code: 'LOGIN_REQUIRED', message: '网页需要登录或拒绝了读取请求。' };
          if (response.statusCode < 200 || response.statusCode >= 300) return { ok: false, code: 'UNAVAILABLE', message: '网页当前无法读取。' };
          const type = String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
          if (!['text/html', 'application/xhtml+xml'].includes(type)) return { ok: false, code: 'UNSUPPORTED_CONTENT', message: '目标不是可读取的 HTML 网页。' };
          const { title, text } = extractHtml(Buffer.from(response.body || '').toString('utf8'));
          if (text.length < MIN_TEXT_CHARS) return { ok: false, code: 'CONTENT_TOO_SHORT', message: '网页正文过短，未提供可选摘录。' };
          return { ok: true, title: title || url.hostname, finalUrl: url.href, text: text.slice(0, 20_000), characterCount: text.length,
            truncated: text.length > 20_000, incomplete: text.length > 20_000 };
        }
        return { ok: false, code: 'UNAVAILABLE', message: '网页当前无法读取。' };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        active--;
      }
    }
  };
}

module.exports = { createWebPageReader, validateUrl, isPublicAddress, extractHtml, MAX_BYTES, MAX_REDIRECTS, TIMEOUT_MS };
