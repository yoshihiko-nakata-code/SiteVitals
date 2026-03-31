export const CATEGORY_META = {
  basic: {
    label: '基礎品質',
    description: '文書メタ情報、デバイス適応、共有用メタデータなどの基礎体力を確認します。',
    lens: 'Nielsen: 一貫性と標準 / システム状態の可視化',
  },
  structure: {
    label: '情報設計',
    description: '見出し、ランドマーク、回遊導線、可読性など、情報の並び方を確認します。',
    lens: 'Nielsen: 想起ではなく認識 / 美的でミニマルな設計',
  },
  accessibility: {
    label: 'アクセシビリティ',
    description: '代替テキスト、フォーム、フォーカス、ARIAの基本要件を確認します。',
    lens: 'WCAG 2.2 / Nielsen: エラー予防 / ユーザーコントロール',
  },
  mobile: {
    label: 'モバイル対応',
    description: 'レスポンシブ設計、画像最適化、PWA関連の準備状況を確認します。',
    lens: 'Nielsen: 柔軟性と効率性 / 近年のモバイルUX実務',
  },
  performance: {
    label: '表示体験',
    description: '初期表示負荷、外部依存、DOM規模、遅延読み込みなどのヒントを確認します。',
    lens: 'Nielsen: システム状態の可視化 / 体感性能',
  },
  trust: {
    label: '信頼・運営情報',
    description: '問い合わせ、法務ページ、robots/sitemap、HTTPセキュリティヘッダを確認します。',
    lens: 'Nielsen: ヘルプとドキュメント / 信頼形成',
  },
};

export const STATUS_META = {
  pass: { label: '良好', className: 'is-pass' },
  warn: { label: '要観察', className: 'is-warn' },
  fail: { label: '要改善', className: 'is-fail' },
  info: { label: '参考', className: 'is-info' },
  na: { label: '対象外', className: 'is-na' },
};

const STATUS_POINTS = {
  pass: 1,
  warn: 0.6,
  fail: 0,
  info: null,
  na: null,
};

const WEAK_LINK_PATTERNS = [/^click here$/i, /^here$/i, /^more$/i, /^read more$/i, /^learn more$/i, /^詳しくはこちら$/, /^こちら$/, /^もっと見る$/, /^続きを読む$/, /^詳細$/, /^詳細を見る$/];
const CONTACT_PATTERNS = [/contact/i, /お問い合わせ/, /問合せ/, /連絡先/, /support/i, /ご相談/];
const PRIVACY_PATTERNS = [/privacy/i, /プライバシー/, /個人情報/];
const TERMS_PATTERNS = [/terms/i, /利用規約/, /規約/, /特定商取引/];
const COMPANY_PATTERNS = [/about/i, /company/i, /会社概要/, /運営会社/, /企業情報/, /about us/i];
const HELP_PATTERNS = [/faq/i, /help/i, /サポート/, /よくある質問/, /ガイド/];
const NUMERIC_FIELD_PATTERNS = /(zip|postal|postcode|phone|tel|fax|card|number|numeric|digit|verification|otp|pin|code|cvv|cvc|郵便|電話|番号|数字|コード)/i;
const NAME_FIELD_PATTERNS = /(name|first|last|full|company|organization|email|mail|phone|tel|mobile|address|zip|postal|city|state|country|氏名|名前|会社|組織|メール|電話|住所|郵便)/i;
const CATEGORY_KEYS = new Set(Object.keys(CATEGORY_META));

export function analyzeSnapshot(snapshot) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(snapshot.html || '<html><body></body></html>', 'text/html');
  const manifest = parseManifest(snapshot.manifest?.text || '');
  const context = buildContext(snapshot, doc, manifest);

  const checks = [
    ...buildBasicChecks(context),
    ...buildStructureChecks(context),
    ...buildAccessibilityChecks(context),
    ...buildMobileChecks(context),
    ...buildPerformanceChecks(context),
    ...buildTrustChecks(context),
  ];

  const categories = buildCategories(checks);
  const overallScore = buildOverallScore(checks);
  const grade = scoreToGrade(overallScore);
  const judgment = scoreToJudgment(overallScore);
  const topIssues = buildTopIssues(checks);
  const prescriptions = buildPrescriptions(topIssues);
  const summary = buildSummary(context, categories, overallScore, grade, judgment, topIssues);

  return {
    generatedAt: new Date().toISOString(),
    page: {
      requestedUrl: snapshot.requestedUrl,
      finalUrl: snapshot.finalUrl,
      title: context.title,
      lang: context.lang || '未設定',
      fetchedAt: snapshot.fetchedAt,
      durationMs: snapshot.durationMs,
      status: snapshot.status,
      htmlBytes: snapshot.htmlBytes,
      likelySpa: context.likelySpa,
    },
    overallScore,
    grade,
    judgment,
    categories,
    checks,
    metrics: context.metrics,
    summary,
    topIssues,
    prescriptions,
    methodology: {
      basis: ['Nielsenの10ヒューリスティクス', 'WCAG 2.2の自動観測可能項目', 'HTML/CSS/HTTPヘッダの観測値'],
      limitations: snapshot.limitations,
    },
  };
}

function buildContext(snapshot, doc, manifest) {
  const pageUrl = new URL(snapshot.finalUrl || snapshot.requestedUrl);
  const pageOrigin = pageUrl.origin;
  const links = [...doc.querySelectorAll('a[href]')].map((anchor) => {
    const hrefRaw = anchor.getAttribute('href') || '';
    const href = resolveUrl(hrefRaw, pageUrl);
    const text = normalizeText(accessibleName(anchor, doc));
    const rel = (anchor.getAttribute('rel') || '').toLowerCase();
    return {
      element: anchor,
      hrefRaw,
      href,
      text,
      targetBlank: anchor.getAttribute('target') === '_blank',
      rel,
      placeholder: hrefRaw === '#' || /^javascript:/i.test(hrefRaw),
      weak: WEAK_LINK_PATTERNS.some((pattern) => pattern.test(text)),
      external: href ? new URL(href).origin !== pageOrigin : false,
    };
  });

  const images = [...doc.querySelectorAll('img')].map((img) => {
    const src = img.getAttribute('src') || '';
    const srcset = img.getAttribute('srcset') || '';
    return {
      src,
      srcset,
      hasAlt: img.hasAttribute('alt'),
      alt: img.getAttribute('alt') || '',
      lazy: img.getAttribute('loading') === 'lazy',
      widthHeight: img.hasAttribute('width') && img.hasAttribute('height'),
      responsive: Boolean(srcset) || img.closest('picture') !== null,
      decodingAsync: img.getAttribute('decoding') === 'async',
      modernFormat: /\.(avif|webp)(\?|#|$)/i.test(src) || /\.(avif|webp)(\?|#|,|\s|$)/i.test(srcset),
      mixedContent: pageUrl.protocol === 'https:' && /^http:\/\//i.test(src),
    };
  });

  const buttons = [...doc.querySelectorAll('button, input[type="button"], input[type="submit"], input[type="reset"], input[type="image"]')].map((el) => ({
    text: normalizeText(accessibleName(el, doc)),
  }));

  const relevantControls = [...doc.querySelectorAll('input, select, textarea')].filter((el) => {
    const type = (el.getAttribute('type') || '').toLowerCase();
    return !['hidden', 'submit', 'button', 'reset', 'image'].includes(type);
  });

  const controlMetrics = relevantControls.map((el) => analyzeControl(el, doc));
  const placeholderOnlyCount = controlMetrics.filter((item) => !item.hasLabel && item.hasPlaceholder).length;
  const needsAutocomplete = controlMetrics.filter((item) => item.needsAutocomplete).length;
  const hasAutocomplete = controlMetrics.filter((item) => item.needsAutocomplete && item.hasAutocomplete).length;
  const needsSemanticType = controlMetrics.filter((item) => item.needsSemanticType).length;
  const hasSemanticType = controlMetrics.filter((item) => item.needsSemanticType && item.semanticTypePass).length;
  const needsInputmode = controlMetrics.filter((item) => item.needsInputmode).length;
  const hasInputmode = controlMetrics.filter((item) => item.needsInputmode && item.inputmodePass).length;
  const requiredControls = controlMetrics.filter((item) => item.required).length;
  const requiredCues = controlMetrics.filter((item) => item.required && item.requiredCue).length;

  const headingLevels = [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((heading) => Number(heading.tagName[1]));
  const headingSkip = hasHeadingSkip(headingLevels);
  const h1Count = doc.querySelectorAll('h1').length;
  const hasHeader = Boolean(doc.querySelector('header, [role="banner"]'));
  const hasNav = Boolean(doc.querySelector('nav, [role="navigation"]'));
  const hasMain = Boolean(doc.querySelector('main, [role="main"]'));
  const hasFooter = Boolean(doc.querySelector('footer, [role="contentinfo"]'));
  const hasSearch = Boolean(doc.querySelector('form[role="search"], [role="search"], input[type="search"]'));
  const hasBreadcrumb = Boolean(
    doc.querySelector('[aria-label*="breadcrumb" i], [aria-label*="パンくず"], nav[aria-label*="breadcrumb" i], ol.breadcrumb, ul.breadcrumb, [itemtype*="BreadcrumbList"]'),
  );
  const hasSkipLink = links.some((link) => /^#/.test(link.hrefRaw) && /skip|スキップ|本文へ/i.test(`${link.text} ${link.hrefRaw}`));

  const duplicateIds = findDuplicateIds(doc);
  const paragraphLengths = [...doc.querySelectorAll('p')].map((p) => normalizeText(p.textContent).length).filter(Boolean);
  const bodyText = normalizeText(doc.body?.textContent || '');
  const textLength = bodyText.length;
  const listsCount = doc.querySelectorAll('ul, ol, dl').length;
  const tables = [...doc.querySelectorAll('table')];
  const scanabilityBlocks = headingLevels.length + listsCount + tables.length;

  const iframes = [...doc.querySelectorAll('iframe')].map((iframe) => ({
    hasTitle: Boolean(normalizeText(iframe.getAttribute('title'))),
    lazy: iframe.getAttribute('loading') === 'lazy',
    src: iframe.getAttribute('src') || '',
  }));

  const mediaMetrics = {
    videos: [...doc.querySelectorAll('video')],
    audios: [...doc.querySelectorAll('audio')],
  };

  const tableMetrics = tables.map((table) => {
    const rows = table.querySelectorAll('tr').length;
    const cells = table.querySelectorAll('th, td').length;
    const hasHeader = table.querySelector('th, thead') !== null;
    const hasCaption = table.querySelector('caption') !== null;
    return {
      rows,
      cells,
      dataTable: rows >= 2 && cells >= 4,
      hasHeader,
      hasCaption,
    };
  });

  const cssText = [
    ...(snapshot.stylesheets || []).map((item) => item.text || ''),
    ...(snapshot.inlineStyles || []).map((item) => item.text || ''),
  ].join('\n');

  const stylesheets = snapshot.stylesheets || [];
  const stylesheetCount = doc.querySelectorAll('link[rel]').length > 0 ? findLinksByRelToken(doc, 'stylesheet').length : stylesheets.length;
  const scriptElements = [...doc.querySelectorAll('script')];
  const externalScripts = scriptElements.filter((script) => script.hasAttribute('src'));
  const asyncScripts = externalScripts.filter((script) => script.hasAttribute('async') || script.hasAttribute('defer') || (script.getAttribute('type') || '').toLowerCase() === 'module');

  const externalOrigins = collectExternalOrigins(doc, pageUrl);
  const preconnectOrigins = unique([
    ...findLinksByRelToken(doc, 'preconnect').map((el) => originOf(resolveUrl(el.getAttribute('href') || '', pageUrl))),
    ...(snapshot.linkSummary?.preconnects || []).map(originOf),
  ]).filter(Boolean);
  const dnsPrefetchOrigins = unique([
    ...findLinksByRelToken(doc, 'dns-prefetch').map((el) => originOf(resolveUrl(el.getAttribute('href') || '', pageUrl))),
    ...(snapshot.linkSummary?.dnsPrefetches || []).map(originOf),
  ]).filter(Boolean);
  const preloadLinks = [...findLinksByRelToken(doc, 'preload'), ...(snapshot.linkSummary?.preloads || [])];
  const googleFontUse = /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(cssText) || externalOrigins.some((origin) => /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(origin));

  const focusSupport = detectFocusSupport(cssText);
  const reducedMotionSupport = /prefers-reduced-motion/i.test(cssText);
  const darkModeSupport = /prefers-color-scheme/i.test(cssText) || /color-scheme\s*:/i.test(cssText) || Boolean(normalizeText(getMeta(doc, 'color-scheme')));
  const responsiveCssSupport = /@media[^\{]*(max-width|min-width|width\s*[<>=])/i.test(cssText);
  const hasFontFace = /@font-face/i.test(cssText) || googleFontUse;
  const hasFontDisplaySwap = /font-display\s*:\s*(swap|optional)/i.test(cssText);
  const animationsPresent = /animation\s*:|transition\s*:/i.test(cssText);

  const mixedContentUrls = collectMixedContentUrls(doc, pageUrl);
  const forms = [...doc.querySelectorAll('form')].map((form) => {
    const actionRaw = form.getAttribute('action') || '';
    const action = resolveUrl(actionRaw, pageUrl);
    return {
      actionRaw,
      action,
      insecure: pageUrl.protocol === 'https:' && action && action.startsWith('http://'),
    };
  });

  const securityHeaders = {
    hsts: Boolean(snapshot.headers?.['strict-transport-security']),
    csp: Boolean(snapshot.headers?.['content-security-policy']),
    referrerPolicy: Boolean(snapshot.headers?.['referrer-policy']),
    xContentTypeOptions: Boolean(snapshot.headers?.['x-content-type-options']),
    permissionsPolicy: Boolean(snapshot.headers?.['permissions-policy']),
  };

  const contactLink = findLinkMatch(links, CONTACT_PATTERNS);
  const privacyLink = findLinkMatch(links, PRIVACY_PATTERNS);
  const termsLink = findLinkMatch(links, TERMS_PATTERNS);
  const companyLink = findLinkMatch(links, COMPANY_PATTERNS);
  const helpLink = findLinkMatch(links, HELP_PATTERNS);

  const ogTags = {
    title: normalizeText(getMetaProperty(doc, 'og:title')),
    description: normalizeText(getMetaProperty(doc, 'og:description')),
    image: normalizeText(getMetaProperty(doc, 'og:image')),
  };
  const twitterCard = normalizeText(getMeta(doc, 'twitter:card'));
  const structuredDataCount = [...doc.querySelectorAll('script[type="application/ld+json"]')].length;

  const rootAppContainer = doc.querySelector('#root, #app, #__next, #__nuxt, [data-reactroot]');
  const likelySpa = Boolean(rootAppContainer) && textLength < 300 && externalScripts.length >= 3;

  const metrics = {
    status: snapshot.status,
    stylesheetCount,
    externalScriptCount: externalScripts.length,
    externalOriginCount: externalOrigins.length,
    domElementCount: doc.querySelectorAll('*').length,
    textLength,
    imageCount: images.length,
    formControlCount: relevantControls.length,
    linkCount: links.length,
    duplicateIdCount: duplicateIds.length,
    inlineScriptBytes: snapshot.inlineScripts?.totalBytes || 0,
    inlineStyleBytes: (snapshot.inlineStyles || []).reduce((sum, item) => sum + (item.size || 0), 0),
    weakLinkCount: links.filter((link) => link.weak).length,
    placeholderLinkCount: links.filter((link) => link.placeholder).length,
  };

  return {
    snapshot,
    doc,
    manifest,
    pageUrl,
    pageOrigin,
    title: normalizeText(doc.title),
    description: normalizeText(getMeta(doc, 'description')),
    lang: normalizeText(doc.documentElement.getAttribute('lang')),
    viewport: normalizeText(getMeta(doc, 'viewport')),
    canonical: findCanonical(doc),
    themeColor: normalizeText(getMeta(doc, 'theme-color')) || manifest?.theme_color || '',
    appleTouchIcon: Boolean(findLinksByRelToken(doc, 'apple-touch-icon').length),
    favicon: Boolean(findLinksByRelToken(doc, 'icon').length),
    manifestLinked: Boolean(findLinksByRelToken(doc, 'manifest').length || snapshot.manifest?.url),
    charsetMeta: normalizeText(doc.querySelector('meta[charset]')?.getAttribute('charset') || ''),
    ogTags,
    twitterCard,
    structuredDataCount,
    links,
    images,
    buttons,
    controlMetrics,
    placeholderOnlyCount,
    needsAutocomplete,
    hasAutocomplete,
    needsSemanticType,
    hasSemanticType,
    needsInputmode,
    hasInputmode,
    requiredControls,
    requiredCues,
    headingLevels,
    headingSkip,
    h1Count,
    hasHeader,
    hasNav,
    hasMain,
    hasFooter,
    hasSearch,
    hasBreadcrumb,
    hasSkipLink,
    duplicateIds,
    paragraphLengths,
    scanabilityBlocks,
    iframes,
    mediaMetrics,
    tableMetrics,
    cssText,
    responsiveCssSupport,
    focusSupport,
    reducedMotionSupport,
    darkModeSupport,
    hasFontFace,
    hasFontDisplaySwap,
    animationsPresent,
    externalScripts,
    asyncScriptRatio: ratio(asyncScripts.length, externalScripts.length),
    externalOrigins,
    preconnectOrigins,
    dnsPrefetchOrigins,
    preloadLinks,
    googleFontUse,
    mixedContentUrls,
    forms,
    securityHeaders,
    contactLink,
    privacyLink,
    termsLink,
    companyLink,
    helpLink,
    likelySpa,
    metrics,
  };
}

function buildBasicChecks(ctx) {
  const viewportLower = ctx.viewport.toLowerCase();
  const ogPresent = [ctx.ogTags.title, ctx.ogTags.description, ctx.ogTags.image].filter(Boolean).length;

  return [
    check('basic', 'https', 'HTTPSで配信されている', ctx.pageUrl.protocol === 'https:' ? 'pass' : 'fail', 3, ctx.pageUrl.protocol === 'https:' ? 'HTTPSです。' : 'HTTPで配信されています。', '公開ページは HTTPS を必須にしてください。'),
    check('basic', 'status-200', 'HTTPステータスが200系', ctx.snapshot.status >= 200 && ctx.snapshot.status < 300 ? 'pass' : ctx.snapshot.status < 400 ? 'warn' : 'fail', 2, `取得ステータス: ${ctx.snapshot.status}`, 'トップ導線に使うURLは恒常的に200系で返すよう整理してください。'),
    check('basic', 'content-type-html', 'HTMLとして返される', /text\/html|application\/xhtml\+xml/i.test(ctx.snapshot.contentType || '') ? 'pass' : 'fail', 2, ctx.snapshot.contentType || 'Content-Typeが取得できません。', '診断対象は HTML ページに絞ってください。'),
    check('basic', 'lang', 'html lang が設定されている', ctx.lang ? 'pass' : 'fail', 3, ctx.lang ? `lang="${ctx.lang}"` : 'lang 属性が見つかりません。', 'ページ言語を html 要素に設定してください。'),
    check('basic', 'title-exists', 'title が設定されている', ctx.title ? 'pass' : 'fail', 3, ctx.title ? `title: ${ctx.title}` : 'title が未設定です。', 'ページ固有の title を設定してください。'),
    check('basic', 'title-length', 'title の長さが適正', inRange(ctx.title.length, 20, 65) ? 'pass' : ctx.title ? 'warn' : 'fail', 1, ctx.title ? `文字数: ${ctx.title.length}` : 'title が未設定です。', '検索結果やブラウザタブで読める長さに整えてください。'),
    check('basic', 'description-exists', 'meta description が設定されている', ctx.description ? 'pass' : 'fail', 2, ctx.description ? `description: ${ctx.description}` : 'meta description が未設定です。', 'ページ内容を要約した description を設定してください。'),
    check('basic', 'description-length', 'meta description の長さが適正', inRange(ctx.description.length, 70, 160) ? 'pass' : ctx.description ? 'warn' : 'fail', 1, ctx.description ? `文字数: ${ctx.description.length}` : 'description が未設定です。', '説明文は 70〜160 文字程度を目安に調整してください。'),
    check('basic', 'viewport', 'viewport が設定されている', ctx.viewport ? 'pass' : 'fail', 3, ctx.viewport || 'viewport が未設定です。', 'モバイル表示のため viewport を設定してください。'),
    check('basic', 'viewport-width', 'viewport に width=device-width が含まれる', /width\s*=\s*device-width/i.test(viewportLower) ? 'pass' : ctx.viewport ? 'warn' : 'fail', 2, ctx.viewport || 'viewport が未設定です。', 'width=device-width を指定してください。'),
    check('basic', 'zoom', 'ズーム禁止が設定されていない', !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0+)?/i.test(viewportLower) ? 'pass' : 'fail', 3, ctx.viewport || 'viewport が未設定です。', '視覚補助のためピンチズームを無効化しないでください。'),
    check('basic', 'canonical', 'canonical が設定されている', ctx.canonical ? 'pass' : 'warn', 1, ctx.canonical || 'canonical が見つかりません。', '正規URLを canonical で明示してください。'),
    check('basic', 'favicon', 'favicon が設定されている', ctx.favicon ? 'pass' : 'warn', 1, ctx.favicon ? 'icon リンクがあります。' : 'icon リンクが見つかりません。', 'ブックマークやタブ識別のため favicon を設定してください。'),
    check('basic', 'apple-touch-icon', 'Apple Touch Icon が設定されている', ctx.appleTouchIcon ? 'pass' : 'warn', 1, ctx.appleTouchIcon ? 'apple-touch-icon があります。' : 'apple-touch-icon がありません。', 'ホーム画面追加に備えて touch icon を設定してください。'),
    check('basic', 'manifest-linked', 'Web App Manifest が設定されている', ctx.manifestLinked ? 'pass' : 'warn', 1, ctx.manifestLinked ? `manifest: ${ctx.snapshot.manifest?.url || 'あり'}` : 'manifest が見つかりません。', 'PWA対応やブランド整合のため manifest を追加してください。'),
    check('basic', 'theme-color', 'theme-color または manifest theme_color がある', ctx.themeColor ? 'pass' : 'warn', 1, ctx.themeColor || 'theme-color が見つかりません。', 'モバイルブラウザの表示色を揃えるため theme-color を設定してください。'),
    check('basic', 'og-core', 'Open Graph の主要3項目が揃っている', ogPresent === 3 ? 'pass' : ogPresent > 0 ? 'warn' : 'fail', 1, `og:title / og:description / og:image = ${ogPresent}/3`, 'SNS共有時の見え方を安定させるため OG 情報を揃えてください。'),
    check('basic', 'twitter-card', 'Twitter/X Card が設定されている', ctx.twitterCard ? 'pass' : 'warn', 1, ctx.twitterCard || 'twitter:card が見つかりません。', 'X共有時のカード表示を明示してください。'),
    check('basic', 'structured-data', '構造化データ(JSON-LD)がある', ctx.structuredDataCount > 0 ? 'pass' : 'warn', 1, `JSON-LD: ${ctx.structuredDataCount}件`, '必要に応じて Organization / Breadcrumb / Article などの構造化データを追加してください。'),
  ];
}

function buildStructureChecks(ctx) {
  const avgParagraph = average(ctx.paragraphLengths);
  const weakLinkRatio = ratio(ctx.links.filter((link) => link.weak).length, ctx.links.length);
  const placeholderLinkRatio = ratio(ctx.links.filter((link) => link.placeholder).length, ctx.links.length);

  return [
    check('structure', 'header', 'header / banner がある', ctx.hasHeader ? 'pass' : 'warn', 1, ctx.hasHeader ? 'header を検出しました。' : 'header が見つかりません。', 'ブランドや主要導線を header に集約してください。'),
    check('structure', 'nav', 'nav / navigation がある', ctx.hasNav ? 'pass' : 'fail', 2, ctx.hasNav ? 'nav を検出しました。' : 'nav が見つかりません。', '主要な移動導線は nav 要素または navigation ランドマークで示してください。'),
    check('structure', 'main', 'main / role=main がある', ctx.hasMain ? 'pass' : 'fail', 3, ctx.hasMain ? 'main を検出しました。' : 'main が見つかりません。', '本文領域を main として明示してください。'),
    check('structure', 'footer', 'footer / contentinfo がある', ctx.hasFooter ? 'pass' : 'warn', 1, ctx.hasFooter ? 'footer を検出しました。' : 'footer が見つかりません。', '会社情報や補助導線を footer に集約してください。'),
    check('structure', 'single-h1', 'H1 が1つに整理されている', ctx.h1Count === 1 ? 'pass' : ctx.h1Count > 1 ? 'fail' : 'warn', 3, `H1件数: ${ctx.h1Count}`, 'ページ主題を H1 ひとつに集約してください。'),
    check('structure', 'heading-hierarchy', '見出しレベルの飛び級がない', ctx.headingSkip ? 'fail' : ctx.headingLevels.length ? 'pass' : 'warn', 2, ctx.headingLevels.length ? `見出し列: ${ctx.headingLevels.join(' > ')}` : '見出しが見つかりません。', 'H2 → H3 → H4 の順で階層構造を整えてください。'),
    check('structure', 'heading-count', '見出しが複数ありスキャンしやすい', ctx.headingLevels.length >= 3 ? 'pass' : ctx.headingLevels.length >= 1 ? 'warn' : 'fail', 1, `見出し数: ${ctx.headingLevels.length}`, '長文ページでは複数の見出しで情報を区切ってください。'),
    check('structure', 'skip-link', 'スキップリンクがある', ctx.hasSkipLink ? 'pass' : 'warn', 2, ctx.hasSkipLink ? 'スキップリンクを検出しました。' : 'スキップリンクが見つかりません。', 'キーボード利用者向けに本文へ移動できるリンクを用意してください。'),
    check('structure', 'breadcrumb', 'パンくず導線がある', ctx.hasBreadcrumb ? 'pass' : 'warn', 1, ctx.hasBreadcrumb ? 'パンくずを検出しました。' : 'パンくずが見つかりません。', '階層サイトではパンくず導線を追加してください。'),
    check('structure', 'search', '検索導線がある', ctx.hasSearch ? 'pass' : ctx.links.length > 25 ? 'warn' : 'na', 1, ctx.hasSearch ? '検索フォームを検出しました。' : `リンク数: ${ctx.links.length}`, '情報量が多いサイトは検索を用意してください。'),
    check('structure', 'scanability', '見出し・リスト・表でスキャンしやすい', ctx.scanabilityBlocks >= 4 ? 'pass' : ctx.scanabilityBlocks >= 2 ? 'warn' : 'fail', 1, `構造化ブロック数: ${ctx.scanabilityBlocks}`, '箇条書きや小見出しで拾い読みしやすく整理してください。'),
    check('structure', 'text-volume', '本文量が極端に少なくない', ctx.metrics.textLength >= 350 ? 'pass' : ctx.metrics.textLength >= 120 ? 'warn' : 'fail', 1, `本文文字数: ${ctx.metrics.textLength}`, 'ページ目的が伝わるだけの本文を確保してください。'),
    check('structure', 'paragraph-length', '段落の長さが読みやすい', avgParagraph && avgParagraph <= 220 ? 'pass' : avgParagraph ? 'warn' : 'na', 1, avgParagraph ? `平均段落長: ${Math.round(avgParagraph)}文字` : '段落が見つかりません。', '長すぎる段落は箇条書きや小見出しで分解してください。'),
    check('structure', 'duplicate-ids', '重複IDがない', ctx.duplicateIds.length === 0 ? 'pass' : 'fail', 2, ctx.duplicateIds.length === 0 ? '重複IDはありません。' : `重複ID: ${ctx.duplicateIds.slice(0, 6).join(', ')}`, '重複IDを解消してください。'),
    check('structure', 'placeholder-links', 'ダミーリンクが多すぎない', placeholderLinkRatio <= 0.03 ? 'pass' : placeholderLinkRatio <= 0.1 ? 'warn' : 'fail', 1, `ダミーリンク比率: ${formatPercent(placeholderLinkRatio)}`, 'href="#" や javascript: の暫定リンクを本番環境に残さないでください。'),
    check('structure', 'weak-link-text', 'リンク文言が具体的', weakLinkRatio <= 0.08 ? 'pass' : weakLinkRatio <= 0.2 ? 'warn' : 'fail', 1, `弱い文言の比率: ${formatPercent(weakLinkRatio)}`, '「詳しくはこちら」だけでなく、遷移先が分かる文言にしてください。'),
    check('structure', 'help-link', 'FAQ / ヘルプ導線がある', ctx.helpLink ? 'pass' : ctx.links.length > 20 ? 'warn' : 'na', 1, ctx.helpLink ? `検出: ${ctx.helpLink.text || ctx.helpLink.hrefRaw}` : 'ヘルプ導線が見つかりません。', 'サポート負荷の高いサイトは FAQ / Help を目立つ場所に置いてください。'),
  ];
}

function buildAccessibilityChecks(ctx) {
  const altRatio = ratio(ctx.images.filter((image) => image.hasAlt).length, ctx.images.length);
  const buttonNameRatio = ratio(ctx.buttons.filter((button) => button.text).length, ctx.buttons.length);
  const linkNameRatio = ratio(ctx.links.filter((link) => link.text).length, ctx.links.length);
  const labeledRatio = ratio(ctx.controlMetrics.filter((item) => item.hasLabel).length, ctx.controlMetrics.length);
  const iframeTitleRatio = ratio(ctx.iframes.filter((iframe) => iframe.hasTitle).length, ctx.iframes.length);
  const tableGoodRatio = ratio(ctx.tableMetrics.filter((item) => !item.dataTable || item.hasHeader || item.hasCaption).length, ctx.tableMetrics.length);
  const blankLinks = ctx.links.filter((link) => link.targetBlank);
  const targetBlankSafeRatio = ratio(blankLinks.filter((link) => /noopener|noreferrer/i.test(link.rel)).length, blankLinks.length);
  const formGroupCount = countFieldGroups(ctx.doc);
  const fieldsetGood = ratio(countFieldsetsWithLegend(ctx.doc), formGroupCount);
  const videoCount = ctx.mediaMetrics.videos.length;
  const videoControls = ctx.mediaMetrics.videos.filter((video) => video.hasAttribute('controls')).length;
  const captionedVideos = ctx.mediaMetrics.videos.filter((video) => video.querySelector('track[kind="captions"], track[kind="subtitles"]')).length;
  const audioCount = ctx.mediaMetrics.audios.length;
  const audioControls = ctx.mediaMetrics.audios.filter((audio) => audio.hasAttribute('controls')).length;

  return [
    check('accessibility', 'alt', '画像に alt 属性がある', ctx.images.length === 0 ? 'na' : altRatio >= 0.95 ? 'pass' : altRatio >= 0.8 ? 'warn' : 'fail', 3, ctx.images.length ? `alt付与率: ${formatPercent(altRatio)}` : '画像はありません。', '装飾以外の画像には目的が分かる alt を設定してください。'),
    check('accessibility', 'button-names', 'ボタンのアクセシブルネームがある', ctx.buttons.length === 0 ? 'na' : buttonNameRatio === 1 ? 'pass' : buttonNameRatio >= 0.85 ? 'warn' : 'fail', 3, ctx.buttons.length ? `ボタン命名率: ${formatPercent(buttonNameRatio)}` : 'ボタンはありません。', 'アイコンボタンには aria-label などで名前を付けてください。'),
    check('accessibility', 'link-names', 'リンクのアクセシブルネームがある', ctx.links.length === 0 ? 'na' : linkNameRatio >= 0.98 ? 'pass' : linkNameRatio >= 0.9 ? 'warn' : 'fail', 3, ctx.links.length ? `リンク命名率: ${formatPercent(linkNameRatio)}` : 'リンクはありません。', '画像リンクは alt を、無文字リンクは aria-label 等を付与してください。'),
    check('accessibility', 'form-labels', 'フォーム項目にラベルがある', ctx.controlMetrics.length === 0 ? 'na' : labeledRatio >= 0.95 ? 'pass' : labeledRatio >= 0.8 ? 'warn' : 'fail', 3, ctx.controlMetrics.length ? `ラベル付与率: ${formatPercent(labeledRatio)}` : '入力項目はありません。', 'placeholder のみではなく、明示ラベルを付与してください。'),
    check('accessibility', 'placeholder-only', 'placeholder だけの入力欄が多すぎない', ctx.controlMetrics.length === 0 ? 'na' : ctx.placeholderOnlyCount === 0 ? 'pass' : ctx.placeholderOnlyCount <= 1 ? 'warn' : 'fail', 1, `placeholderのみ: ${ctx.placeholderOnlyCount}件`, 'ラベル不在のフォーム項目を解消してください。'),
    check('accessibility', 'semantic-input-types', '入力タイプが用途に合っている', ctx.needsSemanticType === 0 ? 'na' : ratio(ctx.hasSemanticType, ctx.needsSemanticType) >= 0.9 ? 'pass' : ratio(ctx.hasSemanticType, ctx.needsSemanticType) >= 0.6 ? 'warn' : 'fail', 2, `適切なtype: ${ctx.hasSemanticType}/${ctx.needsSemanticType}`, 'email / tel / url / search など用途別 type を使用してください。'),
    check('accessibility', 'autocomplete', 'autocomplete が活用されている', ctx.needsAutocomplete === 0 ? 'na' : ratio(ctx.hasAutocomplete, ctx.needsAutocomplete) >= 0.8 ? 'pass' : ratio(ctx.hasAutocomplete, ctx.needsAutocomplete) >= 0.4 ? 'warn' : 'fail', 2, `autocomplete設定: ${ctx.hasAutocomplete}/${ctx.needsAutocomplete}`, 'ユーザー情報入力欄には autocomplete を設定してください。'),
    check('accessibility', 'required-cues', '必須項目が属性と表示で整合している', ctx.requiredControls === 0 ? 'na' : ratio(ctx.requiredCues, ctx.requiredControls) >= 0.9 ? 'pass' : ratio(ctx.requiredCues, ctx.requiredControls) >= 0.5 ? 'warn' : 'fail', 2, `必須表示整合: ${ctx.requiredCues}/${ctx.requiredControls}`, 'required 属性と視覚的な「必須」表示を揃えてください。'),
    check('accessibility', 'fieldset-legend', '選択肢グループに fieldset / legend がある', formGroupCount === 0 ? 'na' : fieldsetGood >= 0.9 ? 'pass' : fieldsetGood >= 0.5 ? 'warn' : 'fail', 2, `fieldset整備: ${countFieldsetsWithLegend(ctx.doc)}/${formGroupCount}`, 'ラジオボタン・チェックボックス群は fieldset と legend でグルーピングしてください。'),
    check('accessibility', 'iframe-title', 'iframe に title がある', ctx.iframes.length === 0 ? 'na' : iframeTitleRatio === 1 ? 'pass' : iframeTitleRatio >= 0.8 ? 'warn' : 'fail', 2, ctx.iframes.length ? `iframe title率: ${formatPercent(iframeTitleRatio)}` : 'iframe はありません。', '埋め込みコンテンツには用途が分かる title を付与してください。'),
    check('accessibility', 'tables', 'データ表に見出しまたは caption がある', ctx.tableMetrics.length === 0 ? 'na' : tableGoodRatio === 1 ? 'pass' : tableGoodRatio >= 0.7 ? 'warn' : 'fail', 1, `表の整備率: ${formatPercent(tableGoodRatio)}`, 'データ表には th / thead / caption を付与してください。'),
    check('accessibility', 'media-controls', '音声・動画に操作手段がある', videoCount + audioCount === 0 ? 'na' : (videoControls + audioControls) === (videoCount + audioCount) ? 'pass' : (videoControls + audioControls) > 0 ? 'warn' : 'fail', 1, `controls付き: ${videoControls + audioControls}/${videoCount + audioCount}`, 'audio / video には controls を付けてください。'),
    check('accessibility', 'captions', '動画に字幕トラックがある', videoCount === 0 ? 'na' : captionedVideos === videoCount ? 'pass' : captionedVideos > 0 ? 'warn' : 'fail', 1, `字幕付き動画: ${captionedVideos}/${videoCount}`, '動画には captions / subtitles トラックを用意してください。'),
    check('accessibility', 'positive-tabindex', 'positive tabindex が使われていない', ctx.doc.querySelectorAll('[tabindex]').length === 0 || [...ctx.doc.querySelectorAll('[tabindex]')].every((el) => Number(el.getAttribute('tabindex')) <= 0) ? 'pass' : 'fail', 2, `positive tabindex: ${[...ctx.doc.querySelectorAll('[tabindex]')].filter((el) => Number(el.getAttribute('tabindex')) > 0).length}件`, 'tabindex の正数指定は避け、自然なDOM順にしてください。'),
    check('accessibility', 'aria-hidden-focusable', 'aria-hidden の中にフォーカス可能要素がない', countAriaHiddenFocusable(ctx.doc) === 0 ? 'pass' : 'fail', 2, `aria-hidden内のフォーカス要素: ${countAriaHiddenFocusable(ctx.doc)}件`, 'aria-hidden 要素にフォーカス可能子要素を置かないでください。'),
    check('accessibility', 'target-blank-rel', '別タブリンクに安全な rel が付く', ctx.links.filter((link) => link.targetBlank).length === 0 ? 'na' : targetBlankSafeRatio === 1 ? 'pass' : targetBlankSafeRatio >= 0.8 ? 'warn' : 'fail', 1, `安全な別タブリンク比率: ${formatPercent(targetBlankSafeRatio)}`, 'target="_blank" には rel="noopener noreferrer" を付けてください。'),
    check('accessibility', 'focus-visible', 'キーボードフォーカス表示に配慮している', ctx.focusSupport === 'pass' ? 'pass' : ctx.focusSupport === 'warn' ? 'warn' : 'fail', 2, focusEvidence(ctx.cssText), 'focus-visible などで明確なフォーカス表示を用意してください。'),
  ];
}

function buildMobileChecks(ctx) {
  const responsiveImageRatio = ratio(ctx.images.filter((image) => image.responsive).length, ctx.images.length);
  const lazyImageRatio = ratio(ctx.images.slice(1).filter((image) => image.lazy).length, Math.max(ctx.images.length - 1, 0));
  const widthHeightRatio = ratio(ctx.images.filter((image) => image.widthHeight).length, ctx.images.length);
  const iframeLazyRatio = ratio(ctx.iframes.filter((iframe) => iframe.lazy).length, ctx.iframes.length);
  const modernImageRatio = ratio(ctx.images.filter((image) => image.modernFormat).length, ctx.images.length);
  const inputmodeRatio = ratio(ctx.hasInputmode, ctx.needsInputmode);
  const manifestIcons = Array.isArray(ctx.manifest?.icons) ? ctx.manifest.icons.length : 0;
  const manifestDisplay = ctx.manifest?.display || '';

  return [
    check('mobile', 'responsive-css', 'レスポンシブ用メディアクエリがある', ctx.responsiveCssSupport ? 'pass' : 'warn', 2, ctx.responsiveCssSupport ? 'レスポンシブ用メディアクエリを検出しました。' : '代表的なメディアクエリが見つかりません。', 'モバイル幅のブレークポイントを CSS に定義してください。'),
    check('mobile', 'dark-mode', 'ダークモードや color-scheme に配慮している', ctx.darkModeSupport ? 'pass' : 'warn', 1, ctx.darkModeSupport ? 'prefers-color-scheme / color-scheme を検出しました。' : 'ダークモード配慮は未検出です。', '近年のOS設定に合わせ、color-scheme やダークモード対応を検討してください。'),
    check('mobile', 'reduced-motion', '低モーション設定に配慮している', ctx.reducedMotionSupport ? 'pass' : ctx.animationsPresent ? 'warn' : 'na', 2, ctx.reducedMotionSupport ? 'prefers-reduced-motion を検出しました。' : ctx.animationsPresent ? 'transition / animation はあるが低モーション配慮は未検出です。' : '顕著な animation / transition は見つかりません。', 'アニメーションを使う場合は prefers-reduced-motion を用意してください。'),
    check('mobile', 'responsive-images', '画像に srcset / picture が活用されている', ctx.images.length === 0 ? 'na' : responsiveImageRatio >= 0.5 ? 'pass' : responsiveImageRatio > 0 ? 'warn' : 'fail', 1, ctx.images.length ? `レスポンシブ画像比率: ${formatPercent(responsiveImageRatio)}` : '画像はありません。', '主要画像には srcset / sizes または picture を検討してください。'),
    check('mobile', 'lazy-images', '非ヒーロー画像で lazy loading を使っている', ctx.images.length <= 1 ? 'na' : lazyImageRatio >= 0.7 ? 'pass' : lazyImageRatio > 0.2 ? 'warn' : 'fail', 2, `lazy画像比率: ${formatPercent(lazyImageRatio)}`, 'ファーストビュー外の画像は loading="lazy" を設定してください。'),
    check('mobile', 'image-dimensions', '画像の width / height が明示されている', ctx.images.length === 0 ? 'na' : widthHeightRatio >= 0.8 ? 'pass' : widthHeightRatio >= 0.4 ? 'warn' : 'fail', 2, ctx.images.length ? `寸法明示率: ${formatPercent(widthHeightRatio)}` : '画像はありません。', 'CLS抑制のため画像サイズを明示してください。'),
    check('mobile', 'iframe-lazy', 'iframe が lazy loading されている', ctx.iframes.length === 0 ? 'na' : iframeLazyRatio >= 0.7 ? 'pass' : iframeLazyRatio > 0 ? 'warn' : 'fail', 1, ctx.iframes.length ? `lazy iframe比率: ${formatPercent(iframeLazyRatio)}` : 'iframe はありません。', '埋め込みは loading="lazy" を検討してください。'),
    check('mobile', 'modern-images', 'AVIF / WebP が使われている', ctx.images.length < 3 ? 'na' : modernImageRatio >= 0.3 ? 'pass' : modernImageRatio > 0 ? 'warn' : 'fail', 1, `次世代画像比率: ${formatPercent(modernImageRatio)}`, '画像量が多い場合は AVIF / WebP を優先してください。'),
    check('mobile', 'manifest', 'manifest が有効に取得できる', ctx.snapshot.manifest?.status >= 200 && ctx.snapshot.manifest?.status < 300 ? 'pass' : ctx.manifestLinked ? 'warn' : 'na', 1, ctx.snapshot.manifest?.url ? `manifest status: ${ctx.snapshot.manifest.status}` : 'manifest はありません。', 'manifest のURLが正しく返るか確認してください。'),
    check('mobile', 'manifest-icons', 'manifest にアイコンがある', !ctx.manifestLinked ? 'na' : manifestIcons > 0 ? 'pass' : 'warn', 1, `manifest icons: ${manifestIcons}`, 'manifest.icons を定義してください。'),
    check('mobile', 'manifest-display', 'manifest に表示モードがある', !ctx.manifestLinked ? 'na' : manifestDisplay ? 'pass' : 'warn', 1, manifestDisplay ? `display: ${manifestDisplay}` : 'display は未設定です。', 'manifest.display に standalone / minimal-ui などを設定してください。'),
    check('mobile', 'inputmode', '数字系入力で inputmode が使われている', ctx.needsInputmode === 0 ? 'na' : inputmodeRatio >= 0.8 ? 'pass' : inputmodeRatio >= 0.4 ? 'warn' : 'fail', 1, `inputmode設定: ${ctx.hasInputmode}/${ctx.needsInputmode}`, 'モバイル入力を改善するため inputmode を検討してください。'),
  ];
}

function buildPerformanceChecks(ctx) {
  const externalOriginCount = ctx.externalOrigins.length;
  const preconnectCoverage = coverageForOrigins(ctx.externalOrigins, ctx.preconnectOrigins, ctx.dnsPrefetchOrigins);
  const iframeCount = ctx.iframes.length;
  const cacheControl = ctx.snapshot.headers?.['cache-control'] || '';

  return [
    check('performance', 'compression', '圧縮転送が有効', /(br|gzip|zstd)/i.test(ctx.snapshot.headers?.['content-encoding'] || '') ? 'pass' : 'warn', 2, ctx.snapshot.headers?.['content-encoding'] || 'content-encoding が見つかりません。', 'HTML圧縮(br/gzip等)を有効にしてください。'),
    check('performance', 'stylesheets', 'スタイルシート数が過多でない', ctx.metrics.stylesheetCount <= 4 ? 'pass' : ctx.metrics.stylesheetCount <= 8 ? 'warn' : 'fail', 1, `stylesheet数: ${ctx.metrics.stylesheetCount}`, 'CSSの分割数を見直してください。'),
    check('performance', 'scripts', '外部スクリプト数が過多でない', ctx.metrics.externalScriptCount <= 8 ? 'pass' : ctx.metrics.externalScriptCount <= 16 ? 'warn' : 'fail', 2, `外部script数: ${ctx.metrics.externalScriptCount}`, '不要なタグやSDKを削減してください。'),
    check('performance', 'async-defer', '外部スクリプトで async / defer / module を使う', ctx.metrics.externalScriptCount === 0 ? 'na' : ctx.asyncScriptRatio >= 0.8 ? 'pass' : ctx.asyncScriptRatio >= 0.4 ? 'warn' : 'fail', 2, `async/defer/module比率: ${formatPercent(ctx.asyncScriptRatio)}`, '同期読み込みの script を減らしてください。'),
    check('performance', 'external-origins', '外部オリジン数が抑制されている', externalOriginCount <= 4 ? 'pass' : externalOriginCount <= 8 ? 'warn' : 'fail', 2, `外部オリジン数: ${externalOriginCount}`, '計測タグやフォント、埋め込み元を整理してください。'),
    check('performance', 'resource-hints', '外部オリジンに対する resource hints がある', externalOriginCount <= 1 ? 'na' : preconnectCoverage >= 0.5 ? 'pass' : preconnectCoverage > 0 ? 'warn' : 'fail', 1, `preconnect/dns-prefetch カバー率: ${formatPercent(preconnectCoverage)}`, '主要な外部接続先には preconnect / dns-prefetch を検討してください。'),
    check('performance', 'font-display', 'Webフォントで font-display が指定される', !ctx.hasFontFace ? 'na' : ctx.hasFontDisplaySwap ? 'pass' : 'warn', 1, ctx.hasFontFace ? (ctx.hasFontDisplaySwap ? 'font-display を検出しました。' : 'font-display が未検出です。') : 'Webフォントは明確に検出されません。', 'Webフォントには font-display: swap を検討してください。'),
    check('performance', 'dom-size', 'DOM規模が過大でない', ctx.metrics.domElementCount <= 1500 ? 'pass' : ctx.metrics.domElementCount <= 3000 ? 'warn' : 'fail', 2, `DOM要素数: ${ctx.metrics.domElementCount}`, '不要なラッパー要素や重複コンポーネントを削減してください。'),
    check('performance', 'inline-script-size', 'インラインスクリプト量が過大でない', ctx.metrics.inlineScriptBytes <= 40_000 ? 'pass' : ctx.metrics.inlineScriptBytes <= 120_000 ? 'warn' : 'fail', 1, `インラインJS: ${formatBytes(ctx.metrics.inlineScriptBytes)}`, '大きなインラインJSは分離し、初期HTMLを軽くしてください。'),
    check('performance', 'inline-style-size', 'インラインCSS量が過大でない', ctx.metrics.inlineStyleBytes <= 20_000 ? 'pass' : ctx.metrics.inlineStyleBytes <= 80_000 ? 'warn' : 'fail', 1, `インラインCSS: ${formatBytes(ctx.metrics.inlineStyleBytes)}`, '大きな style ブロックは整理してください。'),
    check('performance', 'google-font-preconnect', 'Google Fonts 利用時に preconnect がある', !ctx.googleFontUse ? 'na' : ctx.preconnectOrigins.some((origin) => /fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(origin)) ? 'pass' : 'warn', 1, ctx.googleFontUse ? `preconnect: ${ctx.preconnectOrigins.join(', ') || 'なし'}` : 'Google Fonts は未検出です。', 'Google Fonts を使う場合は fonts.googleapis.com / fonts.gstatic.com への preconnect を検討してください。'),
    check('performance', 'iframe-count', '埋め込み iframe 数が過多でない', iframeCount <= 2 ? 'pass' : iframeCount <= 5 ? 'warn' : 'fail', 1, `iframe数: ${iframeCount}`, '埋め込みは必要最小限にしてください。'),
    check('performance', 'cache-control', 'HTMLレスポンスにキャッシュ方針がある', cacheControl ? 'pass' : 'warn', 1, cacheControl || 'cache-control が見つかりません。', 'CDN / ブラウザ向けのキャッシュ方針を整理してください。'),
    check('performance', 'spa-shell', '静的シェルだけでなく本文も取得できている', ctx.likelySpa ? 'warn' : 'pass', 1, ctx.likelySpa ? 'SPAシェル構成の可能性があります。' : 'HTML本文を十分に取得できています。', 'SSR や重要コンテンツのHTML出力を検討してください。'),
  ];
}

function buildTrustChecks(ctx) {
  const secureForms = ctx.forms.filter((form) => !form.insecure).length;
  const secureFormRatio = ratio(secureForms, ctx.forms.length);
  const ogCompleteness = [ctx.ogTags.title, ctx.ogTags.description, ctx.ogTags.image].filter(Boolean).length;

  return [
    check('trust', 'contact', '問い合わせ導線がある', ctx.contactLink ? 'pass' : 'warn', 2, ctx.contactLink ? `検出: ${ctx.contactLink.text || ctx.contactLink.hrefRaw}` : '問い合わせ導線が見つかりません。', '問い合わせや相談導線を明示してください。'),
    check('trust', 'privacy', 'プライバシーポリシー導線がある', ctx.privacyLink ? 'pass' : 'warn', 2, ctx.privacyLink ? `検出: ${ctx.privacyLink.text || ctx.privacyLink.hrefRaw}` : 'プライバシーポリシーが見つかりません。', '個人情報を扱うサイトは必ずポリシーを掲示してください。'),
    check('trust', 'terms', '利用規約または法務導線がある', ctx.termsLink ? 'pass' : 'warn', 1, ctx.termsLink ? `検出: ${ctx.termsLink.text || ctx.termsLink.hrefRaw}` : '利用規約が見つかりません。', '利用規約や特商法表記などの法務導線を整備してください。'),
    check('trust', 'company', '会社概要 / 運営者情報がある', ctx.companyLink ? 'pass' : 'warn', 1, ctx.companyLink ? `検出: ${ctx.companyLink.text || ctx.companyLink.hrefRaw}` : '会社概要導線が見つかりません。', '運営主体が分かるページを設けてください。'),
    check('trust', 'robots-exists', 'robots.txt が存在する', ctx.snapshot.robots?.exists ? 'pass' : 'warn', 1, ctx.snapshot.robots?.url ? `robots.txt status: ${ctx.snapshot.robots.status}` : 'robots.txt 取得情報がありません。', '公開サイトは robots.txt を明示してください。'),
    check('trust', 'robots-allow', '対象パスが robots.txt で拒否されていない', ctx.snapshot.robots?.disallowed ? 'fail' : 'pass', 1, ctx.snapshot.robots?.disallowed ? ctx.snapshot.robots.matchedRule || 'robots.txt で拒否' : 'robots.txt で拒否されていません。', '診断対象ページを公開用途にする場合は robots 設定を見直してください。'),
    check('trust', 'sitemap', 'sitemap.xml が存在する', ctx.snapshot.sitemap?.exists ? 'pass' : 'warn', 1, ctx.snapshot.sitemap?.url ? `sitemap.xml status: ${ctx.snapshot.sitemap.status}` : 'sitemap 情報がありません。', '公開サイトは sitemap.xml を用意してください。'),
    check('trust', 'hsts', 'HSTS ヘッダがある', ctx.securityHeaders.hsts ? 'pass' : ctx.pageUrl.protocol === 'https:' ? 'warn' : 'na', 1, ctx.securityHeaders.hsts ? 'strict-transport-security を検出しました。' : 'strict-transport-security は見つかりません。', 'HTTPSサイトは HSTS を検討してください。'),
    check('trust', 'csp', 'Content-Security-Policy がある', ctx.securityHeaders.csp ? 'pass' : 'warn', 1, ctx.securityHeaders.csp ? 'content-security-policy を検出しました。' : 'content-security-policy は見つかりません。', '少なくとも script-src 等の基本CSPを検討してください。'),
    check('trust', 'referrer-policy', 'Referrer-Policy がある', ctx.securityHeaders.referrerPolicy ? 'pass' : 'warn', 1, ctx.securityHeaders.referrerPolicy ? 'referrer-policy を検出しました。' : 'referrer-policy は見つかりません。', 'referrer-policy を設定してください。'),
    check('trust', 'x-content-type-options', 'X-Content-Type-Options がある', ctx.securityHeaders.xContentTypeOptions ? 'pass' : 'warn', 1, ctx.securityHeaders.xContentTypeOptions ? 'x-content-type-options を検出しました。' : 'x-content-type-options は見つかりません。', 'nosniff を設定してください。'),
    check('trust', 'permissions-policy', 'Permissions-Policy がある', ctx.securityHeaders.permissionsPolicy ? 'pass' : 'warn', 1, ctx.securityHeaders.permissionsPolicy ? 'permissions-policy を検出しました。' : 'permissions-policy は見つかりません。', '不要なブラウザ機能を制限する permissions-policy を検討してください。'),
    check('trust', 'mixed-content', '混在コンテンツがない', ctx.mixedContentUrls.length === 0 ? 'pass' : 'fail', 2, ctx.mixedContentUrls.length === 0 ? '混在コンテンツは見つかりません。' : `http:// 資源: ${ctx.mixedContentUrls.slice(0, 4).join(', ')}`, 'HTTPSページ内の http:// リソースを解消してください。'),
    check('trust', 'secure-forms', 'フォーム送信先がHTTPS', ctx.forms.length === 0 ? 'na' : secureFormRatio === 1 ? 'pass' : secureFormRatio >= 0.5 ? 'warn' : 'fail', 2, ctx.forms.length ? `HTTPS送信比率: ${formatPercent(secureFormRatio)}` : 'フォームはありません。', 'フォーム action は HTTPS に統一してください。'),
    check('trust', 'social-meta', 'SNS共有メタが最低限揃う', ogCompleteness >= 2 || ctx.twitterCard ? 'pass' : 'warn', 1, `OG充足: ${ogCompleteness}/3, twitter: ${ctx.twitterCard ? 'あり' : 'なし'}`, 'OG/Twitter Card を揃えて共有時の信頼感を高めてください。'),
    check('trust', 'structured-data-trust', '構造化データが信頼情報の補助になる', ctx.structuredDataCount > 0 ? 'pass' : 'warn', 1, `構造化データ: ${ctx.structuredDataCount}件`, 'Organization / Breadcrumb / FAQPage などを必要に応じて付与してください。'),
  ];
}

function buildCategories(checks) {
  return Object.entries(CATEGORY_META).map(([key, meta]) => {
    const categoryChecks = checks.filter((checkItem) => checkItem.category === key);
    const score = buildOverallScore(categoryChecks);
    return {
      key,
      label: meta.label,
      description: meta.description,
      lens: meta.lens,
      score,
      grade: scoreToGrade(score),
      judgment: scoreToJudgment(score),
      counts: {
        pass: categoryChecks.filter((item) => item.status === 'pass').length,
        warn: categoryChecks.filter((item) => item.status === 'warn').length,
        fail: categoryChecks.filter((item) => item.status === 'fail').length,
        na: categoryChecks.filter((item) => item.status === 'na').length,
      },
      checks: categoryChecks,
    };
  });
}

function buildOverallScore(checks) {
  const scoreable = checks.filter((item) => STATUS_POINTS[item.status] !== null);
  const totalWeight = scoreable.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return 0;
  const score = scoreable.reduce((sum, item) => sum + item.weight * STATUS_POINTS[item.status], 0);
  return Math.round((score / totalWeight) * 100);
}

function buildTopIssues(checks) {
  return checks
    .filter((item) => item.status === 'fail' || item.status === 'warn')
    .sort((a, b) => {
      const severityA = a.status === 'fail' ? 2 : 1;
      const severityB = b.status === 'fail' ? 2 : 1;
      if (severityB !== severityA) return severityB - severityA;
      return b.weight - a.weight;
    })
    .slice(0, 8);
}

function buildPrescriptions(topIssues) {
  return topIssues.slice(0, 6).map((issue, index) => ({
    order: index + 1,
    title: issue.title,
    category: CATEGORY_META[issue.category]?.label || issue.category,
    recommendation: issue.recommendation,
    severity: issue.status === 'fail' ? '優先対応' : '早期対応',
  }));
}

function buildSummary(ctx, categories, overallScore, grade, judgment, topIssues) {
  const weak = [...categories].sort((a, b) => a.score - b.score).slice(0, 2);
  const strong = [...categories].sort((a, b) => b.score - a.score).slice(0, 2);
  const lead = `総合判定は ${judgment}（${overallScore}点 / ${grade}）です。`;
  const weakText = weak.length ? `特に ${weak.map((item) => `${item.label}(${item.score}点)`).join('、')} が優先改善領域です。` : '';
  const strongText = strong.length ? `一方で ${strong.map((item) => `${item.label}(${item.score}点)`).join('、')} は比較的良好です。` : '';
  const spaText = ctx.likelySpa ? 'このページはSPAシェル構成の可能性があり、JavaScript実行後の要素は別途目視確認を推奨します。' : '';
  const issueText = topIssues.length ? `最優先の処方箋は「${topIssues[0].title}」です。` : '';

  return {
    lead,
    body: [weakText, strongText, spaText, issueText].filter(Boolean).join(' '),
    text: [lead, weakText, strongText, spaText, issueText].filter(Boolean).join(' '),
  };
}

function analyzeControl(el, doc) {
  const type = (el.getAttribute('type') || '').toLowerCase();
  const nameLike = `${el.getAttribute('name') || ''} ${el.getAttribute('id') || ''} ${el.getAttribute('placeholder') || ''} ${el.getAttribute('autocomplete') || ''}`;
  const labelText = controlLabelText(el, doc);
  const hasLabel = Boolean(labelText || normalizeText(el.getAttribute('aria-label')) || normalizeText(resolveAriaLabelledby(el, doc)) || normalizeText(el.getAttribute('title')));
  const hasPlaceholder = Boolean(normalizeText(el.getAttribute('placeholder')));
  const semanticTypePass = semanticTypeCheck(type, nameLike);
  const needsSemanticType = semanticTypeNeeded(nameLike);
  const autocomplete = (el.getAttribute('autocomplete') || '').toLowerCase();
  const needsAutocomplete = NAME_FIELD_PATTERNS.test(nameLike) && !['password', 'search'].includes(type);
  const hasAutocomplete = Boolean(autocomplete && autocomplete !== 'off');
  const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
  const requiredCue = required && (/\*/.test(labelText) || /必須|required/i.test(`${labelText} ${el.getAttribute('placeholder') || ''}`) || el.getAttribute('aria-required') === 'true');
  const needsInputmode = type === 'text' && NUMERIC_FIELD_PATTERNS.test(nameLike);
  const inputmodePass = needsInputmode ? Boolean(normalizeText(el.getAttribute('inputmode'))) : true;

  return {
    type,
    nameLike,
    hasLabel,
    hasPlaceholder,
    needsSemanticType,
    semanticTypePass,
    needsAutocomplete,
    hasAutocomplete,
    required,
    requiredCue,
    needsInputmode,
    inputmodePass,
  };
}

function semanticTypeNeeded(nameLike) {
  return /(email|mail|e-mail|tel|phone|mobile|url|website|site|search|検索)/i.test(nameLike);
}

function semanticTypeCheck(type, nameLike) {
  if (!semanticTypeNeeded(nameLike)) return true;
  if (/(email|mail|e-mail)/i.test(nameLike)) return type === 'email';
  if (/(tel|phone|mobile|電話)/i.test(nameLike)) return type === 'tel';
  if (/(url|website|site)/i.test(nameLike)) return type === 'url';
  if (/(search|検索)/i.test(nameLike)) return type === 'search';
  return true;
}

function check(category, id, title, status, weight, evidence, recommendation) {
  if (!CATEGORY_KEYS.has(category)) {
    throw new Error(`Unknown category: ${category}`);
  }
  return {
    category,
    id,
    title,
    status,
    weight,
    evidence,
    recommendation,
    statusLabel: STATUS_META[status]?.label || status,
  };
}

function findLinksByRelToken(doc, token) {
  return [...doc.querySelectorAll('link[rel]')].filter((el) => relHasToken(el.getAttribute('rel'), token));
}

function relHasToken(relValue = '', token) {
  return relValue
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .includes(token.toLowerCase());
}

function findCanonical(doc) {
  const canonicalLink = findLinksByRelToken(doc, 'canonical')[0];
  return canonicalLink ? canonicalLink.getAttribute('href') || canonicalLink.href || '' : '';
}

function getMeta(doc, name) {
  const meta = [...doc.querySelectorAll('meta[name]')].find((el) => (el.getAttribute('name') || '').toLowerCase() === name.toLowerCase());
  return normalizeText(meta?.getAttribute('content') || '');
}

function getMetaProperty(doc, property) {
  const meta = [...doc.querySelectorAll('meta[property]')].find((el) => (el.getAttribute('property') || '').toLowerCase() === property.toLowerCase());
  return normalizeText(meta?.getAttribute('content') || '');
}

function parseManifest(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function accessibleName(el, doc) {
  return normalizeText(
    el.getAttribute?.('aria-label') ||
      resolveAriaLabelledby(el, doc) ||
      el.getAttribute?.('alt') ||
      el.getAttribute?.('value') ||
      el.getAttribute?.('title') ||
      imageAltFromChild(el) ||
      el.textContent ||
      '',
  );
}

function resolveAriaLabelledby(el, doc) {
  const ids = (el.getAttribute?.('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  return ids.map((id) => normalizeText(doc.getElementById(id)?.textContent || '')).filter(Boolean).join(' ');
}

function imageAltFromChild(el) {
  const img = el.querySelector?.('img[alt]');
  return img ? img.getAttribute('alt') || '' : '';
}

function controlLabelText(el, doc) {
  const id = el.getAttribute('id');
  if (id) {
    const explicit = doc.querySelector(`label[for="${cssEscape(id)}"]`);
    if (explicit) return normalizeText(explicit.textContent);
  }
  const wrapped = el.closest('label');
  if (wrapped) return normalizeText(wrapped.textContent || '');
  return '';
}

function cssEscape(value) {
  return String(value).replace(/([ #;?%&,.+*~\':"!^$\[\]()=>|/@])/g, '\\$1');
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function resolveUrl(value, baseUrl) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed || /^(javascript:|data:|mailto:|tel:|about:|blob:)/i.test(trimmed)) return '';
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return '';
  }
}

function collectExternalOrigins(doc, pageUrl) {
  const urls = [];
  for (const selector of ['link[href]', 'script[src]', 'img[src]', 'iframe[src]', 'video[src]', 'audio[src]', 'source[src]']) {
    for (const el of doc.querySelectorAll(selector)) {
      const attr = el.getAttribute('href') || el.getAttribute('src') || '';
      const url = resolveUrl(attr, pageUrl);
      if (url) urls.push(url);
    }
  }

  for (const source of doc.querySelectorAll('img[srcset], source[srcset]')) {
    parseSrcset(source.getAttribute('srcset') || '', pageUrl).forEach((url) => urls.push(url));
  }

  return unique(
    urls
      .map((url) => originOf(url))
      .filter((origin) => Boolean(origin) && origin !== pageUrl.origin),
  );
}

function collectMixedContentUrls(doc, pageUrl) {
  if (pageUrl.protocol !== 'https:') return [];
  const urls = [];
  for (const selector of ['link[href]', 'script[src]', 'img[src]', 'iframe[src]', 'video[src]', 'audio[src]', 'form[action]']) {
    for (const el of doc.querySelectorAll(selector)) {
      const attr = el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('action') || '';
      if (/^http:\/\//i.test(attr)) urls.push(attr);
    }
  }
  return unique(urls);
}

function parseSrcset(srcset, baseUrl) {
  return srcset
    .split(',')
    .map((item) => item.trim().split(/\s+/)[0])
    .map((candidate) => resolveUrl(candidate, baseUrl))
    .filter(Boolean);
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function findLinkMatch(links, patterns) {
  return links.find((link) => patterns.some((pattern) => pattern.test(`${link.text} ${link.hrefRaw}`)));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function ratio(numerator, denominator) {
  if (!denominator) return 0;
  return numerator / denominator;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function inRange(value, min, max) {
  return value >= min && value <= max;
}

function scoreToGrade(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'E';
}

function scoreToJudgment(score) {
  if (score >= 90) return '異常なし';
  if (score >= 80) return '軽度注意';
  if (score >= 70) return '経過観察';
  if (score >= 60) return '要改善';
  return '要精査';
}

function formatPercent(value) {
  return `${Math.round((value || 0) * 100)}%`;
}

function formatBytes(value) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function hasHeadingSkip(levels) {
  let previous = 0;
  for (const level of levels) {
    if (previous && level > previous + 1) return true;
    previous = level;
  }
  return false;
}

function findDuplicateIds(doc) {
  const counts = new Map();
  for (const el of doc.querySelectorAll('[id]')) {
    const id = el.getAttribute('id');
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

function countAriaHiddenFocusable(doc) {
  return [...doc.querySelectorAll('[aria-hidden="true"]')].filter((container) => {
    if (isFocusable(container)) return true;
    return container.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])') !== null;
  }).length;
}

function isFocusable(el) {
  if (!el) return false;
  const tabindex = el.getAttribute('tabindex');
  if (tabindex !== null && Number(tabindex) >= 0) return true;
  return ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !(el.tagName === 'A' && !el.getAttribute('href'));
}

function countFieldGroups(doc) {
  const groups = new Map();
  for (const input of doc.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
    const name = input.getAttribute('name') || '__unnamed__';
    groups.set(name, (groups.get(name) || 0) + 1);
  }
  return [...groups.values()].filter((count) => count > 1).length;
}

function countFieldsetsWithLegend(doc) {
  return [...doc.querySelectorAll('fieldset')].filter((fieldset) => fieldset.querySelector('legend')).length;
}

function detectFocusSupport(cssText) {
  const hasFocusVisible = /:focus-visible\b/i.test(cssText);
  const removesOutline = /:focus[^\{]*\{[^\}]*outline\s*:\s*(none|0)\b/i.test(cssText);
  const visibleFocus = /:focus[^\{]*\{[^\}]*?(box-shadow\s*:[^;\}]+|outline\s*:\s*(?!none|0)[^;\}]+|border(?:-color)?\s*:[^;\}]+)/i.test(cssText);
  if (hasFocusVisible || visibleFocus) return 'pass';
  if (removesOutline) return 'fail';
  return 'warn';
}

function focusEvidence(cssText) {
  if (/:focus-visible\b/i.test(cssText)) return ':focus-visible を検出しました。';
  if (/:focus[^\{]*\{[^\}]*?(box-shadow\s*:[^;\}]+|outline\s*:\s*(?!none|0)[^;\}]+|border(?:-color)?\s*:[^;\}]+)/i.test(cssText)) return ':focus スタイルを検出しました。';
  if (/:focus[^\{]*\{[^\}]*outline\s*:\s*(none|0)\b/i.test(cssText)) return 'focus outline が無効化されています。';
  return 'focus系スタイルは明確に検出できません。';
}

function coverageForOrigins(externalOrigins, preconnectOrigins, dnsPrefetchOrigins) {
  if (!externalOrigins.length) return 0;
  const hinted = externalOrigins.filter((origin) => preconnectOrigins.includes(origin) || dnsPrefetchOrigins.includes(origin)).length;
  return hinted / externalOrigins.length;
}
