import { CATEGORY_META, STATUS_META } from './analyzer.js';

export function renderReport(root, report) {
  const counts = {
    pass: report.checks.filter((item) => item.status === 'pass').length,
    warn: report.checks.filter((item) => item.status === 'warn').length,
    fail: report.checks.filter((item) => item.status === 'fail').length,
    na: report.checks.filter((item) => item.status === 'na').length,
  };

  const metricCards = [
    ['総合判定', `${report.judgment} / ${report.grade}`],
    ['良好', `${counts.pass}項目`],
    ['要観察', `${counts.warn}項目`],
    ['要改善', `${counts.fail}項目`],
    ['DOM規模', `${report.metrics.domElementCount}要素`],
    ['外部オリジン', `${report.metrics.externalOriginCount}件`],
    ['外部script', `${report.metrics.externalScriptCount}件`],
    ['画像数', `${report.metrics.imageCount}件`],
  ];

  root.hidden = false;
  root.innerHTML = `
    <section class="report-shell">
      <article class="report-card report-hero">
        <div class="report-hero-main">
          <div>
            <p class="eyebrow">UI/UX 健康診断カルテ</p>
            <h2 class="report-title">${escapeHtml(report.page.title || 'タイトル未設定ページ')}</h2>
            <p class="report-url"><a href="${escapeHtml(report.page.finalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(report.page.finalUrl)}</a></p>
            <p class="report-meta-line">受診日時: ${formatDateTime(report.page.fetchedAt)} / HTTP ${report.page.status} / HTML ${formatBytes(report.page.htmlBytes)}</p>
          </div>
          <div class="score-ring" aria-label="総合スコア ${report.overallScore}点">
            <div class="score-ring-inner">
              <span class="score-number">${report.overallScore}</span>
              <span class="score-grade">${report.grade}</span>
            </div>
          </div>
        </div>
        <div class="report-toolbar">
          <button type="button" class="secondary-button" id="printReportBtn">印刷 / PDF保存</button>
          <button type="button" class="secondary-button" id="downloadJsonBtn">JSON保存</button>
        </div>
      </article>

      <article class="report-card">
        <h3 class="section-title">総合所見</h3>
        <p class="summary-lead">${escapeHtml(report.summary.lead)}</p>
        <p class="summary-body">${escapeHtml(report.summary.body)}</p>
      </article>

      <section class="stats-grid">
        ${metricCards.map(([label, value]) => `
          <article class="stat-card">
            <p class="stat-label">${escapeHtml(label)}</p>
            <p class="stat-value">${escapeHtml(value)}</p>
          </article>
        `).join('')}
      </section>

      <section class="category-grid">
        ${report.categories.map((category) => `
          <article class="category-card">
            <header class="category-card-header">
              <div>
                <p class="category-name">${escapeHtml(category.label)}</p>
                <p class="category-lens">${escapeHtml(category.lens)}</p>
              </div>
              <div class="category-score-block">
                <span class="category-score">${category.score}</span>
                <span class="category-grade">${escapeHtml(category.grade)}</span>
              </div>
            </header>
            <div class="category-meter" aria-hidden="true">
              <span style="width:${Math.max(4, category.score)}%"></span>
            </div>
            <p class="category-description">${escapeHtml(category.description)}</p>
            <dl class="category-counts">
              <div><dt>良好</dt><dd>${category.counts.pass}</dd></div>
              <div><dt>要観察</dt><dd>${category.counts.warn}</dd></div>
              <div><dt>要改善</dt><dd>${category.counts.fail}</dd></div>
            </dl>
          </article>
        `).join('')}
      </section>

      <section class="split-section">
        <article class="report-card">
          <h3 class="section-title">要点サマリー</h3>
          <ol class="issue-list">
            ${report.topIssues.length ? report.topIssues.map((issue) => `
              <li>
                <span class="status-pill ${STATUS_META[issue.status]?.className || ''}">${escapeHtml(STATUS_META[issue.status]?.label || issue.status)}</span>
                <strong>${escapeHtml(CATEGORY_META[issue.category]?.label || issue.category)}:</strong>
                <span>${escapeHtml(issue.title)}</span>
              </li>
            `).join('') : '<li>大きな所見はありません。</li>'}
          </ol>
        </article>

        <article class="report-card">
          <h3 class="section-title">優先処方箋</h3>
          <ol class="prescription-list">
            ${report.prescriptions.map((item) => `
              <li>
                <div class="prescription-head">
                  <span class="prescription-order">${item.order}</span>
                  <div>
                    <p class="prescription-title">${escapeHtml(item.title)}</p>
                    <p class="prescription-meta">${escapeHtml(item.category)} / ${escapeHtml(item.severity)}</p>
                  </div>
                </div>
                <p class="prescription-body">${escapeHtml(item.recommendation)}</p>
              </li>
            `).join('')}
          </ol>
        </article>
      </section>

      <section class="details-stack">
        ${report.categories.map((category, index) => `
          <details class="category-details" ${index < 2 ? 'open' : ''}>
            <summary>
              <span>${escapeHtml(category.label)}</span>
              <span>${category.score}点 / ${escapeHtml(category.grade)}</span>
            </summary>
            <div class="details-body">
              <p class="details-description">${escapeHtml(category.description)}</p>
              <table class="report-table">
                <thead>
                  <tr>
                    <th>判定</th>
                    <th>検査項目</th>
                    <th>所見</th>
                    <th>処方</th>
                  </tr>
                </thead>
                <tbody>
                  ${category.checks.map((item) => `
                    <tr>
                      <td>
                        <span class="status-pill ${STATUS_META[item.status]?.className || ''}">${escapeHtml(STATUS_META[item.status]?.label || item.status)}</span>
                      </td>
                      <td>${escapeHtml(item.title)}</td>
                      <td>${escapeHtml(item.evidence)}</td>
                      <td>${escapeHtml(item.recommendation)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </details>
        `).join('')}
      </section>

      <article class="report-card methodology-card">
        <h3 class="section-title">判定ロジック</h3>
        <ul class="methodology-list">
          ${report.methodology.basis.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
        </ul>
        <p class="methodology-note">${escapeHtml(report.methodology.limitations?.note || '')}</p>
      </article>
    </section>
  `;
}

export function renderFailure(root, message, detail = '') {
  root.hidden = false;
  root.innerHTML = `
    <article class="report-card failure-card">
      <p class="eyebrow">診断結果</p>
      <h2 class="failure-title">${escapeHtml(message)}</h2>
      ${detail ? `<p class="failure-detail">${escapeHtml(detail)}</p>` : ''}
    </article>
  `;
}

export function clearRoot(root) {
  root.hidden = true;
  root.innerHTML = '';
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatBytes(value) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
