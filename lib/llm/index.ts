/**
 * LLM Integration Service
 * Supports Cloudflare Workers AI, OpenAI, and other LLM providers
 */

export type LLMProvider = "cloudflare-ai" | "openai" | "anthropic" | "ollama";

export interface LLMConfig {
  provider: LLMProvider;
  // Cloudflare Workers AI
  aiBinding?: any;
  // OpenAI
  openaiApiKey?: string;
  openaiModel?: string;
  // Anthropic
  anthropicApiKey?: string;
  anthropicModel?: string;
  // Ollama
  ollamaBaseUrl?: string;
  ollamaModel?: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

let llmInstance: LLMService | null = null;

/**
 * LLM Service Interface
 */
export interface LLMService {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse>;
  complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse>;
  generateEmbedding(text: string, model?: string): Promise<number[]>;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  model?: string;
}

export interface CompletionOptions extends ChatOptions {}

/**
 * Initialize LLM service based on configuration
 */
export async function initLLM(config?: LLMConfig) {
  if (llmInstance) return llmInstance;

  const provider = config?.provider || detectLLMProvider();

  switch (provider) {
    case "cloudflare-ai":
      llmInstance = new CloudflareAILLM(config?.aiBinding);
      break;
    case "openai":
      llmInstance = new OpenAILLM(config);
      break;
    case "anthropic":
      llmInstance = new AnthropicLLM(config);
      break;
    case "ollama":
      llmInstance = new OllamaLLM(config);
      break;
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }

  return llmInstance;
}

/**
 * Detect LLM provider from environment
 */
function detectLLMProvider(): LLMProvider {
  // Check for Cloudflare Workers AI binding
  if (typeof globalThis !== "undefined" && (globalThis as any).AI) {
    return "cloudflare-ai";
  }

  // Check for OpenAI API key
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }

  // Check for Anthropic API key
  if (process.env.ANTHROPIC_API_KEY) {
    return "anthropic";
  }

  // Default to Ollama for local development
  return "ollama";
}

/**
 * Cloudflare Workers AI Implementation
 */
class CloudflareAILLM implements LLMService {
  private ai: any;

  constructor(aiBinding?: any) {
    this.ai = aiBinding || (globalThis as any).AI;
    if (!this.ai) {
      throw new Error("AI binding not found. Ensure AI is bound in wrangler.toml");
    }
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const model = options?.model || "@cf/meta/llama-3-8b-instruct";
    
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    if (options?.systemPrompt) {
      formattedMessages.unshift({
        role: "system",
        content: options.systemPrompt,
      });
    }

    const response = await this.ai.run(model, {
      messages: formattedMessages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 1024,
    });

    return {
      content: response.response || response.message?.content || "",
      model: model,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens || 0,
        completionTokens: response.usage.completion_tokens || 0,
        totalTokens: response.usage.total_tokens || 0,
      } : undefined,
    };
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    return this.chat([{ role: "user", content: prompt }], options);
  }

  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    const embeddingModel = model || "@cf/baai/bge-base-en-v1.5";
    
    const response = await this.ai.run(embeddingModel, {
      text: text,
    });

    return response.data || response.embeddings || [];
  }
}

/**
 * OpenAI Implementation
 */
class OpenAILLM implements LLMService {
  private apiKey: string;
  private model: string;
  private client: any;

  constructor(config?: LLMConfig) {
    this.apiKey = config?.openaiApiKey || process.env.OPENAI_API_KEY!;
    this.model = config?.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini";

    if (!this.apiKey) {
      throw new Error("OpenAI API key is required");
    }

    // Dynamically import OpenAI SDK
    const { OpenAI } = require("openai");
    this.client = new OpenAI({ apiKey: this.apiKey });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const response = await this.client.chat.completions.create({
      model: options?.model || this.model,
      messages: formattedMessages,
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens ?? 1024,
    });

    const choice = response.choices[0];
    
    return {
      content: choice.message.content || "",
      model: response.model,
      usage: response.usage ? {
        promptTokens: response.usage.prompt_tokens,
        completionTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
    };
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    return this.chat([{ role: "user", content: prompt }], options);
  }

  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    const embeddingModel = model || "text-embedding-3-small";
    
    const response = await this.client.embeddings.create({
      model: embeddingModel,
      input: text,
    });

    return response.data[0].embedding;
  }
}

/**
 * Anthropic Implementation
 */
class AnthropicLLM implements LLMService {
  private apiKey: string;
  private model: string;
  private client: any;

  constructor(config?: LLMConfig) {
    this.apiKey = config?.anthropicApiKey || process.env.ANTHROPIC_API_KEY!;
    this.model = config?.anthropicModel || process.env.ANTHROPIC_MODEL || "claude-3-haiku-20240307";

    if (!this.apiKey) {
      throw new Error("Anthropic API key is required");
    }

    // Dynamically import Anthropic SDK
    const { Anthropic } = require("@anthropic-ai/sdk");
    this.client = new Anthropic({ apiKey: this.apiKey });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const systemPrompt = options?.systemPrompt || messages.find(m => m.role === "system")?.content;
    const userMessages = messages.filter(m => m.role !== "system");

    const response = await this.client.messages.create({
      model: options?.model || this.model,
      max_tokens: options?.maxTokens ?? 1024,
      system: systemPrompt,
      messages: userMessages.map(msg => ({
        role: msg.role === "assistant" ? "assistant" : "user",
        content: [{ type: "text", text: msg.content }],
      })),
    });

    const contentBlock = response.content[0];
    
    return {
      content: contentBlock.type === "text" ? contentBlock.text : "",
      model: response.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    return this.chat([{ role: "user", content: prompt }], options);
  }

  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    throw new Error("Anthropic does not support embeddings");
  }
}

/**
 * Ollama Implementation (for local development)
 */
class OllamaLLM implements LLMService {
  private baseUrl: string;
  private model: string;

  constructor(config?: LLMConfig) {
    this.baseUrl = config?.ollamaBaseUrl || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    this.model = config?.ollamaModel || process.env.OLLAMA_MODEL || "llama3";
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options?.model || this.model,
        messages: messages,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens ?? 1024,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      content: data.message?.content || "",
      model: data.model,
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };
  }

  async complete(prompt: string, options?: CompletionOptions): Promise<LLMResponse> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options?.model || this.model,
        prompt: prompt,
        stream: false,
        options: {
          temperature: options?.temperature ?? 0.7,
          num_predict: options?.maxTokens ?? 1024,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama request failed: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      content: data.response || "",
      model: data.model,
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
    };
  }

  async generateEmbedding(text: string, model?: string): Promise<number[]> {
    const embeddingModel = model || "nomic-embed-text";
    
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: embeddingModel,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings request failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.embedding || [];
  }
}

/**
 * Get the current LLM instance
 */
export function getLLM() {
  if (!llmInstance) {
    throw new Error("LLM service not initialized. Call initLLM() first.");
  }
  return llmInstance;
}

/**
 * Close LLM connections (if needed)
 */
export async function closeLLM() {
  llmInstance = null;
}
