'use strict';

// Finite learner-facing action clauses for cue IDs the real recommender can
// persist. This module has no renderer/sanitizer dependencies so both prompt
// construction and the final learner-facing safety boundary can share one map
// without a require cycle. Unknown IDs deliberately resolve to ''.
const WIN_CUE_ACTIONS = Object.freeze({
  'starter-light-lift': 'starting the words on a small "mm" hum',
  'starter-settle-low': 'starting low and easy with the jaw loose',
  'starter-stable-onenote': 'holding the first sound steady',
  'starter-nasal-buzz': 'humming first and keeping that buzz on your lips',
  'starter-settle-back': 'opening a little more space in your mouth',
  'starter-light-onset': 'starting each word softly instead of pressing',
  'starter-grounded-onset': 'starting the first word on firmer contact',
  'starter-clean-onset': 'starting the first word with a tiny gentle "uh"',
  'starter-easy-hum': 'humming quietly with the jaw loose and no push',
  'starter-slowdown': 'saying it slowly and letting the jaw finish each word',
  'starter-lift-end': 'keeping the lips and jaw moving to the last word',
});

function resolvePreviousCueAction(signal) {
  const id = typeof signal?.previousCue?.id === 'string' ? signal.previousCue.id.trim() : '';
  if (!id || !Object.prototype.hasOwnProperty.call(WIN_CUE_ACTIONS, id)) return '';
  const action = WIN_CUE_ACTIONS[id];
  return typeof action === 'string' && action.trim() ? action.trim() : '';
}

module.exports = {
  WIN_CUE_ACTIONS,
  resolvePreviousCueAction,
};
