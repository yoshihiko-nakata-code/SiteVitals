const CANNOT_DIAGNOSE_MESSAGE = '診断先のウェブページの仕様により、診断できませんでした';
const MAX_HTML_CHARS = 700_000;
const MAX_CSS_CHARS = 90_000;
const MAX_MANIFEST_CHARS = 60_000;
const MAX_ROBOTS_CHARS = 40_000;
const MAX_STYLESHEETS = 5;
const CACHE_TTL_SECONDS = 300;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === '/api/analyze' && request.method === 'POST') {
      return handleAnalyze(request, env, ctx);
    }

    if (url.pathname === '/api/health') {
      return json({ ok: true, service: 'ux-health-check-worker' });
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleAnalyze(request, env, ctx) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: 'リクエスト形式が不正です。',
      },
      400,
    );
  }

  const rawUrl = String(payload?.url || '').trim();
  if (!rawUrl) {
    return json({ ok: false, error: 'URLを入力してください。' }, 400);
  }

  let normalized;
  try {
    normalized = normalizeTargetUrl(rawUrl);
  } catch (error) {
    return json({ ok: false, error: error.message }, 400);
  }

  const cacheKey = new Request(`https://cache.local/api/analyze?url=${encodeURIComponent(normalized)}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const cachedResponse = new Response(cached.body, cached);
    cachedResponse.headers.set('X-Cache', 'HIT');
    return withCors(cachedResponse);
  }

  const result = await buildSnapshot(normalized);
  const response = json(result, result.ok ? 200 : 502);

  if (result.ok && !result.blocked) {
    response.headers.set('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }

  return withCors(response);
}

async function buildSnapshot(targetUrl) {
  const startedAt = Date.now();
  const target = new URL(targetUrl);

  let response;
  try {
    response = await fetch(target.toString(), {
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
      },
      cf: {
        cacheTtl: 60,
        cacheEverything: false,
      },
    });
  } catch (error) {
    return {
      ok: true,
      blocked: true,
      message: CANNOT_DIAGNOSE_MESSAGE,
      reason: 'fetch_error',
      diagnosticReason: sanitizeErrorMessage(error),
      requestedUrl: target.toString(),
      fetchedAt: new Date().toISOString(),
    };
  }

  const finalUrl = response.url || target.toString();
  const contentType = response.headers.get('content-type') || '';
  const headerSnapshot = pickHeaders(response.headers, [
    'content-type',
    'content-length',
    'cache-control',
    'content-encoding',
    'content-language',
    'strict-transport-security',
    'content-security-policy',
    'referrer-policy',
    'x-content-type-options',
    'permissions-policy',
    'cross-origin-opener-policy',
    'cross-origin-embedder-policy',
    'cross-origin-resource-policy',
    'x-frame-options',
    'server',
    'cf-mitigated',
  ]);

  let html = '';
  try {
    html = await response.text();
  } catch {
    return {
      ok: true,
      blocked: true,
      message: CANNOT_DIAGNOSE_MESSAGE,
      reason: 'body_unreadable',
      requestedUrl: target.toString(),
      finalUrl,
      status: response.status,
      fetchedAt: new Date().toISOString(),
    };
  }

  const bodyLower = html.toLowerCase();
  if (shouldTreatAsBlocked(response.status, contentType, headerSnapshot, bodyLower)) {
    return {
      ok: true,
      blocked: true,
      message: CANNOT_DIAGNOSE_MESSAGE,
      reason: inferBlockedReason(response.status, contentType, headerSnapshot, bodyLower),
      requestedUrl: target.toString(),
      finalUrl,
      status: response.status,
      headers: headerSnapshot,
      fetchedAt: new Date().toISOString(),
    };
  }

  const robots = await fetchRobots(finalUrl);
  if (robots.disallowed) {
    return {
      ok: true,
      blocked: true,
      message: CANNOT_DIAGNOSE_MESSAGE,
      reason: 'robots_disallow',
      diagnosticReason: robots.matchedRule || 'Disallowed by robots.txt',
      requestedUrl: target.toString(),
      finalUrl,
      status: response.status,
      headers: headerSnapshot,
      robots,
      fetchedAt: new Date().toISOString(),
    };
  }

  const extraction = extractHtmlArtifacts(html, finalUrl);
  const stylesheets = await fetchStylesheets(extraction.stylesheets, finalUrl);
  const manifest = extraction.manifestUrl ? await fetchManifest(extraction.manifestUrl) : null;
  const sitemap = await fetchSitemap(finalUrl);

  const strippedHtml = stripNonEssentialPayload(html).slice(0, MAX_HTML_CHARS);
  const htmlBytes = byteLength(strippedHtml);

  return {
    ok: true,
    blocked: false,
    requestedUrl: target.toString(),
    finalUrl,
    status: response.status,
    fetchedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    contentType,
    headers: headerSnapshot,
    html: strippedHtml,
    htmlBytes,
    htmlTruncated: stripNonEssentialPayload(html).length > MAX_HTML_CHARS,
    robots,
    sitemap,
    manifest,
    stylesheets,
    inlineStyles: extraction.inlineStyles,
    inlineScripts: extraction.inlineScripts,
    linkSummary: extraction.linkSummary,
    limitations: {
      javascriptExecuted: false,
      note: 'HTML/CSS/HTTPヘッダを中心に判定しています。JavaScript 実行後にのみ描画される要素は計測対象外です。',
    },
  };
}

function normalizeTargetUrl(value) {
  if (value.length > 2048) {
    throw new Error('URLが長すぎます。');
  }

  let candidate = value;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('URLの形式が不正です。');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('http または https の URL を入力してください。');
  }

  if (url.username || url.password) {
    throw new Error('認証情報付きURLは診断できません。');
  }

  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error('標準ポート以外のURLは診断対象外です。');
  }

  if (isPrivateOrLocalHost(url.hostname)) {
    throw new Error('ローカル環境またはプライベートアドレスは診断対象外です。');
  }

  url.hash = '';
  return url.toString();
}

function isPrivateOrLocalHost(hostname) {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '::1' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal') ||
    lower.endsWith('.localhost')
  ) {
    return true;
  }

  if (/^\d+\.\d+\.\d+\.\d+$/.test(lower)) {
    const parts = lower.split('.').map((part) => Number(part));
    const [a, b] = parts;
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      a === 169 && b === 254 ||
      a === 192 && b === 168 ||
      a === 172 && b >= 16 && b <= 31 ||
      a === 100 && b >= 64 && b <= 127
    );
  }

  if (lower.includes(':')) {
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
  }

  return false;
}

function shouldTreatAsBlocked(status, contentType, headers, bodyLower) {
  if ([401, 403, 407, 409, 410, 423, 429, 451].includes(status)) {
    return true;
  }

  if (status >= 500) {
    return true;
  }

  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
    return true;
  }

  if (headers['cf-mitigated']) {
    return true;
  }

  const blockedPatterns = [
    /captcha/i,
    /verify\s+you\s+are\s+human/i,
    /bot\s+verification/i,
    /access\s+denied/i,
    /attention\s+required/i,
    /request\s+blocked/i,
    /security\s+check/i,
    /press\s+&?\s*hold/i,
    /enable\s+javascript\s+and\s+cookies\s+to\s+continue/i,
    /cf-chl/i,
  ];

  return blockedPatterns.some((pattern) => pattern.test(bodyLower));
}

function inferBlockedReason(status, contentType, headers, bodyLower) {
  if ([401, 403, 407, 409, 410, 423, 429, 451].includes(status)) return `http_${status}`;
  if (status >= 500) return `http_${status}`;
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) return 'non_html';
  if (headers['cf-mitigated']) return 'bot_challenge';
  if (/captcha/i.test(bodyLower)) return 'captcha';
  if (/verify\s+you\s+are\s+human/i.test(bodyLower)) return 'human_verification';
  if (/access\s+denied/i.test(bodyLower)) return 'access_denied';
  return 'target_rejected';
}

async function fetchRobots(pageUrl) {
  const url = new URL('/robots.txt', pageUrl).toString();

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { Accept: 'text/plain,*/*;q=0.1' },
      cf: { cacheTtl: 300, cacheEverything: false },
    });
    const text = response.ok ? (await response.text()).slice(0, MAX_ROBOTS_CHARS) : '';
    const evaluation = evaluateRobots(text, new URL(pageUrl).pathname);
    return {
      url,
      status: response.status,
      exists: response.ok,
      disallowed: evaluation.disallowed,
      matchedRule: evaluation.matchedRule,
      text: response.ok ? text : '',
    };
  } catch {
    return {
      url,
      status: 0,
      exists: false,
      disallowed: false,
      matchedRule: null,
      text: '',
    };
  }
}

function evaluateRobots(text, pathname) {
  if (!text) {
    return { disallowed: false, matchedRule: null };
  }

  const lines = text.split(/\r?\n/);
  let applies = false;
  let matchedRule = null;
  let strongestDisallow = '';
  let strongestAllow = '';

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      applies = value === '*' || /ux[-\s]?health/i.test(value);
      continue;
    }

    if (!applies) continue;

    if (key === 'allow' && matchesRobotsPath(pathname, value)) {
      if (value.length >= strongestAllow.length) strongestAllow = value;
    }

    if (key === 'disallow' && matchesRobotsPath(pathname, value)) {
      if (value.length >= strongestDisallow.length) {
        strongestDisallow = value;
        matchedRule = `Disallow: ${value}`;
      }
    }
  }

  const disallowed = strongestDisallow.length > strongestAllow.length && strongestDisallow !== '';
  return { disallowed, matchedRule };
}

function matchesRobotsPath(pathname, rulePath) {
  if (rulePath === '') return false;
  if (rulePath === '/') return true;
  const normalizedRule = rulePath.replace(/\*$/g, '');
  return pathname.startsWith(normalizedRule);
}

async function fetchSitemap(pageUrl) {
  const url = new URL('/sitemap.xml', pageUrl).toString();
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.1' },
      cf: { cacheTtl: 300, cacheEverything: false },
    });

    return {
      url,
      status: response.status,
      exists: response.ok,
    };
  } catch {
    return { url, status: 0, exists: false };
  }
}

function extractHtmlArtifacts(html, baseUrl) {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  const scriptTags = html.match(/<script\b[\s\S]*?<\/script>/gi) || [];
  const inlineStyleMatches = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
  const inlineScriptMatches = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];

  const stylesheets = [];
  let manifestUrl = null;
  const linkSummary = {
    icons: [],
    preconnects: [],
    dnsPrefetches: [],
    preloads: [],
  };

  for (const tag of linkTags) {
    const attrs = parseAttributes(tag);
    const href = resolveUrl(attrs.href, baseUrl);
    const rel = (attrs.rel || '').toLowerCase();
    if (!href || !rel) continue;

    if (rel.includes('stylesheet')) {
      stylesheets.push({
        url: href,
        media: attrs.media || '',
        sameOrigin: sameOrigin(href, baseUrl),
      });
    }

    if (rel.includes('manifest') && !manifestUrl) {
      manifestUrl = href;
    }

    if (rel.includes('icon')) {
      linkSummary.icons.push(href);
    }
    if (rel.includes('preconnect')) {
      linkSummary.preconnects.push(href);
    }
    if (rel.includes('dns-prefetch')) {
      linkSummary.dnsPrefetches.push(href);
    }
    if (rel.includes('preload')) {
      linkSummary.preloads.push({ url: href, as: attrs.as || '' });
    }
  }

  const prioritizedStylesheets = [...stylesheets]
    .sort((a, b) => Number(b.sameOrigin) - Number(a.sameOrigin))
    .slice(0, MAX_STYLESHEETS);

  const inlineStyles = inlineStyleMatches.map((match, index) => {
    const text = (match[1] || '').slice(0, MAX_CSS_CHARS);
    return {
      index,
      size: byteLength(text),
      text,
      truncated: (match[1] || '').length > MAX_CSS_CHARS,
    };
  });

  const inlineScripts = inlineScriptMatches
    .map((match, index) => {
      const attrs = parseAttributes(`<script ${match[1] || ''}>`);
      const body = match[2] || '';
      return {
        index,
        external: Boolean(attrs.src),
        size: byteLength(body),
      };
    })
    .filter((entry) => !entry.external);

  return {
    stylesheets: prioritizedStylesheets,
    manifestUrl,
    inlineStyles,
    inlineScripts: {
      count: inlineScripts.length,
      totalBytes: inlineScripts.reduce((sum, entry) => sum + entry.size, 0),
      maxBytes: inlineScripts.reduce((max, entry) => Math.max(max, entry.size), 0),
    },
    linkSummary,
    scriptTagCount: scriptTags.length,
  };
}

async function fetchStylesheets(stylesheets, baseUrl) {
  const results = [];
  for (const stylesheet of stylesheets) {
    try {
      const response = await fetch(stylesheet.url, {
        redirect: 'follow',
        headers: { Accept: 'text/css,*/*;q=0.1' },
        cf: { cacheTtl: 300, cacheEverything: false },
      });
      const contentType = response.headers.get('content-type') || '';
      const rawText = response.ok ? await response.text() : '';
      const text = rawText.slice(0, MAX_CSS_CHARS);
      results.push({
        url: stylesheet.url,
        status: response.status,
        sameOrigin: stylesheet.sameOrigin,
        contentType,
        size: byteLength(text),
        truncated: rawText.length > MAX_CSS_CHARS,
        text,
        media: stylesheet.media,
      });
    } catch {
      results.push({
        url: stylesheet.url,
        status: 0,
        sameOrigin: stylesheet.sameOrigin,
        contentType: '',
        size: 0,
        truncated: false,
        text: '',
        media: stylesheet.media,
      });
    }
  }
  return results;
}

async function fetchManifest(url) {
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: { Accept: 'application/manifest+json,application/json;q=0.9,*/*;q=0.1' },
      cf: { cacheTtl: 300, cacheEverything: false },
    });
    const rawText = response.ok ? await response.text() : '';
    const text = rawText.slice(0, MAX_MANIFEST_CHARS);
    return {
      url,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      text,
      truncated: rawText.length > MAX_MANIFEST_CHARS,
    };
  } catch {
    return {
      url,
      status: 0,
      contentType: '',
      text: '',
      truncated: false,
    };
  }
}

function stripNonEssentialPayload(html) {
  return html
    .replace(/<!--([\s\S]*?)-->/g, '')
    .replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (_match, attrs) => `<script${attrs}></script>`)
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '<style></style>');
}

function parseAttributes(tag) {
  const attrs = {};
  const attrPattern = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let match;
  while ((match = attrPattern.exec(tag))) {
    const name = match[1].toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (name === 'link' || name === 'script') continue;
    attrs[name] = value;
  }
  return attrs;
}

function resolveUrl(value, baseUrl) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || /^(data:|javascript:|mailto:|tel:|blob:|about:)/i.test(trimmed)) return null;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

function sameOrigin(firstUrl, secondUrl) {
  try {
    return new URL(firstUrl).origin === new URL(secondUrl).origin;
  } catch {
    return false;
  }
}

function pickHeaders(headers, names) {
  const result = {};
  for (const name of names) {
    const value = headers.get(name);
    if (value) result[name] = value;
  }
  return result;
}

function sanitizeErrorMessage(error) {
  return String(error?.message || 'unknown_error').slice(0, 200);
}

function byteLength(value) {
  return new TextEncoder().encode(value || '').length;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
  };
}

function withCors(response) {
  const next = new Response(response.body, response);
  const headers = corsHeaders();
  Object.entries(headers).forEach(([key, value]) => next.headers.set(key, value));
  return next;
}
