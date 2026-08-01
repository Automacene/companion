import '../../styles/theme.css';
import '../../styles/global.css';
import '../../styles/anim.css';
import '../../styles/sidepanel.css';
import { VercelConversation } from '../../lib/conversation';
import { initGhostOverlay } from '../../lib/anim';

const OLLAMA_HOST = 'http://localhost:11434';
const MODEL_NAME = 'llama3';

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

  if (!statusDot || !statusPill || !chatContainer || !chatForm || !chatInput || !runBtn) {
    console.warn('Missing UI elements in sidepanel');
    return;
  }

  // 2. Initialize Conversation Manager
  const conversation = new VercelConversation(
    'You are Automacene Companion, an AI sidepanel assistant analyzing webpage context concisely and accurately.',
    8000
  );

  // 3. Healthcheck Ollama Connection
  async function checkOllamaConnection(): Promise<boolean> {
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/tags`, { method: 'GET' });
      if (res.ok) {
        statusDot!.className = 'status-indicator-dot connected';
        statusPill!.className = 'status-badge connected';
        statusPill!.innerText = '[ 200 OK ]';
        return true;
      }
    } catch {
      // Failed to connect
    }

    statusDot!.className = 'status-indicator-dot error';
    statusPill!.className = 'status-badge error';
    statusPill!.innerText = '[ OFFLINE ]';
    return false;
  }

  await checkOllamaConnection();

  // 4. Chat Bubble Rendering Helper
  function appendBubble(role: 'user' | 'assistant', initialText = ''): HTMLDivElement {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-bubble-row ${role}`;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;

    bubble.innerText = initialText;
    wrapper.appendChild(bubble);
    chatContainer!.appendChild(wrapper);
    chatContainer!.scrollTop = chatContainer!.scrollHeight;

    return bubble;
  }

  // 5. Send Message & Stream Response from Ollama
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const prompt = chatInput.value.trim();
    if (!prompt) return;

    const isConnected = await checkOllamaConnection();
    if (!isConnected) {
      alert('Ollama is not running locally. Make sure Ollama is open and running on http://localhost:11434');
      return;
    }

    appendBubble('user', prompt);
    conversation.addUser(prompt);
    chatInput.value = '';

    runBtn.disabled = true;
    runBtn.innerText = 'Running...';

    const aiBubble = appendBubble('assistant', '');

    try {
      const response = await fetch(`${OLLAMA_HOST}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: conversation.getMessages(),
          stream: true,
        }),
      });

      if (!response.body) throw new Error('ReadableStream not supported.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullAssistantText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(Boolean);

        for (const line of lines) {
          try {
            const parsed = JSON.parse(line);
            if (parsed.message?.content) {
              fullAssistantText += parsed.message.content;
              aiBubble.innerText = fullAssistantText;
              chatContainer!.scrollTop = chatContainer!.scrollHeight;
            }
          } catch {
            // Ignore partial JSON chunks
          }
        }
      }

      conversation.addAssistant(fullAssistantText);

    } catch (err) {
      aiBubble.innerText = `Error: Failed to reach Ollama. (${(err as Error).message})`;
      aiBubble.classList.add('text-rose-600');
    } finally {
      runBtn.disabled = false;
      runBtn.innerText = 'Run →';
    }
  });
});