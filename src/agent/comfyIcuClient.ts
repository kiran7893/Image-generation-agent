import * as fs from "fs/promises";
import * as path from "path";
import { buildApiWorkflowFromFile } from "./comfyClient.js";

export interface ComfyIcuConfig {
    baseUrl: string;
    apiKey: string;
    workflowKey?: string;
    workflowPath: string;
    pollIntervalMs: number;
    timeoutMs: number;
}

interface WorkflowRegistry {
    defaultWorkflowKey?: string;
    workflows?: Record<string, { workflowId?: string }>;
}

const REGISTRY_PATH = "./src/workflows/comfyicu/workflow-registry.json";

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectImageUrls(value: unknown, urls: string[]): void {
    if (!value) return;
    if (typeof value === "string") {
        if (/^https?:\/\//i.test(value) && /(\.png|\.jpg|\.jpeg|\.webp|\/view\?)/i.test(value)) {
            urls.push(value);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectImageUrls(item, urls);
        return;
    }
    if (typeof value === "object") {
        for (const nestedValue of Object.values(value as Record<string, unknown>)) {
            collectImageUrls(nestedValue, urls);
        }
    }
}

function extractBestImageUrl(runPayload: any): string | null {
    const urls: string[] = [];
    collectImageUrls(runPayload, urls);
    return urls.length > 0 ? urls[0] : null;
}

export async function generateAndSaveImageWithComfyIcu(
    prompt: string,
    negativePrompt: string,
    config: ComfyIcuConfig,
    onUpdate?: (text: string) => void
): Promise<string> {
    const baseUrl = normalizeBaseUrl(config.baseUrl || "https://comfy.icu");
    if (!config.apiKey) {
        throw new Error("COMFYICU_API_KEY is required for IMAGE_BACKEND=comfyicu.");
    }
    const registryPath = path.resolve(process.cwd(), REGISTRY_PATH);
    const workflowId = await resolveWorkflowId(registryPath, config.workflowKey);

    const workflowPrompt = await buildApiWorkflowFromFile(config.workflowPath, prompt, negativePrompt);
    onUpdate?.("Submitting workflow to ComfyICU...");

    const runResponse = await fetch(`${baseUrl}/api/v1/workflows/${workflowId}/runs`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
            prompt: workflowPrompt
        })
    });

    if (!runResponse.ok) {
        const errorBody = await runResponse.text();
        throw new Error(`ComfyICU run create failed (${runResponse.status}): ${errorBody}`);
    }

    const runPayload = await runResponse.json() as any;
    const runId = runPayload?.run_id || runPayload?.id || runPayload?.data?.run_id;
    if (!runId) {
        throw new Error(`ComfyICU did not return run_id. Raw response: ${JSON.stringify(runPayload)}`);
    }

    const startedAt = Date.now();
    onUpdate?.(`Waiting for ComfyICU run ${runId}...`);

    while (Date.now() - startedAt < config.timeoutMs) {
        await sleep(config.pollIntervalMs);

        const statusResponse = await fetch(
            `${baseUrl}/api/v1/workflows/${workflowId}/runs/${runId}`,
            { headers: { "Authorization": `Bearer ${config.apiKey}` } }
        );
        if (!statusResponse.ok) continue;

        const statusPayload = await statusResponse.json() as any;
        const status = String(
            statusPayload?.status ||
            statusPayload?.data?.status ||
            ""
        ).toLowerCase();

        if (status.includes("fail") || status.includes("error") || status.includes("cancel")) {
            throw new Error(`ComfyICU run failed: ${JSON.stringify(statusPayload)}`);
        }

        const imageUrl = extractBestImageUrl(statusPayload);
        if (status.includes("complete") || status.includes("succeed") || imageUrl) {
            if (!imageUrl) {
                throw new Error(`ComfyICU run completed but no image URL found. Raw response: ${JSON.stringify(statusPayload)}`);
            }

            const imageResponse = await fetch(imageUrl, {
                headers: { "Authorization": `Bearer ${config.apiKey}` }
            });
            if (!imageResponse.ok) {
                throw new Error(`Failed to download ComfyICU image (${imageResponse.status}). URL: ${imageUrl}`);
            }

            const outputDir = path.resolve(process.cwd(), "outdir");
            await fs.mkdir(outputDir, { recursive: true });
            const filename = `image_${Date.now()}.png`;
            const filepath = path.join(outputDir, filename);
            const buffer = Buffer.from(await imageResponse.arrayBuffer());
            await fs.writeFile(filepath, buffer);
            return filepath;
        }
    }

    throw new Error(`Timed out waiting for ComfyICU output after ${config.timeoutMs}ms.`);
}

async function resolveWorkflowId(registryPath: string, workflowKey?: string): Promise<string> {
    const parsed = await readWorkflowRegistry(registryPath);
    const key = workflowKey || parsed.defaultWorkflowKey || "";
    const workflowId = parsed.workflows?.[key]?.workflowId || "";
    if (!workflowId) {
        throw new Error(
            `No ComfyICU workflowId configured for key "${key}". ` +
            `Set it in src/workflows/comfyicu/workflow-registry.json.`
        );
    }
    return workflowId;
}

async function readWorkflowRegistry(registryPath: string): Promise<WorkflowRegistry> {
    try {
        const content = await fs.readFile(registryPath, "utf-8");
        return JSON.parse(content) as WorkflowRegistry;
    } catch {
        throw new Error(`Could not read ComfyICU registry at ${registryPath}.`);
    }
}

export async function listComfyIcuWorkflowKeys(): Promise<{ defaultWorkflowKey: string; keys: string[] }> {
    const registryPath = path.resolve(process.cwd(), REGISTRY_PATH);
    const parsed = await readWorkflowRegistry(registryPath);
    const keys = Object.keys(parsed.workflows || {});
    return {
        defaultWorkflowKey: parsed.defaultWorkflowKey || "",
        keys
    };
}
