/**
 * Craftland QA AI layer: the Insea workflow client, context assembly, the pass library
 * (digest_read → [dig] → synthesize, whatif_answer) and the citation verifier.
 *
 * Lane rules from the master plan:
 * - This package depends only on @craftland-qa/contracts — never on the engine — so passes,
 *   clients and prompts can be tested and replaced in isolation.
 * - The LLM is never a source of facts; it interprets facts produced elsewhere and every claim
 *   must anchor to evidence that the verifier can re-check.
 */

/** Package version marker — replaced by real AI-layer exports as E4 lands. */
export const AI_PACKAGE_VERSION = "0.1.0";
