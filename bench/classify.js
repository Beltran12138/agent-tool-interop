'use strict';

/**
 * Single source of truth for turning a finished cell into an outcome code.
 *
 * Used by run.js live and by analyze.js over persisted records, so a cell can
 * always be re-scored from disk without re-running it. Two implementations of
 * this rule would drift, and a drifting classifier is a silent re-scoring
 * machine.
 *
 * TERMINAL STATE FIRST — this is the rule, and it was learned from a bug.
 * An earlier version tested `anyArgViolation` before looking at what actually
 * ended up on disk, so a cell that emitted one bad argument, was told, fixed
 * it, and then produced a wrong *value* was reported as F2 (schema violation)
 * instead of F3 (wrong value). The code named the first anomaly rather than the
 * failure. Any model that stumbles once and recovers would have been
 * systematically mis-attributed.
 *
 * Recovery is a flag, not a verdict.
 */

function classify({ flags, verify, transportOutcome, strict }) {
  if (transportOutcome === 'ERROR') return { outcome: 'ERROR' };

  // STRICT MODE — the Slice 0.2 dependent variable.
  //
  // Slice 0 and Slice 0.1 both scored under a tolerant parser and both saturated
  // at ceiling. Under tolerance, "did it work" stops discriminating long before
  // the envelopes stop differing, because the harness quietly absorbs syntax the
  // prompt never specified. A real scaffold that accepts only its own literal
  // syntax would have rejected those calls outright.
  //
  // So conformance becomes part of the outcome rather than a footnote: a cell
  // that only succeeded via a non-specified dialect is F2 under strict scoring —
  // envelope present, emission does not conform. Both codes are always reported
  // side by side; neither alone is honest. Tolerant overstates what a strict
  // consumer would accept; strict alone lets the harness's own leniency setting
  // masquerade as a fact about the model.
  if (strict && flags.variantDialect) {
    return { outcome: 'F2', strictRejected: true };
  }

  // F0 vs F2, the distinction this whole bench is organised around — and which
  // the first version of THIS function got wrong. A cell where every turn
  // produced an unreadable `<tool_call>` block has `anyCall === false`, because
  // nothing ever parsed into a call. Reading that as F0 would report
  // "emitted no tool call at all" about a model that emitted a tool call every
  // single turn and merely garbled the syntax. Envelope present but never
  // readable is F2's family: the form was recognised, the emission did not
  // conform. Absence is only absence when nothing tool-shaped was there.
  if (!flags.anyCall) {
    if (flags.anyMalformed || flags.anyArgViolation) return { outcome: 'F2', neverReadable: true };
    if (flags.anyUnknownTool) return { outcome: 'F1' };
    return { outcome: 'F0' };
  }
  if (verify && verify.ok) {
    return {
      outcome: 'OK',
      recovered: !!(flags.anyMalformed || flags.anyArgViolation) || undefined,
    };
  }

  const detail = (verify && verify.detail) || '';
  const artifactMissing = /does not exist/.test(detail);

  // Did any tool call actually run to completion? If not, the cell never got
  // off the ground and the envelope-level failure is the real story.
  const everExecuted = flags.calledExpected || flags.calledOtherKnown || flags.calledDistractor;

  if (!everExecuted) {
    if (flags.anyArgViolation || flags.anyMalformed) return { outcome: 'F2' };
    if (flags.anyUnknownTool) return { outcome: 'F1' };
    return { outcome: 'F0' };
  }

  // Something ran. Prefer the terminal explanation.
  if (artifactMissing) {
    if (flags.calledDistractor || flags.anyUnknownTool || (flags.calledOtherKnown && !flags.calledExpected)) {
      return { outcome: 'F1', recovered: !!(flags.anyMalformed || flags.anyArgViolation) || undefined };
    }
    return { outcome: 'F4', recovered: !!(flags.anyMalformed || flags.anyArgViolation) || undefined };
  }

  // The artifact exists and is wrong: the tool ran with values that were wrong.
  return { outcome: 'F3', recovered: !!(flags.anyMalformed || flags.anyArgViolation) || undefined };
}

/**
 * DIALECT DRIFT WITHIN A CELL.
 *
 * The dependent variable for the contamination probe. A cell-level
 * `variantDialect` flag cannot express it: it says "somewhere in this cell a
 * non-specified dialect appeared", which is also true of a model that simply has
 * the other prior and used it from the first turn. Drift is the *change* — the
 * model started one way and switched after the payload was in front of it.
 *
 * `sequence` is the per-turn dialect for every turn that produced a parseable
 * call, in order. `drifted` is true when some later turn disagrees with the
 * first one. `settledOn` is the last dialect seen, which is what a scaffold
 * downstream would actually have to cope with.
 *
 * Deliberately NOT inferred from the outcome code: a drifted cell can be OK
 * (Slice 0.3's clean case verified fine and drifted anyway), and reading drift
 * off a failure would make the measure agree with the thing it is supposed to
 * be independent of.
 */
function dialectDrift(trace) {
  const sequence = (trace || [])
    .map((t) => t.parsed && t.parsed.kind === 'call' ? t.parsed.dialect : null)
    .filter((d) => d === 'specified' || d === 'variant');
  if (sequence.length === 0) return { sequence, drifted: false, settledOn: null, turns: 0 };
  const first = sequence[0];
  return {
    sequence,
    drifted: sequence.some((d) => d !== first),
    settledOn: sequence[sequence.length - 1],
    turns: sequence.length,
  };
}

module.exports = { classify, dialectDrift };
