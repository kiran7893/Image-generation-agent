# RULES

1. **User Intent Focus**: The agent determines the user's intent purely through natural language.
2. **Text Conversation**: By default, the text model responds directly to text inputs.
3. **Image Generation**: When the user requests an image generation, a separate tool/model is triggered to produce the image via OpenRouter.
4. **Storage Location**: All generated images must be downloaded and stored locally in the `outdir` directory relative to the project root.
