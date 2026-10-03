import AdmZip from "adm-zip";
import { createContentHash } from "@/lib/hash";
import { parseGitHubRepoUrl } from "@/lib/import-sources/github-repo";
import { parseMarkdownToAsset } from "@/lib/markdown";
import { importMarkdownAsset, parseMarkdownForPreview } from "@/server/services/markdown-service";
import type { ImportConflictStrategy } from "@/lib/constants";
import type { ValidationResult } from "@/lib/validation";
import type { MarkdownFrontmatter } from "@/lib/markdown";

export const MAX_GITHUB_REPO_IMPORT_FILE_COUNT = 50;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;

export interface RepoFilePreview {
  filePath: string;
  fileName: string;
  content: string;
  contentHash: string;
  frontmatter: MarkdownFrontmatter | null;
  validation: ValidationResult;
  sizeBytes: number;
}

export interface RepoPreviewResult {
  source: {
    owner: string;
    repo: string;
    ref: string;
    htmlUrl: string;
  };
  files: RepoFilePreview[];
  totalFiles: number;
  filteredOut: number;
  truncated: boolean;
}

export interface RepoImportResult {
  imported: { filePath: string; assetId: string }[];
  errors: { filePath: string; error: string }[];
}

function matchGlob(pattern: string, filePath: string): boolean {
  if (!pattern || pattern === "**" || pattern === "**/*") {
    return true;
  }

  const segments = pattern.split(",").map((s) => s.trim()).filter(Boolean);

  for (const segment of segments) {
    if (matchSingleGlob(segment, filePath)) {
      return true;
    }
  }

  return false;
}

function matchSingleGlob(pattern: string, filePath: string): boolean {
  let regex = "^";
  let i = 0;

  while (i < pattern.length) {
    const ch = pattern[i];

    if (ch === "*") {
      if (i + 1 < pattern.length && pattern[i + 1] === "*") {
        if (i + 2 < pattern.length && pattern[i + 2] === "/") {
          regex += "(?:.*/)?";
          i += 3;
        } else {
          regex += ".*";
          i += 2;
        }
      } else {
        regex += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      regex += "[^/]";
      i += 1;
    } else if (ch === "." || ch === "(" || ch === ")" || ch === "[" || ch === "]" || ch === "{" || ch === "}" || ch === "+" || ch === "^" || ch === "$" || ch === "|" || ch === "\\") {
      regex += "\\" + ch;
      i += 1;
    } else {
      regex += ch;
      i += 1;
    }
  }

  regex += "$";

  try {
    return new RegExp(regex).test(filePath);
  } catch {
    return filePath.endsWith(pattern.replace(/\*/g, ""));
  }
}

function isMarkdownFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

function stripRepoPrefix(filePath: string): string {
  const slashIndex = filePath.indexOf("/");
  if (slashIndex === -1) return filePath;
  return filePath.slice(slashIndex + 1);
}

async function fetchRepoArchive(archiveUrl: string): Promise<Buffer> {
  const response = await fetch(archiveUrl, {
    cache: "no-store",
    headers: {
      Accept: "application/zip",
      "User-Agent": "SkillVault",
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error("GitHub 仓库或分支不存在，请检查 URL 和 ref");
    }
    throw new Error(`GitHub 仓库获取失败：${response.status}`);
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_ARCHIVE_BYTES) {
    throw new Error(`仓库压缩包过大（${(parseInt(contentLength, 10) / 1024 / 1024).toFixed(1)}MB），当前仅支持 ${MAX_ARCHIVE_BYTES / 1024 / 1024}MB 以内`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`仓库压缩包过大（${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB），当前仅支持 ${MAX_ARCHIVE_BYTES / 1024 / 1024}MB 以内`);
  }

  return buffer;
}

export async function previewGitHubRepoImport(
  url: string,
  ref: string,
  pathFilter: string,
): Promise<RepoPreviewResult> {
  const source = parseGitHubRepoUrl(url, ref);
  const buffer = await fetchRepoArchive(source.archiveUrl);

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const mdEntries = entries.filter(
    (entry) => !entry.isDirectory && isMarkdownFile(entry.entryName),
  );

  const allMdFiles = mdEntries.map((entry) => ({
    entry,
    filePath: stripRepoPrefix(entry.entryName),
  }));

  const filtered = pathFilter.trim()
    ? allMdFiles.filter((f) => matchGlob(pathFilter.trim(), f.filePath))
    : allMdFiles;

  const filteredOut = allMdFiles.length - filtered.length;
  const truncated = filtered.length > MAX_GITHUB_REPO_IMPORT_FILE_COUNT;
  const limited = filtered.slice(0, MAX_GITHUB_REPO_IMPORT_FILE_COUNT);

  const files: RepoFilePreview[] = [];

  for (const { entry, filePath } of limited) {
    const rawContent = entry.getData().toString("utf-8");
    const sizeBytes = Buffer.byteLength(rawContent, "utf-8");

    if (sizeBytes > MAX_FILE_BYTES) {
      continue;
    }

    const contentHash = createContentHash(rawContent);
    const parsed = parseMarkdownToAsset(rawContent);

    let frontmatter: MarkdownFrontmatter | null = null;
    let validation: ValidationResult = { issues: [], summary: { errorCount: 0, warningCount: 0 } };

    if (!("error" in parsed)) {
      frontmatter = parsed.data.frontmatter;
      const previewResult = await parseMarkdownForPreview(rawContent, {
        sourceUrl: `https://github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/blob/${encodeURIComponent(source.ref)}/${filePath}`,
        sourceRef: source.ref,
        sourcePath: filePath,
        sourceChecksum: contentHash,
      });
      if (!("error" in previewResult)) {
        validation = previewResult.data.validation;
      }
    }

    files.push({
      filePath,
      fileName: filePath.split("/").at(-1) ?? filePath,
      content: rawContent,
      contentHash,
      frontmatter,
      validation,
      sizeBytes,
    });
  }

  return {
    source: {
      owner: source.owner,
      repo: source.repo,
      ref: source.ref,
      htmlUrl: source.htmlUrl,
    },
    files,
    totalFiles: allMdFiles.length,
    filteredOut,
    truncated,
  };
}

export async function importGitHubRepoAssets(
  url: string,
  ref: string,
  selectedFiles: string[],
  strategy: ImportConflictStrategy,
): Promise<RepoImportResult> {
  if (selectedFiles.length > MAX_GITHUB_REPO_IMPORT_FILE_COUNT) {
    const error = `仓库导入最多支持 ${MAX_GITHUB_REPO_IMPORT_FILE_COUNT} 个文件`;
    return {
      imported: [],
      errors: selectedFiles.map((filePath) => ({ filePath, error })),
    };
  }

  const source = parseGitHubRepoUrl(url, ref);
  const buffer = await fetchRepoArchive(source.archiveUrl);

  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const selectedSet = new Set(selectedFiles);

  const matchedEntries = entries.filter((entry) => {
    if (entry.isDirectory) return false;
    const filePath = stripRepoPrefix(entry.entryName);
    return selectedSet.has(filePath) && isMarkdownFile(filePath);
  });

  const imported: { filePath: string; assetId: string }[] = [];
  const errors: { filePath: string; error: string }[] = [];

  for (const entry of matchedEntries) {
    const filePath = stripRepoPrefix(entry.entryName);
    if (entry.header.size > MAX_FILE_BYTES) {
      errors.push({ filePath, error: "文件超过 1 MB 限制" });
      continue;
    }

    const rawBytes = entry.getData();
    if (rawBytes.byteLength > MAX_FILE_BYTES) {
      errors.push({ filePath, error: "文件超过 1 MB 限制" });
      continue;
    }

    const rawContent = rawBytes.toString("utf-8");
    const sourceChecksum = createContentHash(rawContent);

    try {
      const parsed = parseMarkdownToAsset(rawContent);
      if ("error" in parsed) {
        errors.push({ filePath, error: parsed.error.message });
        continue;
      }

      const result = await importMarkdownAsset(parsed.data, strategy, {
        sourceUrl: `https://github.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/blob/${encodeURIComponent(source.ref)}/${filePath}`,
        sourceRef: source.ref,
        sourcePath: filePath,
        sourceChecksum,
        sourceImportedAt: Date.now(),
      });

      if ("cancelled" in result) {
        errors.push({ filePath, error: "导入已取消" });
        continue;
      }

      imported.push({ filePath, assetId: result.asset.id });
    } catch (error) {
      errors.push({
        filePath,
        error: error instanceof Error ? error.message : "导入失败",
      });
    }
  }

  return { imported, errors };
}
