The Cockpit is a browser front end for the same commands the CLI runs. It lets you observe and steer what Construct does, instead of typing each command. It lives in the repository under `ui/`.

## Start it

```bash
cd ui/server && npm install && npm start      # backend on http://localhost:4000
cd ui/client && npm install && npm run dev    # frontend on http://localhost:3000
```

Open <http://localhost:3000>. The backend only accepts requests from `http://localhost:3000`; if you serve the frontend elsewhere, start the backend with `UI_CLIENT_ORIGIN` set to that address.

Start with **Settings** to choose the project directory the UI works on (it is passed as `--dir` to every command). This is held in memory only, so restarting the backend resets it.

## The screens

| Screen | What you do there |
|---|---|
| **Dashboard** | Four independent forms: **Create** (a feature, one layer file, or a multi-layer slice), **Refactor** (move or rename), **Research** (doctor, summarize) and **Import** (for one known file or an approved plan). Each shows its own result. |
| **Import Wizard** | A chat-style, guided version of `construct import --route`: name a route, answer questions, review the proposed plan and approve it before anything is written. |
| **Pages Editor** | Browse a page's element tree and edit it visually; changes are written back to source. |
| **Workflows** | See each XState workflow as a diagram, with a plain-English explanation, its scenarios and health findings beneath. |
| **Local Model** | Manage the local Ollama model used for small, scoped code-writing steps. |
| **Settings** | Project directory and which AI provider each optional capability uses. |
| **Help** | Built-in tutorials and the CLI reference. |

## How AI is handled in the UI

Choosing a provider in Settings never triggers a call by itself. A step calls a model only when you tick an explicit box on that form (for example "Have the LLM write the implementation"), and then it uses the provider Settings names for that capability. Whole-feature planning in the Import Wizard is restricted to a hosted provider, not a local model, and the wizard always asks for your approval before writing files.

## Tutorials with screenshots

Each [tutorial](@user-guide/tutorials/) shows the CLI and Cockpit routes to the same result, with real screenshots.
