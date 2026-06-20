/**
 * Background script for Azure TTS Reader.
 * Proxies TTS API requests and manages settings.
 */

// Handle messages from content script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TTS_SYNTHESIZE') {
    handleSynthesize(message.text, message.options)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // Keep message channel open for async response
  }

  if (message.type === 'TTS_GET_VOICES') {
    handleGetVoices()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'GET_SETTINGS') {
    getSettings()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'SAVE_SETTINGS') {
    saveSettings(message.settings)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

/**
 * Synthesize text to speech using Azure TTS API.
 */
async function handleSynthesize(text, options = {}) {
  const settings = await getSettings();
  if (!settings.apiKey || !settings.region) {
    return { error: 'API Key and Region are required. Please configure in extension settings.' };
  }

  const voice = options.voice || settings.voice || 'en-US-JennyNeural';
  const style = options.style || settings.style || '';
  const styleDegree = options.styleDegree || settings.styleDegree || 1;
  const rate = options.rate || settings.rate || '1';
  const pitch = options.pitch || settings.pitch || '+0%';
  const outputFormat = settings.outputFormat || 'audio-16khz-128kbitrate-mono-mp3';

  // Build SSML
  const ssml = buildSSML(text, { voice, style, styleDegree, rate, pitch });

  const url = `https://${settings.region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': settings.apiKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': outputFormat,
        'User-Agent': 'AzureTTSReaderFirefoxAddon'
      },
      body: ssml
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { error: `Azure API error (${response.status}): ${errorText}` };
    }

    const arrayBuffer = await response.arrayBuffer();
    // Convert to base64 for messaging
    const base64 = arrayBufferToBase64(arrayBuffer);
    return { audio: base64 };
  } catch (err) {
    return { error: `Network error: ${err.message}` };
  }
}

/**
 * Build SSML markup for Azure TTS.
 */
function buildSSML(text, options) {
  const { voice, style, styleDegree, rate, pitch } = options;
  const lang = voice.split('-').slice(0, 2).join('-'); // e.g., 'en-US'

  let content = escapeXml(text);

  // Wrap with prosody if rate or pitch specified
  if (rate !== '1' || pitch !== '+0%') {
    const rateStr = rate === '1' ? 'medium' : `${(parseFloat(rate) * 100).toFixed(0)}%`;
    content = `<prosody rate="${rateStr}" pitch="${pitch}">${content}</prosody>`;
  }

  // Wrap with style if specified
  if (style && style !== 'default' && style !== '') {
    content = `<mstts:express-as style="${style}" styledegree="${styleDegree}">${content}</mstts:express-as>`;
  }

  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${lang}">
  <voice name="${voice}">
    ${content}
  </voice>
</speak>`;
}

/**
 * Fetch available voices from Azure.
 */
async function handleGetVoices() {
  const settings = await getSettings();
  if (!settings.apiKey || !settings.region) {
    return { error: 'API Key and Region are required.' };
  }

  const url = `https://${settings.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`;

  try {
    const response = await fetch(url, {
      headers: {
        'Ocp-Apim-Subscription-Key': settings.apiKey
      }
    });

    if (!response.ok) {
      return { error: `Failed to fetch voices (${response.status})` };
    }

    const voices = await response.json();
    return { voices };
  } catch (err) {
    return { error: `Network error: ${err.message}` };
  }
}

/**
 * Get settings from browser storage.
 */
async function getSettings() {
  const result = await browser.storage.local.get('ttsSettings');
  return result.ttsSettings || {
    apiKey: '',
    region: 'eastus',
    voice: 'en-US-JennyNeural',
    style: '',
    styleDegree: 1,
    rate: '1',
    pitch: '+0%',
    outputFormat: 'audio-16khz-128kbitrate-mono-mp3'
  };
}

/**
 * Save settings to browser storage.
 */
async function saveSettings(settings) {
  await browser.storage.local.set({ ttsSettings: settings });
}

/**
 * Convert ArrayBuffer to base64 string.
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Escape XML special characters.
 */
function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
