const RELEASES = {
  x64: 'https://github.com/RealSe62em/Pine-Launcher/releases/download/v1.2.3/PineLauncherSetup-x64.exe',
  arm64: 'https://github.com/RealSe62em/Pine-Launcher/releases/download/v1.2.3/PineLauncherSetup-arm64.exe',
  linux: 'https://github.com/RealSe62em/Pine-Launcher/releases/download/v1.2.3/PineLauncher-1.2.3-linux-amd64.deb',
  linuxArm64: 'https://github.com/RealSe62em/Pine-Launcher/releases/download/v1.2.3/PineLauncher-1.2.3-linux-arm64.deb',
  arch: 'https://github.com/RealSe62em/Pine-Launcher/releases/download/v1.2.3/PineLauncher-1.2.3-archlinux-x64.pacman'
};
const FALLBACK_VERSION = '1.2.3';
const ANALYTICS_ID = 'G-FR14WGWZY2';
const CONSENT_KEY = 'pine_analytics_consent';

function readAnalyticsConsent() {
  try { return localStorage.getItem(CONSENT_KEY); } catch { return null; }
}

function writeAnalyticsConsent(value) {
  try { localStorage.setItem(CONSENT_KEY, value); } catch { /* Continue without persistence. */ }
}

function loadAnalytics() {
  if (window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', ANALYTICS_ID, { anonymize_ip: true });
  const tag = document.createElement('script');
  tag.async = true;
  tag.src = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_ID}`;
  document.head.appendChild(tag);
}

function sendAnalyticsEvent(name, parameters = {}) {
  if (readAnalyticsConsent() !== 'accepted' || typeof window.gtag !== 'function') return;
  window.gtag('event', name, parameters);
}

const consentDialog = document.querySelector('.analytics-consent');
function showConsentDialog() { if (consentDialog) consentDialog.hidden = false; }
function hideConsentDialog() { if (consentDialog) consentDialog.hidden = true; }

const existingConsent = readAnalyticsConsent();
if (existingConsent === 'accepted') loadAnalytics();
else if (existingConsent !== 'declined') showConsentDialog();

document.querySelectorAll('[data-consent]').forEach((button) => {
  button.addEventListener('click', () => {
    const choice = button.dataset.consent;
    writeAnalyticsConsent(choice);
    if (choice === 'declined' && typeof window.gtag === 'function') {
      window.location.reload();
      return;
    }
    hideConsentDialog();
    if (choice === 'accepted') loadAnalytics();
  });
});
document.querySelector('.privacy-settings')?.addEventListener('click', showConsentDialog);

function compareVersions(left, right) {
  const parts = value => String(value).split('.').map(part => Number.parseInt(part, 10) || 0);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}
document.querySelectorAll('.download-link').forEach((link) => { link.href = RELEASES[link.dataset.build] || RELEASES.x64; });

document.addEventListener('click', (event) => {
  const link = event.target.closest('a[href]');
  if (!link) return;
  const href = link.href;
  if (link.classList.contains('download-link')) {
    const fileName = new URL(href).pathname.split('/').pop();
    sendAnalyticsEvent('file_download', {
      build: link.dataset.build || 'unknown',
      file_name: fileName,
      link_url: href,
      version: document.querySelector('[data-release-version]')?.textContent || FALLBACK_VERSION
    });
    return;
  }
  if (href.includes('github.com/')) sendAnalyticsEvent('github_click', { link_url: href, link_text: link.textContent.trim() });
  if (href.includes('discord.gg/')) sendAnalyticsEvent('discord_click', { link_url: href, link_text: link.textContent.trim() });
});

async function syncLatestRelease() {
  const response = await fetch('https://api.github.com/repos/RealSe62em/Pine-Launcher/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' }
  });
  if (!response.ok) return;
  const release = await response.json();
  const version = String(release.tag_name || '').replace(/^v/i, '');
  if (!version || compareVersions(version, FALLBACK_VERSION) < 0) return;
  if (version) document.querySelectorAll('[data-release-version]').forEach((element) => { element.textContent = version; });

  const assets = new Map((release.assets || []).map((asset) => [asset.name, asset]));
  const names = {
    x64: 'PineLauncherSetup-x64.exe',
    arm64: 'PineLauncherSetup-arm64.exe',
    linux: `PineLauncher-${version}-linux-amd64.deb`,
    linuxArm64: `PineLauncher-${version}-linux-arm64.deb`,
    arch: `PineLauncher-${version}-archlinux-x64.pacman`
  };
  for (const [build, name] of Object.entries(names)) {
    const asset = assets.get(name);
    if (!asset?.browser_download_url) continue;
    RELEASES[build] = asset.browser_download_url;
    document.querySelectorAll(`.download-link[data-build="${build}"]`).forEach((link) => { link.href = asset.browser_download_url; });
  }

  for (const [build, name] of Object.entries(names)) {
    const asset = assets.get(name);
    if (!asset?.size) continue;
    const size = `${Math.round(asset.size / 1024 / 1024)} MB`;
    document.querySelectorAll(`[data-release-size="${build}"]`).forEach((element) => { element.textContent = size; });
  }
  const preferred = assets.get(names.x64);
  const digest = String(preferred?.digest || '').match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toUpperCase();
  const hashButton = document.querySelector('[data-hash]');
  if (digest && hashButton) {
    hashButton.dataset.hash = digest;
    const code = hashButton.querySelector('code');
    if (code) code.textContent = `${digest.slice(0, 8)}…${digest.slice(-8)}`;
    const virusTotal = document.querySelector('[data-virustotal]');
    if (virusTotal) virusTotal.href = `https://www.virustotal.com/gui/file/${digest.toLowerCase()}`;
  }
}
syncLatestRelease().catch(() => {});
const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add('visible'); observer.unobserve(entry.target); } }), { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));
const toast = document.querySelector('.toast');
document.querySelector('[data-hash]').addEventListener('click', async (event) => { const value = event.currentTarget.dataset.hash; try { await navigator.clipboard.writeText(value); } catch { const field = document.createElement('textarea'); field.value = value; document.body.appendChild(field); field.select(); document.execCommand('copy'); field.remove(); } toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 1800); });
document.querySelector('#year').textContent = new Date().getFullYear();

const preview = document.querySelector('.real-preview');
if (preview) {
  const restingTransform = 'perspective(1100px) rotateX(2deg) rotateY(-5deg) translateY(0)';
  preview.style.transform = restingTransform;
  preview.addEventListener('mousemove', (event) => {
    const bounds = preview.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    preview.style.transform = `perspective(1100px) rotateX(${(-y * 14).toFixed(2)}deg) rotateY(${(x * 18).toFixed(2)}deg) translateY(-7px) scale(1.015)`;
  });
  preview.addEventListener('mouseleave', () => { preview.style.transform = restingTransform; });
}
const downloadSection = document.querySelector('section#download');
document.querySelectorAll('a[href="#download"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    downloadSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
