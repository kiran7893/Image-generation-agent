import OpenAI from "openai";
import * as fs from "fs/promises";
import * as path from "path";
import dotenv from "dotenv";
import { expandImagePrompt } from "./agent/imageGenAgent.js";
import { generateAndSaveImageWithComfy } from "./agent/comfyClient.js";
import { generateAndSaveImageWithComfyIcu, listComfyIcuWorkflowKeys } from "./agent/comfyIcuClient.js";

// Setup dotenv manually due to ink execution
dotenv.config();

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
export const TEXT_MODEL = process.env.TEXT_MODEL || "openai/gpt-4o-mini";
const IMAGE_MODEL = process.env.IMAGE_MODEL || "google/imagen-3";
const IMAGE_BACKEND = (process.env.IMAGE_BACKEND || "comfyui").toLowerCase();
const COMFYUI_BASE_URL = process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188";
const COMFYUI_API_KEY = process.env.COMFYUI_API_KEY || "";
const COMFYUI_WORKFLOW_PATH = "./src/workflows/comfyui/zimage_standard.json";
const COMFYUI_POLL_INTERVAL_MS = 1500;
const COMFYUI_TIMEOUT_MS = 120000;
const COMFYICU_BASE_URL = process.env.COMFYICU_BASE_URL || "https://comfy.icu";
const COMFYICU_API_KEY = process.env.COMFYICU_API_KEY || "";
const COMFYICU_ACCELERATOR = process.env.COMFYICU_ACCELERATOR || "T4";
const COMFYICU_POLL_INTERVAL_MS = 2000;
const COMFYICU_TIMEOUT_MS = 180000;
let selectedComfyIcuWorkflowKey: string | undefined;

export const openrouter = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: OPENROUTER_API_KEY,
    defaultHeaders: {
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "React Ink Agent",
    }
});

export type Message = { role: "system" | "user" | "assistant"; content: string };

const systemPrompt = `You are a specialized image generation agent. Your primary purpose is to help users create, refine, and generate high-quality images.
If the user just talks or asks questions, reply normally in text, offering advice on image creation if relevant.
If the user asks you to generate, create, or draw an image, you MUST call the "generate_image" tool with the full image prompt. Be concise.`;

export async function chat(messages: Message[], onUpdate: (text: string) => void): Promise<string> {
    const commandResult = await tryHandleCommands(messages);
    if (commandResult) return commandResult;

    const fullMessages = [{ role: "system", content: systemPrompt }, ...messages] as any[];

    try {
        const response = await openrouter.chat.completions.create({
            model: TEXT_MODEL,
            messages: fullMessages,
            tools: [
                {
                    type: "function",
                    function: {
                        name: "generate_image",
                        description: "Generates an image based on the user's prompt",
                        parameters: {
                            type: "object",
                            properties: {
                                prompt: { type: "string", description: "The descriptive image prompt to pass to the image generator." }
                            },
                            required: ["prompt"]
                        }
                    }
                }
            ],
            tool_choice: "auto"
        });

        const choice = response.choices[0];
        if (choice?.message?.tool_calls && choice.message.tool_calls.length > 0) {
            const toolCall = choice.message.tool_calls[0];
            if (toolCall?.function?.name === "generate_image") {
                try {
                    const args = JSON.parse(toolCall.function.arguments || "{}");
                    onUpdate(`Expanding prompt: "${args.prompt}"...`);
                    const { prompt: detailedPrompt, negativePrompt } = await expandImagePrompt(args.prompt);
                    const backendLabel = IMAGE_BACKEND === "openrouter"
                        ? `OpenRouter (${IMAGE_MODEL})`
                        : IMAGE_BACKEND === "comfyicu"
                            ? `ComfyICU (${COMFYICU_BASE_URL})`
                            : `ComfyUI (${COMFYUI_BASE_URL})`;
                    onUpdate(`Generating image with detailed prompt using ${backendLabel}...`);
                    const savedPath = await generateAndSaveImage(detailedPrompt, negativePrompt, onUpdate);
                    return `Image successfully generated and saved to:\n${savedPath}\n\nDetailed Prompt Used:\n${detailedPrompt}\n\nNegative Prompt:\n${negativePrompt}`;
                } catch (err: any) {
                    return `Failed to generate image: ${err.message}`;
                }
            }
        }

        return choice?.message?.content || "No response generated.";
    } catch (e: any) {
        throw new Error(`Text Generation Error: ${e.message}`);
    }
}

async function generateAndSaveImage(
    prompt: string,
    negativePrompt: string,
    onUpdate?: (text: string) => void
): Promise<string> {
    if (IMAGE_BACKEND === "comfyicu") {
        return generateAndSaveImageWithComfyIcu(
            prompt,
            negativePrompt,
            {
                baseUrl: COMFYICU_BASE_URL,
                apiKey: COMFYICU_API_KEY,
                workflowKey: selectedComfyIcuWorkflowKey,
                workflowPath: COMFYUI_WORKFLOW_PATH,
                pollIntervalMs: COMFYICU_POLL_INTERVAL_MS,
                timeoutMs: COMFYICU_TIMEOUT_MS,
                accelerator: COMFYICU_ACCELERATOR
            },
            onUpdate
        );
    }

    if (IMAGE_BACKEND === "comfyui") {
        return generateAndSaveImageWithComfy(
            prompt,
            negativePrompt,
            {
                baseUrl: COMFYUI_BASE_URL,
                apiKey: COMFYUI_API_KEY,
                workflowPath: COMFYUI_WORKFLOW_PATH,
                pollIntervalMs: COMFYUI_POLL_INTERVAL_MS,
                timeoutMs: COMFYUI_TIMEOUT_MS
            },
            onUpdate
        );
    }

    return generateAndSaveImageWithOpenRouter(prompt, negativePrompt);
}

async function tryHandleCommands(messages: Message[]): Promise<string | null> {
    const latestUserMessage = [...messages].reverse().find((m) => m.role === "user")?.content?.trim() || "";

    if (!latestUserMessage.startsWith("/")) return null;

    if (latestUserMessage === "/workflows") {
        const { defaultWorkflowKey, keys } = await listComfyIcuWorkflowKeys();
        if (keys.length === 0) {
            return "No ComfyICU workflows found. Add entries in src/workflows/comfyicu/workflow-registry.json.";
        }

        const current = selectedComfyIcuWorkflowKey || defaultWorkflowKey || "(none)";
        const lines = keys.map((key) => `- ${key}${key === current ? " (current)" : ""}`);
        return `ComfyICU workflows:\n${lines.join("\n")}\n\nCurrent workflow key: ${current}`;
    }

    if (latestUserMessage.startsWith("/workflow ")) {
        const key = latestUserMessage.slice("/workflow ".length).trim();
        const { keys } = await listComfyIcuWorkflowKeys();
        if (!keys.includes(key)) {
            return `Unknown workflow key "${key}". Use /workflows to list available keys.`;
        }
        selectedComfyIcuWorkflowKey = key;
        return `ComfyICU workflow switched to: ${key}`;
    }

    return null;
}

async function generateAndSaveImageWithOpenRouter(prompt: string, negativePrompt: string): Promise<string> {
    const outputDir = path.resolve(process.cwd(), "outdir");
    await fs.mkdir(outputDir, { recursive: true });

    // Using OpenRouter image capabilities via chat completion
    const response = await openrouter.chat.completions.create({
        model: IMAGE_MODEL,
        messages: [
            { role: "user", content: `Generate an image based on this prompt: ${prompt}\n\nNegative prompt: ${negativePrompt}` }
        ]
    });

    const message = response.choices[0]?.message as any;
    const content = message?.content || "";
    let imageUrl: string | null = null;
    let base64Data: string | null = null;

    if (message?.images && message.images.length > 0) {
        const url = message.images[0]?.image_url?.url;
        if (url) {
            if (url.startsWith("data:image/")) {
                const parts = url.split(",");
                if (parts.length > 1) {
                    base64Data = parts[1];
                }
            } else {
                imageUrl = url;
            }
        }
    }

    // Attempt to extract a markdown URL or a raw URL from the model's response if not in images array
    if (!imageUrl && !base64Data) {
        const urlMatch = content.match(/!\[.*?\]\((.*?)\)/) || content.match(/https?:\/\/[^\s\)]+/);
        imageUrl = urlMatch ? (urlMatch[1] || urlMatch[0]) : null;
    }

    if (!imageUrl && !base64Data) {
        throw new Error("Could not extract an image URL from the model response. Raw response: " + JSON.stringify(message));
    }

    let buffer: Buffer;
    if (base64Data) {
        buffer = Buffer.from(base64Data, "base64");
    } else {
        const imageResponse = await fetch(imageUrl as string);
        if (!imageResponse.ok) {
            throw new Error(`Failed to download image from the generated URL (status: ${imageResponse.status})`);
        }
        buffer = Buffer.from(await imageResponse.arrayBuffer());
    }

    const filename = `image_${Date.now()}.png`;
    const filepath = path.join(outputDir, filename);

    await fs.writeFile(filepath, buffer);
    return filepath;
}
