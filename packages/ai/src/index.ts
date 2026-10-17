/**
 * Craftland QA AI layer, v2 (E7.2 — decision #28): the Insea workflow client, context assembly,
 * the multi-call reading flow (`map → read×N → [dig] → synthesize`) and the linker.
 *
 * Lane rules from the master plan:
 * - This package depends only on @craftland-qa/contracts — never on the engine — so passes,
 *   clients and prompts can be tested and replaced in isolation.
 * - The LLM is never a source of facts: numbers travel as `{{f:<factId>}}` placeholders from the
 *   engine's fact store, structural claims are typed slots the engine evaluates, and the linker
 *   rejects anything the digest cannot back.
 * - The Insea service is stateless and single-shot: every call carries everything the model
 *   sees; context assembly and manifests (not server memory) provide continuity.
 */

export * from "./context/build.js";
export * from "./context/types.js";
export * from "./errors.js";
export * from "./facts/fact-index.js";
export * from "./fallback.js";
export * from "./insea/canary.js";
export * from "./insea/client.js";
export * from "./insea/types.js";
export * from "./insea/unwrap.js";
export * from "./link/index.js";
export * from "./passes/dig.js";
export * from "./passes/digest-step.js";
export * from "./passes/map.js";
export * from "./passes/parse-output.js";
export * from "./passes/read.js";
export * from "./passes/synthesize.js";
export * from "./passes/types.js";
export * from "./pipeline/review.js";
export * from "./prompts/registry.js";
