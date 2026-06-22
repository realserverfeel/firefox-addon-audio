/**
 * Popup script for Azure TTS Reader settings.
 */
document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('api-key');
  const regionSelect = document.getElementById('region');
  const outputFormatSelect = document.getElementById('output-format');
  const saveBtn = document.getElementById('save-btn');
  const testBtn = document.getElementById('test-btn');
  const toggleKeyBtn = document.getElementById('toggle-key');
  const statusEl = document.getElementById('status');
  const addonToggle = document.getElementById('addon-toggle');
  const toggleStatusEl = document.getElementById('toggle-status');

  // Load addon enabled state
  browser.storage.local.get('addonEnabled', (result) => {
    const enabled = result.addonEnabled !== false; // default true
    addonToggle.checked = enabled;
    toggleStatusEl.textContent = enabled ? 'Enabled' : 'Disabled';
  });

  // Toggle addon on/off
  addonToggle.addEventListener('change', () => {
    const enabled = addonToggle.checked;
    toggleStatusEl.textContent = enabled ? 'Enabled' : 'Disabled';
    browser.storage.local.set({ addonEnabled: enabled });
    // Notify all tabs
    browser.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        browser.tabs.sendMessage(tab.id, { type: 'ADDON_TOGGLE', enabled }).catch(() => {});
      }
    });
  });

  // Load saved settings
  browser.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
    if (response && !response.error) {
      apiKeyInput.value = response.apiKey || '';
      regionSelect.value = response.region || 'eastus';
      outputFormatSelect.value = response.outputFormat || 'audio-16khz-128kbitrate-mono-mp3';
    }
  });

  // Toggle API key visibility
  toggleKeyBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleKeyBtn.textContent = 'Hide';
    } else {
      apiKeyInput.type = 'password';
      toggleKeyBtn.textContent = 'Show';
    }
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    const settings = {
      apiKey: apiKeyInput.value.trim(),
      region: regionSelect.value,
      outputFormat: outputFormatSelect.value
    };

    if (!settings.apiKey) {
      showStatus('Please enter your API Key', 'error');
      return;
    }

    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }, (current) => {
      const merged = { ...current, ...settings };
      browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: merged }, (response) => {
        if (response && response.success) {
          showStatus('Settings saved successfully!', 'success');
        } else {
          showStatus('Failed to save settings', 'error');
        }
      });
    });
  });

  // Test connection
  testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    const region = regionSelect.value;

    if (!apiKey) {
      showStatus('Please enter your API Key first', 'error');
      return;
    }

    testBtn.textContent = 'Testing...';
    testBtn.disabled = true;

    try {
      const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;
      const response = await fetch(url, {
        headers: {
          'Ocp-Apim-Subscription-Key': apiKey
        }
      });

      if (response.ok) {
        const voices = await response.json();
        showStatus(`Connection successful! ${voices.length} voices available.`, 'success');
      } else {
        showStatus(`Connection failed (${response.status}). Check your API Key and Region.`, 'error');
      }
    } catch (err) {
      showStatus(`Network error: ${err.message}`, 'error');
    }

    testBtn.textContent = 'Test Connection';
    testBtn.disabled = false;
  });

  function showStatus(message, type) {
    statusEl.textContent = message;
    statusEl.className = 'status ' + type;
    setTimeout(() => {
      statusEl.className = 'status';
    }, 5000);
  }
});
