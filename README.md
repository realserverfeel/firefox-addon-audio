# Azure TTS Reader - Firefox Add-on

A Firefox browser extension that converts selected text to speech using Azure Text-to-Speech API. Features per-sentence playback, dictation mode with text masking, and customizable voice settings.

## Features

- **Floating Action Button** — Right-side button that activates when text is selected
- **Sentence Splitting** — Intelligent splitting that handles abbreviations (Dr., Mr., U.S.), decimals, and ellipses
- **Concurrent TTS** — Batch requests with up to 5 parallel API calls for fast loading
- **Sidebar Player** — Slide-out panel with per-sentence playback controls and progress bars
- **Play Modes** — Single sentence, play all (continuous), and follow-along with configurable pauses
- **Dictation Mode** — Masks sentence text (blur effect); reveal individually or all at once
- **Voice & Style** — Choose from Azure Neural voices with style presets (chat, narration, newscast, etc.)
- **Speed Control** — 0.5x to 2x playback speed
- **Download** — Save individual sentence audio as .mp3 files
- **Copy** — Quick-copy sentence text to clipboard

## Installation

### Temporary (Development)

1. Open Firefox and navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select the `manifest.json` file from this directory

### Permanent (Developer Edition)

1. Download [Firefox Developer Edition](https://www.mozilla.org/en-US/firefox/developer/)
2. Navigate to `about:config`, set `xpinstall.signatures.required` to `false`
3. Drag and drop the `.xpi` file into the browser window

### Permanent (AMO Unlisted)

1. Go to https://addons.mozilla.org/developers/
2. Submit as "unlisted" — Mozilla auto-signs within minutes
3. Install the signed `.xpi` in any Firefox

## Setup

1. Install the extension using one of the methods above
2. Click the extension icon in the toolbar to open settings
3. Enter your Azure Speech API Key and select your region
4. Click "Test Connection" to verify

### Getting an Azure API Key (Free)

1. Go to [Azure Portal](https://portal.azure.com)
2. Search for "Speech" → Click "Create"
3. Select **F0 (Free)** pricing tier — 500,000 characters/month
4. After creation, go to "Keys and Endpoint"
5. Copy **Key 1** and your **Region**

## Usage

1. Select any text on a webpage
2. The floating button on the right turns green
3. Click it to open the sidebar with your sentences
4. Sentences load progressively — play as soon as the first one is ready
5. Switch to "Dictation" mode to practice listening comprehension

## Project Structure

```
├── manifest.json           — Extension manifest (Manifest V2)
├── background.js           — API proxy, settings management
├── content.js              — Floating button, sidebar, playback logic
├── content.css             — All injected styles
├── popup/
│   ├── popup.html          — Settings popup
│   ├── popup.css           — Popup styles
│   └── popup.js            — Settings logic
├── utils/
│   ├── sentence-split.js   — Sentence splitting algorithm
│   └── azure-tts.js        — Azure TTS API wrapper
└── icons/
    ├── icon.svg            — Source icon
    ├── icon-16.png
    ├── icon-48.png
    └── icon-128.png
```

## Building .xpi

```bash
zip -r azure-tts-reader.xpi manifest.json background.js content.js content.css popup/ utils/ icons/ -x "*.git*"
```

## Recommended Voices for English Practice

| Scenario | Voice + Style |
|----------|--------------|
| Daily conversation | Aria + chat |
| Presentations | Aria + narration-professional |
| Business English | Jenny + friendly |
| News reading | Jenny + newscast-casual |
| Formal occasions | Davis + serious |

## License

MIT
