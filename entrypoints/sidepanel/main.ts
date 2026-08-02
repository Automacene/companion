import '../../styles/theme.css';
import '../../styles/global.css';
import '../../styles/anim.css';
import '../../styles/sidepanel.css';

import { VercelConversation } from '../../lib/conversation';
import { initGhostOverlay } from '../../lib/anim';
import { checkOllamaConnection, streamChatResponse } from '../../lib/model';
import { renderMarkdown } from '../../lib/markdown';

const OLLAMA_HOST = 'http://localhost:11434';
const MODEL_NAME = 'llama3';

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
          connTimeout: s?.connTimeout || 5000,
          activeModel: s?.activeModel || MODEL_NAME,
          fallbackModel: s?.fallbackModel || '',
          systemPrompt:
            s?.systemPrompt ||
            'You are Automacene Companion, an AI sidepanel assistant analyzing webpage context concisely and accurately.',
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
        connTimeout: s.connTimeout || 5000,
        activeModel: s.activeModel || MODEL_NAME,
        fallbackModel: s.fallbackModel || '',
        systemPrompt:
          s.systemPrompt ||
          'You are Automacene Companion, an AI sidepanel assistant analyzing webpage context concisely and accurately.',
        streamResponses: s.streamResponses ?? true,
      };
    } catch {
      // ignore invalid storage payloads
    }
  }

  return {
    ollamaHost: OLLAMA_HOST,
    connTimeout: 5000,
    activeModel: MODEL_NAME,
    fallbackModel: '',
    systemPrompt:
      'You are Automacene Companion, an AI sidepanel assistant analyzing webpage context concisely and accurately.',
    streamResponses: true,
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  // Initialize background ghost grid animation
  initGhostOverlay('grid-overlay');

  // 1. UI Selectors
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

  // 2. Initialize Conversation Manager
  const conversation = new VercelConversation(
    settings.systemPrompt ||
      'You are Automacene Companion, an AI sidepanel assistant analyzing webpage context concisely and accurately.',
    8000
  );

  // 3. UI Status Updating Helper
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

  // 4. Chat Bubble Rendering Helper
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

  // 5. Send Message & Stream Response using Vercel AI SDK Infrastructure
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
    conversation.addUser(prompt);
    chatInput.value = '';

    runBtn.disabled = true;
    runBtn.innerText = 'Running...';

    const aiBubble = appendBubble('assistant', '');

    try {
      // Delegate streaming logic to lib/model.ts via Vercel streamText
      let accumulatedText = '';

      await streamChatResponse(
        {
          ollamaHost: hostUrl,
          activeModel: modelName,
        },
        conversation.getMessages(),
        (textDelta) => {
          accumulatedText += textDelta;
          aiBubble.innerHTML = renderMarkdown(accumulatedText);
          chatContainer!.scrollTop = chatContainer!.scrollHeight;
        }
      );

      // Store final assistant message in conversation context
      conversation.addAssistant(accumulatedText);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      aiBubble.innerText = `Error: ${message}`;
      aiBubble.classList.add('text-rose-600');
    } finally {
      runBtn.disabled = false;
      runBtn.innerText = 'Run →';
    }
  });
});