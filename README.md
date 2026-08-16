# Automacene Companion

<p align="center">
  <img src="assets/logo.svg" alt="Automacene Logo" width="440" />
</p>

<p align="center" style="font-size: 1.5rem; font-weight: 700; margin: 0.5rem 0;">
  Power <span style="color: #ea580c;">your</span> agents with <span style="color: #ea580c;">your data</span>
</p>

<p align="center" style="font-size: 1rem; margin-top: 0.25rem;">
  A <b>data companion</b> for all of your online activities
</p>

<p style="font-size: 0.875rem; color: #71717a; margin-top: 0.75rem;">
  <i>A 100% open-source, privacy-first AI companion for your browser—powered by your local hardware, not subscription fees.</i>
</p>

Automacene Companion is a browser sidepanel extension designed to give you instant, context-aware AI assistance using self-hosted LLMs. By connecting directly to your local **Ollama** instance, Automacene Companion ensures your data stays private, your workflows remain uninterrupted, and you never have to pay a monthly fee to proprietary AI providers.

## Mission

The goal of the Automacene ecosystem is simple: **democratize AI with a 100% open-source stack.**

* **Open-Source Models:** Run models like `llama3`, `mistral`, or `phi3` locally.
* **Zero Cloud Dependencies:** Your data never leaves your machine.
* **Zero Subscription Costs:** Completely free to use forever.
* **Extensible Architecture:** Designed to evolve alongside local desktop applications, custom tool configurations, and self-hosted databases.

## Features

* **Interactive Sidepanel UI:** Clean, minimalist glassmorphic interface with real-time connection status indicators.
* **Streaming Responses:** Smooth, token-by-token LLM output powered by the Vercel AI SDK framework.
* **Full Markdown & Code Rendering:** GitHub-Flavored Markdown support with formatted code blocks, tables, and list structures.
* **Local Ollama Integration:** Connects seamlessly to your local Ollama instance running on `http://localhost:11434`.
* **Advanced Settings Panel:**
* Switch primary and fallback models on the fly.
* Adjust hyperparameters (`temperature`, `top-p`, `top-k`, `repeat-penalty`, `num_ctx`, `num_predict`).
* Customize system prompts and character memory limits.
* Configure VRAM keep-alive and connection timeouts.

## Quick Start

### Prerequisites

1. **Node.js** (v18+ recommended) & `npm` / `pnpm`.
2. **Ollama** installed and running on your local machine ([Download Ollama](https://ollama.com)).
3. A Chromium-based browser or Firefox with extension sidepanel support.

### Step 1: Configure Ollama for Cross-Origin Requests (CORS)

Because browser extensions run under strict origin security policies, you must allow browser origins when launching Ollama.

#### **macOS / Linux**

Set the `OLLAMA_ORIGINS` environment variable before running Ollama:
```bash
export OLLAMA_ORIGINS="*"
ollama serve
```

#### **Windows**

1. Quit Ollama from the system tray.
2. Open **Environment Variables** in Control Panel / System Properties.
3. Add a new **User Variable**:
* **Variable name:** `OLLAMA_ORIGINS`
* **Variable value:** `*`

4. Relaunch Ollama from your Start menu or terminal (`ollama serve`).

### Step 2: Install Local Models

Pull your preferred model via terminal:
```bash
ollama run llama3
```

*(You can also pull `mistral`, `phi3`, or any other model supported by Ollama).*

### Step 3: Build & Load the Extension

1. **Clone the repository:**
```bash
git clone https://github.com/automacene/companion.git
cd companion
```

2. **Install dependencies & build:**
```bash
npm install
npm run build
```

3. **Load into Browser:**
* **Chrome / Brave / Edge:**
1. Open `chrome://extensions/`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked** and select the generated `dist/` folder.

* **Firefox:**
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...** and select `manifest.json` inside the build directory.


## Configuration & Settings

Access the **Automacene Settings** page by right-clicking the extension icon and selecting **Options**, or clicking through the extension interface.

| Setting | Description | Default |
| --- | --- | --- |
| **Ollama Host URL** | Local API endpoint for Ollama | `http://localhost:11434` |
| **Primary Model** | Active LLM for sidepanel chat | `llama3` |
| **Fallback Model** | Backup model if primary fails | `mistral` |
| **Temperature** | Controls response randomness | `0.7` |
| **VRAM Keep Alive** | Duration to keep model loaded in GPU | `5m` |
| **Stream Token Responses** | Enables real-time streaming output | `Enabled` |

## Roadmap & Future Development

* [ ] **Direct Model Pulling:** Download new Ollama models straight from the Settings UI using `ollama pull`.
* [ ] **Desktop Companion App:** Orchestrate local databases, Docker containers, and system resources to extend agent capabilities.
* [ ] **Tool Integration Engine:** Configure custom backend tools, page scrapers, and data mapping triggers directly from the interface.

## License

Distributed under the **Apache 2.0 License**.

You are fully free to fork, modify, reskin, redistribute, commercialize, or integrate this codebase into your own products. The goal is to get powerful, self-hosted AI tools into as many hands as possible. See `LICENSE` for the full license text.
