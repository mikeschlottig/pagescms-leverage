/**
 * LLM Chat API Endpoint
 * POST /api/ai/chat
 * 
 * Provides a unified interface for LLM interactions across different providers.
 * Supports Cloudflare Workers AI, OpenAI, Anthropic, and Ollama.
 */

import { type NextRequest } from "next/server";
import { initLLM, getLLM, type ChatMessage, type ChatOptions } from "@/lib/llm";
import { toErrorResponse } from "@/lib/api-error";
import { requireApiUserSession } from "@/lib/session-server";

/**
 * POST /api/ai/chat
 * 
 * Send a chat message to the configured LLM provider.
 * 
 * Request body:
 * {
 *   messages: Array<{ role: "system" | "user" | "assistant", content: string }>,
 *   options?: {
 *     temperature?: number,
 *     maxTokens?: number,
 *     systemPrompt?: string,
 *     model?: string
 *   }
 * }
 * 
 * Response:
 * {
 *   status: "success",
 *   data: {
 *     content: string,
 *     model: string,
 *     usage?: {
 *       promptTokens: number,
 *       completionTokens: number,
 *       totalTokens: number
 *     }
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // Require authentication for API access
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;

    const body = await request.json();
    const { messages, options } = body;

    if (!messages || !Array.isArray(messages)) {
      return Response.json(
        { status: "error", error: "messages array is required" },
        { status: 400 }
      );
    }

    // Initialize LLM service (auto-detects provider from environment)
    await initLLM();
    const llm = getLLM();

    const chatOptions: ChatOptions = {
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      systemPrompt: options?.systemPrompt,
      model: options?.model,
    };

    const response = await llm.chat(messages, chatOptions);

    return Response.json({
      status: "success",
      data: response,
    });
  } catch (error: any) {
    console.error("LLM chat error:", error);
    return toErrorResponse(error);
  }
}

/**
 * GET /api/ai/chat
 * 
 * Health check and provider info endpoint.
 */
export async function GET() {
  try {
    let provider: string;
    let available = false;

    try {
      // Try to detect provider
      if (typeof globalThis !== "undefined" && (globalThis as any).AI) {
        provider = "cloudflare-ai";
        available = true;
      } else if (process.env.OPENAI_API_KEY) {
        provider = "openai";
        available = true;
      } else if (process.env.ANTHROPIC_API_KEY) {
        provider = "anthropic";
        available = true;
      } else if (process.env.OLLAMA_BASE_URL || process.env.OLLAMA_MODEL) {
        provider = "ollama";
        available = true;
      } else {
        provider = "none";
        available = false;
      }
    } catch {
      provider = "unknown";
      available = false;
    }

    return Response.json({
      status: "success",
      data: {
        provider,
        available,
        endpoints: {
          chat: "/api/ai/chat",
          complete: "/api/ai/complete",
          embed: "/api/ai/embed",
        },
      },
    });
  } catch (error: any) {
    return toErrorResponse(error);
  }
}
