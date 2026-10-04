function setWindowMaximized(maximized) {
  const button = document.querySelector('[data-window-action="maximize"]');
  if (!button) return;
  button.dataset.maximized = String(Boolean(maximized));
  button.setAttribute('aria-label', maximized ? 'Restore window' : 'Maximize');
  button.title = maximized ? 'Restore window' : 'Maximize';
}

export function bindWindowChrome(api) {
  document.querySelectorAll('[data-window-action]').forEach(button => {
    button.addEventListener('click', async () => {
      try {
        const result = await api.windowControl(button.dataset.windowAction);
        if (button.dataset.windowAction === 'maximize') setWindowMaximized(result?.maximized);
      } catch (error) {
        console.error('Window control failed:', error);
      }
    });
  });
  api.onWindowMaximizedChanged?.(setWindowMaximized);
}
