/**
 * REST API v1 - Individual Entry Endpoint
 * 
 * GET /api/v1/entries/:owner/:repo/:collection/:path - Get entry
 * PUT /api/v1/entries/:owner/:repo/:collection/:path - Update entry
 * DELETE /api/v1/entries/:owner/:repo/:collection/:path - Delete entry
 */

import { type NextRequest } from "next/server";
import { toErrorResponse, createHttpError } from "@/lib/api-error";
import { requireApiUserSession } from "@/lib/session-server";
import { getToken } from "@/lib/token";
import { createOctokitInstance } from "@/lib/utils/octokit";
import { getConfig } from "@/lib/config-store";
import { getSchemaByName } from "@/lib/schema";
import { parse, stringify } from "@/lib/serialization";

/**
 * GET /api/v1/entries/:owner/:repo/:collection/:path
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string; collection: string; path: string }> }
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

    const octokit = createOctokitInstance(token);
    
    let response;
    try {
      response = await octokit.rest.repos.getContent({
        owner: params.owner,
        repo: params.repo,
        path: params.path,
        ref: "main",
      });
    } catch (error: any) {
      if (error?.status === 404) {
        throw createHttpError("Entry not found", 404);
      }
      throw error;
    }

    if (Array.isArray(response.data) || response.data.type !== "file") {
      throw createHttpError("Expected a file", 400);
    }

    const content = Buffer.from(response.data.content, "base64").toString();
    const contentObject = parseContent(content, schema, config);

    return Response.json({
      status: "success",
      data: {
        path: response.data.path,
        sha: response.data.sha,
        data: contentObject,
      },
    });
  } catch (error: any) {
    console.error("API v1 get entry error:", error);
    return toErrorResponse(error);
  }
}

/**
 * PUT /api/v1/entries/:owner/:repo/:collection/:path
 * 
 * Update an existing entry.
 * Request body:
 * {
 *   data: Record<string, any>,
 *   message?: string (commit message),
 *   sha?: string (required for update)
 * }
 */
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string; collection: string; path: string }> }
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

    const body = await request.json();
    const { data, message, sha } = body;

    if (!data || typeof data !== "object") {
      throw createHttpError("data object is required", 400);
    }

    const octokit = createOctokitInstance(token);

    // Get current SHA if not provided
    let currentSha = sha;
    if (!currentSha) {
      try {
        const currentFile = await octokit.rest.repos.getContent({
          owner: params.owner,
          repo: params.repo,
          path: params.path,
          ref: "main",
        });

        if (!Array.isArray(currentFile.data)) {
          currentSha = currentFile.data.sha;
        }
      } catch (error: any) {
        if (error?.status === 404) {
          throw createHttpError("Entry not found", 404);
        }
        throw error;
      }
    }

    // Serialize data
    const content = stringify(data, {
      format: schema.format || "yaml-frontmatter",
      delimiters: schema.delimiters,
      fields: schema.fields,
    });

    const response = await octokit.rest.repos.createOrUpdateFileContents({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      message: message || `Update ${params.collection} entry: ${params.path}`,
      content: Buffer.from(content).toString("base64"),
      sha: currentSha,
      branch: "main",
    });

    return Response.json({
      status: "success",
      data: {
        path: response.data.content.path,
        sha: response.data.content.sha,
        url: response.data.content.html_url,
      },
    });
  } catch (error: any) {
    console.error("API v1 update entry error:", error);
    return toErrorResponse(error);
  }
}

/**
 * DELETE /api/v1/entries/:owner/:repo/:collection/:path
 * 
 * Delete an entry.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ owner: string; repo: string; collection: string; path: string }> }
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

    const octokit = createOctokitInstance(token);

    // Get current SHA
    let currentSha: string;
    try {
      const currentFile = await octokit.rest.repos.getContent({
        owner: params.owner,
        repo: params.repo,
        path: params.path,
        ref: "main",
      });

      if (Array.isArray(currentFile.data)) {
        throw createHttpError("Cannot delete a directory", 400);
      }
      currentSha = currentFile.data.sha;
    } catch (error: any) {
      if (error?.status === 404) {
        throw createHttpError("Entry not found", 404);
      }
      throw error;
    }

    // Delete the file
    await octokit.rest.repos.deleteFile({
      owner: params.owner,
      repo: params.repo,
      path: params.path,
      message: `Delete ${params.collection} entry: ${params.path}`,
      sha: currentSha,
      branch: "main",
    });

    return Response.json({
      status: "success",
      data: {
        path: params.path,
        deleted: true,
      },
    });
  } catch (error: any) {
    console.error("API v1 delete entry error:", error);
    return toErrorResponse(error);
  }
}

// Helper function to parse content
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

      if (schema.list) {
        contentObject = { listWrapper: contentObject };
      }

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
