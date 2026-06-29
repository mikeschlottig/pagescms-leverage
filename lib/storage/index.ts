/**
 * Storage abstraction layer
 * Supports Cloudflare R2, AWS S3, and local filesystem storage
 */

export type StorageType = "r2" | "s3" | "local";

export interface StorageConfig {
  type: StorageType;
  // R2 configuration
  r2Bucket?: any; // Cloudflare R2 binding
  // S3 configuration
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Bucket?: string;
  s3Region?: string;
  s3Endpoint?: string;
  // Local storage configuration
  localPath?: string;
}

let storageInstance: StorageAdapter | null = null;

/**
 * Storage adapter interface
 */
export interface StorageAdapter {
  put(key: string, content: Buffer | ArrayBuffer | string, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | ArrayBuffer | null>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): Promise<string>;
}

/**
 * Initialize storage based on environment
 */
export async function initStorage(config?: StorageConfig) {
  if (storageInstance) return storageInstance;

  const storageType = config?.type || detectStorageType();

  switch (storageType) {
    case "r2":
      storageInstance = new R2Storage(config?.r2Bucket);
      break;
    case "s3":
      storageInstance = new S3Storage(config);
      break;
    case "local":
      storageInstance = new LocalStorage(config?.localPath);
      break;
    default:
      throw new Error(`Unsupported storage type: ${storageType}`);
  }

  return storageInstance;
}

/**
 * Detect storage type from environment
 */
function detectStorageType(): StorageType {
  // Check for Cloudflare R2 binding
  if (typeof globalThis !== "undefined" && (globalThis as any).R2_BUCKET) {
    return "r2";
  }

  // Check for S3 configuration
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return "s3";
  }

  // Default to local storage
  return "local";
}

/**
 * Cloudflare R2 Storage Adapter
 */
class R2Storage implements StorageAdapter {
  private bucket: any;

  constructor(bucket?: any) {
    this.bucket = bucket || (globalThis as any).R2_BUCKET;
    if (!this.bucket) {
      throw new Error("R2 bucket not found. Ensure R2_BUCKET is bound in wrangler.toml");
    }
  }

  async put(key: string, content: Buffer | ArrayBuffer | string, contentType?: string): Promise<void> {
    const options: any = {};
    if (contentType) {
      options.httpMetadata = { contentType };
    }
    
    let body: ArrayBuffer | ReadableStream;
    if (content instanceof Buffer) {
      body = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
    } else if (content instanceof ArrayBuffer) {
      body = content;
    } else {
      body = new TextEncoder().encode(content).buffer;
    }

    await this.bucket.put(key, body, options);
  }

  async get(key: string): Promise<Buffer | ArrayBuffer | null> {
    const object = await this.bucket.get(key);
    if (!object) return null;
    
    const arrayBuffer = await object.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async list(prefix?: string): Promise<string[]> {
    const listed = await this.bucket.list({ prefix });
    return listed.objects.map(obj => obj.key);
  }

  async exists(key: string): Promise<boolean> {
    const object = await this.bucket.head(key);
    return object !== null;
  }

  async getUrl(key: string): Promise<string> {
    // For R2, you might want to use a custom domain or public URL
    // This is a placeholder - adjust based on your R2 public access configuration
    return `https://r2-storage.pagescms.dev/${key}`;
  }
}

/**
 * AWS S3 Storage Adapter
 */
class S3Storage implements StorageAdapter {
  private client: any;
  private bucket: string;
  private region: string;

  constructor(config?: StorageConfig) {
    this.bucket = config?.s3Bucket || process.env.AWS_S3_BUCKET || "";
    this.region = config?.s3Region || process.env.AWS_REGION || "us-east-1";
    
    if (!this.bucket) {
      throw new Error("S3 bucket name is required");
    }

    // Dynamically import AWS SDK v3
    const { S3Client } = require("@aws-sdk/client-s3");
    
    this.client = new S3Client({
      region: this.region,
      endpoint: config?.s3Endpoint || process.env.AWS_ENDPOINT,
      credentials: {
        accessKeyId: config?.s3AccessKeyId || process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: config?.s3SecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }

  async put(key: string, content: Buffer | ArrayBuffer | string, contentType?: string): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content instanceof Buffer || content instanceof ArrayBuffer ? content : Buffer.from(content),
      ContentType: contentType,
    });

    await this.client.send(command);
  }

  async get(key: string): Promise<Buffer | ArrayBuffer | null> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client.send(command);
      const arrayBuffer = await response.Body!.transformToByteArray();
      return Buffer.from(arrayBuffer);
    } catch (error: any) {
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  async list(prefix?: string): Promise<string[]> {
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
    });

    const response = await this.client.send(command);
    return response.Contents?.map(obj => obj.Key!) || [];
  }

  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  async getUrl(key: string): Promise<string> {
    // Return presigned URL or public URL
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
    
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    // Presigned URL valid for 1 hour
    return await getSignedUrl(this.client, command, { expiresIn: 3600 });
  }
}

/**
 * Local Filesystem Storage Adapter
 * For development and testing only
 */
class LocalStorage implements StorageAdapter {
  private basePath: string;

  constructor(basePath?: string) {
    this.basePath = basePath || process.env.LOCAL_STORAGE_PATH || "./storage";
    
    // Ensure base path exists
    const fs = require("fs");
    const path = require("path");
    
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    const path = require("path");
    return path.join(this.basePath, key);
  }

  async put(key: string, content: Buffer | ArrayBuffer | string, contentType?: string): Promise<void> {
    const fs = require("fs").promises;
    const path = require("path");
    
    const filePath = this.getFilePath(key);
    const dir = path.dirname(filePath);
    
    await fs.mkdir(dir, { recursive: true });
    
    const data = content instanceof Buffer || content instanceof ArrayBuffer 
      ? content 
      : Buffer.from(content);
    
    await fs.writeFile(filePath, data);
  }

  async get(key: string): Promise<Buffer | ArrayBuffer | null> {
    const fs = require("fs").promises;
    
    try {
      const filePath = this.getFilePath(key);
      const data = await fs.readFile(filePath);
      return data;
    } catch (error: any) {
      if (error.code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const fs = require("fs").promises;
    
    try {
      const filePath = this.getFilePath(key);
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const fs = require("fs").promises;
    const path = require("path");
    
    const searchPath = prefix ? path.join(this.basePath, prefix) : this.basePath;
    
    async function walkDir(dir: string): Promise<string[]> {
      const results: string[] = [];
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.basePath, fullPath);
        
        if (entry.isDirectory()) {
          const subResults = await walkDir(fullPath);
          results.push(...subResults);
        } else {
          results.push(relativePath);
        }
      }
      
      return results;
    }

    return await walkDir(searchPath);
  }

  async exists(key: string): Promise<boolean> {
    const fs = require("fs").promises;
    
    try {
      const filePath = this.getFilePath(key);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getUrl(key: string): Promise<string> {
    // Return file:// URL for local storage
    const path = require("path");
    const filePath = this.getFilePath(key);
    return `file://${path.resolve(filePath)}`;
  }
}

/**
 * Get the current storage instance
 */
export function getStorage() {
  if (!storageInstance) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return storageInstance;
}

/**
 * Close storage connections (if needed)
 */
export async function closeStorage() {
  storageInstance = null;
}
