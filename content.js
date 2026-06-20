/**
 * Content script for Azure TTS Reader.
 * Injects floating button and sidebar, handles text selection and playback.
 */
(() => {
  'use strict';

  // State
  let state = {
    mode: 'read', // 'read' or 'dictation'
    sentences: [],
    audioBlobs: [],   // Blob | null | {error: string}
    currentPlaying: -1,
    isPlayingAll: false,
    sidebarOpen: false,
    settings: {
      voice: 'en-US-JennyNeural',
      style: '',
      styleDegree: 1,
      rate: '1',
      pitch: '+0%'
    },
    followAlongPause: 3, // seconds pause between sentences in follow mode
    dictationRevealed: new Set(),
    pageMasks: []
  };

  let audioElements = [];
  let currentAudio = null;

  // ===== INITIALIZATION =====
  function init() {
    createFAB();
    createSidebar();
    loadSettings();
    listenForSelection();
  }

  // ===== FLOATING ACTION BUTTON =====
  function createFAB() {
    const fab = document.createElement('button');
    fab.id = 'azure-tts-fab';
    fab.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
    fab.title = 'Azure TTS Reader';
    fab.addEventListener('click', handleFABClick);
    document.body.appendChild(fab);
  }

  function handleFABClick() {
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      processText(selectedText);
    } else if (state.sidebarOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  // ===== SELECTION LISTENER =====
  function listenForSelection() {
    document.addEventListener('mouseup', () => {
      const selectedText = window.getSelection().toString().trim();
      const fab = document.getElementById('azure-tts-fab');
      if (fab) {
        if (selectedText) {
          fab.classList.add('active');
        } else {
          fab.classList.remove('active');
        }
      }
    });
  }

  // ===== TEXT PROCESSING =====
  function processText(text) {
    state.sentences = SentenceSplitter.split(text);
    state.audioBlobs = new Array(state.sentences.length).fill(null);
    state.currentPlaying = -1;
    state.isPlayingAll = false;
    state.dictationRevealed = new Set();
    audioElements = new Array(state.sentences.length).fill(null);

    openSidebar();
    renderSentences();
    startSynthesis();
  }

  // ===== SIDEBAR =====
  function createSidebar() {
    const sidebar = document.createElement('div');
    sidebar.id = 'azure-tts-sidebar';
    sidebar.innerHTML = `
      <div class="tts-sidebar-header">
        <h3>Azure TTS Reader</h3>
        <button class="tts-close-btn" id="tts-close">&times;</button>
      </div>
      <div class="tts-mode-tabs">
        <button class="tts-mode-tab active" data-mode="read">Playback</button>
        <button class="tts-mode-tab" data-mode="dictation">Dictation</button>
      </div>
      <div class="tts-settings">
        <div class="tts-setting-row">
          <label>Voice</label>
          <select id="tts-voice-select">
            <option value="en-US-JennyNeural">Jenny (Female, US)</option>
            <option value="en-US-AriaNeural">Aria (Female, US)</option>
            <option value="en-US-GuyNeural">Guy (Male, US)</option>
            <option value="en-US-DavisNeural">Davis (Male, US)</option>
            <option value="en-US-JaneNeural">Jane (Female, US)</option>
            <option value="en-US-JasonNeural">Jason (Male, US)</option>
            <option value="en-GB-SoniaNeural">Sonia (Female, UK)</option>
            <option value="en-AU-NatashaNeural">Natasha (Female, AU)</option>
          </select>
        </div>
        <div class="tts-setting-row">
          <label>Style</label>
          <select id="tts-style-select">
            <option value="">Default</option>
            <option value="chat">Chat</option>
            <option value="narration-professional">Narration Professional</option>
            <option value="narration-relaxed">Narration Relaxed</option>
            <option value="newscast">Newscast</option>
            <option value="newscast-casual">Newscast Casual</option>
            <option value="friendly">Friendly</option>
            <option value="cheerful">Cheerful</option>
            <option value="customerservice">Customer Service</option>
            <option value="excited">Excited</option>
            <option value="sad">Sad</option>
            <option value="angry">Angry</option>
            <option value="whispering">Whispering</option>
            <option value="shouting">Shouting</option>
          </select>
        </div>
        <div class="tts-setting-row">
          <label>Speed</label>
          <div class="tts-speed-btns">
            <button class="tts-speed-btn" data-rate="0.5">0.5x</button>
            <button class="tts-speed-btn" data-rate="0.75">0.75x</button>
            <button class="tts-speed-btn active" data-rate="1">1x</button>
            <button class="tts-speed-btn" data-rate="1.25">1.25x</button>
            <button class="tts-speed-btn" data-rate="1.5">1.5x</button>
            <button class="tts-speed-btn" data-rate="2">2x</button>
          </div>
        </div>
      </div>
      <div class="tts-controls">
        <button class="tts-btn primary" id="tts-play-all">&#9654; Play All</button>
        <button class="tts-btn" id="tts-pause">&#10074;&#10074; Pause</button>
        <button class="tts-btn" id="tts-stop">&#9632; Stop</button>
      </div>
      <div class="tts-dictation-controls" id="tts-dictation-controls">
        <button class="tts-btn" id="tts-reveal-all">Reveal All</button>
        <button class="tts-btn" id="tts-hide-all">Hide All</button>
      </div>
      <div class="tts-follow-settings" id="tts-follow-settings">
        <div class="tts-setting-row">
          <label>Pause</label>
          <select id="tts-follow-pause">
            <option value="2">2s</option>
            <option value="3" selected>3s</option>
            <option value="5">5s</option>
            <option value="0">No pause</option>
          </select>
        </div>
      </div>
      <div class="tts-sentence-list" id="tts-sentence-list"></div>
    `;
    document.body.appendChild(sidebar);

    // Event listeners
    document.getElementById('tts-close').addEventListener('click', closeSidebar);
    document.getElementById('tts-play-all').addEventListener('click', playAll);
    document.getElementById('tts-pause').addEventListener('click', pausePlayback);
    document.getElementById('tts-stop').addEventListener('click', stopPlayback);
    document.getElementById('tts-reveal-all').addEventListener('click', revealAll);
    document.getElementById('tts-hide-all').addEventListener('click', hideAll);

    // Mode tabs
    sidebar.querySelectorAll('.tts-mode-tab').forEach(tab => {
      tab.addEventListener('click', () => switchMode(tab.dataset.mode));
    });

    // Voice select
    document.getElementById('tts-voice-select').addEventListener('change', (e) => {
      state.settings.voice = e.target.value;
      saveSettings();
    });

    // Style select
    document.getElementById('tts-style-select').addEventListener('change', (e) => {
      state.settings.style = e.target.value;
      saveSettings();
    });

    // Speed buttons
    sidebar.querySelectorAll('.tts-speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        sidebar.querySelectorAll('.tts-speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.settings.rate = btn.dataset.rate;
        saveSettings();
      });
    });

    // Follow pause
    document.getElementById('tts-follow-pause').addEventListener('change', (e) => {
      state.followAlongPause = parseInt(e.target.value);
    });
  }

  function openSidebar() {
    const sidebar = document.getElementById('azure-tts-sidebar');
    sidebar.classList.add('open');
    state.sidebarOpen = true;
  }

  function closeSidebar() {
    const sidebar = document.getElementById('azure-tts-sidebar');
    sidebar.classList.remove('open');
    state.sidebarOpen = false;
    stopPlayback();
    removePageMasks();
  }

  function switchMode(mode) {
    state.mode = mode;
    const tabs = document.querySelectorAll('.tts-mode-tab');
    tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));

    const dictControls = document.getElementById('tts-dictation-controls');
    const followSettings = document.getElementById('tts-follow-settings');

    if (mode === 'dictation') {
      dictControls.classList.add('visible');
      followSettings.classList.add('visible');
      applyDictationMode();
    } else {
      dictControls.classList.remove('visible');
      followSettings.classList.remove('visible');
      removePageMasks();
      state.dictationRevealed.clear();
    }
    renderSentences();
  }

  // ===== SENTENCE RENDERING =====
  function renderSentences() {
    const list = document.getElementById('tts-sentence-list');
    if (!list) return;

    list.innerHTML = state.sentences.map((sentence, idx) => {
      const isLoading = state.audioBlobs[idx] === null;
      const hasError = state.audioBlobs[idx] && state.audioBlobs[idx].error;
      const isReady = state.audioBlobs[idx] instanceof Blob;
      const isPlaying = state.currentPlaying === idx;
      const isMasked = state.mode === 'dictation' && !state.dictationRevealed.has(idx);

      let statusClass = '';
      if (isPlaying) statusClass = ' playing';
      if (hasError) statusClass = ' error';

      const textClass = isMasked ? 'tts-sentence-text masked' : 'tts-sentence-text revealed';
      const displayText = escapeHtml(sentence.length > 80 ? sentence.slice(0, 80) + '...' : sentence);

      let actionsHtml = '';
      if (isLoading) {
        actionsHtml = `<div class="tts-loading"><div class="tts-spinner"></div>Loading...</div>`;
      } else if (hasError) {
        actionsHtml = `
          <button class="tts-action-btn" data-action="retry" data-idx="${idx}">Retry</button>
          <span style="color:#d32f2f;font-size:11px">${escapeHtml(state.audioBlobs[idx].error)}</span>
        `;
      } else if (isReady) {
        actionsHtml = `
          <button class="tts-action-btn${isPlaying ? ' playing' : ''}" data-action="play" data-idx="${idx}">
            ${isPlaying ? '&#10074;&#10074;' : '&#9654;'}
          </button>
          <div class="tts-progress-container" data-idx="${idx}">
            <div class="tts-progress-bar" id="tts-progress-${idx}"></div>
          </div>
          <span class="tts-duration" id="tts-duration-${idx}">--</span>
          <button class="tts-action-btn" data-action="copy" data-idx="${idx}" title="Copy text">&#128203;</button>
          <button class="tts-action-btn" data-action="download" data-idx="${idx}" title="Download MP3">&#11015;</button>
          ${state.mode === 'dictation' ? `<button class="tts-action-btn" data-action="toggle-mask" data-idx="${idx}">${isMasked ? '&#128065;' : '&#128584;'}</button>` : ''}
        `;
      }

      return `
        <div class="tts-sentence-card${statusClass}" data-idx="${idx}">
          <div class="tts-sentence-num">${idx + 1}.</div>
          <div class="${textClass}" data-idx="${idx}">${displayText}</div>
          <div class="tts-sentence-actions">${actionsHtml}</div>
        </div>
      `;
    }).join('');

    // Attach event listeners
    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', handleSentenceAction);
    });

    // Click masked text to reveal
    list.querySelectorAll('.tts-sentence-text.masked').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        toggleMask(idx);
      });
    });
  }

  function handleSentenceAction(e) {
    const action = e.currentTarget.dataset.action;
    const idx = parseInt(e.currentTarget.dataset.idx);

    switch (action) {
      case 'play':
        if (state.currentPlaying === idx) {
          pausePlayback();
        } else {
          playSentence(idx);
        }
        break;
      case 'retry':
        retrySentence(idx);
        break;
      case 'copy':
        copySentence(idx);
        break;
      case 'download':
        downloadSentence(idx);
        break;
      case 'toggle-mask':
        toggleMask(idx);
        break;
    }
  }

  // ===== AUDIO PLAYBACK =====
  function playSentence(idx) {
    if (!state.audioBlobs[idx] || !(state.audioBlobs[idx] instanceof Blob)) return;

    stopCurrentAudio();
    state.currentPlaying = idx;

    const blob = state.audioBlobs[idx];
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audioElements[idx] = audio;
    currentAudio = audio;

    audio.addEventListener('timeupdate', () => {
      updateProgress(idx, audio.currentTime, audio.duration);
    });

    audio.addEventListener('loadedmetadata', () => {
      const durationEl = document.getElementById(`tts-duration-${idx}`);
      if (durationEl) {
        durationEl.textContent = formatTime(audio.duration);
      }
    });

    audio.addEventListener('ended', () => {
      state.currentPlaying = -1;
      renderSentences();
      URL.revokeObjectURL(url);

      if (state.isPlayingAll) {
        playNextInSequence(idx);
      }
    });

    audio.play();
    renderSentences();
  }

  function playAll() {
    state.isPlayingAll = true;
    const firstReady = state.audioBlobs.findIndex(b => b instanceof Blob);
    if (firstReady >= 0) {
      playSentence(firstReady);
    }
  }

  function playNextInSequence(currentIdx) {
    if (!state.isPlayingAll) return;

    const nextIdx = state.audioBlobs.findIndex((b, i) => i > currentIdx && b instanceof Blob);
    if (nextIdx >= 0) {
      // In dictation mode with follow-along, add pause
      if (state.mode === 'dictation' && state.followAlongPause > 0) {
        setTimeout(() => {
          // Auto-reveal in dictation mode
          state.dictationRevealed.add(currentIdx);
          revealPageMask(currentIdx);
          renderSentences();

          setTimeout(() => playSentence(nextIdx), 1000);
        }, state.followAlongPause * 1000);
      } else {
        playSentence(nextIdx);
      }
    } else {
      state.isPlayingAll = false;
      renderSentences();
    }
  }

  function pausePlayback() {
    if (currentAudio) {
      if (currentAudio.paused) {
        currentAudio.play();
      } else {
        currentAudio.pause();
      }
    }
  }

  function stopPlayback() {
    state.isPlayingAll = false;
    stopCurrentAudio();
    state.currentPlaying = -1;
    renderSentences();
  }

  function stopCurrentAudio() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
  }

  function updateProgress(idx, currentTime, duration) {
    const progressBar = document.getElementById(`tts-progress-${idx}`);
    const durationEl = document.getElementById(`tts-duration-${idx}`);
    if (progressBar && duration) {
      progressBar.style.width = `${(currentTime / duration) * 100}%`;
    }
    if (durationEl && duration) {
      durationEl.textContent = formatTime(duration - currentTime);
    }
  }

  // ===== SYNTHESIS =====
  function startSynthesis() {
    AzureTTS.batchSynthesize(
      state.sentences,
      state.settings,
      (idx, blob, error) => {
        if (blob) {
          state.audioBlobs[idx] = blob;
        } else {
          state.audioBlobs[idx] = { error: error || 'Unknown error' };
        }
        renderSentences();
      }
    );
  }

  function retrySentence(idx) {
    state.audioBlobs[idx] = null;
    renderSentences();

    AzureTTS.synthesize(state.sentences[idx], state.settings)
      .then(blob => {
        state.audioBlobs[idx] = blob;
        renderSentences();
      })
      .catch(err => {
        state.audioBlobs[idx] = { error: err.message };
        renderSentences();
      });
  }

  // ===== COPY & DOWNLOAD =====
  function copySentence(idx) {
    const text = state.sentences[idx];
    navigator.clipboard.writeText(text).then(() => {
      showTooltip('Copied!');
    });
  }

  function downloadSentence(idx) {
    const blob = state.audioBlobs[idx];
    if (!(blob instanceof Blob)) return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sentence-${idx + 1}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function showTooltip(text) {
    const tooltip = document.createElement('div');
    tooltip.className = 'tts-copied-tooltip';
    tooltip.textContent = text;
    tooltip.style.position = 'fixed';
    tooltip.style.top = '20px';
    tooltip.style.right = '380px';
    tooltip.style.zIndex = '2147483642';
    document.body.appendChild(tooltip);
    setTimeout(() => tooltip.remove(), 1000);
  }

  // ===== DICTATION MODE =====
  function applyDictationMode() {
    state.dictationRevealed.clear();
    renderSentences();
    // Page masks are optional — user can use sidebar masks
  }

  function toggleMask(idx) {
    if (state.dictationRevealed.has(idx)) {
      state.dictationRevealed.delete(idx);
      hidePageMask(idx);
    } else {
      state.dictationRevealed.add(idx);
      revealPageMask(idx);
    }
    renderSentences();
  }

  function revealAll() {
    state.sentences.forEach((_, idx) => state.dictationRevealed.add(idx));
    state.pageMasks.forEach((mask) => {
      if (mask) mask.classList.add('revealed');
    });
    renderSentences();
  }

  function hideAll() {
    state.dictationRevealed.clear();
    state.pageMasks.forEach((mask) => {
      if (mask) mask.classList.remove('revealed');
    });
    renderSentences();
  }

  function revealPageMask(idx) {
    if (state.pageMasks[idx]) {
      state.pageMasks[idx].classList.add('revealed');
    }
  }

  function hidePageMask(idx) {
    if (state.pageMasks[idx]) {
      state.pageMasks[idx].classList.remove('revealed');
    }
  }

  function removePageMasks() {
    state.pageMasks.forEach(mask => {
      if (mask && mask.parentNode) {
        const text = mask.textContent;
        mask.parentNode.replaceChild(document.createTextNode(text), mask);
      }
    });
    state.pageMasks = [];
  }

  // ===== SETTINGS =====
  function loadSettings() {
    browser.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
      if (response && !response.error) {
        state.settings = { ...state.settings, ...response };
        applySettingsToUI();
      }
    });
  }

  function saveSettings() {
    browser.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      settings: state.settings
    });
  }

  function applySettingsToUI() {
    const voiceSelect = document.getElementById('tts-voice-select');
    const styleSelect = document.getElementById('tts-style-select');
    if (voiceSelect) voiceSelect.value = state.settings.voice;
    if (styleSelect) styleSelect.value = state.settings.style || '';

    document.querySelectorAll('.tts-speed-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.rate === state.settings.rate);
    });
  }

  // ===== UTILITIES =====
  function formatTime(seconds) {
    if (!seconds || isNaN(seconds)) return '--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ===== START =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
