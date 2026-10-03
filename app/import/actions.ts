"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseMarkdownForPreview, importMarkdownAsset } from "@/server/services/markdown-service";
import { parseMarkdownToAsset } from "@/lib/markdown";
import type { ImportConflictStrategy } from "@/lib/constants";
import { createContentHash } from "@/lib/hash";
import {
  githubImportExecuteSchema,
  githubImportPreviewSchema,
} from "@/lib/validators/github-import";
import {
  importGitHubMarkdownAsset,
  previewGitHubMarkdownImport,
} from "@/server/services/github-import-service";
import { getCuratedExampleContent, getCuratedExamples } from "@/lib/curated";
import {
  MAX_GITHUB_REPO_IMPORT_FILE_COUNT,
  previewGitHubRepoImport,
  importGitHubRepoAssets,
} from "@/server/services/github-repo-import-service";

const markdownSchema = z.string().max(10_000_000);

const batchItemSchema = z.object({
  filename: z.string().min(1).max(255),
  markdown: z.string().min(1).max(10_000_000),
});
const batchSchema = z.array(batchItemSchema).min(1).max(100);

const importMarkdownSchema = z.object({
  markdown: z.string().min(1).max(10_000_000),
  strategy: z.enum(["overwrite", "copy", "cancel"]),
});

const githubRepoPreviewSchema = z.object({
  url: z.string().url().max(2000),
  ref: z.string().max(255).optional(),
  pathFilter: z.string().max(500).optional(),
});

const githubRepoImportSchema = z.object({
  url: z.string().url().max(2000),
  ref: z.string().max(255).optional(),
  selectedFiles: z.array(z.string().min(1).max(500)).min(1).max(MAX_GITHUB_REPO_IMPORT_FILE_COUNT),
  strategy: z.enum(["overwrite", "copy", "cancel"]),
});

const curatedImportSchema = z.object({
  selectedFiles: z.array(z.string().min(1).max(255)).min(1).max(50),
  strategy: z.enum(["overwrite", "copy", "cancel"]),
});

export async function parseMarkdownAction(markdown: string) {
  try {
    markdownSchema.parse(markdown);
    const result = await parseMarkdownForPreview(markdown);
    if ("error" in result) {
      return { success: false, error: result.error };
    }
    return { success: true, data: result.data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "解析失败",
    };
  }
}

export async function batchImportAction(
  items: { filename: string; markdown: string }[],
) {
  try {
    batchSchema.parse(items);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "批量导入参数无效",
    };
  }

  const results: { filename: string; success: boolean; assetId?: string; error?: string }[] = [];

  for (const item of items) {
    try {
      const parsed = parseMarkdownToAsset(item.markdown);
      if ("error" in parsed) {
        results.push({ filename: item.filename, success: false, error: parsed.error.message });
        continue;
      }

      const result = await importMarkdownAsset(parsed.data, "copy", {
        sourcePath: item.filename,
        sourceChecksum: createContentHash(item.markdown),
        sourceImportedAt: Date.now(),
      });

      if ("cancelled" in result) {
        results.push({ filename: item.filename, success: false, error: "导入已取消" });
        continue;
      }

      results.push({ filename: item.filename, success: true, assetId: result.asset.id });
    } catch (error) {
      results.push({
        filename: item.filename,
        success: false,
        error: error instanceof Error ? error.message : "导入失败",
      });
    }
  }

  revalidatePath("/assets");

  return results;
}

export async function importMarkdownAction(
  markdown: string,
  strategy: ImportConflictStrategy,
) {
  try {
    importMarkdownSchema.parse({ markdown, strategy });
    const parsed = parseMarkdownToAsset(markdown);
    if ("error" in parsed) {
      return { success: false, error: parsed.error.message };
    }

    const result = await importMarkdownAsset(parsed.data, strategy, {
      sourceChecksum: createContentHash(markdown),
      sourceImportedAt: Date.now(),
    });

    if ("cancelled" in result) {
      return { success: true, cancelled: true };
    }

    revalidatePath("/assets");
    if (result.asset) {
      revalidatePath(`/assets/${result.asset.id}`);
    }

    return { success: true, assetId: result.asset.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "导入失败",
    };
  }
}

export async function previewGitHubImportAction(url: string) {
  const parsed = githubImportPreviewSchema.safeParse({ url });
  if (!parsed.success) {
    return { success: false, error: "GitHub URL 格式无效" };
  }

  try {
    const result = await previewGitHubMarkdownImport(parsed.data.url);
    if ("error" in result) {
      return { success: false, error: result.error };
    }

    return { success: true, data: result.data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "GitHub 文件预览失败",
    };
  }
}

export async function importGitHubAction(
  url: string,
  previewChecksum: string,
  strategy: ImportConflictStrategy,
) {
  const parsed = githubImportExecuteSchema.safeParse({
    url,
    previewChecksum,
    strategy,
  });
  if (!parsed.success) {
    return { success: false, error: "GitHub 导入参数无效" };
  }

  try {
    const result = await importGitHubMarkdownAsset(
      parsed.data.url,
      parsed.data.previewChecksum,
      parsed.data.strategy,
    );

    if ("cancelled" in result) {
      return { success: true, cancelled: true };
    }

    revalidatePath("/assets");
    if (result.asset) {
      revalidatePath(`/assets/${result.asset.id}`);
    }

    return { success: true, assetId: result.asset.id };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "GitHub 文件导入失败",
    };
  }
}

export async function previewGitHubRepoImportAction(
  url: string,
  ref: string,
  pathFilter: string,
) {
  try {
    githubRepoPreviewSchema.parse({ url, ref, pathFilter });
    const result = await previewGitHubRepoImport(url, ref, pathFilter);
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "GitHub 仓库预览失败",
    };
  }
}

export async function importGitHubRepoAssetsAction(
  url: string,
  ref: string,
  selectedFiles: string[],
  strategy: ImportConflictStrategy,
) {
  try {
    githubRepoImportSchema.parse({ url, ref, selectedFiles, strategy });
    const result = await importGitHubRepoAssets(url, ref, selectedFiles, strategy);
    revalidatePath("/assets");
    return { success: true, data: result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "GitHub 仓库导入失败",
    };
  }
}

export async function getCuratedExamplesAction() {
  try {
    const examples = await getCuratedExamples();
    return { success: true, data: examples };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "加载精选示例失败",
    };
  }
}

export async function importCuratedExamplesAction(
  selectedFiles: string[],
  strategy: ImportConflictStrategy,
) {
  try {
    curatedImportSchema.parse({ selectedFiles, strategy });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "精选导入参数无效",
    };
  }

  const results: { filename: string; success: boolean; assetId?: string; error?: string }[] = [];

  for (const filename of selectedFiles) {
    try {
      const raw = await getCuratedExampleContent(filename);
      const parsed = parseMarkdownToAsset(raw);
      if ("error" in parsed) {
        results.push({ filename, success: false, error: parsed.error.message });
        continue;
      }

      const result = await importMarkdownAsset(parsed.data, strategy, {
        sourcePath: `curated:${filename}`,
        sourceChecksum: createContentHash(raw),
        sourceImportedAt: Date.now(),
      });

      if ("cancelled" in result) {
        results.push({ filename, success: false, error: "导入已取消" });
        continue;
      }

      results.push({ filename, success: true, assetId: result.asset.id });
    } catch (error) {
      results.push({
        filename,
        success: false,
        error: error instanceof Error ? error.message : "导入失败",
      });
    }
  }

  revalidatePath("/assets");
  return results;
}
