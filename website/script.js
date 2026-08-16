const RELEASES = {
  universal: 'https://github.com/RealSe62em/Pine-Launcher/releases/download/v1.1.16/PineLauncherSetup.exe',
  x64: 'https://github.com/RealSe62em/Pine-Launcher/releases/download/v1.1.16/PineLauncherSetup-x64.exe',
  arm64: 'https://github.com/RealSe62em/Pine-Launcher/releases/download/v1.1.16/PineLauncherSetup-arm64.exe'
};
document.querySelectorAll('.download-link').forEach((link) => { link.href = RELEASES[link.dataset.build] || RELEASES.universal; });

async function syncLatestRelease() {
  const response = await fetch('https://api.github.com/repos/RealSe62em/Pine-Launcher/releases/latest', {
    headers: { Accept: 'application/vnd.github+json' }
  });
  if (!response.ok) return;
  const release = await response.json();
  const version = String(release.tag_name || '').replace(/^v/i, '');
  if (version) document.querySelectorAll('[data-release-version]').forEach((element) => { element.textContent = version; });

  const assets = new Map((release.assets || []).map((asset) => [asset.name, asset]));
  const names = {
    universal: 'PineLauncherSetup.exe',
    x64: 'PineLauncherSetup-x64.exe',
    arm64: 'PineLauncherSetup-arm64.exe'
  };
  for (const [build, name] of Object.entries(names)) {
    const asset = assets.get(name);
    if (!asset?.browser_download_url) continue;
    RELEASES[build] = asset.browser_download_url;
    document.querySelectorAll(`.download-link[data-build="${build}"]`).forEach((link) => { link.href = asset.browser_download_url; });
  }

  const universal = assets.get(names.universal);
  if (universal?.size) {
    const size = `${Math.round(universal.size / 1024 / 1024)} MB`;
    document.querySelectorAll('[data-release-size]').forEach((element) => { element.textContent = size; });
  }
  const digest = String(universal?.digest || '').match(/^sha256:([a-f0-9]{64})$/i)?.[1]?.toUpperCase();
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
const downloadSection = document.querySelector('#download');
document.querySelectorAll('a[href="#download"]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    downloadSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});
