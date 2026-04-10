import http from "node:http";
import path from "node:path";
import { access, readFile, stat } from "node:fs/promises";

/**
 * Serves an already-built Quartz output directory for the static preview fallback path.
 * This stays separate from process-readiness logic so file serving concerns are easy to find.
 */
const MAX_PREVIEW_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export async function startStaticPreviewServer(outputDir: string, port: number): Promise<http.Server> {
  const resolvedOutputDir = path.resolve(outputDir);
  const server = http.createServer(async (request, response) => {
    try {
      const resolvedPath = await resolvePreviewRequestPath(resolvedOutputDir, request.url ?? "/");

      // H8: File size limit to prevent OOM on large assets
      const fileStat = await stat(resolvedPath);
      if (fileStat.size > MAX_PREVIEW_FILE_SIZE) {
        response.writeHead(413, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("File Too Large");
        return;
      }

      const body = await readFile(resolvedPath);

      response.writeHead(200, {
        "Content-Type": getContentType(resolvedPath)
      });
      response.end(body);
    } catch {
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8"
      });
      response.end("Not Found");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve();
    });
  });

  return server;
}

async function resolvePreviewRequestPath(outputDir: string, requestUrl: string): Promise<string> {
  const requestedPath = decodeURIComponent((requestUrl.split("?")[0] ?? "/").replace(/\\/g, "/"));
  const normalizedPath = requestedPath.startsWith("/") ? requestedPath : `/${requestedPath}`;
  const candidatePaths = normalizedPath.endsWith("/")
    ? [path.join(outputDir, normalizedPath, "index.html"), path.join(outputDir, `${normalizedPath.slice(0, -1)}.html`)]
    : [
        path.join(outputDir, normalizedPath),
        path.join(outputDir, `${normalizedPath}.html`),
        path.join(outputDir, normalizedPath, "index.html")
      ];

  for (const candidatePath of candidatePaths) {
    const resolved = path.resolve(candidatePath);
    // C1: Prevent path traversal — resolved path must stay within outputDir
    if (!resolved.startsWith(outputDir + path.sep) && resolved !== outputDir) {
      continue;
    }
    try {
      await access(resolved);
      return resolved;
    } catch {
      // Try the next preview path candidate.
    }
  }

  throw new Error(`Preview path not found for ${requestUrl}.`);
}

function getContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".xml":
      return "application/xml; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}
