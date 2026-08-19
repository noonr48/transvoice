const test = require('node:test');
const assert = require('node:assert/strict');
const { focusAxisGroup } = require('./signal-builder.js');
const { FOCUS_AXES } = require('./signal-schema.js');

// Independent-review #1 risk: a REAL focus axis unmapped in FOCUS_AXIS_GROUP
// would yield group=null, escaping the strain safety guard and enabling spurious
// rotation. Every emittable focus axis except the 'none' sentinel must group.
test('fairness cap: every real FOCUS_AXES member groups to non-null (no unmapped axis)', () => {
  for (const axis of FOCUS_AXES) {
    if (axis === 'none') continue;
    assert.notEqual(focusAxisGroup(axis), null, `focus axis ${axis} unmapped -> breaks the fairness cap`);
  }
});

test('fairness cap: the none sentinel and unmapped strings group to null (no-op)', () => {
  assert.equal(focusAxisGroup('none'), null);
  assert.equal(focusAxisGroup(''), null);
  assert.equal(focusAxisGroup('totally_unmapped'), null);
});
