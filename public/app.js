import { analyzeSnapshot } from './analyzer.js';
import { clearRoot, renderFailure, renderReport } from './render.js';

const form = document.getElementById('diagnosticForm');
const urlInput = document.getElementById('targetUrl');
const submitButton = document.getElementById('submitButton');
const statusStrip = document.getElementById('statusStrip');
const reportRoot = document.getElementById('reportRoot');
const helperBox = document.getElementById('helperBox');

const STEPS = ['URL確認', 'ページ取得', '解析', 'カルテ生成'];

let currentReport = null;
let progressTimer = null;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const rawUrl = urlInput.value.trim();
  if (!rawUrl) {
    renderFailure(reportRoot, 'URLを入力してください。');
    return;
  }

  clearRoot(reportRoot);
  currentReport = null;
  setBusy(true);
  setHelper('HTML・CSS・HTTPヘッダをもとに自動診断しています。JavaScript 実行後にのみ描画される要素は別途目視確認が必要です。');
  startProgress();

  try {
    updateProgress(0, '入力URLを確認しています。');
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error || '診断APIの呼び出しに失敗しました。');
    }

    if (payload.blocked) {
      stopProgress();
      updateProgress(3, '診断対象の仕様により取得できませんでした。', true);
      renderFailure(reportRoot, payload.message || '診断先のウェブページの仕様により、診断できませんでした', blockedReasonLabel(payload.reason, payload.diagnosticReason));
      return;
    }

    updateProgress(2, 'カルテを組み立てています。');
    const report = analyzeSnapshot(payload);
    currentReport = report;
    stopProgress();
    updateProgress(3, '健康診断カルテを生成しました。', true);
    renderReport(reportRoot, report);
    bindReportActions(report);
  } catch (error) {
    stopProgress();
    updateProgress(3, 'エラーが発生しました。', true);
    renderFailure(reportRoot, '診断中にエラーが発生しました。', error.message || '時間をおいて再試行してください。');
  } finally {
    setBusy(false);
  }
});

function bindReportActions(report) {
  document.getElementById('printReportBtn')?.addEventListener('click', () => window.print());
  document.getElementById('downloadJsonBtn')?.addEventListener('click', () => downloadJson(report));
}

function downloadJson(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `ux-health-check-${timestampForFile()}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function timestampForFile() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  urlInput.disabled = isBusy;
  submitButton.textContent = isBusy ? '診断中…' : '診断を始める';
}

function startProgress() {
  let index = 0;
  statusStrip.hidden = false;
  renderProgress(index, '診断を開始しました。');
  stopProgress();
  progressTimer = window.setInterval(() => {
    index = Math.min(index + 1, STEPS.length - 2);
    renderProgress(index, `${STEPS[index]}を進めています。`);
  }, 1400);
}

function stopProgress() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

function updateProgress(stepIndex, note, done = false) {
  renderProgress(stepIndex, note, done);
}

function renderProgress(activeIndex, note, done = false) {
  statusStrip.hidden = false;
  statusStrip.innerHTML = `
    <div class="progress-track" role="status" aria-live="polite">
      ${STEPS.map((step, index) => {
        const classNames = ['progress-step'];
        if (index < activeIndex || (done && index <= activeIndex)) classNames.push('is-done');
        if (!done && index === activeIndex) classNames.push('is-active');
        if (done && index === activeIndex) classNames.push('is-done');
        return `
          <div class="${classNames.join(' ')}">
            <span class="progress-index">${index + 1}</span>
            <span class="progress-label">${step}</span>
          </div>
        `;
      }).join('')}
    </div>
    <p class="progress-note">${escapeHtml(note)}</p>
  `;
}

function blockedReasonLabel(reason, diagnosticReason) {
  const reasonMap = {
    robots_disallow: 'robots.txt により対象パスが許可されていない可能性があります。',
    captcha: 'Bot / CAPTCHA 対策により取得できない可能性があります。',
    human_verification: '人間確認の仕組みにより取得できない可能性があります。',
    bot_challenge: 'Bot対策のチャレンジ応答により取得できない可能性があります。',
    access_denied: 'アクセス制限により取得できない可能性があります。',
    non_html: 'HTMLページではないため、自動診断の対象外です。',
  };
  return reasonMap[reason] || diagnosticReason || '認証必須ページ、Bot対策ページ、非公開ページは診断できません。';
}

function setHelper(text) {
  helperBox.textContent = text;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
