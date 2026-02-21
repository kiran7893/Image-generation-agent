# Image Generation Agent

A small CLI agent built with React Ink and OpenRouter. It can answer questions and generate images using two different models through OpenRouter based on the user's intent.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and add your `OPENROUTER_API_KEY`.
   ```bash
   cp .env.example .env
   ```
3. Customise `TEXT_MODEL` and `IMAGE_MODEL` in `.env` if desired.

## Run

```bash
npm start
```

## Features
- **Text Generation**: Replies to conversational inputs via `TEXT_MODEL`.
- **Image Generation with Prompt Expansion**: When a user asks to generate an image, a specialized subagent intercepts the vague prompt, expands it into a highly detailed description (specifying lighting, mood, camera angles, and art style) using the `TEXT_MODEL`, and then uses the `IMAGE_MODEL` to generate the result. Images are downloaded automatically to the `outdir` folder.

## Tech Stack & Architecture

- **React Ink**: We use React-Ink to build interactive CLI interfaces using React components.
- **OpenRouter API**: The core AI logic is powered by the OpenAI SDK configured to point to OpenRouter, allowing us to seamlessly switch between different LLMs for text and image tasks.
- **Subagent Architecture**: The application employs a modular agent pattern. The primary agent handles the conversation loop and tool routing, while specialized subagents (like the image prompt expander) are invoked for specific complex tasks.

