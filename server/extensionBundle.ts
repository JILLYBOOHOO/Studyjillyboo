import zlib from 'zlib';

// Standard IEEE 802.3 CRC32 table for valid PKZIP & PNG generation without external packages
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createExtensionIconPng(size: number): Buffer {
  const raw = Buffer.alloc(size * (1 + size * 4));
  const cornerRadius = Math.max(3, Math.round(size * 0.22));
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;

  for (let y = 0; y < size; y++) {
    const rowStart = y * (1 + size * 4);
    raw[rowStart] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const px = rowStart + 1 + x * 4;

      // Rounded rectangle mask
      const dx = Math.max(0, Math.abs(x - cx) - (size / 2 - cornerRadius));
      const dy = Math.max(0, Math.abs(y - cy) - (size / 2 - cornerRadius));
      const inside = dx * dx + dy * dy <= cornerRadius * cornerRadius;

      if (!inside) {
        raw[px] = 0;
        raw[px + 1] = 0;
        raw[px + 2] = 0;
        raw[px + 3] = 0;
        continue;
      }

      // Crisp dark slate background (#0F172A) with blue viewfinder frame (#2563EB) & center dot (#FFFFFF)
      const normX = x / size;
      const normY = y / size;
      const inFrame =
        normX >= 0.2 &&
        normX <= 0.8 &&
        normY >= 0.22 &&
        normY <= 0.78 &&
        (normX <= 0.29 || normX >= 0.71 || normY <= 0.31 || normY >= 0.69);
      const distCenter = Math.hypot(normX - 0.5, normY - 0.5);

      if (distCenter <= 0.14) {
        raw[px] = 255;
        raw[px + 1] = 255;
        raw[px + 2] = 255;
        raw[px + 3] = 255;
      } else if (inFrame) {
        raw[px] = 59;
        raw[px + 1] = 130;
        raw[px + 2] = 246;
        raw[px + 3] = 255;
      } else {
        raw[px] = 15;
        raw[px + 1] = 23;
        raw[px + 2] = 42;
        raw[px + 3] = 255;
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = zlib.deflateSync(raw);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

interface ZipEntryInput {
  name: string;
  data: Buffer;
}

function createZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const compressed = zlib.deflateRawSync(entry.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(8, 8); // Compression method: deflate
    localHeader.writeUInt16LE(0, 10); // Mod time
    localHeader.writeUInt16LE(0x5421, 12); // Mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // Extra field len

    localParts.push(localHeader, nameBuf, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central directory signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // Deflate
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

export function buildChromeExtensionZip(appOrigin: string): Buffer {
  const safeOrigin = appOrigin.replace(/\/+$/, '');

  const manifestJson = JSON.stringify(
    {
      manifest_version: 3,
      name: 'StudyTrack AI — Smart Clipper & Screenshot',
      version: '1.0.0',
      description:
        'Capture tab screenshots and clipboard snippets, auto-save to StudyTrack AI, and trigger smart actions for dates, letters, definitions, and code.',
      permissions: [
        'activeTab',
        'tabs',
        'storage',
        'contextMenus',
        'alarms',
        'notifications',
        'clipboardRead',
      ],
      host_permissions: ['https://*/*', 'http://localhost:3000/*'],
      action: {
        default_popup: 'popup.html',
        default_title: 'StudyTrack AI Smart Clipper',
        default_icon: {
          '16': 'icons/icon16.png',
          '48': 'icons/icon48.png',
          '128': 'icons/icon128.png',
        },
      },
      icons: {
        '16': 'icons/icon16.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png',
      },
      background: {
        service_worker: 'background.js',
      },
      content_scripts: [
        {
          matches: ['https://*.run.app/*', 'http://localhost:3000/*'],
          js: ['content-bridge.js'],
          run_at: 'document_idle',
        },
      ],
      commands: {
        'capture-screenshot': {
          suggested_key: {
            default: 'Alt+Shift+S',
          },
          description: 'Capture screenshot of current tab & auto-save to StudyTrack AI',
        },
      },
    },
    null,
    2,
  );

  const configJs = `// Pre-configured StudyTrack AI URL from the workspace you downloaded this extension from.
const DEFAULT_APP_URL = ${JSON.stringify(safeOrigin)};
`;

  const contentBridgeJs = `// Relays Smart Clips captured in the Chrome Extension directly to an open StudyTrack AI tab.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'STUDYTRACK_DELIVER_CLIP' && message.clip) {
    window.postMessage(
      {
        source: 'studytrack-chrome-extension',
        type: 'CLIP_READY',
        clip: message.clip,
      },
      '*',
    );
    sendResponse({ delivered: true });
    return true;
  }
  return false;
});
`;

  const backgroundJs = `importScripts('config.js');

const STORAGE_KEYS = {
  APP_URL: 'studytrack_app_url',
  AUTO_SAVE: 'studytrack_auto_save',
  RECENT_CLIPS: 'studytrack_recent_clips',
};

async function getSettings() {
  const res = await chrome.storage.local.get([
    STORAGE_KEYS.APP_URL,
    STORAGE_KEYS.AUTO_SAVE,
    STORAGE_KEYS.RECENT_CLIPS,
  ]);
  return {
    appUrl: (res[STORAGE_KEYS.APP_URL] || DEFAULT_APP_URL).replace(/\\/+$/, ''),
    autoSave: res[STORAGE_KEYS.AUTO_SAVE] !== false,
    recentClips: Array.isArray(res[STORAGE_KEYS.RECENT_CLIPS]) ? res[STORAGE_KEYS.RECENT_CLIPS] : [],
  };
}

async function saveRecentClip(clip) {
  const { recentClips } = await getSettings();
  const next = [
    {
      id: clip.handoffId || String(Date.now()),
      savedAt: new Date().toISOString(),
      intent: clip.intent,
      title: clip.smartCard?.title || 'Captured Clip',
      cardType: clip.smartCard?.cardType || 'note',
      courseCode: clip.smartCard?.courseCode || 'AIL1001',
      clip,
    },
    ...recentClips,
  ].slice(0, 15);
  await chrome.storage.local.set({ [STORAGE_KEYS.RECENT_CLIPS]: next });
}

async function deliverClipToStudyTrack(clip, openIfMissing) {
  const { appUrl } = await getSettings();
  const tabs = await chrome.tabs.query({});
  const targetTab = tabs.find(
    (t) => t.url && (t.url.startsWith(appUrl) || t.url.includes('localhost:3000') || t.url.includes('.run.app')),
  );

  if (targetTab && targetTab.id) {
    try {
      await chrome.tabs.sendMessage(targetTab.id, {
        type: 'STUDYTRACK_DELIVER_CLIP',
        clip,
      });
      return { deliveredToOpenTab: true, tabId: targetTab.id };
    } catch {
      // Fall back to opening handoff URL below if requested
    }
  }

  if (openIfMissing && clip.handoffId) {
    await chrome.tabs.create({
      url: appUrl + '/?clip=' + encodeURIComponent(clip.handoffId),
      active: false,
    });
    return { openedBackgroundTab: true };
  }
  return { deliveredToOpenTab: false };
}

async function scheduleReminderAlarm(title, isoDateStr) {
  const parsed = Date.parse(isoDateStr);
  const when = Number.isNaN(parsed) || parsed <= Date.now() ? Date.now() + 60 * 60 * 1000 : parsed;
  const alarmId = 'studytrack_rem_' + Date.now();
  await chrome.storage.local.set({ [alarmId]: title || 'Study Reminder' });
  chrome.alarms.create(alarmId, { when });
}

async function analyzeAndAutoSave({ imageDataUrl, text, pageUrl, pageTitle, openIfMissing }) {
  const { appUrl, autoSave } = await getSettings();
  const payload = {
    text: text || '',
    pageUrl: pageUrl || '',
    pageTitle: pageTitle || '',
  };
  if (imageDataUrl) {
    const commaIdx = imageDataUrl.indexOf(',');
    payload.imageBase64 = commaIdx >= 0 ? imageDataUrl.slice(commaIdx + 1) : imageDataUrl;
    payload.mimeType = 'image/png';
  }

  const resp = await fetch(appUrl + '/api/clip/smart-action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || 'Could not analyze clip on StudyTrack AI server.');
  }

  await saveRecentClip(data);
  if (autoSave) {
    await deliverClipToStudyTrack(data, openIfMissing);
  }
  return data;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'studytrack-screenshot',
      title: 'StudyTrack AI: Screenshot Tab & Auto-Save',
      contexts: ['page', 'frame', 'image'],
    });
    chrome.contextMenus.create({
      id: 'studytrack-selection',
      title: 'StudyTrack AI: Smart Action on Selection',
      contexts: ['selection'],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === 'studytrack-screenshot' && tab) {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const clip = await analyzeAndAutoSave({
        imageDataUrl: dataUrl,
        pageUrl: tab.url || '',
        pageTitle: tab.title || '',
        openIfMissing: true,
      });
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Screenshot Auto-Saved',
        message: clip.smartCard?.title || 'Saved to StudyTrack AI Smart Notebook',
      });
    } else if (info.menuItemId === 'studytrack-selection' && info.selectionText) {
      const clip = await analyzeAndAutoSave({
        text: info.selectionText,
        pageUrl: tab?.url || '',
        pageTitle: tab?.title || '',
        openIfMissing: true,
      });
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Smart Action Ready',
        message: clip.intentSummary || clip.smartCard?.title || 'Saved to StudyTrack AI',
      });
    }
  } catch (err) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'StudyTrack AI Clipper',
      message: err instanceof Error ? err.message : 'Action failed. Open popup to check App URL.',
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-screenshot') return;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const clip = await analyzeAndAutoSave({
      imageDataUrl: dataUrl,
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
      openIfMissing: true,
    });
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: 'Screenshot Auto-Saved',
      message: clip.smartCard?.title || 'Saved to StudyTrack AI',
    });
  } catch {
    // Ignore shortcut errors on restricted chrome:// tabs
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith('studytrack_rem_')) return;
  const res = await chrome.storage.local.get([alarm.name]);
  const title = res[alarm.name] || 'Study Reminder';
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'StudyTrack AI Reminder',
    message: title,
  });
  await chrome.storage.local.remove([alarm.name]);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return false;
  if (message.type === 'ANALYZE_AND_SAVE') {
    analyzeAndAutoSave(message.payload || {})
      .then((clip) => sendResponse({ ok: true, clip }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Failed' }));
    return true;
  }
  if (message.type === 'DELIVER_CLIP_TO_APP') {
    deliverClipToStudyTrack(message.clip, true)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Failed' }));
    return true;
  }
  if (message.type === 'SCHEDULE_REMINDER') {
    scheduleReminderAlarm(message.title, message.reminderAt)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err instanceof Error ? err.message : 'Failed' }));
    return true;
  }
  return false;
});
`;

  const popupHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>StudyTrack AI Smart Clipper</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <header class="topbar">
      <div class="brand-row">
        <span class="brand">StudyTrack AI</span>
        <button id="toggleSettingsBtn" class="ghost-btn" type="button">Settings</button>
      </div>
      <label class="autosave-row">
        <input id="autoSaveToggle" type="checkbox" checked />
        <span>Auto-save captures &amp; smart actions to StudyTrack AI</span>
      </label>
    </header>

    <section id="settingsPanel" class="panel hidden">
      <label class="field-label" for="appUrlInput">StudyTrack AI App URL</label>
      <div class="row-gap">
        <input id="appUrlInput" type="url" placeholder="https://..." />
        <button id="saveUrlBtn" class="secondary-btn" type="button">Save</button>
      </div>
      <p class="hint">Shortcut: Alt+Shift+S captures any tab automatically.</p>
    </section>

    <main class="main">
      <div class="primary-actions">
        <button id="captureTabBtn" class="primary-btn" type="button">
          Screenshot Tab &amp; Auto-Save
        </button>
        <button id="readClipboardBtn" class="secondary-btn" type="button">
          Smart Paste Clipboard
        </button>
      </div>

      <div class="paste-box">
        <textarea
          id="clipInput"
          rows="3"
          placeholder="Or paste any copied date, letter/email, definition, or code snippet here..."
        ></textarea>
        <button id="analyzeTextBtn" class="secondary-btn full-width" type="button">
          Detect Smart Actions &amp; Save
        </button>
      </div>

      <p id="statusMsg" class="status hidden"></p>

      <section id="resultSection" class="result-card hidden">
        <div class="result-head">
          <div>
            <p id="resultMeta" class="meta-line"></p>
            <h2 id="resultTitle" class="result-title"></h2>
          </div>
          <button id="openAppBtn" class="ghost-btn" type="button">Open in App</button>
        </div>

        <p id="intentSummary" class="intent-summary"></p>

        <div id="smartActionsList" class="smart-actions"></div>

        <pre id="extractedPreview" class="preview-box"></pre>
      </section>

      <section id="recentSection" class="recent-wrap hidden">
        <p class="section-label">Recent Captures</p>
        <div id="recentList" class="recent-list"></div>
      </section>
    </main>

    <script src="config.js"></script>
    <script src="popup.js"></script>
  </body>
</html>
`;

  const popupCss = `* {
  box-sizing: border-box;
}
body {
  margin: 0;
  width: 400px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: #f8fafc;
  color: #0f172a;
}
.hidden {
  display: none !important;
}
.topbar {
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  padding: 12px 14px;
}
.brand-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}
.autosave-row {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #475569;
  cursor: pointer;
}
.panel {
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  padding: 12px 14px;
}
.field-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #475569;
  margin-bottom: 6px;
}
.row-gap {
  display: flex;
  gap: 6px;
}
input[type="url"],
textarea {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  color: #0f172a;
  background: #ffffff;
  font-family: inherit;
}
.hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: #64748b;
}
.main {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.primary-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
button {
  font-family: inherit;
  cursor: pointer;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  padding: 9px 10px;
  border: 1px solid transparent;
  transition: background-color 0.15s ease;
}
button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.primary-btn {
  background: #1d4ed8;
  color: #ffffff;
}
.primary-btn:hover:not(:disabled) {
  background: #1e40af;
}
.secondary-btn {
  background: #ffffff;
  border-color: #cbd5e1;
  color: #1e293b;
}
.secondary-btn:hover:not(:disabled) {
  background: #f1f5f9;
}
.ghost-btn {
  background: transparent;
  color: #1d4ed8;
  padding: 4px 8px;
  font-size: 11px;
}
.ghost-btn:hover {
  background: #eff6ff;
}
.full-width {
  width: 100%;
  margin-top: 6px;
}
.status {
  margin: 0;
  font-size: 12px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #eff6ff;
  color: #1e40af;
  border: 1px solid #bfdbfe;
}
.status.error {
  background: #fef2f2;
  color: #b91c1c;
  border-color: #fecaca;
}
.result-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.result-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}
.meta-line {
  margin: 0;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #1d4ed8;
}
.result-title {
  margin: 2px 0 0;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
}
.intent-summary {
  margin: 0;
  font-size: 12px;
  color: #334155;
  line-height: 1.45;
}
.smart-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.action-btn {
  background: #eff6ff;
  color: #1e40af;
  border: 1px solid #bfdbfe;
  padding: 6px 10px;
  font-size: 11px;
}
.action-btn:hover {
  background: #dbeafe;
}
.preview-box {
  margin: 0;
  padding: 8px;
  border-radius: 6px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #334155;
  max-height: 110px;
  overflow-y: auto;
  white-space: pre-wrap;
}
.recent-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.section-label {
  margin: 0;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
}
.recent-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.recent-item {
  width: 100%;
  text-align: left;
  background: #ffffff;
  border: 1px solid #e2e8f0;
  padding: 7px 10px;
  font-size: 11px;
  color: #1e293b;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.recent-item:hover {
  border-color: #93c5fd;
}
`;

  const popupJs = `const STORAGE_KEYS = {
  APP_URL: 'studytrack_app_url',
  AUTO_SAVE: 'studytrack_auto_save',
  RECENT_CLIPS: 'studytrack_recent_clips',
};

const captureTabBtn = document.getElementById('captureTabBtn');
const readClipboardBtn = document.getElementById('readClipboardBtn');
const analyzeTextBtn = document.getElementById('analyzeTextBtn');
const clipInput = document.getElementById('clipInput');
const autoSaveToggle = document.getElementById('autoSaveToggle');
const toggleSettingsBtn = document.getElementById('toggleSettingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const appUrlInput = document.getElementById('appUrlInput');
const saveUrlBtn = document.getElementById('saveUrlBtn');
const statusMsg = document.getElementById('statusMsg');
const resultSection = document.getElementById('resultSection');
const resultMeta = document.getElementById('resultMeta');
const resultTitle = document.getElementById('resultTitle');
const intentSummary = document.getElementById('intentSummary');
const smartActionsList = document.getElementById('smartActionsList');
const extractedPreview = document.getElementById('extractedPreview');
const openAppBtn = document.getElementById('openAppBtn');
const recentSection = document.getElementById('recentSection');
const recentList = document.getElementById('recentList');

let currentClip = null;
let configuredAppUrl = DEFAULT_APP_URL;

function setStatus(text, isError = false) {
  if (!text) {
    statusMsg.classList.add('hidden');
    return;
  }
  statusMsg.textContent = text;
  statusMsg.classList.toggle('error', isError);
  statusMsg.classList.remove('hidden');
}

function setBusy(busy) {
  captureTabBtn.disabled = busy;
  readClipboardBtn.disabled = busy;
  analyzeTextBtn.disabled = busy;
}

async function sendRuntimeMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => resolve(resp));
  });
}

function buildModifiedClip(clip, overrides) {
  const cloned = JSON.parse(JSON.stringify(clip));
  cloned.smartCard = Object.assign({}, cloned.smartCard || {}, overrides);
  return cloned;
}

async function triggerSmartAction(action, clip) {
  if (action.actionId === 'set_reminder') {
    const reminderAt = clip.detectedDateIso || clip.smartCard?.reminderAt || new Date(Date.now() + 3600000).toISOString().slice(0, 16);
    const title = clip.reminderTitle || clip.smartCard?.title || 'Study Reminder';
    await sendRuntimeMessage({ type: 'SCHEDULE_REMINDER', title, reminderAt });
    const updated = buildModifiedClip(clip, {
      pinned: true,
      reminderAt,
      title,
      colorTag: 'amber',
    });
    await sendRuntimeMessage({ type: 'DELIVER_CLIP_TO_APP', clip: updated });
    setStatus('Reminder set in Chrome & synced to StudyTrack AI.');
    return;
  }

  if (action.actionId === 'open_calendar') {
    const startRaw = (clip.detectedDateIso || '').replace(/[-:]/g, '');
    const startCal = startRaw.length >= 13 ? startRaw.slice(0, 15) + '00' : '';
    const calUrl =
      'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' +
      encodeURIComponent(clip.reminderTitle || clip.smartCard?.title || 'Study Deadline') +
      '&details=' +
      encodeURIComponent(clip.extractedText || '') +
      (startCal ? '&dates=' + encodeURIComponent(startCal + '/' + startCal) : '');
    chrome.tabs.create({ url: calUrl });
    return;
  }

  if (action.actionId === 'send_email') {
    const gmailUrl =
      'https://mail.google.com/mail/?view=cm&fs=1' +
      (clip.emailTo ? '&to=' + encodeURIComponent(clip.emailTo) : '') +
      '&su=' +
      encodeURIComponent(clip.emailSubject || clip.smartCard?.title || '') +
      '&body=' +
      encodeURIComponent(clip.emailBody || clip.extractedText || '');
    chrome.tabs.create({ url: gmailUrl });
    return;
  }

  if (action.actionId === 'save_template') {
    const updated = buildModifiedClip(clip, {
      cardType: 'template',
      colorTag: 'blue',
      title: clip.emailSubject || clip.smartCard?.title || 'Saved Email Template',
      emailSubject: clip.emailSubject || clip.smartCard?.title || 'Course Email Template',
      content: clip.emailBody || clip.extractedText || clip.smartCard?.content || '',
    });
    await sendRuntimeMessage({ type: 'DELIVER_CLIP_TO_APP', clip: updated });
    setStatus('Saved as reusable Email Template in Smart Notebook.');
    return;
  }

  if (action.actionId === 'save_flashcard') {
    const updated = buildModifiedClip(clip, {
      cardType: 'flashcard',
      colorTag: 'emerald',
      title: clip.flashcardFront || clip.smartCard?.title || 'Concept Flashcard',
      content: clip.flashcardBack || clip.extractedText || clip.smartCard?.content || '',
      flashcardHint: clip.flashcardHint || '',
    });
    await sendRuntimeMessage({ type: 'DELIVER_CLIP_TO_APP', clip: updated });
    setStatus('Saved as interactive Flashcard in StudyTrack AI.');
    return;
  }

  if (action.actionId === 'practice_coach') {
    const q = encodeURIComponent(clip.flashcardFront || clip.smartCard?.title || clip.extractedText.slice(0, 120));
    chrome.tabs.create({ url: configuredAppUrl + '/?coach=' + q });
    return;
  }

  if (action.actionId === 'add_classwork') {
    const url =
      configuredAppUrl +
      '/?clip=' +
      encodeURIComponent(clip.handoffId || '') +
      '&task=1';
    chrome.tabs.create({ url });
    return;
  }

  // Default: save card to StudyTrack AI
  await sendRuntimeMessage({ type: 'DELIVER_CLIP_TO_APP', clip });
  setStatus('Saved to StudyTrack AI Smart Notebook.');
}

function renderClip(clip) {
  currentClip = clip;
  resultSection.classList.remove('hidden');
  resultMeta.textContent = (clip.smartCard?.courseCode || 'AIL1001') + ' · ' + (clip.smartCard?.cardType || 'note').toUpperCase();
  resultTitle.textContent = clip.smartCard?.title || 'Captured Clip';
  intentSummary.textContent = clip.intentSummary || '';
  extractedPreview.textContent = clip.extractedText || clip.smartCard?.content || '';

  smartActionsList.innerHTML = '';
  const actions = Array.isArray(clip.recommendedActions) ? clip.recommendedActions : [];
  actions.forEach((act) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'action-btn';
    btn.textContent = act.label;
    btn.title = act.description || '';
    btn.addEventListener('click', () => triggerSmartAction(act, clip));
    smartActionsList.appendChild(btn);
  });
}

async function renderRecentClips() {
  const res = await chrome.storage.local.get([STORAGE_KEYS.RECENT_CLIPS]);
  const list = Array.isArray(res[STORAGE_KEYS.RECENT_CLIPS]) ? res[STORAGE_KEYS.RECENT_CLIPS] : [];
  if (list.length === 0) {
    recentSection.classList.add('hidden');
    return;
  }
  recentSection.classList.remove('hidden');
  recentList.innerHTML = '';
  list.slice(0, 4).forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'recent-item';
    const left = document.createElement('span');
    left.textContent = item.title;
    const right = document.createElement('span');
    right.textContent = item.courseCode + ' · ' + item.cardType;
    btn.appendChild(left);
    btn.appendChild(right);
    btn.addEventListener('click', () => {
      if (item.clip) renderClip(item.clip);
    });
    recentList.appendChild(btn);
  });
}

async function runAnalyze({ imageDataUrl, text, pageUrl, pageTitle }) {
  setBusy(true);
  setStatus('Analyzing content & detecting smart actions...');
  try {
    const res = await sendRuntimeMessage({
      type: 'ANALYZE_AND_SAVE',
      payload: {
        imageDataUrl,
        text,
        pageUrl,
        pageTitle,
        openIfMissing: autoSaveToggle.checked,
      },
    });
    if (!res || !res.ok) {
      throw new Error(res?.error || 'Analysis failed.');
    }
    renderClip(res.clip);
    await renderRecentClips();
    setStatus(
      autoSaveToggle.checked
        ? 'Analyzed and auto-saved to StudyTrack AI!'
        : 'Smart actions detected. Choose an action below.',
    );
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Failed to analyze clip.', true);
  } finally {
    setBusy(false);
  }
}

captureTabBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active browser tab found.');
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    await runAnalyze({
      imageDataUrl: dataUrl,
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
    });
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Could not capture this tab.', true);
  }
});

readClipboardBtn.addEventListener('click', async () => {
  try {
    const clipText = await navigator.clipboard.readText();
    if (!clipText || !clipText.trim()) {
      setStatus('Clipboard is empty. Copy a date, email, definition, or code first.', true);
      return;
    }
    clipInput.value = clipText;
    await runAnalyze({ text: clipText });
  } catch {
    setStatus('Paste into the box below and click "Detect Smart Actions & Save".', true);
  }
});

analyzeTextBtn.addEventListener('click', async () => {
  const txt = clipInput.value.trim();
  if (!txt) {
    setStatus('Paste text first to detect smart actions.', true);
    return;
  }
  await runAnalyze({ text: txt });
});

openAppBtn.addEventListener('click', () => {
  if (!currentClip || !currentClip.handoffId) {
    chrome.tabs.create({ url: configuredAppUrl });
    return;
  }
  chrome.tabs.create({
    url: configuredAppUrl + '/?clip=' + encodeURIComponent(currentClip.handoffId),
  });
});

toggleSettingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

saveUrlBtn.addEventListener('click', async () => {
  const clean = appUrlInput.value.trim().replace(/\\/+$/, '');
  if (!clean) return;
  configuredAppUrl = clean;
  await chrome.storage.local.set({ [STORAGE_KEYS.APP_URL]: clean });
  setStatus('Saved StudyTrack AI App URL.');
});

autoSaveToggle.addEventListener('change', async () => {
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTO_SAVE]: autoSaveToggle.checked });
});

(async function init() {
  const res = await chrome.storage.local.get([STORAGE_KEYS.APP_URL, STORAGE_KEYS.AUTO_SAVE]);
  configuredAppUrl = (res[STORAGE_KEYS.APP_URL] || DEFAULT_APP_URL).replace(/\\/+$/, '');
  appUrlInput.value = configuredAppUrl;
  autoSaveToggle.checked = res[STORAGE_KEYS.AUTO_SAVE] !== false;
  await renderRecentClips();
})();
`;

  const readmeTxt = `StudyTrack AI — Chrome Extension Installation Guide
==================================================

1. Unzip this folder somewhere permanent on your computer (e.g., Documents/studytrack-ai-extension).
2. Open Google Chrome and visit: chrome://extensions
3. Turn ON "Developer mode" (top-right toggle).
4. Click "Load unpacked" and select the unzipped folder containing manifest.json.
5. Pin "StudyTrack AI — Smart Clipper & Screenshot" to your toolbar!

Features:
- Press Alt+Shift+S (or click "Screenshot Tab & Auto-Save") on any page to OCR & auto-save.
- Copy a Date/Deadline -> Set Chrome + StudyTrack Reminder & Google Calendar link.
- Copy a Letter/Email -> Open directly in Gmail Compose or Save as Reusable Email Template.
- Copy a Definition/Concept -> Save as Interactive Flip Flashcard or Practice in Mastery Coach.
- Copy Code -> Save as Formatted Code Card with language & editor settings.
`;

  return createZipBuffer([
    { name: 'manifest.json', data: Buffer.from(manifestJson, 'utf8') },
    { name: 'config.js', data: Buffer.from(configJs, 'utf8') },
    { name: 'background.js', data: Buffer.from(backgroundJs, 'utf8') },
    { name: 'content-bridge.js', data: Buffer.from(contentBridgeJs, 'utf8') },
    { name: 'popup.html', data: Buffer.from(popupHtml, 'utf8') },
    { name: 'popup.css', data: Buffer.from(popupCss, 'utf8') },
    { name: 'popup.js', data: Buffer.from(popupJs, 'utf8') },
    { name: 'README.txt', data: Buffer.from(readmeTxt, 'utf8') },
    { name: 'icons/icon16.png', data: createExtensionIconPng(16) },
    { name: 'icons/icon48.png', data: createExtensionIconPng(48) },
    { name: 'icons/icon128.png', data: createExtensionIconPng(128) },
  ]);
}
