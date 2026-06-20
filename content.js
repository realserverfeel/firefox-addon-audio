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
    followAlongPause: 3,
    dictationRevealed: new Set(),
    pageMasks: [],       // Array of DOM elements wrapping sentences on the page
    selectionRange: null, // Stored Range from user selection
    voices: [],          // Dynamically loaded voice list
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
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    if (selectedText) {
      // Store the selection range for page masking
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
    // Clean up previous page masks
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
        populateVoiceSelect();
      })
      .catch(() => {
        // Silently fail — use fallback hardcoded list
        state.voicesLoaded = false;
      });
  }

  function populateVoiceSelect() {
    const select = document.getElementById('tts-voice-select');
    if (!select || !state.voices.length) return;

    // Group voices by locale
    const grouped = {};
    state.voices.forEach(v => {
      const locale = v.Locale || v.locale || '';
      if (!grouped[locale]) grouped[locale] = [];
      grouped[locale].push(v);
    });

    // Sort locales — put English first
    const locales = Object.keys(grouped).sort((a, b) => {
      if (a.startsWith('en-') && !b.startsWith('en-')) return -1;
      if (!a.startsWith('en-') && b.startsWith('en-')) return 1;
      return a.localeCompare(b);
    });

    select.innerHTML = '';
    locales.forEach(locale => {
      const group = document.createElement('optgroup');
      group.label = locale;
      grouped[locale]
        .sort((a, b) => (a.DisplayName || a.ShortName).localeCompare(b.DisplayName || b.ShortName))
        .forEach(voice => {
          const opt = document.createElement('option');
          opt.value = voice.ShortName || voice.shortName || '';
          const displayName = voice.DisplayName || voice.LocalName || voice.ShortName || '';
          const gender = voice.Gender || '';
          opt.textContent = `${displayName} (${gender})`;
          if (opt.value === state.settings.voice) opt.selected = true;
          group.appendChild(opt);
        });
      select.appendChild(group);
    });
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

  // ===== REGENERATE =====
  function regenerateAll() {
    if (!state.sentences.length) return;

    stopPlayback();
    state.audioBlobs = new Array(state.sentences.length).fill(null);
    audioElements = new Array(state.sentences.length).fill(null);
    renderSentences();
    startSynthesis();
    showTooltip('Regenerating with new settings...');
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

    // Highlight corresponding page mask
    highlightPageMask(idx);

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
      if (state.mode === 'dictation' && state.followAlongPause > 0) {
        setTimeout(() => {
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
      // Reveal last sentence in dictation mode
      if (state.mode === 'dictation') {
        state.dictationRevealed.add(currentIdx);
        revealPageMask(currentIdx);
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
    setTimeout(() => tooltip.remove(), 1200);
  }

  // ===== PAGE-LEVEL SENTENCE MASKING (DICTATION MODE) =====

  /**
   * Apply dictation mode: find sentences in the page DOM and wrap them with mask elements.
   */
  function applyDictationMode() {
    state.dictationRevealed.clear();
    removePageMasks();

    if (state.selectionRange && state.sentences.length > 0) {
      applyPageMasks();
    }

    renderSentences();
  }

  /**
   * Wrap each sentence in the selected text with a mask span on the actual page.
   * Uses text node walking within the selection range.
   */
  function applyPageMasks() {
    state.pageMasks = [];

    try {
      const range = state.selectionRange;
      if (!range) return;

      // Get all text nodes within the selection range
      const textNodes = getTextNodesInRange(range);
      if (!textNodes.length) return;

      // Concatenate all text content
      let fullText = '';
      const nodeMap = []; // {node, startOffset, endOffset, globalStart}
      textNodes.forEach(tn => {
        const start = (tn === range.startContainer) ? range.startOffset : 0;
        const end = (tn === range.endContainer) ? range.endOffset : tn.textContent.length;
        const text = tn.textContent.substring(start, end);
        nodeMap.push({
          node: tn,
          startOffset: start,
          endOffset: end,
          globalStart: fullText.length,
          text: text
        });
        fullText += text;
      });

      // Find each sentence's position in the full text
      let searchPos = 0;
      state.sentences.forEach((sentence, idx) => {
        const sentenceStart = fullText.indexOf(sentence, searchPos);
        if (sentenceStart === -1) {
          state.pageMasks.push(null); // Can't find this sentence
          return;
        }
        const sentenceEnd = sentenceStart + sentence.length;
        searchPos = sentenceEnd;

        // Find which text nodes this sentence spans
        const affectedNodes = [];
        nodeMap.forEach(nm => {
          const nmEnd = nm.globalStart + nm.text.length;
          if (nm.globalStart < sentenceEnd && nmEnd > sentenceStart) {
            // This node overlaps with the sentence
            const localStart = Math.max(0, sentenceStart - nm.globalStart);
            const localEnd = Math.min(nm.text.length, sentenceEnd - nm.globalStart);
            affectedNodes.push({
              ...nm,
              sentenceLocalStart: localStart + nm.startOffset,
              sentenceLocalEnd: localEnd + nm.startOffset
            });
          }
        });

        if (affectedNodes.length === 0) {
          state.pageMasks.push(null);
          return;
        }

        // Simple case: sentence within single text node
        if (affectedNodes.length === 1) {
          const an = affectedNodes[0];
          const maskSpan = wrapTextRange(an.node, an.sentenceLocalStart, an.sentenceLocalEnd, idx);
          state.pageMasks.push(maskSpan);
        } else {
          // Complex case: sentence spans multiple nodes
          // Wrap each portion and link them
          const maskGroup = document.createElement('span');
          maskGroup.className = 'tts-page-mask-group';
          maskGroup.dataset.idx = idx;

          const wrappedSpans = [];
          affectedNodes.forEach(an => {
            const span = wrapTextRange(an.node, an.sentenceLocalStart, an.sentenceLocalEnd, idx);
            if (span) wrappedSpans.push(span);
          });

          // Use the first span as the representative mask
          state.pageMasks.push(wrappedSpans[0] || null);
        }
      });
    } catch (e) {
      // If DOM manipulation fails, fall back to sidebar-only masking
      console.warn('Azure TTS: Could not apply page masks', e);
      state.pageMasks = [];
    }
  }

  /**
   * Wrap a portion of a text node with a mask span.
   */
  function wrapTextRange(textNode, start, end, sentenceIdx) {
    try {
      if (!textNode || !textNode.parentNode) return null;
      if (start >= end) return null;

      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, end);

      const maskSpan = document.createElement('span');
      maskSpan.className = 'tts-page-mask';
      maskSpan.dataset.sentenceIdx = sentenceIdx;

      // Click to toggle reveal
      maskSpan.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleMask(sentenceIdx);
      });

      range.surroundContents(maskSpan);
      return maskSpan;
    } catch (e) {
      // surroundContents can fail if range crosses element boundaries
      return null;
    }
  }

  /**
   * Get all text nodes within a Range.
   */
  function getTextNodesInRange(range) {
    const nodes = [];
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
      return [startContainer];
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
    while (node = walker.nextNode()) {
      nodes.push(node);
    }
    return nodes;
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
    state.sentences.forEach((_, idx) => {
      state.dictationRevealed.add(idx);
      revealPageMask(idx);
    });
    renderSentences();
  }

  function hideAll() {
    state.dictationRevealed.clear();
    state.pageMasks.forEach((mask, idx) => {
      hidePageMask(idx);
    });
    renderSentences();
  }

  function revealPageMask(idx) {
    // Reveal main mask
    if (state.pageMasks[idx]) {
      state.pageMasks[idx].classList.add('revealed');
    }
    // Reveal all spans with same sentence idx
    document.querySelectorAll(`.tts-page-mask[data-sentence-idx="${idx}"]`).forEach(el => {
      el.classList.add('revealed');
    });
  }

  function hidePageMask(idx) {
    if (state.pageMasks[idx]) {
      state.pageMasks[idx].classList.remove('revealed');
    }
    document.querySelectorAll(`.tts-page-mask[data-sentence-idx="${idx}"]`).forEach(el => {
      el.classList.remove('revealed');
    });
  }

  function highlightPageMask(idx) {
    // Remove highlight from all
    document.querySelectorAll('.tts-page-mask.playing').forEach(el => {
      el.classList.remove('playing');
    });
    // Add highlight to current
    document.querySelectorAll(`.tts-page-mask[data-sentence-idx="${idx}"]`).forEach(el => {
      el.classList.add('playing');
    });
  }

  function removePageMasks() {
    // Find all mask spans and unwrap them
    document.querySelectorAll('.tts-page-mask').forEach(mask => {
      const parent = mask.parentNode;
      if (parent) {
        while (mask.firstChild) {
          parent.insertBefore(mask.firstChild, mask);
        }
        parent.removeChild(mask);
        parent.normalize(); // Merge adjacent text nodes
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
