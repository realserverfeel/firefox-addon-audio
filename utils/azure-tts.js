/**
 * Azure TTS API wrapper.
 * Handles communication with the background script for TTS requests.
 */
const AzureTTS = (() => {
  const MAX_CONCURRENCY = 5;

  /**
   * Generate speech for a single sentence.
   * Sends request to background script which proxies to Azure API.
   * @param {string} text - Text to synthesize.
   * @param {object} options - TTS options.
   * @param {string} options.voice - Voice name (e.g., 'en-US-JennyNeural').
   * @param {string} options.style - Style (e.g., 'cheerful', 'narration-professional').
   * @param {number} options.styleDegree - Style intensity (0.01-2).
   * @param {string} options.rate - Speech rate (e.g., '1', '0.8', '1.5').
   * @param {string} options.pitch - Pitch adjustment (e.g., '+0%', '+10%').
   * @returns {Promise<Blob>} Audio blob.
   */
  async function synthesize(text, options = {}) {
    return new Promise((resolve, reject) => {
      browser.runtime.sendMessage({
        type: 'TTS_SYNTHESIZE',
        text,
        options
      }, (response) => {
        if (response && response.error) {
          reject(new Error(response.error));
        } else if (response && response.audio) {
          // Convert base64 to blob
          const byteChars = atob(response.audio);
          const byteNumbers = new Array(byteChars.length);
          for (let i = 0; i < byteChars.length; i++) {
            byteNumbers[i] = byteChars.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'audio/mpeg' });
          resolve(blob);
        } else {
          reject(new Error('No response from background script'));
        }
      });
    });
  }

  /**
   * Batch synthesize multiple sentences with concurrency control.
   * @param {string[]} sentences - Array of sentences.
   * @param {object} options - TTS options.
   * @param {function} onProgress - Callback(index, blob) called when each sentence completes.
   * @returns {Promise<Blob[]>} Array of audio blobs.
   */
  async function batchSynthesize(sentences, options = {}, onProgress = null) {
    const results = new Array(sentences.length).fill(null);
    let nextIndex = 0;
    const inFlight = new Set();

    return new Promise((resolve, reject) => {
      function launchNext() {
        while (inFlight.size < MAX_CONCURRENCY && nextIndex < sentences.length) {
          const idx = nextIndex++;
          const promise = synthesize(sentences[idx], options)
            .then((blob) => {
              results[idx] = blob;
              inFlight.delete(promise);
              if (onProgress) onProgress(idx, blob);
              launchNext();
            })
            .catch((err) => {
              results[idx] = { error: err.message };
              inFlight.delete(promise);
              if (onProgress) onProgress(idx, null, err.message);
              launchNext();
            });
          inFlight.add(promise);
        }

        if (inFlight.size === 0 && nextIndex >= sentences.length) {
          resolve(results);
        }
      }

      launchNext();
    });
  }

  /**
   * Fetch available voices from Azure.
   * @returns {Promise<object[]>} Array of voice objects.
   */
  async function getVoices() {
    return new Promise((resolve, reject) => {
      browser.runtime.sendMessage({ type: 'TTS_GET_VOICES' }, (response) => {
        if (response && response.error) {
          reject(new Error(response.error));
        } else if (response && response.voices) {
          resolve(response.voices);
        } else {
          reject(new Error('No response'));
        }
      });
    });
  }

  return { synthesize, batchSynthesize, getVoices, MAX_CONCURRENCY };
})();

if (typeof window !== 'undefined') {
  window.AzureTTS = AzureTTS;
}
