/**
 * LLM Completion API Endpoint
 * POST /api/ai/complete
 * 
 * Provides a simple text completion interface.
 */

import { type NextRequest } from "next/server";
import { initLLM, getLLM, type CompletionOptions } from "@/lib/llm";
import { toErrorResponse } from "@/lib/api-error";
import { requireApiUserSession } from "@/lib/session-server";

/**
 * POST /api/ai/complete
 * 
 * Send a prompt for text completion.
 * 
 * Request body:
 * {
 *   prompt: string,
 *   options?: {
 *     temperature?: number,
 *     maxTokens?: number,
 *     model?: string
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;

    const body = await request.json();
    const { prompt, options } = body;

    if (!prompt || typeof prompt !== "string") {
      return Response.json(
        { status: "error", error: "prompt string is required" },
        { status: 400 }
      );
    }

    await initLLM();
    const llm = getLLM();

    const completionOptions: CompletionOptions = {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      model: options?.model,
    };

    const response = await llm.complete(prompt, completionOptions);

    return Response.json({
      status: "success",
      data: response,
    });
  } catch (error: any) {
    console.error("LLM completion error:", error);
    return toErrorResponse(error);
  }
}
