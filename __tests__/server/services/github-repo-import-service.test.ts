import AdmZip from "adm-zip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const markdownServiceMocks = vi.hoisted(() => ({
  importMarkdownAsset: vi.fn(),
  parseMarkdownForPreview: vi.fn(),
}));

vi.mock("@/server/services/markdown-service", () => markdownServiceMocks);

import { importGitHubRepoAssets } from "@/server/services/github-repo-import-service";

const repoUrl = "https://github.com/owner/repo";
const repoPath = (filePath: string) => `owner-repo-main/${filePath}`;

function mockArchiveFetch(files: Record<string, string>) {
  const zip = new AdmZip();
  for (const [filePath, content] of Object.entries(files)) {
    zip.addFile(repoPath(filePath), Buffer.from(content));
  }

  const archive = zip.toBuffer();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(archive, {
        headers: { "content-length": String(archive.byteLength) },
      }),
    ),
  );
}

describe("importGitHubRepoAssets limits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    markdownServiceMocks.importMarkdownAsset.mockResolvedValue({
      asset: { id: "asset-1" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a selection above the 50-file preview limit", async () => {
    const selectedFiles = Array.from({ length: 51 }, (_, index) => `skill-${index}.md`);

    const result = await importGitHubRepoAssets(repoUrl, "main", selectedFiles, "copy");

    expect(result.imported).toHaveLength(0);
    expect(result.errors).toHaveLength(selectedFiles.length);
    expect(result.errors.every((item) => item.error.includes("50"))).toBe(true);
    expect(markdownServiceMocks.importMarkdownAsset).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("imports a selection at the 50-file limit", async () => {
    const selectedFiles = Array.from({ length: 50 }, (_, index) => `skill-${index}.md`);
    mockArchiveFetch(Object.fromEntries(selectedFiles.map((filePath) => [filePath, "# Skill\n"])));

    const result = await importGitHubRepoAssets(repoUrl, "main", selectedFiles, "copy");

    expect(result.imported).toHaveLength(50);
    expect(result.errors).toHaveLength(0);
    expect(markdownServiceMocks.importMarkdownAsset).toHaveBeenCalledTimes(50);
  });

  it("rejects a selected file above 1 MiB before importing it", async () => {
    const selectedFile = "large-skill.md";
    mockArchiveFetch({ [selectedFile]: `# Large Skill\n${"x".repeat(1024 * 1024)}` });

    const result = await importGitHubRepoAssets(repoUrl, "main", [selectedFile], "copy");

    expect(result.imported).toHaveLength(0);
    expect(result.errors).toEqual([
      expect.objectContaining({
        filePath: selectedFile,
        error: expect.stringContaining("1 MB"),
      }),
    ]);
    expect(markdownServiceMocks.importMarkdownAsset).not.toHaveBeenCalled();
  });

  it("imports a selected file within the configured limits", async () => {
    const selectedFile = "small-skill.md";
    mockArchiveFetch({ [selectedFile]: "# Small Skill\n" });

    const result = await importGitHubRepoAssets(repoUrl, "main", [selectedFile], "copy");

    expect(result.imported).toEqual([{ filePath: selectedFile, assetId: "asset-1" }]);
    expect(result.errors).toHaveLength(0);
    expect(markdownServiceMocks.importMarkdownAsset).toHaveBeenCalledOnce();
  });

  it("imports a file exactly at the 1 MiB limit", async () => {
    const selectedFile = "boundary-skill.md";
    const prefix = "# Boundary Skill\n";
    const content = prefix + "x".repeat(1024 * 1024 - Buffer.byteLength(prefix));
    mockArchiveFetch({ [selectedFile]: content });

    const result = await importGitHubRepoAssets(repoUrl, "main", [selectedFile], "copy");

    expect(Buffer.byteLength(content)).toBe(1024 * 1024);
    expect(result.imported).toEqual([{ filePath: selectedFile, assetId: "asset-1" }]);
    expect(result.errors).toHaveLength(0);
  });
});
