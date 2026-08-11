const RELEASES = { universal: '../dist-native/PineLauncherSetup.exe', x64: '../dist-native/PineLauncherSetup-x64.exe', arm64: '../dist-native/PineLauncherSetup-arm64.exe' };
document.querySelectorAll('.download-link').forEach((link) => { link.href = RELEASES[link.dataset.build] || RELEASES.universal; });
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
