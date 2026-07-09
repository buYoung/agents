/**
 * catalog/schema.ts — catalog TOML 스키마·타입
 */

import { z } from "zod";

export const CatalogModelSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.enum(["active", "deprecated"]).default("active"),
  replacement: z.string().optional(),
  aliases: z.array(z.string()).default([]),
  reasoning_efforts: z.array(z.string()).default([]),
  tool_call: z.boolean().default(true),
  temperature: z.boolean().default(true),
  input_modalities: z
    .array(z.enum(["text", "audio", "image", "video", "pdf"]))
    .default(["text"]),
  output_modalities: z
    .array(z.enum(["text", "audio", "image", "video", "pdf"]))
    .default(["text"]),
});

export const CatalogSchema = z.object({
  catalogVersion: z.string().regex(/^\d{4}\.\d{2}\.\d{2}\.\d+$/),
  provider: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    npm: z.string().min(1),
    api: z.string().min(1),
    baseURL: z.string().min(1),
    env: z.array(z.string()).default([]),
  }),
  models: z.array(CatalogModelSchema).min(1),
});

export type Catalog = z.infer<typeof CatalogSchema>;
export type CatalogModel = z.infer<typeof CatalogModelSchema>;

export interface ProviderConfigShape {
  id: string;
  name: string;
  npm: string;
  api: string;
  env: string[];
  options: {
    baseURL: string;
  };
  models: Record<
    string,
    {
      id: string;
      name: string;
      status: "active" | "deprecated";
      reasoning: boolean;
      temperature: boolean;
      tool_call: boolean;
      modalities: {
        input: Array<"text" | "audio" | "image" | "video" | "pdf">;
        output: Array<"text" | "audio" | "image" | "video" | "pdf">;
      };
      options: {
        reasoning_efforts: readonly string[];
        replacement?: string;
        aliases?: readonly string[];
      };
    }
  >;
}

export type CatalogSourceKind = "managed" | "bundled";

export interface CatalogSource {
  kind: CatalogSourceKind;
  path: string;
}
