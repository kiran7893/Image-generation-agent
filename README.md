# Image Generation Agent

A small CLI agent built with React Ink. It can chat via OpenRouter and generate images through a ComfyUI-compatible wrapper endpoint (default) or OpenRouter.

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
   - `IMAGE_BACKEND=comfyui` (default) or `IMAGE_BACKEND=openrouter`.
   - `COMFYUI_BASE_URL` should point to your local ComfyUI server or your wrapper URL (must expose `/prompt`, `/history`, `/view`).
   - Workflow/poll/timeout are project-managed defaults (no env setup needed).
   - If using OpenRouter images, set `IMAGE_MODEL`.

## Run

```bash
npm start
```

## Features
- **Text Generation**: Replies to conversational inputs via `TEXT_MODEL`.
- **Image Generation with Prompt Expansion**: When a user asks to generate an image, the prompt is expanded using the text model and then sent to the selected image backend.
- **ComfyUI Wrapper Support (Default)**:
  - Uses ComfyUI REST API (`/prompt`, `/history`, `/view`).
  - Supports local ComfyUI and wrapper/web URLs via `COMFYUI_BASE_URL`.
  - Uses the vendored workflow at `src/workflows/comfyui/zimage_standard.json` by default.
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

## Troubleshooting

- **ComfyUI `/prompt` fails**: verify `COMFYUI_BASE_URL`, workflow compatibility, and installed nodes/models.
- **Timeout waiting for image**: increase timeout defaults in `src/agent.ts` and confirm ComfyUI is processing jobs.
- **No image in history output**: verify your workflow ends in `SaveImage` and produces image outputs.
- **Workflow file error**: confirm `src/workflows/comfyui/zimage_standard.json` exists and is valid JSON.

## Tech Stack & Architecture

- **React Ink**: We use [Ink](https://github.com/vadimdemedes/ink) to build interactive CLI interfaces using React components.
- **OpenRouter API**: The agent uses the OpenAI SDK against OpenRouter for text chat and prompt expansion.
- **ComfyUI API**: Image generation (default) is executed via ComfyUI-compatible endpoints exposed by local ComfyUI or your wrapper.
- **Modular agent flow**: Chat routing, prompt expansion, and image backend execution are split into focused modules.
