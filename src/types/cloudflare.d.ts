// Ambient Cloudflare Workers & Pages Functions type definitions
// Defines standard platform interfaces for D1, R2, Vectorize, Workers AI,
// Analytics Engine, Durable Objects, Rate Limiting, and HTMLRewriter.

declare namespace Cloudflare {
  export interface D1PreparedStatement {
    bind(...params: unknown[]): D1PreparedStatement;
    all<T = unknown>(): Promise<{
      results: T[];
      success?: boolean;
      meta?: unknown;
    }>;
    first<T = unknown>(column?: string): Promise<T | null>;
    run(): Promise<{ success: boolean; meta?: unknown }>;
  }

  export interface D1Database {
    prepare(sql: string): D1PreparedStatement;
    batch?<T = unknown>(
      statements: D1PreparedStatement[],
    ): Promise<Array<{ results: T[] }>>;
    exec?(sql: string): Promise<{ count: number; duration: number }>;
  }

  export interface R2Object {
    key: string;
    version: string;
    size: number;
    etag: string;
    httpEtag: string;
    uploaded: Date;
    customMetadata?: Record<string, string>;
    text(): Promise<string>;
    arrayBuffer(): Promise<ArrayBuffer>;
    json<T = unknown>(): Promise<T>;
  }

  export interface R2Bucket {
    get(key: string): Promise<R2Object | null>;
    put(
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream | Blob,
      options?: {
        customMetadata?: Record<string, string>;
        httpMetadata?: Record<string, string>;
      },
    ): Promise<R2Object | undefined>;
    delete?(keys: string | string[]): Promise<void>;
    list?(options?: {
      prefix?: string;
      limit?: number;
      cursor?: string;
    }): Promise<{
      objects: R2Object[];
      truncated: boolean;
      cursor?: string;
    }>;
  }

  export interface VectorizeMatch {
    id: string;
    score: number;
    values?: number[];
    metadata?: Record<string, unknown>;
  }

  export interface VectorizeMatches {
    matches: VectorizeMatch[];
    count?: number;
  }

  export interface VectorizeIndex {
    query(
      vector: number[] | Float32Array,
      options?: {
        topK?: number;
        returnVectors?: boolean;
        returnMetadata?: boolean | 'all' | 'none' | 'indexed';
      },
    ): Promise<VectorizeMatches>;
    insert(
      vectors: Array<{
        id: string;
        values: number[] | Float32Array;
        metadata?: Record<string, unknown>;
      }>,
    ): Promise<{ count: number; ids: string[] }>;
  }

  export interface AnalyticsEngineDataset {
    writeDataPoint(dataPoint: {
      blobs?: string[];
      doubles?: number[];
      indexes?: string[];
    }): void;
  }

  export interface WorkersAI {
    run(
      model: string,
      inputs: {
        prompt?: string;
        messages?: Array<{ role: string; content: string }>;
        text?: string[];
        image?: number[] | Uint8Array;
        max_tokens?: number;
        temperature?: number;
      },
    ): Promise<{
      response?: string;
      data?: number[][];
      description?: string;
      [key: string]: unknown;
    }>;
  }

  export interface RateLimiter {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  }

  export interface DurableObjectStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
    put(key: string, value: unknown): Promise<void>;
    put(entries: Record<string, unknown>): Promise<void>;
    delete(key: string): Promise<boolean>;
    delete(keys: string[]): Promise<number>;
    deleteAll(): Promise<void>;
    setAlarm(scheduledTime: number | Date): Promise<void>;
    getAlarm(): Promise<number | null>;
    deleteAlarm(): Promise<void>;
  }

  export interface DurableObjectState {
    id: unknown;
    storage: DurableObjectStorage;
    acceptWebSocket(ws: WebSocket, tags?: string[]): void;
    getWebSockets(tag?: string): WebSocket[];
    setWebSocketAutoResponse?(autoResponse: unknown): void;
  }
}

// Global ambient interfaces for Cloudflare bindings
type D1Database = Cloudflare.D1Database;
type D1PreparedStatement = Cloudflare.D1PreparedStatement;
type R2Bucket = Cloudflare.R2Bucket;
type R2Object = Cloudflare.R2Object;
type VectorizeIndex = Cloudflare.VectorizeIndex;
type VectorizeMatch = Cloudflare.VectorizeMatch;
type VectorizeMatches = Cloudflare.VectorizeMatches;
type AnalyticsEngineDataset = Cloudflare.AnalyticsEngineDataset;
type WorkersAI = Cloudflare.WorkersAI;
type RateLimiter = Cloudflare.RateLimiter;
type DurableObjectStorage = Cloudflare.DurableObjectStorage;
type DurableObjectState = Cloudflare.DurableObjectState;

// HTMLRewriter global
declare class HTMLRewriter {
  on(
    selector: string,
    handlers: {
      element?: (element: {
        tagName: string;
        attributes: Iterable<[string, string]>;
        getAttribute(name: string): string | null;
        hasAttribute(name: string): boolean;
        setAttribute(name: string, value: string): void;
        removeAttribute(name: string): void;
        before(content: string, options?: { html?: boolean }): void;
        after(content: string, options?: { html?: boolean }): void;
        prepend(content: string, options?: { html?: boolean }): void;
        append(content: string, options?: { html?: boolean }): void;
        setInnerContent(content: string, options?: { html?: boolean }): void;
        remove(): void;
        removeAndKeepContent(): void;
      }) => void | Promise<void>;
      text?: (text: {
        text: string;
        lastInTextNode: boolean;
        remove(): void;
        replace(content: string, options?: { html?: boolean }): void;
        before(content: string, options?: { html?: boolean }): void;
        after(content: string, options?: { html?: boolean }): void;
      }) => void | Promise<void>;
      comments?: (comment: {
        text: string;
        remove(): void;
        replace(content: string, options?: { html?: boolean }): void;
        before(content: string, options?: { html?: boolean }): void;
        after(content: string, options?: { html?: boolean }): void;
      }) => void | Promise<void>;
    },
  ): HTMLRewriter;
  onDocument(handlers: unknown): HTMLRewriter;
  transform(response: Response): Response;
}

// WebSocketPair global in Cloudflare Workers
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

// Pages Function EventContext
interface EventContext<
  Env = Record<string, unknown>,
  P extends string = string,
  Data = unknown,
> {
  request: Request;
  functionPath: string;
  waitUntil: (promise: Promise<unknown>) => void;
  next: (input?: Request | string, init?: RequestInit) => Promise<Response>;
  env: Env;
  params: Record<P, string | string[]>;
  data: Data;
}

type PagesFunction<
  Env = Record<string, unknown>,
  P extends string = string,
  Data = unknown,
> = (context: EventContext<Env, P, Data>) => Response | Promise<Response>;
