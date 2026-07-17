/**
 * Options page for Azure TTS Reader.
 * Currently exposes the floating-button placement (left / right edge).
 */
document.addEventListener('DOMContentLoaded', () => {
  const sideToggle = document.getElementById('side-toggle');
  const sideStatusEl = document.getElementById('side-status');

  function describe(onLeft) {
    return onLeft
      ? 'On \u2014 button is on the left edge'
      : 'Off \u2014 button is on the right edge';
  }

  // Load current placement (default: right)
  browser.storage.local.get(['buttonSide'], (result) => {
    const onLeft = result.buttonSide === 'left';
    sideToggle.checked = onLeft;
    sideStatusEl.textContent = describe(onLeft);
  });

  sideToggle.addEventListener('change', () => {
    const onLeft = sideToggle.checked;
    const side = onLeft ? 'left' : 'right';
    sideStatusEl.textContent = describe(onLeft);
    browser.storage.local.set({ buttonSide: side });
    // Notify all open tabs so the button moves immediately
    browser.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        browser.tabs.sendMessage(tab.id, { type: 'BUTTON_SIDE', side }).catch(() => {});
      }
    });
  });
});
