/**
 * LLM Embeddings API Endpoint
 * POST /api/ai/embed
 * 
 * Generate vector embeddings for text.
 */

import { type NextRequest } from "next/server";
import { initLLM, getLLM } from "@/lib/llm";
import { toErrorResponse } from "@/lib/api-error";
import { requireApiUserSession } from "@/lib/session-server";

/**
 * POST /api/ai/embed
 * 
 * Generate embeddings for text.
 * 
 * Request body:
 * {
 *   text: string,
 *   model?: string
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;

    const body = await request.json();
    const { text, model } = body;

    if (!text || typeof text !== "string") {
      return Response.json(
        { status: "error", error: "text string is required" },
        { status: 400 }
      );
    }

    await initLLM();
    const llm = getLLM();

    const embedding = await llm.generateEmbedding(text, model);

    return Response.json({
      status: "success",
      data: {
        embedding,
        dimensions: embedding.length,
      },
    });
  } catch (error: any) {
    console.error("LLM embedding error:", error);
    return toErrorResponse(error);
  }
}
