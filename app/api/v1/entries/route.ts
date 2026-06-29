/**
 * REST API v1 - Entries Endpoint
 * 
 * Provides programmatic access to content entries.
 * This is a simplified REST API wrapper around the existing GitHub-based API.
 * 
 * Endpoints:
 * - GET /api/v1/entries/:owner/:repo/:collection - List entries
 * - GET /api/v1/entries/:owner/:repo/:collection/:path - Get entry
 * - POST /api/v1/entries/:owner/:repo/:collection - Create entry
 * - PUT /api/v1/entries/:owner/:repo/:collection/:path - Update entry
 * - DELETE /api/v1/entries/:owner/:repo/:collection/:path - Delete entry
 */

import { type NextRequest } from "next/server";
import { toErrorResponse, createHttpError } from "@/lib/api-error";
import { requireApiUserSession } from "@/lib/session-server";
import { getToken } from "@/lib/token";
import { createOctokitInstance } from "@/lib/utils/octokit";
import { getConfig } from "@/lib/config-store";
import { getSchemaByName } from "@/lib/schema";
import { parse, stringify } from "@/lib/serialization";
import { normalizePath } from "@/lib/utils/file";

/**
 * GET /api/v1/entries/:owner/:repo/:collection
 * 
 * List all entries in a collection.
 * Query params:
 * - limit?: number (default: 50)
 * - offset?: number (default: 0)
 * - filter?: JSON string for filtering
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string; collection: string }> }
) {
  try {
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;
    const user = sessionResult.user;

    const params = await context.params;
    const { token } = await getToken(user, params.owner, params.repo);
    
    if (!token) {
      throw createHttpError("Authentication failed", 401);
    }

    const config = await getConfig(params.owner, params.repo, "main", {
      getToken: async () => token,
    });

    if (!config) {
      throw createHttpError("Repository configuration not found", 404);
    }

    const schema = getSchemaByName(config.object, params.collection);
    if (!schema) {
      throw createHttpError(`Collection "${params.collection}" not found`, 404);
    }

    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // List files in the collection path
    const octokit = createOctokitInstance(token);
    const response = await octokit.rest.repos.getContent({
      owner: params.owner,
      repo: params.repo,
      path: schema.path,
      ref: "main",
    });

    if (!Array.isArray(response.data)) {
      throw createHttpError("Expected a directory", 400);
    }

    // Filter only files with the correct extension
    const extension = schema.extension || "";
    const files = response.data.filter(
      (file) => file.type === "file" && file.name.endsWith(`.${extension}`)
    );

    // Apply pagination
    const paginatedFiles = files.slice(offset, offset + limit);

    // Fetch and parse each entry
    const entries = await Promise.all(
      paginatedFiles.map(async (file) => {
        const fileResponse = await octokit.rest.repos.getContent({
          owner: params.owner,
          repo: params.repo,
          path: file.path,
          ref: "main",
        });

        if (Array.isArray(fileResponse.data) || fileResponse.data.type !== "file") {
          return null;
        }

        const content = Buffer.from(fileResponse.data.content, "base64").toString();
        const contentObject = parseContent(content, schema, config);

        return {
          path: file.path,
          sha: file.sha,
          data: contentObject,
        };
      })
    );

    return Response.json({
      status: "success",
      data: {
        entries: entries.filter(Boolean),
        total: files.length,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    console.error("API v1 entries error:", error);
    return toErrorResponse(error);
  }
}

/**
 * POST /api/v1/entries/:owner/:repo/:collection
 * 
 * Create a new entry.
 * Request body:
 * {
 *   data: Record<string, any>,
 *   path?: string (optional custom path),
 *   message?: string (commit message)
 * }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string; collection: string }> }
) {
  try {
    const sessionResult = await requireApiUserSession();
    if ("response" in sessionResult) return sessionResult.response;
    const user = sessionResult.user;

    const params = await context.params;
    const { token } = await getToken(user, params.owner, params.repo);
    
    if (!token) {
      throw createHttpError("Authentication failed", 401);
    }

    const config = await getConfig(params.owner, params.repo, "main", {
      getToken: async () => token,
    });

    if (!config) {
      throw createHttpError("Repository configuration not found", 404);
    }

    const schema = getSchemaByName(config.object, params.collection);
    if (!schema) {
      throw createHttpError(`Collection "${params.collection}" not found", 404);
    }

    const body = await request.json();
    const { data, path: customPath, message } = body;

    if (!data || typeof data !== "object") {
      throw createHttpError("data object is required", 400);
    }

    // Generate filename from data if not provided
    let filePath = customPath;
    if (!filePath) {
      const nameField = schema?.fields?.find((f: any) => f.name === "name" || f.name === "title" || f.name === "slug");
      const nameValue = nameField ? data[nameField.name] : Date.now().toString();
      const slug = nameValue.toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      filePath = `${schema.path}/${slug}.${schema.extension || "md"}`;
    }

    // Serialize data based on schema format
    const content = stringify(data, {
      format: schema.format || "yaml-frontmatter",
      delimiters: schema.delimiters,
      fields: schema.fields,
    });

    const octokit = createOctokitInstance(token);
    
    // Check if file already exists
    try {
      await octokit.rest.repos.getContent({
        owner: params.owner,
        repo: params.repo,
        path: filePath,
        ref: "main",
      });
      throw createHttpError("Entry already exists", 409);
    } catch (error: any) {
      if (error.status !== 404) {
        throw error;
      }
    }

    // Create the file
    const response = await octokit.rest.repos.createOrUpdateFileContents({
      owner: params.owner,
      repo: params.repo,
      path: filePath,
      message: message || `Create ${params.collection} entry: ${filePath}`,
      content: Buffer.from(content).toString("base64"),
      branch: "main",
    });

    return Response.json(
      {
        status: "success",
        data: {
          path: filePath,
          sha: response.data.content.sha,
          url: response.data.content.html_url,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("API v1 create entry error:", error);
    return toErrorResponse(error);
  }
}

// Helper function to parse content (same as in entries/[path]/route.ts)
const parseContent = (
  content: string,
  schema: Record<string, any>,
  config: Record<string, any>
) => {
  const serializedTypes = [
    "yaml-frontmatter",
    "json-frontmatter",
    "toml-frontmatter",
    "yaml",
    "json",
    "toml",
  ];

  let contentObject: Record<string, any> = {};

  if (
    serializedTypes.includes(schema && schema.format) &&
    schema.fields &&
    schema.fields.length > 0
  ) {
    try {
      contentObject = parse(content, {
        format: schema.format,
        delimiters: schema.delimiters,
      });

      // Handle list at root
      if (schema.list) {
        contentObject = { listWrapper: contentObject };
      }

      // Apply field transformations would go here
      // (simplified for brevity)

      if (schema.list) {
        contentObject = contentObject.listWrapper;
      }
    } catch (error: any) {
      throw createHttpError(`Error parsing content: ${error.message}`, 400);
    }
  } else {
    contentObject = { body: content };
  }

  return contentObject;
};
