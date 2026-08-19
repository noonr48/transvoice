'use strict';

/**
 * direct-reply-shadow-eval.js — Phase 0 SHADOW composer evaluation harness.
 *
 * Replays a fixture matrix through buildDirectReply and reports the four
 * review-phase numbers:
 *   - law-clean rate   : sanitizeCoachReply(composed) === composed, per reply
 *   - coverage         : per-intent composed/null breakdown (null = LLM serves)
 *   - repetition rate  : identical consecutive replies + repeated 3-gram rate,
 *                        across a synthetic 5-take sequence per scenario
 *   - length           : avg/max spoken words vs the 45-word budget
 *
 * RUN: node backend/eval/direct-reply-shadow-eval.js
 * Exit code 0 when every composed reply is law-clean and no consecutive repeat
 * occurs; 1 otherwise (so the review step can gate on it).
 */

const { buildDirectReply } = require('../coaching/direct-reply');
const { sanitizeCoachReply } = require('../coaching/sanitizer');

const DRILLS = {
  pitch_floor: 'Start on a small "mm" hum with the lips lightly together, then open the jaw into the words without letting the pitch fall back down.',
  vocal_weight: 'Let your shoulders drop and the jaw stay loose, then start each word more softly.',
  resonance_forward: 'Hum the line on "m" or "n" first and feel the buzz on your lips, then open into the words.',
};

function scenarioSignal(scenario, takeIndex, readings) {
  const [prev, latest] = readings[takeIndex];
  const base = {
    coachingDecision: { intent: 'single_actionable_cue' },
    policy: { coachingAction: 'coach', shouldCorrect: true, avoidTopics: [] },
    history: { last3TakeSummary: `t1: ${prev}Hz/55% · t2: ${latest}Hz/60%`, trend: 'improving' },
    practiceLine: 'how was your day',
    takeKind: 'phrase',
    userUtterance: '',
  };
  if (scenario.kind === 'coach') {
    base.coachingDecision.primaryFocus = scenario.focus;
    base.coachingDecision.recommendedDrill = { instruction: DRILLS[scenario.focus] };
  } else if (scenario.kind === 'action') {
    base.policy.coachingAction = scenario.action;
    base.coachingDecision.recommendedDrill = { instruction: DRILLS.vocal_weight };
  } else if (scenario.kind === 'intent') {
    base.coachingDecision.intent = scenario.intent;
    if (scenario.intent === 'stop_and_reset' || scenario.intent === 'lesson_transition') {
      base.policy = { coachingAction: 'breather', shouldCorrect: false, avoidTopics: [] };
    }
    if (scenario.intent === 'lesson_transition') {
      base.personalization = { currentLesson: 'Soft starts' };
    }
  } else if (scenario.kind === 'breather') {
    base.coachingDecision.intent = 'continue_conversation';
    base.policy = { coachingAction: 'breather', shouldCorrect: false, avoidTopics: [] };
  } else if (scenario.kind === 'offscript') {
    // A learner statement that is not the practice line must escalate (null).
    base.userUtterance = scenario.utterance;
  }
  return base;
}

const SCENARIOS = [
  { id: 'coach/pitch_floor', kind: 'coach', focus: 'pitch_floor' },
  { id: 'coach/vocal_weight', kind: 'coach', focus: 'vocal_weight' },
  { id: 'coach/resonance_forward', kind: 'coach', focus: 'resonance_forward' },
  { id: 'adapt', kind: 'action', action: 'adapt' },
  { id: 'gentle', kind: 'action', action: 'gentle' },
  { id: 'acknowledge_win', kind: 'intent', intent: 'acknowledge_win' },
  { id: 'stop_and_reset', kind: 'intent', intent: 'stop_and_reset' },
  { id: 'breather', kind: 'breather' },
  { id: 'lesson_transition', kind: 'intent', intent: 'lesson_transition' },
  { id: 'offscript/pain-report', kind: 'offscript', utterance: 'my throat hurts', expectNull: true },
  { id: 'offscript/confusion', kind: 'offscript', utterance: 'i dont understand', expectNull: true },
];

const READINGS = [[150, 158], [158, 165], [165, 162], [162, 170], [170, 177]];

function wordCount(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function trigrams(text) {
  const words = String(text || '').toLowerCase().split(/\s+/).filter(Boolean);
  const grams = [];
  for (let i = 0; i + 3 <= words.length; i += 1) grams.push(words.slice(i, i + 3).join(' '));
  return grams;
}

function main() {
  let lawClean = 0;
  let composedTotal = 0;
  let consecutiveRepeats = 0;
  let repeatedTrigramTurns = 0;
  let totalWords = 0;
  let maxWords = 0;
  let escalationMisses = 0;
  const coverage = {};

  for (const scenario of SCENARIOS) {
    const thread = [];
    const replies = [];
    for (let take = 0; take < READINGS.length; take += 1) {
      const signal = scenarioSignal(scenario, take, READINGS);
      const text = buildDirectReply(signal, { conversationHistory: thread });
      // 2026-07-28 review fix: null means "the LLM serves" — it is NOT a
      // law-clean miss and must not enter the denominator.
      if (text) composedTotal += 1;
      coverage[scenario.id] = (coverage[scenario.id] || 0) + (text ? 1 : 0);
      if (scenario.expectNull && text !== null) {
        escalationMisses += 1;
        console.log(`  ESCALATION MISS [${scenario.id} take ${take + 1}]: expected null, got ${text}`);
      }
      if (!text) {
        replies.push(null);
        continue;
      }
      const clean = sanitizeCoachReply(text, signal) === text;
      if (clean) lawClean += 1;
      else console.log(`  LAW-DIRTY [${scenario.id} take ${take + 1}]: ${text}`);
      const words = wordCount(text);
      totalWords += words;
      maxWords = Math.max(maxWords, words);
      if (replies.length > 0 && replies[replies.length - 1] === text) consecutiveRepeats += 1;
      replies.push(text);
      thread.push({ role: 'assistant', content: text });
    }
    // 3-gram repeats WITHIN a scenario's 5 replies (stock phrases vs template
    // bodies the drill intentionally reuses — count, don't gate).
    const seen = new Set();
    let dupes = 0;
    for (const reply of replies.filter(Boolean)) {
      for (const gram of trigrams(reply)) {
        if (seen.has(gram)) dupes += 1;
        seen.add(gram);
      }
    }
    if (dupes > 0) repeatedTrigramTurns += 1;
  }

  const cleanRate = composedTotal ? (lawClean / composedTotal) : 0;
  const avgWords = composedTotal ? (totalWords / composedTotal) : 0;

  console.log('\ndirect-reply SHADOW eval');
  console.log('========================');
  console.log(`scenarios:            ${SCENARIOS.length} x ${READINGS.length} takes = ${composedTotal} composed`);
  console.log(`law-clean rate:       ${lawClean}/${composedTotal} (${(cleanRate * 100).toFixed(1)}%)`);
  console.log('coverage by intent:');
  for (const scenario of SCENARIOS) {
    console.log(`  ${scenario.id.padEnd(26)} ${coverage[scenario.id]}/${READINGS.length} composed`);
  }
  console.log(`consecutive repeats:  ${consecutiveRepeats}`);
  // NOTE (Phase-2 spec input): per-axis drill bodies intentionally share their
  // engine-authored cue text across takes, so 3-gram reuse inside a scenario
  // is expected where the drill instruction repeats. Phase 0 rotates 3
  // instruction variants per covered axis (drillRegistry is always null in
  // production — the registry should own these pools in Phase 2).
  console.log(`scenarios w/ 3-gram reuse (shared drill bodies — expected): ${repeatedTrigramTurns}`);
  console.log(`length:               avg ${avgWords.toFixed(1)} words, max ${maxWords} (budget 45)`);

  const pass = cleanRate === 1 && consecutiveRepeats === 0 && maxWords <= 45 && !escalationMisses;
  console.log(pass ? '\nPASS' : '\nFAIL');
  process.exit(pass ? 0 : 1);
}

main();
