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

* **Interactive Sidepanel UI:** Clean, minimalist interface with an animated backdrop and real-time connection status.
* **Streaming Responses:** Token-by-token output, streamed straight from Ollama's NDJSON endpoint.
* **Full Markdown & Code Rendering:** GitHub-Flavored Markdown with formatted code blocks, tables, and lists.
* **Local Ollama Integration:** Connects to your local Ollama instance, `http://localhost:11434` by default.
* **Reads the page you are on:** Extracts what a reader would actually see rather than scraping raw HTML, and tells you how much of a reread you already had before you store it again.
* **Memory that spans tabs:** Every conversation writes into one shared archive, and pages are kept in fragments so recall returns the paragraph that matched rather than the whole document.
* **Conversations survive a restart:** A tab is recognised after the browser reopens by the page it is on, how deep its history is, and where it sits in the strip — Chrome reassigns tab ids, so nothing else would find it.
* **Inspect and prune what it knows:** A memory page that browses, filters, and deletes stored items the way a browser history window does.
* **Advanced Settings:**
* Switch models on the fly.
* Adjust hyperparameters (`temperature`, `top-p`, `top-k`, `repeat-penalty`, `num_ctx`, `num_predict`).
* Customize the system prompt.
* Divide the context window between the reply, the attached page, conversation history, and recall.

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
3. Click **Load unpacked** and select the generated `.output/chrome-mv3` folder.

* **Firefox:** not currently targeted. WXT can produce a Firefox build, but the
  extension is developed and tested against Chromium only.


## Configuration & Settings

Access the **Automacene Settings** page by right-clicking the extension icon and selecting **Options**, or clicking through the extension interface.

| Setting | Description | Default |
| --- | --- | --- |
| **Ollama Host URL** | Local API endpoint for Ollama | `http://localhost:11434` |
| **Active Model** | The model that answers | `llama3` |
| **Temperature** | Controls response randomness | `0.7` |
| **Context Length** (`num_ctx`) | How much the model can hold at once. Every memory budget is a share of this. | `4096` |
| **Room to answer** | Held back so the model has space to reply | `25%` |
| **Attached page** | Room for one page read | `20%` |
| **Conversation history** | How much of this tab stays in the prompt verbatim | `30%` |
| **Recalled memory** | Room for what comes back from other tabs and earlier browsing | `15%` |
| **Conversations recalled** | How many past exchanges a question may bring back | `8` |
| **Page fragments recalled** | How many pieces of read pages a question may bring back | `4` |

> `num_ctx` decides how much memory Ollama allocates, not just how much the
> model remembers. A large context on a card that cannot hold it spills into
> system RAM and can exhaust the machine — a 3B model at 128k needs roughly
> 15 GB. If the first message after changing it is very slow or the machine
> stalls, lower it.

## Development

```bash
npm install
npm run dev     # loads a browser with the extension and reloads on change
npm run build   # writes .output/chrome-mv3
```

**Browser binary.** `npm run dev` launches the browser named by
`webExt.binaries.chrome` in `wxt.config.ts`, which defaults to
`/usr/bin/brave-browser`. Set `CHROME_BIN` to override it on another machine:

```bash
CHROME_BIN="/path/to/chrome" npm run dev
```

**Reloading.** Reloading the extension does not inject content scripts into
tabs that are already open, so reload the page too when testing anything that
touches a page — page reading, or how a tab is recognised.

**The service worker.** MV3 stops it whenever it goes idle. Inspect it from
`chrome://extensions` → Developer mode → **service worker**; its console is
where the background half logs. `__TEST_SERVICES__` is exposed there for
poking at the running state.

## Roadmap & Future Development

* [ ] **Direct Model Pulling:** Download new Ollama models straight from the Settings UI using `ollama pull`.
* [ ] **Desktop Companion App:** Orchestrate local databases, Docker containers, and system resources to extend agent capabilities.
* [ ] **Tool Integration Engine:** Configure custom backend tools, page scrapers, and data mapping triggers directly from the interface.

## License

Distributed under the **Apache 2.0 License**.

You are fully free to fork, modify, reskin, redistribute, commercialize, or integrate this codebase into your own products. The goal is to get powerful, self-hosted AI tools into as many hands as possible. See `LICENSE` for the full license text.
