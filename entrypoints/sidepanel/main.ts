import '../../styles/theme.css';
import '../../styles/global.css';
import '../../styles/anim.css';
import '../../styles/sidepanel.css';

import { initGhostOverlay } from '../../lib/anim';
import { DEFAULT_CONN_TIMEOUT, DEFAULT_SYSTEM_PROMPT, MODEL_NAME, OLLAMA_HOST, SIDEPANEL_CONNECTION_NAME } from '../../lib/constants';
import { checkOllamaConnection } from '../../lib/model';
import { renderMarkdown } from '../../lib/markdown';
import { PortAction } from '../../types/actions';
import type { ModelMessage } from 'ai';

interface ExtensionSettings {
  ollamaHost?: string;
  connTimeout?: number;
  activeModel?: string;
  fallbackModel?: string;
  systemPrompt?: string;
  streamResponses?: boolean;
}

function getStorage() {
  if (typeof browser !== 'undefined' && browser.storage && browser.storage.local) {
    return browser.storage.local;
  }
  return null;
}

async function loadSettings(): Promise<ExtensionSettings> {
  const storage = getStorage();
  if (storage) {
    return new Promise((resolve) => {
      (storage as Browser.storage.StorageArea).get(['extensionSettings'], (items) => {
        const s = items?.extensionSettings as ExtensionSettings | undefined;
        resolve({
          ollamaHost: s?.ollamaHost || OLLAMA_HOST,
          connTimeout: s?.connTimeout || DEFAULT_CONN_TIMEOUT,
          activeModel: s?.activeModel || MODEL_NAME,
          fallbackModel: s?.fallbackModel || '',
          systemPrompt:
            s?.systemPrompt || DEFAULT_SYSTEM_PROMPT,
          streamResponses: s?.streamResponses ?? true,
        });
      });
    });
  }

  const raw = localStorage.getItem('extensionSettings');
  if (raw) {
    try {
      const s = JSON.parse(raw) as ExtensionSettings;
      return {
        ollamaHost: s.ollamaHost || OLLAMA_HOST,
        connTimeout: s.connTimeout || DEFAULT_CONN_TIMEOUT,
        activeModel: s.activeModel || MODEL_NAME,
        fallbackModel: s.fallbackModel || '',
        systemPrompt:
          s.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        streamResponses: s.streamResponses ?? true,
      };
    } catch {
      // ignore invalid storage payloads
    }
  }

  return {
    ollamaHost: OLLAMA_HOST,
    connTimeout: DEFAULT_CONN_TIMEOUT,
    activeModel: MODEL_NAME,
    fallbackModel: '',
    systemPrompt: DEFAULT_SYSTEM_PROMPT,
    streamResponses: true,
  };
}

async function getCurrentTabId(): Promise<number> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? -1;
  } catch {
    return -1;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize background ghost grid animation
  initGhostOverlay('grid-overlay');
  const statusDot = document.getElementById('status-dot') as HTMLElement | null;
  const statusPill = document.getElementById('status-pill') as HTMLElement | null;
  const chatContainer = document.getElementById('chat-container') as HTMLElement | null;
  const chatForm = document.getElementById('chat-form') as HTMLFormElement | null;
  const chatInput = document.getElementById('chat-input') as HTMLInputElement | null;
  const runBtn = document.getElementById('run-btn') as HTMLButtonElement | null;
  const hero = document.querySelector('.brand-hero') as HTMLElement | null;
  const pulser = document.querySelector('.brand-status-badge') as HTMLElement | null;

  if (!statusDot || !statusPill || !chatContainer || !chatForm || !chatInput || !runBtn) {
    console.warn('Missing UI elements in sidepanel');
    return;
  }

  const settings = await loadSettings();

  // Establish port connection to background state
  const port = browser.runtime.connect({ name: SIDEPANEL_CONNECTION_NAME });
  let currentActiveTabId = await getCurrentTabId();
  let aiBubble: HTMLDivElement | null = null;

  // UI Status Updating Helper
  async function updateConnectionStatus(
    hostUrl = settings.ollamaHost || OLLAMA_HOST
  ): Promise<boolean> {
    const { success } = await checkOllamaConnection(hostUrl);

    if (success) {
      statusDot!.className = 'status-indicator-dot connected';
      statusPill!.className = 'status-badge connected';
      statusPill!.innerText = '[ 200 OK ]';
      return true;
    }

    statusDot!.className = 'status-indicator-dot error';
    statusPill!.className = 'status-badge error';
    statusPill!.innerText = '[ OFFLINE ]';
    return false;
  }

  await updateConnectionStatus();

  pulser?.addEventListener('click', () => {
    hero?.classList.remove('is-collapsed');
  });

  // Chat Bubble Rendering Helper
  function appendBubble(role: 'user' | 'assistant', initialText = ''): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-bubble-row ${role}`;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;

    if (role === 'assistant') {
      bubble.classList.add('markdown-body');
      bubble.innerHTML = renderMarkdown(initialText);
    } else {
      bubble.innerText = initialText;
    }

    wrapper.appendChild(bubble);
    chatContainer!.appendChild(wrapper);
    chatContainer!.scrollTop = chatContainer!.scrollHeight;

    return bubble;
  }

  function renderHistory(messages: ModelMessage[]) {
    chatContainer!.innerHTML = '';
    const nonSystem = messages.filter((m) => m.role !== 'system');

    if (nonSystem.length > 0) {
      hero?.classList.add('is-collapsed');
    }

    for (const msg of nonSystem) {
      const text = typeof msg.content === 'string' ? msg.content : '';
      if (msg.role === 'user' || msg.role === 'assistant') {
        appendBubble(msg.role, text);
      }
    }
  }

  // Handle Port Stream Responses from Background
  port.onMessage.addListener((msg) => {
    if (msg.action === PortAction.HISTORY_RESPONSE) {
      renderHistory(msg.messages);
    }

    if (msg.action === PortAction.STREAM_CHUNK) {
      if (aiBubble) {
        aiBubble.innerHTML = renderMarkdown(msg.fullText);
        chatContainer!.scrollTop = chatContainer!.scrollHeight;
      }
    }

    if (msg.action === PortAction.STREAM_COMPLETE) {
      runBtn.disabled = false;
      runBtn.innerText = 'Run →';
      aiBubble = null;
    }

    if (msg.action === PortAction.STREAM_ERROR) {
      if (aiBubble) {
        aiBubble.innerText = `Error: ${msg.error}`;
        aiBubble.classList.add('text-rose-600');
      }
      runBtn.disabled = false;
      runBtn.innerText = 'Run →';
      aiBubble = null;
    }
  });

  // Load initial history for active tab
  port.postMessage({
    action: PortAction.GET_HISTORY,
    tabId: currentActiveTabId,
    systemPrompt: settings.systemPrompt,
  });

  // Switch conversation view when browser active tab changes
  browser.tabs.onActivated.addListener(async (activeInfo) => {
    currentActiveTabId = activeInfo.tabId;
    port.postMessage({
      action: PortAction.GET_HISTORY,
      tabId: currentActiveTabId,
      systemPrompt: settings.systemPrompt,
    });
  });

  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.shiftKey) {
      event.preventDefault();
      const start = chatInput.selectionStart ?? chatInput.value.length;
      const end = chatInput.selectionEnd ?? chatInput.value.length;
      const value = chatInput.value;
      chatInput.value = `${value.slice(0, start)}\n${value.slice(end)}`;
      const pos = start + 1;
      chatInput.setSelectionRange(pos, pos);
    }
  });

  // Send Message & Stream Response via Background Process
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = chatInput.value.trim();
    if (!prompt) return;

    const currentSettings = await loadSettings();
    const hostUrl = currentSettings.ollamaHost || OLLAMA_HOST;
    const modelName = currentSettings.activeModel || MODEL_NAME;

    const isConnected = await updateConnectionStatus(hostUrl);
    if (!isConnected) {
      alert(
        `Ollama is not reachable at ${hostUrl}. Make sure Ollama is open and the host/model settings are correct.`
      );
      return;
    }

    hero?.classList.add('is-collapsed');

    appendBubble('user', prompt);
    chatInput.value = '';

    runBtn.disabled = true;
    runBtn.innerText = 'Running...';

    aiBubble = appendBubble('assistant', '');

    // Send prompt to background worker
    port.postMessage({
      action: PortAction.SEND_MESSAGE,
      tabId: currentActiveTabId,
      prompt,
      hostUrl,
      modelName,
      systemPrompt: currentSettings.systemPrompt,
    });
  });
});