export function bindAccessibleLayers({ closeMainModal, cancelEditSheet }) {
  const layerFocus = new WeakMap();

  function layerIsOpen(layer) {
    return layer?.matches('.modal-root.visible:not([hidden]), .sheet-root.visible:not([hidden])');
  }

  function focusableIn(layer) {
    return [...layer.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.getClientRects().length > 0 && !element.hidden);
  }

  function prepareLayer(layer) {
    if (!layerIsOpen(layer) || layerFocus.get(layer)?.active) return;
    const panel = layer.querySelector('.modal, .sheet');
    if (panel) {
      if (!panel.hasAttribute('role')) panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      const title = panel.querySelector('.modal-title, .sheet-title');
      if (title && !panel.hasAttribute('aria-labelledby')) {
        if (!title.id) title.id = `pine-dialog-title-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        panel.setAttribute('aria-labelledby', title.id);
      }
    }
    layer.querySelectorAll('.modal-close:not([aria-label])')
      .forEach(button => button.setAttribute('aria-label', 'Close dialog'));
    layerFocus.set(layer, { active: true, previous: document.activeElement });
    requestAnimationFrame(() => {
      const preferred = layer.querySelector('[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), .btn-primary:not([disabled]), .modal-close:not([disabled])');
      preferred?.focus?.();
    });
  }

  function releaseLayer(layer) {
    const state = layerFocus.get(layer);
    if (!state?.active) return;
    layerFocus.set(layer, { ...state, active: false });
    if (state.previous?.isConnected) requestAnimationFrame(() => state.previous.focus?.());
  }

  function topOpenLayer() {
    return [...document.querySelectorAll('.modal-root.visible:not([hidden]), .sheet-root.visible:not([hidden])')]
      .sort((a, b) => (Number.parseInt(getComputedStyle(a).zIndex, 10) || 0) - (Number.parseInt(getComputedStyle(b).zIndex, 10) || 0)).at(-1);
  }

  function closeLayer(layer) {
    if (!layer) return;
    if (layer.id === 'modal-overlay') return closeMainModal();
    if (layer.id === 'edit-sheet-root') return cancelEditSheet();
    const close = layer.querySelector('[data-close], [data-cancel], #confirm-cancel, .modal-close');
    if (close) close.click();
  }

  document.querySelectorAll('.modal-root, .sheet-root').forEach(prepareLayer);
  const observer = new MutationObserver(records => {
    records.forEach(record => {
      if (record.type === 'attributes') {
        if (layerIsOpen(record.target)) prepareLayer(record.target);
        else releaseLayer(record.target);
      }
      record.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('.modal-root, .sheet-root')) prepareLayer(node);
        node.querySelectorAll?.('.modal-root, .sheet-root').forEach(prepareLayer);
      });
      record.removedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('.modal-root, .sheet-root')) releaseLayer(node);
        node.querySelectorAll?.('.modal-root, .sheet-root').forEach(releaseLayer);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });

  document.addEventListener('keydown', event => {
    const layer = topOpenLayer();
    if (!layer) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeLayer(layer);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableIn(layer);
    if (!focusable.length) return event.preventDefault();
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }, true);
}
