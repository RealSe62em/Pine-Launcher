export function memoryRangeMarkup(prefix, minValue, maxValue, systemMemoryGb) {
  const currentMin = Math.min(128, Math.max(1, Number(minValue) || 1));
  const currentMax = Math.min(128, Math.max(currentMin, Number(maxValue) || currentMin));
  const limit = Math.min(128, Math.max(8, Number(systemMemoryGb) || 16, currentMax));
  const position = value => ((value - 1) / Math.max(1, limit - 1)) * 100;
  return `<div class="settings-row settings-row-col memory-range-row"><label>Memory allocation</label><div class="memory-range-control" data-memory-range="${prefix}" style="--memory-min:${position(currentMin)};--memory-max:${position(currentMax)}">
    <div class="memory-range-labels" aria-hidden="true"><output class="memory-handle-label memory-min-label" data-memory-min-label><b>Min</b><span>${currentMin} GB</span></output><output class="memory-handle-label memory-max-label" data-memory-max-label><b>Max</b><span>${currentMax} GB</span></output></div>
    <div class="memory-range-track" aria-hidden="true"><i></i></div>
    <input id="${prefix}-min-mem" class="memory-range-input memory-range-input-min" type="range" min="1" max="${limit}" step="1" value="${currentMin}" aria-label="Minimum Java memory in gigabytes">
    <input id="${prefix}-max-mem" class="memory-range-input memory-range-input-max" type="range" min="1" max="${limit}" step="1" value="${currentMax}" aria-label="Maximum Java memory in gigabytes">
    <div class="memory-range-scale" aria-hidden="true"><span>1 GB</span><span>${limit} GB${limit === systemMemoryGb ? ' installed' : ''}</span></div>
  </div></div>`;
}

export function bindMemoryRange(prefix) {
  const control = document.querySelector(`[data-memory-range="${prefix}"]`);
  const minInput = document.getElementById(`${prefix}-min-mem`);
  const maxInput = document.getElementById(`${prefix}-max-mem`);
  if (!control || !minInput || !maxInput) return;
  const sync = changed => {
    let min = Number(minInput.value);
    let max = Number(maxInput.value);
    if (min > max) {
      if (changed === minInput) { max = min; maxInput.value = String(max); }
      else { min = max; minInput.value = String(min); }
    }
    const limit = Number(minInput.max) || 128;
    const position = value => ((value - 1) / Math.max(1, limit - 1)) * 100;
    control.style.setProperty('--memory-min', String(position(min)));
    control.style.setProperty('--memory-max', String(position(max)));
    control.classList.toggle('handles-close', Math.abs(position(max) - position(min)) < 18);
    const minLabel = control.querySelector('[data-memory-min-label] span');
    const maxLabel = control.querySelector('[data-memory-max-label] span');
    if (minLabel) minLabel.textContent = `${min} GB`;
    if (maxLabel) maxLabel.textContent = `${max} GB`;
  };
  minInput.addEventListener('input', () => sync(minInput));
  maxInput.addEventListener('input', () => sync(maxInput));
  minInput.addEventListener('pointerdown', () => control.classList.add('dragging-min'));
  maxInput.addEventListener('pointerdown', () => control.classList.add('dragging-max'));
  for (const input of [minInput, maxInput]) input.addEventListener('pointerup', () => control.classList.remove('dragging-min', 'dragging-max'));
  sync();
}
