/**
 * Content script for Azure TTS Reader.
 * Injects floating button and sidebar, handles text selection and playback.
 */
(() => {
  'use strict';

  // State
  let state = {
    mode: 'read',
    sentences: [],
    audioBlobs: [],
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
    followAlongPause: 3,
    dictationRevealed: new Set(),
    overlayMasks: [],     // Array of overlay divs positioned over sentences
    selectionRange: null,
    voices: [],
    voicesLoaded: false
  };

  let audioElements = [];
  let currentAudio = null;

  // ===== INITIALIZATION =====
  function init() {
    createFAB();
    createSidebar();
    loadSettings();
    listenForSelection();
    loadVoices();
    listenForClickOutside();
  }

  // ===== FLOATING ACTION BUTTON =====
  function createFAB() {
    const fab = document.createElement('button');
    fab.id = 'azure-tts-fab';
    fab.innerHTML = `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
    fab.title = 'Azure TTS Reader';
    // Prevent mousedown from clearing the text selection
    fab.addEventListener('mousedown', (e) => e.preventDefault());
    fab.addEventListener('click', handleFABClick);
    document.body.appendChild(fab);
  }

  function handleFABClick() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (selectedText) {
      if (selection.rangeCount > 0) {
        state.selectionRange = selection.getRangeAt(0).cloneRange();
      }
      processText(selectedText);
    } else if (state.sidebarOpen) {
      closeSidebar();
    } else {
      openSidebar();
    }
  }

  // ===== CLICK OUTSIDE TO HIDE SIDEBAR =====
  function listenForClickOutside() {
    document.addEventListener('click', (e) => {
      if (!state.sidebarOpen) return;
      const sidebar = document.getElementById('azure-tts-sidebar');
      const fab = document.getElementById('azure-tts-fab');
      const container = document.getElementById('tts-overlay-container');
      const pane = document.querySelector('.tts-overlay-pane');
      if (sidebar && sidebar.contains(e.target)) return;
      if (fab && fab.contains(e.target)) return;
      if (container && container.contains(e.target)) return;
      if (pane && pane.contains(e.target)) return;
      closeSidebar();
    }, true);
  }

  // ===== SELECTION LISTENER =====
  function listenForSelection() {
    document.addEventListener('mouseup', () => {
      const selectedText = window.getSelection().toString().trim();
      const fab = document.getElementById('azure-tts-fab');
      if (fab) {
        fab.classList.toggle('active', !!selectedText);
      }
    });
  }

  // ===== TEXT PROCESSING =====
  function processText(text) {
    stopPlayback();
    removePageMasks();
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

  // ===== DYNAMIC VOICE LOADING =====
  function loadVoices() {
    AzureTTS.getVoices()
      .then(voices => {
        state.voices = voices;
        state.voicesLoaded = true;
        populateVoiceSearch();
      })
      .catch(() => {
        state.voicesLoaded = false;
      });
  }

  function populateVoiceSearch() {
    const container = document.getElementById('tts-voice-search-container');
    if (!container || !state.voices.length) return;
    // Voice search is already initialized, just update data
    renderVoiceDropdown('');
  }

  function renderVoiceDropdown(filter) {
    const list = document.getElementById('tts-voice-dropdown-list');
    if (!list) return;

    const filterLower = filter.toLowerCase();
    let voices = state.voices;

    if (filterLower) {
      voices = voices.filter(v => {
        const name = (v.DisplayName || v.LocalName || v.ShortName || '').toLowerCase();
        const locale = (v.Locale || '').toLowerCase();
        const gender = (v.Gender || '').toLowerCase();
        return name.includes(filterLower) || locale.includes(filterLower) || gender.includes(filterLower);
      });
    } else {
      // Show only English voices by default to reduce clutter
      voices = voices.filter(v => (v.Locale || '').startsWith('en-'));
    }

    // Sort: current selection first, then alphabetical
    voices.sort((a, b) => {
      const aName = a.ShortName || '';
      const bName = b.ShortName || '';
      if (aName === state.settings.voice) return -1;
      if (bName === state.settings.voice) return 1;
      return (a.DisplayName || aName).localeCompare(b.DisplayName || bName);
    });

    // Limit to 50 for performance
    const shown = voices.slice(0, 50);

    list.innerHTML = shown.map(v => {
      const name = v.DisplayName || v.LocalName || v.ShortName || '';
      const gender = v.Gender || '';
      const locale = v.Locale || '';
      const shortName = v.ShortName || '';
      const isSelected = shortName === state.settings.voice;
      return `<div class="tts-voice-option${isSelected ? ' selected' : ''}" data-voice="${escapeHtml(shortName)}">
        <span class="tts-voice-name">${escapeHtml(name)}</span>
        <span class="tts-voice-meta">${escapeHtml(gender)} &middot; ${escapeHtml(locale)}</span>
      </div>`;
    }).join('');

    if (shown.length === 0) {
      list.innerHTML = '<div class="tts-voice-empty">No voices found</div>';
    }

    // Click handlers
    list.querySelectorAll('.tts-voice-option').forEach(el => {
      el.addEventListener('click', () => {
        state.settings.voice = el.dataset.voice;
        saveSettings();
        // Update display
        const input = document.getElementById('tts-voice-search-input');
        if (input) input.value = el.querySelector('.tts-voice-name').textContent;
        closeVoiceDropdown();
      });
    });
  }

  let voiceHighlightIdx = -1;

  function openVoiceDropdown() {
    const dropdown = document.getElementById('tts-voice-dropdown');
    if (dropdown) {
      dropdown.classList.add('open');
      voiceHighlightIdx = -1;
      renderVoiceDropdown(document.getElementById('tts-voice-search-input').value);
    }
  }

  function closeVoiceDropdown() {
    const dropdown = document.getElementById('tts-voice-dropdown');
    if (dropdown) dropdown.classList.remove('open');
    voiceHighlightIdx = -1;
  }

  function handleVoiceKeydown(e) {
    const dropdown = document.getElementById('tts-voice-dropdown');
    if (!dropdown || !dropdown.classList.contains('open')) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        openVoiceDropdown();
        e.preventDefault();
      }
      return;
    }

    const options = dropdown.querySelectorAll('.tts-voice-option');
    if (!options.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      voiceHighlightIdx = Math.min(voiceHighlightIdx + 1, options.length - 1);
      updateVoiceHighlight(options);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      voiceHighlightIdx = Math.max(voiceHighlightIdx - 1, 0);
      updateVoiceHighlight(options);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (voiceHighlightIdx >= 0 && voiceHighlightIdx < options.length) {
        options[voiceHighlightIdx].click();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeVoiceDropdown();
    }
  }

  function updateVoiceHighlight(options) {
    options.forEach((opt, i) => {
      opt.classList.toggle('highlighted', i === voiceHighlightIdx);
    });
    if (voiceHighlightIdx >= 0 && options[voiceHighlightIdx]) {
      options[voiceHighlightIdx].scrollIntoView({ block: 'nearest' });
    }
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
          <div class="tts-voice-search-container" id="tts-voice-search-container">
            <input type="text" id="tts-voice-search-input" placeholder="Search voices..." autocomplete="off">
            <div class="tts-voice-dropdown" id="tts-voice-dropdown">
              <div class="tts-voice-dropdown-list" id="tts-voice-dropdown-list"></div>
            </div>
          </div>
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
        <button class="tts-btn" id="tts-regenerate" title="Regenerate with current settings">&#8635; Regen</button>
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
    document.getElementById('tts-regenerate').addEventListener('click', regenerateAll);

    // Voice search input
    const voiceInput = document.getElementById('tts-voice-search-input');
    voiceInput.addEventListener('focus', openVoiceDropdown);
    voiceInput.addEventListener('input', (e) => {
      voiceHighlightIdx = -1;
      openVoiceDropdown();
      renderVoiceDropdown(e.target.value);
    });
    voiceInput.addEventListener('keydown', handleVoiceKeydown);
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      const container = document.getElementById('tts-voice-search-container');
      if (container && !container.contains(e.target)) {
        closeVoiceDropdown();
      }
    });

    // Mode tabs
    sidebar.querySelectorAll('.tts-mode-tab').forEach(tab => {
      tab.addEventListener('click', () => switchMode(tab.dataset.mode));
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

  // ===== REGENERATE =====
  function regenerateAll() {
    if (!state.sentences.length) return;
    stopPlayback();
    state.audioBlobs = new Array(state.sentences.length).fill(null);
    audioElements = new Array(state.sentences.length).fill(null);
    renderSentences();
    startSynthesis();
    showTooltip('Regenerating...');
  }

  // ===== SENTENCE RENDERING (full text, no truncation) =====
  function renderSentences() {
    const list = document.getElementById('tts-sentence-list');
    if (!list) return;

    list.innerHTML = state.sentences.map((sentence, idx) => {
      const isLoading = state.audioBlobs[idx] === null;
      const hasError = state.audioBlobs[idx] && state.audioBlobs[idx].error;
      const isReady = state.audioBlobs[idx] instanceof Blob;
      const isPlaying = state.currentPlaying === idx && currentAudio && !currentAudio.paused;
      const isPaused = state.currentPlaying === idx && currentAudio && currentAudio.paused;
      const isActive = isPlaying || isPaused;
      const isMasked = state.mode === 'dictation' && !state.dictationRevealed.has(idx);

      let statusClass = '';
      if (isActive) statusClass = ' playing';
      if (hasError) statusClass = ' error';

      const textClass = isMasked ? 'tts-sentence-text masked' : 'tts-sentence-text';

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
          <div class="tts-playback-row">
            <button class="tts-action-btn${isActive ? ' playing' : ''}" data-action="play" data-idx="${idx}">
              ${isPlaying ? '&#10074;&#10074;' : '&#9654;'}
            </button>
            <button class="tts-action-btn" data-action="replay" data-idx="${idx}" title="Replay from start">&#8634;</button>
            <div class="tts-progress-container" data-idx="${idx}">
              <div class="tts-progress-bar" id="tts-progress-${idx}"></div>
            </div>
            <span class="tts-duration" id="tts-duration-${idx}">--</span>
          </div>
          <div class="tts-tools-row">
            <button class="tts-action-btn" data-action="copy" data-idx="${idx}" title="Copy text">&#128203; Copy</button>
            <button class="tts-action-btn" data-action="download" data-idx="${idx}" title="Download MP3">&#11015; MP3</button>
            ${state.mode === 'dictation' ? `<button class="tts-action-btn" data-action="toggle-mask" data-idx="${idx}">${isMasked ? '&#128065; Show' : '&#128584; Hide'}</button>` : ''}
          </div>
        `;
      }

      return `
        <div class="tts-sentence-card${statusClass}" data-idx="${idx}">
          <div class="tts-sentence-num">${idx + 1}.</div>
          <div class="${textClass}" data-idx="${idx}">${escapeHtml(sentence)}</div>
          <div class="tts-sentence-actions">${actionsHtml}</div>
        </div>
      `;
    }).join('');

    // Attach event listeners
    list.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', handleSentenceAction);
    });

    // Progress bar seek (click to seek)
    list.querySelectorAll('.tts-progress-container').forEach(bar => {
      bar.addEventListener('click', (e) => {
        const idx = parseInt(bar.dataset.idx);
        seekAudio(idx, e, bar);
      });
    });

    // Click masked text to reveal in sidebar
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
        if (state.currentPlaying === idx && currentAudio) {
          pausePlayback();
        } else {
          playSentence(idx);
        }
        break;
      case 'replay':
        playSentence(idx);
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
      if (durationEl) durationEl.textContent = formatTime(audio.duration);
    });

    audio.addEventListener('ended', () => {
      state.currentPlaying = -1;
      renderSentences();
      URL.revokeObjectURL(url);
      if (state.isPlayingAll) playNextInSequence(idx);
    });

    // Highlight overlay mask
    highlightOverlayMask(idx);

    audio.play();
    renderSentences();
  }

  function seekAudio(idx, event, bar) {
    const audio = audioElements[idx];
    if (!audio || !audio.duration) return;
    const rect = bar.getBoundingClientRect();
    const clickX = event.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    audio.currentTime = ratio * audio.duration;
  }

  function playAll() {
    state.isPlayingAll = true;
    const firstReady = state.audioBlobs.findIndex(b => b instanceof Blob);
    if (firstReady >= 0) playSentence(firstReady);
  }

  function playNextInSequence(currentIdx) {
    if (!state.isPlayingAll) return;

    const nextIdx = state.audioBlobs.findIndex((b, i) => i > currentIdx && b instanceof Blob);
    if (nextIdx >= 0) {
      if (state.mode === 'dictation' && state.followAlongPause > 0) {
        setTimeout(() => {
          state.dictationRevealed.add(currentIdx);
          revealOverlayMask(currentIdx);
          renderSentences();
          setTimeout(() => playSentence(nextIdx), 1000);
        }, state.followAlongPause * 1000);
      } else {
        playSentence(nextIdx);
      }
    } else {
      state.isPlayingAll = false;
      if (state.mode === 'dictation') {
        state.dictationRevealed.add(currentIdx);
        revealOverlayMask(currentIdx);
      }
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
      // Update only the play button icon without re-rendering the whole list
      const idx = state.currentPlaying;
      const btn = document.querySelector(`[data-action="play"][data-idx="${idx}"]`);
      if (btn) {
        btn.innerHTML = currentAudio.paused ? '&#9654;' : '&#10074;&#10074;';
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

  // Strip footnote markers [N] from text for TTS (don't read them aloud)
  function stripFootnotes(text) {
    return text.replace(/\[\d+\]/g, '').replace(/\s{2,}/g, ' ').trim();
  }

  // ===== SYNTHESIS =====
  function startSynthesis() {
    const cleanedSentences = state.sentences.map(s => stripFootnotes(s));
    AzureTTS.batchSynthesize(
      cleanedSentences,
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
    AzureTTS.synthesize(stripFootnotes(state.sentences[idx]), state.settings)
      .then(blob => { state.audioBlobs[idx] = blob; renderSentences(); })
      .catch(err => { state.audioBlobs[idx] = { error: err.message }; renderSentences(); });
  }

  // ===== COPY & DOWNLOAD =====
  function copySentence(idx) {
    navigator.clipboard.writeText(state.sentences[idx]).then(() => showTooltip('Copied!'));
  }

  function downloadSentence(idx) {
    const blob = state.audioBlobs[idx];
    if (!(blob instanceof Blob)) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Filename: tts-YYYYMMDD-HHmmss-NN.mp3
    const now = new Date();
    const ts = now.getFullYear().toString()
      + String(now.getMonth() + 1).padStart(2, '0')
      + String(now.getDate()).padStart(2, '0')
      + '-' + String(now.getHours()).padStart(2, '0')
      + String(now.getMinutes()).padStart(2, '0')
      + String(now.getSeconds()).padStart(2, '0');
    a.download = `tts-${ts}-${String(idx + 1).padStart(2, '0')}.mp3`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function showTooltip(text) {
    const tooltip = document.createElement('div');
    tooltip.className = 'tts-copied-tooltip';
    tooltip.textContent = text;
    tooltip.style.cssText = 'position:fixed;top:20px;right:380px;z-index:2147483642';
    document.body.appendChild(tooltip);
    setTimeout(() => tooltip.remove(), 1200);
  }

  // ===== OVERLAY-BASED PAGE MASKING (DICTATION MODE) =====

  function applyDictationMode() {
    state.dictationRevealed.clear();
    removePageMasks();

    if (state.selectionRange && state.sentences.length > 0) {
      createOverlayMasks();
    }
    renderSentences();
  }

  /**
   * Create overlay divs positioned over each sentence on the page.
   * Uses Range.getClientRects() — does not modify the page DOM at all.
   */
  function createOverlayMasks() {
    state.overlayMasks = [];

    // Create overlay container
    let container = document.getElementById('tts-overlay-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'tts-overlay-container';
      container.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483630;';
      document.body.appendChild(container);
    }
    container.innerHTML = '';

    const range = state.selectionRange;
    if (!range) return;

    // Get all text nodes in the selection
    const textNodes = getTextNodesInRange(range);
    if (!textNodes.length) return;

    // Build a map of text content with global positions
    let fullText = '';
    const nodeMap = [];
    textNodes.forEach(tn => {
      const start = (tn === range.startContainer) ? range.startOffset : 0;
      const end = (tn === range.endContainer) ? range.endOffset : tn.textContent.length;
      const text = tn.textContent.substring(start, end);
      nodeMap.push({ node: tn, startOffset: start, endOffset: end, globalStart: fullText.length, text });
      fullText += text;
    });

    // For each sentence, find its position and get bounding rects
    let searchPos = 0;
    state.sentences.forEach((sentence, idx) => {
      const sentenceStart = fullText.indexOf(sentence, searchPos);
      if (sentenceStart === -1) {
        state.overlayMasks.push(null);
        return;
      }
      const sentenceEnd = sentenceStart + sentence.length;
      searchPos = sentenceEnd;

      // Create a Range spanning this sentence
      const sentenceRange = document.createRange();
      let startSet = false, endSet = false;

      for (const nm of nodeMap) {
        const nmEnd = nm.globalStart + nm.text.length;

        if (!startSet && sentenceStart >= nm.globalStart && sentenceStart < nmEnd) {
          const localOffset = sentenceStart - nm.globalStart + nm.startOffset;
          sentenceRange.setStart(nm.node, localOffset);
          startSet = true;
        }
        if (!endSet && sentenceEnd > nm.globalStart && sentenceEnd <= nmEnd) {
          const localOffset = sentenceEnd - nm.globalStart + nm.startOffset;
          sentenceRange.setEnd(nm.node, localOffset);
          endSet = true;
        }
        if (startSet && endSet) break;
      }

      if (!startSet || !endSet) {
        state.overlayMasks.push(null);
        return;
      }

      // Get client rects for this sentence and merge rects on the same line
      const rawRects = sentenceRange.getClientRects();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      const merged = mergeRectsOnSameLine(rawRects);

      const overlayGroup = [];
      for (let ri = 0; ri < merged.length; ri++) {
        const rect = merged[ri];
        const overlay = document.createElement('div');
        const isFirst = ri === 0;
        overlay.className = 'tts-overlay-mask' + (idx % 2 === 1 ? ' tts-mask-alt' : '') + (isFirst ? ' tts-mask-first' : '');
        overlay.dataset.idx = idx;
        overlay.style.cssText = `
          position: absolute;
          top: ${rect.top + scrollY}px;
          left: ${rect.left + scrollX}px;
          width: ${rect.width}px;
          height: ${rect.height}px;
          pointer-events: auto;
        `;
        // Edge bar for re-masking after reveal (first rect only)
        if (isFirst) {
          const edge = document.createElement('div');
          edge.className = 'tts-mask-edge';
          edge.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMask(idx);
          });
          overlay.appendChild(edge);
        }

        overlay.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleMask(idx);
        });

        // Hover highlight via inline styles (CSS classes don't work in Firefox content scripts)
        overlay.addEventListener('mouseenter', () => {
          document.querySelectorAll(`.tts-overlay-mask[data-idx="${idx}"]`).forEach(el => {
            el.style.outline = '3px solid #0078D4';
          });
        });
        overlay.addEventListener('mouseleave', (e) => {
          const related = e.relatedTarget;
          if (related) {
            const relMask = related.closest ? related.closest('.tts-overlay-mask') : null;
            if (relMask && parseInt(relMask.dataset.idx) === idx) return;
          }
          document.querySelectorAll(`.tts-overlay-mask[data-idx="${idx}"]`).forEach(el => {
            el.style.outline = '';
          });
        });

        // Touch highlight for tablets — touchstart highlights entire sentence
        overlay.addEventListener('touchstart', () => {
          // Clear any previous touch highlight
          document.querySelectorAll('.tts-overlay-mask').forEach(el => {
            el.style.outline = '';
          });
          // Highlight all rects of this sentence
          document.querySelectorAll(`.tts-overlay-mask[data-idx="${idx}"]`).forEach(el => {
            el.style.outline = '3px solid #0078D4';
          });
        }, { passive: true });

        container.appendChild(overlay);
        overlayGroup.push(overlay);
      }

      state.overlayMasks.push(overlayGroup);
    });

    // Install global hover handler for pane logic
    installOverlayHoverHandler();
  }

  /**
   * Merge DOMRectList rects that share the same line (similar top) into
   * single wide rects, eliminating gaps caused by inline element boundaries.
   */
  function mergeRectsOnSameLine(rectList) {
    const rects = [];
    for (let i = 0; i < rectList.length; i++) {
      const r = rectList[i];
      if (r.width < 1 || r.height < 1) continue;
      rects.push({ top: r.top, left: r.left, right: r.right, bottom: r.bottom });
    }
    if (!rects.length) return [];

    // Group rects that overlap vertically (their Y ranges intersect)
    const lines = [];
    for (const r of rects) {
      let found = false;
      for (const line of lines) {
        const lineTop = Math.min(...line.map(l => l.top));
        const lineBottom = Math.max(...line.map(l => l.bottom));
        // Check vertical overlap
        if (r.top < lineBottom && r.bottom > lineTop) {
          line.push(r);
          found = true;
          break;
        }
      }
      if (!found) lines.push([r]);
    }

    // Merge each line into one rect
    const merged = lines.map(line => {
      const top = Math.min(...line.map(r => r.top));
      const bottom = Math.max(...line.map(r => r.bottom));
      const left = Math.min(...line.map(r => r.left));
      const right = Math.max(...line.map(r => r.right));
      return { top, left, width: right - left, height: bottom - top };
    });

    // Filter out tiny fragments: only remove if both very narrow AND very short
    // (e.g. superscript markers). Keep short last-lines of sentences.
    return merged.filter(r => !(r.width < 20 && r.height < 14));
  }

  function getTextNodesInRange(range) {
    const nodes = [];
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
      return [range.startContainer];
    }

    const walker = document.createTreeWalker(
      range.commonAncestorContainer,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const nodeRange = document.createRange();
          nodeRange.selectNodeContents(node);
          if (range.compareBoundaryPoints(Range.END_TO_START, nodeRange) >= 0) return NodeFilter.FILTER_REJECT;
          if (range.compareBoundaryPoints(Range.START_TO_END, nodeRange) <= 0) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) nodes.push(node);
    return nodes;
  }

  function toggleMask(idx) {
    if (state.dictationRevealed.has(idx)) {
      state.dictationRevealed.delete(idx);
      hideOverlayMask(idx);
    } else {
      state.dictationRevealed.add(idx);
      revealOverlayMask(idx);
    }
    renderSentences();
  }

  function revealAll() {
    state.sentences.forEach((_, idx) => {
      state.dictationRevealed.add(idx);
      revealOverlayMask(idx);
    });
    renderSentences();
  }

  function hideAll() {
    state.dictationRevealed.clear();
    state.overlayMasks.forEach((_, idx) => hideOverlayMask(idx));
    renderSentences();
  }

  function revealOverlayMask(idx) {
    const group = state.overlayMasks[idx];
    if (group) group.forEach(el => el.classList.add('revealed'));
  }

  function hideOverlayMask(idx) {
    const group = state.overlayMasks[idx];
    if (group) group.forEach(el => el.classList.remove('revealed'));
  }

  function highlightOverlayMask(idx) {
    // Remove all playing highlights
    document.querySelectorAll('.tts-overlay-mask.playing').forEach(el => el.classList.remove('playing'));
    document.querySelectorAll('.tts-overlay-mask.playing-flash').forEach(el => {
      el.classList.remove('playing-flash', 'flash-fade');
    });
    // Add playing to ALL rects for this sentence (by data-idx attribute)
    const masks = document.querySelectorAll(`.tts-overlay-mask[data-idx="${idx}"]`);
    const isRevealed = masks.length > 0 && masks[0].classList.contains('revealed');
    masks.forEach(el => el.classList.add('playing'));

    // For revealed sentences: flash blue frame briefly then fade out
    if (isRevealed) {
      masks.forEach(el => el.classList.add('playing-flash'));
      setTimeout(() => {
        masks.forEach(el => el.classList.add('flash-fade'));
      }, 1200);
      setTimeout(() => {
        masks.forEach(el => el.classList.remove('playing-flash', 'flash-fade'));
      }, 1700);
    }

    // Auto-scroll to the playing sentence if not already visible
    if (masks.length > 0) {
      const rect = masks[0].getBoundingClientRect();
      const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!inView) {
        masks[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  // ===== OVERLAY HOVER PANE (robust mousemove-based) =====
  let overlayPaneEl = null;
  let overlayPaneTimeout = null;
  let overlayPaneIdx = -1;
  let overlayPaneShowTimeout = null;
  let hoverSentenceIdx = -1; // which sentence the mouse is currently over
  // Global mousemove handler — installed once when overlay container is created
  function installOverlayHoverHandler() {
    document.addEventListener('mousemove', handleOverlayMouseMove, true);
  }

  function uninstallOverlayHoverHandler() {
    document.removeEventListener('mousemove', handleOverlayMouseMove, true);
  }

  function handleOverlayMouseMove(e) {
    // Check if mouse is over a pane
    const overPane = overlayPaneEl && (overlayPaneEl === e.target || overlayPaneEl.contains(e.target));
    if (overPane) {
      // Mouse is on the pane — keep it alive
      if (overlayPaneTimeout) { clearTimeout(overlayPaneTimeout); overlayPaneTimeout = null; }
      return;
    }

    // Check if mouse is over an overlay mask (use elementsFromPoint for robustness)
    let maskEl = e.target.closest ? e.target.closest('.tts-overlay-mask') : null;
    if (!maskEl) {
      const els = document.elementsFromPoint(e.clientX, e.clientY);
      for (const el of els) {
        if (el.classList && el.classList.contains('tts-overlay-mask') && !el.classList.contains('revealed')) {
          maskEl = el;
          break;
        }
      }
    }
    if (!maskEl) {
      // Mouse left all masks and pane
      if (hoverSentenceIdx >= 0) {
        hoverSentenceIdx = -1;
      }
      if (overlayPaneShowTimeout) { clearTimeout(overlayPaneShowTimeout); overlayPaneShowTimeout = null; }
      scheduleHidePane();
      return;
    }

    const idx = parseInt(maskEl.dataset.idx);

    // Same sentence — just keep alive
    if (idx === hoverSentenceIdx) {
      if (overlayPaneTimeout) { clearTimeout(overlayPaneTimeout); overlayPaneTimeout = null; }
      return;
    }

    // Different sentence — switch hover
    hoverSentenceIdx = idx;

    // Cancel any pending show/hide
    if (overlayPaneShowTimeout) { clearTimeout(overlayPaneShowTimeout); overlayPaneShowTimeout = null; }
    if (overlayPaneTimeout) { clearTimeout(overlayPaneTimeout); overlayPaneTimeout = null; }

    // If pane already showing for this sentence, done
    if (overlayPaneEl && overlayPaneIdx === idx) return;

    // Schedule pane show after 300ms
    const capturedMaskEl = maskEl;
    const capturedClientX = e.clientX;
    overlayPaneShowTimeout = setTimeout(() => {
      overlayPaneShowTimeout = null;
      // Double-check mouse is still over the same sentence
      if (hoverSentenceIdx !== idx) return;
      createPane(idx, capturedMaskEl, capturedClientX);
    }, 300);
  }

  function createPane(idx, maskEl, clientX) {
    // Remove existing pane
    if (overlayPaneEl && overlayPaneEl.parentNode) {
      overlayPaneEl.parentNode.removeChild(overlayPaneEl);
    }
    overlayPaneEl = null;
    overlayPaneIdx = idx;

    const pane = document.createElement('div');
    pane.className = 'tts-overlay-pane';
    pane.innerHTML = `
      <span class="tts-overlay-pane-label">#${idx + 1}</span>
      <button class="tts-overlay-pane-btn" data-pane-action="focus" title="Focus in sidebar">&#8599;</button>
      <button class="tts-overlay-pane-btn" data-pane-action="play" title="Play audio">&#9654;</button>
      <button class="tts-overlay-pane-btn" data-pane-action="reveal" title="Reveal text">&#128065;</button>
    `;

    const maskRect = maskEl.getBoundingClientRect();
    const paneTop = maskRect.top - 32;
    pane.style.cssText = `
      position: fixed;
      top: ${paneTop < 4 ? maskRect.bottom + 4 : paneTop}px;
      left: ${Math.max(60, Math.min(clientX, window.innerWidth - 60))}px;
      transform: translateX(-50%);
      z-index: 2147483645;
    `;

    pane.querySelectorAll('[data-pane-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.paneAction;
        if (action === 'focus') {
          const card = document.querySelector(`.tts-sentence-card[data-idx="${idx}"]`);
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (action === 'play') {
          playSentence(idx);
          const card = document.querySelector(`.tts-sentence-card[data-idx="${idx}"]`);
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (action === 'reveal') {
          toggleMask(idx);
        }
      });
    });

    document.body.appendChild(pane);
    overlayPaneEl = pane;
  }

  function scheduleHidePane() {
    if (overlayPaneTimeout) clearTimeout(overlayPaneTimeout);
    overlayPaneTimeout = setTimeout(() => forceRemovePane(), 350);
  }

  function forceRemovePane() {
    if (overlayPaneShowTimeout) { clearTimeout(overlayPaneShowTimeout); overlayPaneShowTimeout = null; }
    if (overlayPaneTimeout) { clearTimeout(overlayPaneTimeout); overlayPaneTimeout = null; }
    if (overlayPaneEl && overlayPaneEl.parentNode) {
      overlayPaneEl.parentNode.removeChild(overlayPaneEl);
    }
    overlayPaneEl = null;
    overlayPaneIdx = -1;
    hoverSentenceIdx = -1;
  }

  function removePageMasks() {
    uninstallOverlayHoverHandler();
    forceRemovePane();
    const container = document.getElementById('tts-overlay-container');
    if (container) container.innerHTML = '';
    state.overlayMasks = [];
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
    browser.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: state.settings });
  }

  function applySettingsToUI() {
    const voiceInput = document.getElementById('tts-voice-search-input');
    const styleSelect = document.getElementById('tts-style-select');
    if (voiceInput) {
      // Find display name for current voice
      const v = state.voices.find(v => (v.ShortName || '') === state.settings.voice);
      voiceInput.value = v ? (v.DisplayName || v.ShortName) : state.settings.voice;
    }
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
