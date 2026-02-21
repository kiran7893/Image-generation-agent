import { openrouter, TEXT_MODEL } from "../agent.js";

const imageExpansionSystemPrompt = `You expand a short image placement prompt into a detailed, production-ready ComfyUI prompt using documentary-style guidelines.

## Guidelines

**Structure:** Subject → Details (include framing/viewpoint) → Setting/Context (who/where/when) → Lighting/Atmosphere → Style (documentary, photorealistic) → Technical (16:9, 8K).

**Principles:** Informational focus, clarity over artistry, documentary aesthetic. Each image is standalone. Avoid internal contradictions.

**Style:** Documentary/educational, photorealistic, 16:9 aspect ratio, 8K, high detail.

**Camera/Composition:** Always specify shot type and viewpoint (e.g., wide/medium/close-up, eye-level/water-level/aerial), subject framing, and 1–3 key foreground/background elements that support the story.

**Historical authenticity:** If depicting a real period/event, keep props/wardrobe/architecture period-accurate and add era-appropriate photographic cues when helpful (e.g., "high-resolution scan of an 1890s glass-plate photograph", grain, halation, scratches, vignette) while still meeting the 8K/high-detail requirement.

**Detail level:** Write a single paragraph of ~3–6 sentences. Include at least one concrete viewpoint/framing cue, one lighting cue, and 2–4 era/style cues (especially for historical scenes).

**Negative prompts:** Avoid deformed, blurry, text, watermarks, overly stylized, unrealistic colors, anachronisms/modern elements, CGI/3D render look, and multiple competing subjects.

## Output format

Output exactly two parts, with no other text before or after:

1. **Detailed image prompt** – A single paragraph. Documentary-style, ComfyUI-ready. Include subject, details, setting, lighting, style, and technical specs (16:9, 8K, photorealistic, high detail). No commentary, no JSON.

2. **Negative prompt** – On a new line, write exactly \`---NEGATIVE---\` then on the next line the negative prompt (e.g. deformed, blurry, low quality, text, watermarks, stylized, unrealistic colors). One line only.

Example structure:
\`\`\`
[Your full detailed image prompt here, one paragraph.]
---NEGATIVE---
deformed, blurry, low quality, text, watermarks, modern elements, stylized, unrealistic proportions
\`\`\`

Output ONLY the detailed prompt and negative prompt as above. No other text.`;

export interface ExpandedPrompt {
    prompt: string;
    negativePrompt: string;
}

export async function expandImagePrompt(userPrompt: string): Promise<ExpandedPrompt> {
    try {
        const response = await openrouter.chat.completions.create({
            model: TEXT_MODEL,
            messages: [
                { role: "system", content: imageExpansionSystemPrompt },
                { role: "user", content: `Expand this image prompt: ${userPrompt}` }
            ]
        });

        const rawContent = response.choices[0]?.message?.content?.trim();
        
        if (!rawContent) {
            return { prompt: userPrompt, negativePrompt: "deformed, blurry, low quality, text, watermarks, stylized, unrealistic colors" };
        }

        const parts = rawContent.split("---NEGATIVE---");
        const prompt = parts[0]?.trim() || userPrompt;
        const negativePrompt = parts[1]?.trim() || "deformed, blurry, low quality, text, watermarks, stylized, unrealistic colors";

        return { prompt, negativePrompt };
    } catch (e) {
        console.error("Failed to expand image prompt, using original:", e);
        return { prompt: userPrompt, negativePrompt: "deformed, blurry, low quality, text, watermarks, stylized, unrealistic colors" };
    }
}
