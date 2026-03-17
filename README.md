# Image Generation Agent

A small CLI agent built with React Ink. It can chat via OpenRouter and generate images through ComfyUI (default), ComfyICU, or OpenRouter.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set your variables:
   ```bash
   cp .env.example .env
   ```
3. Configure `.env`:
   - `OPENROUTER_API_KEY` for text generation and prompt expansion.
   - `IMAGE_BACKEND=comfyui` (default), `IMAGE_BACKEND=comfyicu`, or `IMAGE_BACKEND=openrouter`.
   - `COMFYUI_BASE_URL` for local or hosted ComfyUI (for example `http://127.0.0.1:8188`).
   - Optional: `COMFYUI_API_KEY` for Comfy Cloud or protected endpoints.
   - For ComfyICU: `COMFYICU_BASE_URL`, `COMFYICU_API_KEY`, and optional `COMFYICU_ACCELERATOR` (default `T4`).
   - Workflow/poll/timeout are project-managed defaults (no env setup needed).
   - If using OpenRouter images, set `IMAGE_MODEL`.

## Run

```bash
npm start
```

## Features
- **Text Generation**: Replies to conversational inputs via `TEXT_MODEL`.
- **Image Generation with Prompt Expansion**: When a user asks to generate an image, the prompt is expanded using the text model and then sent to the selected image backend.
- **ComfyUI Support (Default)**:
  - Uses ComfyUI REST API (`/prompt`, `/history`, `/view`).
  - Supports local ComfyUI and hosted/web ComfyUI URLs via `COMFYUI_BASE_URL`.
  - Uses the vendored workflow at `src/workflows/comfyui/zimage_standard.json` by default.
  - Saves generated images to `outdir`.
- **ComfyICU Support**:
  - Uses ComfyICU run APIs:
    - `POST /api/v1/workflows/{workflow_id}/runs`
    - `GET /api/v1/workflows/{workflow_id}/runs/{run_id}`
  - Reuses the same prompt-expanded workflow payload.
  - Saves generated images to `outdir`.

## ComfyUI usage

### 1) Local ComfyUI
- Start ComfyUI locally and ensure API is reachable on your configured port.
- Example:
  - `COMFYUI_BASE_URL=http://127.0.0.1:8188`
  - `IMAGE_BACKEND=comfyui`

### 2) Hosted/Web ComfyUI
- Point `COMFYUI_BASE_URL` to your reachable ComfyUI endpoint.
- Keep `IMAGE_BACKEND=comfyui`.
- The same workflow injection and polling flow is used.

### 3) Workflow defaults
- Default workflow file: `src/workflows/comfyui/zimage_standard.json`.
- Runtime injection updates:
  - Positive prompt in the positive `CLIPTextEncode` node.
  - Negative prompt in the negative `CLIPTextEncode` node.

## Fallback backend

If needed, switch to OpenRouter image generation:

```env
IMAGE_BACKEND=openrouter
IMAGE_MODEL=google/imagen-3
```

## ComfyICU quick start

```env
IMAGE_BACKEND=comfyicu
COMFYICU_BASE_URL=https://comfy.icu
COMFYICU_API_KEY=your_comfyicu_api_key
COMFYICU_ACCELERATOR=T4
```

Set ComfyICU workflow IDs in `src/workflows/comfyicu/workflow-registry.json` (project-managed), so you can add multiple workflows without putting IDs in `.env`.

Runtime commands:
- `/workflows` to list workflow keys from the registry.
- `/workflow <key>` to switch current ComfyICU workflow in the running session.

## Troubleshooting

- **ComfyUI `/prompt` fails**: verify `COMFYUI_BASE_URL`, workflow compatibility, and installed nodes/models.
- **Timeout waiting for image**: increase timeout defaults in `src/agent.ts` and confirm ComfyUI is processing jobs.
- **No image in history output**: verify your workflow ends in `SaveImage` and produces image outputs.
- **Workflow file error**: confirm `src/workflows/comfyui/zimage_standard.json` exists and is valid JSON.
- **Cloud auth fails (401/403)**: set `COMFYUI_API_KEY` and confirm your Cloud account key is active.
- **ComfyICU run creation fails**: verify `COMFYICU_API_KEY` and the mapped workflow ID in `src/workflows/comfyicu/workflow-registry.json`.
- **ComfyICU cost is higher than expected**: set `COMFYICU_ACCELERATOR=T4` (or another cheaper accelerator available in your account/workflow).

## Tech Stack & Architecture

- **React Ink**: We use [Ink](https://github.com/vadimdemedes/ink) to build interactive CLI interfaces using React components.
- **OpenRouter API**: The agent uses the OpenAI SDK against OpenRouter for text chat and prompt expansion.
- **ComfyUI API**: Image generation (default) is executed via ComfyUI workflows and downloaded from ComfyUI output endpoints.
- **Modular agent flow**: Chat routing, prompt expansion, and image backend execution are split into focused modules.
