/**
 * One-shot real review: `pnpm --filter @silentskip/ai review:once <projectId> <base> <current>`.
 *
 * Fetches the digest from the local dev server, runs the full v2 pipeline
 * (`map → read×N → [dig] → synthesize` with the linker on every boundary) against the live
 * Insea workflow and prints the report plus honest per-pass stats.
 * Dev probe — server-side runs go through POST /api/reviews.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { type DigestBundle, DigestBundleSchema } from "@silentskip/contracts";
import { AiError, createReviewDeps, runReviewPipeline } from "../src/index.js";

const envPath = resolve(process.cwd(), "../../.env");
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const [projectId, base, current] = process.argv.slice(2);
if (projectId === undefined || base === undefined || current === undefined) {
  console.error("usage: review:once <projectId> <baseRef> <currentRef>");
  process.exit(2);
}

const serverUrl = process.env.SILENTSKIP_SERVER_URL ?? "http://127.0.0.1:3000";
const workflowUrl = process.env.AI_WORKFLOW_URL ?? null;
const apiKey = process.env.AI_WORKFLOW_API_KEY ?? null;
if (workflowUrl === null || apiKey === null) {
  console.error("missing AI_WORKFLOW_URL / AI_WORKFLOW_API_KEY (checked repo-root .env)");
  process.exit(1);
}

const digestUrl = `${serverUrl}/api/projects/${projectId}/digest?base=${encodeURIComponent(base)}&current=${encodeURIComponent(current)}`;
const response = await fetch(digestUrl);
if (!response.ok) {
  console.error(`digest fetch failed: HTTP ${response.status} (${digestUrl})`);
  process.exit(1);
}
const digest: DigestBundle = DigestBundleSchema.parse(await response.json());

const startedAt = performance.now();
try {
  const result = await runReviewPipeline(createReviewDeps({ workflowUrl, apiKey }), { digest });
  const totalMs = Math.round(performance.now() - startedAt);
  console.log(
    JSON.stringify(
      {
        totalMs,
        passes: result.passes,
        themes: result.themes.map((theme) => ({
          id: theme.id,
          name: theme.name,
          files: theme.files,
        })),
        context: result.contextManifest.counts,
        contextNotes: result.contextManifest.notes,
        structuredFindings: result.structuredFindings.findings.length,
        structuredUnknowns: result.structuredFindings.unknowns.length,
        answers: result.structuredFindings.answers.length,
        verification: {
          read: result.verification.read,
          dig: result.verification.dig,
          synthesize: result.verification.synthesize,
          issues: result.verification.issues.length,
          issueSample: result.verification.issues.slice(0, 6),
        },
        report: result.report,
      },
      null,
      2,
    ),
  );
  process.exit(0);
} catch (error) {
  if (error instanceof AiError) {
    console.error(
      JSON.stringify(
        {
          code: error.code,
          status: error.status,
          message: error.message,
          details: error.details,
        },
        null,
        2,
      ),
    );
  } else {
    console.error(error);
  }
  process.exit(1);
}
