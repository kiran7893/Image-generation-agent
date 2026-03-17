import * as fs from "fs/promises";
import * as path from "path";

type WorkflowMap = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

interface StandardWorkflowInput {
    name: string;
    link: number | null;
    type?: string;
    widget?: { name?: string };
}

interface StandardWorkflowNode {
    id: number;
    type: string;
    title?: string;
    inputs?: StandardWorkflowInput[];
    widgets_values?: unknown[];
}

interface StandardWorkflow {
    nodes: StandardWorkflowNode[];
    links: Array<[number, number, number, number, number, string]>;
}

export interface ComfyConfig {
    baseUrl: string;
    apiKey?: string;
    workflowPath: string;
    pollIntervalMs: number;
    timeoutMs: number;
}

function resolveWorkflowPath(workflowPath: string): string {
    return path.isAbsolute(workflowPath)
        ? workflowPath
        : path.resolve(process.cwd(), workflowPath);
}

function normalizeBaseUrl(baseUrl: string): string {
    return baseUrl.replace(/\/+$/, "");
}

function buildComfyEndpoint(baseUrl: string, route: string): string {
    const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
    let needsApiPrefix = false;
    try {
        const hostname = new URL(baseUrl).hostname.toLowerCase();
        needsApiPrefix = hostname === "cloud.comfy.org" || hostname.endsWith(".comfy.org");
    } catch {
        needsApiPrefix = baseUrl.includes("cloud.comfy.org");
    }
    const prefixedRoute = needsApiPrefix && !normalizedRoute.startsWith("/api/")
        ? `/api${normalizedRoute}`
        : normalizedRoute;
    return `${baseUrl}${prefixedRoute}`;
}

function createHeaders(apiKey?: string): HeadersInit {
    const headers: Record<string, string> = {
        "Content-Type": "application/json"
    };
    if (apiKey) {
        headers["X-API-Key"] = apiKey;
        headers["Authorization"] = `Bearer ${apiKey}`;
    }
    return headers;
}

function asStandardWorkflow(workflow: unknown): StandardWorkflow | null {
    if (!workflow || typeof workflow !== "object") return null;
    const obj = workflow as Record<string, unknown>;
    if (!Array.isArray(obj.nodes) || !Array.isArray(obj.links)) return null;
    return workflow as StandardWorkflow;
}

function asApiWorkflow(workflow: unknown): WorkflowMap | null {
    if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return null;
    const entries = Object.entries(workflow as Record<string, unknown>);
    if (entries.length === 0) return null;
    const looksLikeApi = entries.every(([, value]) => {
        return !!value && typeof value === "object" && "class_type" in (value as Record<string, unknown>);
    });
    return looksLikeApi ? (workflow as WorkflowMap) : null;
}

function findPromptNodeIds(workflow: StandardWorkflow): { positiveId?: number; negativeId?: number } {
    const kSamplerIds = new Set(
        workflow.nodes
            .filter((node) => node.type.toLowerCase().includes("ksampler"))
            .map((node) => node.id)
    );

    let positiveId: number | undefined;
    let negativeId: number | undefined;

    for (const [, sourceNodeId, , targetNodeId, targetSlot] of workflow.links) {
        if (!kSamplerIds.has(targetNodeId)) continue;
        if (targetSlot === 1) positiveId = sourceNodeId;
        if (targetSlot === 2) negativeId = sourceNodeId;
    }

    if (!negativeId) {
        const titleMatch = workflow.nodes.find(
            (n) => n.type === "CLIPTextEncode" && (n.title || "").toLowerCase().includes("negative")
        );
        if (titleMatch) negativeId = titleMatch.id;
    }

    if (!positiveId) {
        const firstClip = workflow.nodes.find((n) => n.type === "CLIPTextEncode");
        if (firstClip) positiveId = firstClip.id;
    }

    if (!negativeId) {
        const clipNodes = workflow.nodes.filter((n) => n.type === "CLIPTextEncode");
        if (clipNodes.length > 1) {
            const nonPositive = clipNodes.find((n) => n.id !== positiveId);
            if (nonPositive) negativeId = nonPositive.id;
        }
    }

    return { positiveId, negativeId };
}

function injectPromptsIntoStandardWorkflow(
    workflow: StandardWorkflow,
    positivePrompt: string,
    negativePrompt: string
): StandardWorkflow {
    const cloned: StandardWorkflow = JSON.parse(JSON.stringify(workflow));
    const { positiveId, negativeId } = findPromptNodeIds(cloned);

    const setNodeText = (nodeId: number | undefined, text: string): void => {
        if (!nodeId) return;
        const node = cloned.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        if (!Array.isArray(node.widgets_values)) node.widgets_values = [];
        node.widgets_values[0] = text;
    };

    setNodeText(positiveId, positivePrompt);
    setNodeText(negativeId, negativePrompt);
    return cloned;
}

function standardToApiWorkflow(workflow: StandardWorkflow): WorkflowMap {
    const linksById = new Map<number, [number, number, number, number, number, string]>();
    for (const link of workflow.links) {
        linksById.set(link[0], link);
    }

    const prompt: WorkflowMap = {};
    for (const node of workflow.nodes) {
        if (node.type === "Note" || node.type === "MarkdownNote") continue;

        const inputs: Record<string, unknown> = {};
        const nodeInputs = node.inputs || [];
        const widgetValues = node.widgets_values || [];
        let widgetIndex = 0;

        for (const input of nodeInputs) {
            if (input.link !== null && input.link !== undefined) {
                const link = linksById.get(input.link);
                if (link) {
                    const sourceNodeId = link[1];
                    const sourceSlot = link[2];
                    inputs[input.name] = [String(sourceNodeId), sourceSlot];
                }
                continue;
            }

            if (input.widget) {
                // Some exported workflow formats include extra control widgets
                // (for example KSampler seed mode "randomize") that are not part
                // of node input fields. Advance until value type matches input type.
                while (widgetIndex < widgetValues.length) {
                    const candidate = widgetValues[widgetIndex];
                    widgetIndex += 1;
                    if (isWidgetValueCompatible(input, candidate)) {
                        inputs[input.name] = candidate;
                        break;
                    }
                }
            }
        }

        prompt[String(node.id)] = {
            class_type: node.type,
            inputs
        };
    }
    return prompt;
}

function isWidgetValueCompatible(input: StandardWorkflowInput, value: unknown): boolean {
    const inputType = (input.type || "").toUpperCase();
    if (!inputType) return true;

    if (inputType === "INT") {
        return typeof value === "number" && Number.isInteger(value);
    }
    if (inputType === "FLOAT") {
        return typeof value === "number";
    }
    if (inputType === "STRING") {
        return typeof value === "string";
    }
    if (inputType === "BOOLEAN") {
        return typeof value === "boolean";
    }
    if (inputType === "COMBO") {
        return typeof value === "string";
    }

    return true;
}

export async function buildApiWorkflowFromFile(
    workflowPath: string,
    prompt: string,
    negativePrompt: string
): Promise<WorkflowMap> {
    const resolvedPath = resolveWorkflowPath(workflowPath);
    const content = await fs.readFile(resolvedPath, "utf-8");
    const parsed = JSON.parse(content) as unknown;

    const apiWorkflow = asApiWorkflow(parsed);
    if (apiWorkflow) {
        const cloned = JSON.parse(JSON.stringify(apiWorkflow)) as WorkflowMap;
        if (cloned["6"]?.inputs?.text !== undefined) cloned["6"].inputs.text = prompt;
        if (cloned["7"]?.inputs?.text !== undefined) cloned["7"].inputs.text = negativePrompt;
        return cloned;
    }

    const standardWorkflow = asStandardWorkflow(parsed);
    if (!standardWorkflow) {
        throw new Error(`Unsupported workflow JSON format at ${resolvedPath}`);
    }

    const injected = injectPromptsIntoStandardWorkflow(standardWorkflow, prompt, negativePrompt);
    return standardToApiWorkflow(injected);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractImageFromHistory(historyItem: any): { filename: string; subfolder: string; type: string } | null {
    const outputs = historyItem?.outputs;
    if (!outputs || typeof outputs !== "object") return null;

    for (const value of Object.values(outputs as Record<string, any>)) {
        if (Array.isArray(value?.images) && value.images.length > 0) {
            const image = value.images[0];
            if (image?.filename) {
                return {
                    filename: image.filename,
                    subfolder: image.subfolder || "",
                    type: image.type || "output"
                };
            }
        }
    }

    return null;
}

export async function generateAndSaveImageWithComfy(
    prompt: string,
    negativePrompt: string,
    config: ComfyConfig,
    onUpdate?: (text: string) => void
): Promise<string> {
    const baseUrl = normalizeBaseUrl(config.baseUrl);
    if (!baseUrl) {
        throw new Error("COMFYUI_BASE_URL is not set.");
    }

    const apiWorkflow = await buildApiWorkflowFromFile(config.workflowPath, prompt, negativePrompt);
    onUpdate?.("Submitting workflow to ComfyUI...");
    const headers = createHeaders(config.apiKey);

    const promptResponse = await fetch(buildComfyEndpoint(baseUrl, "/prompt"), {
        method: "POST",
        headers,
        body: JSON.stringify({
            prompt: apiWorkflow,
            client_id: `react-ink-agent-${Date.now()}`
        })
    });

    if (!promptResponse.ok) {
        const errorBody = await promptResponse.text();
        throw new Error(`ComfyUI /prompt failed (${promptResponse.status}): ${errorBody}`);
    }

    const promptPayload = await promptResponse.json() as { prompt_id?: string };
    const promptId = promptPayload.prompt_id;
    if (!promptId) {
        throw new Error("ComfyUI did not return a prompt_id.");
    }

    const startedAt = Date.now();
    let imageRef: { filename: string; subfolder: string; type: string } | null = null;

    onUpdate?.(`Waiting for ComfyUI job ${promptId}...`);
    while (Date.now() - startedAt < config.timeoutMs) {
        await sleep(config.pollIntervalMs);

        const historyResponse = await fetch(
            buildComfyEndpoint(baseUrl, `/history/${promptId}`),
            { headers }
        );
        if (!historyResponse.ok) continue;

        const historyPayload = await historyResponse.json() as Record<string, any>;
        const historyItem = historyPayload[promptId];
        if (!historyItem) continue;

        imageRef = extractImageFromHistory(historyItem);
        if (imageRef) break;

        const completed = historyItem?.status?.completed === true;
        const statusStr = historyItem?.status?.status_str;
        if (completed && !imageRef) {
            throw new Error(`ComfyUI job completed without image output (status: ${statusStr || "unknown"}).`);
        }
    }

    if (!imageRef) {
        throw new Error(`Timed out waiting for ComfyUI output after ${config.timeoutMs}ms.`);
    }

    const params = new URLSearchParams({
        filename: imageRef.filename,
        subfolder: imageRef.subfolder,
        type: imageRef.type
    });
    const imageUrl = `${buildComfyEndpoint(baseUrl, "/view")}?${params.toString()}`;
    const imageResponse = await fetch(imageUrl, { headers });
    if (!imageResponse.ok) {
        throw new Error(`Failed to fetch generated image from ComfyUI /view (${imageResponse.status}).`);
    }

    const outputDir = path.resolve(process.cwd(), "outdir");
    await fs.mkdir(outputDir, { recursive: true });
    const filename = `image_${Date.now()}.png`;
    const filepath = path.join(outputDir, filename);
    const buffer = Buffer.from(await imageResponse.arrayBuffer());
    await fs.writeFile(filepath, buffer);

    return filepath;
}
