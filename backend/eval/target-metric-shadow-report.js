'use strict';

const path = require('path');
const { readTurnRecords } = require('./coaching-eval');
const { computeTargetMetricShadowAnalytics } = require('./target-metric-shadow-analytics');

function sortedCounter(counter) {
  return Object.fromEntries(Object.entries(counter || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

function buildTargetMetricShadowReport(turns) {
  const analytics = computeTargetMetricShadowAnalytics(turns);
  return {
    schema: 'transvoice.target_metric_shadow_report.v1',
    generatedAt: new Date().toISOString(),
    inputRowCount: analytics.inputRowCount,
    witnessCount: analytics.witnessCount,
    witnessCoverageRate: analytics.witnessCoverageRate,
    coachOutcomeRate: analytics.coachOutcomeRate,
    measurementUsableRate: analytics.measurementUsableRate,
    freshEvidenceRate: analytics.freshEvidenceRate,
    focusAgreement: analytics.focusAgreement,
    meanFocusConfidence: analytics.meanFocusConfidence,
    meanFocusDistance: analytics.meanFocusDistance,
    outcomes: sortedCounter(analytics.outcomes),
    focusDimensions: sortedCounter(analytics.focusDimensions),
    cueIds: sortedCounter(analytics.cueIds),
    cueReviewStatuses: sortedCounter(analytics.cueReviewStatuses),
    targetSources: sortedCounter(analytics.targetSources),
    takeKinds: sortedCounter(analytics.takeKinds),
    rejectionReasons: sortedCounter(analytics.rejectionReasons),
    errors: sortedCounter(analytics.errors),
  };
}

function main(argv = process.argv.slice(2)) {
  const sourcePath = argv[0] ? path.resolve(argv[0]) : null;
  if (!sourcePath) {
    process.stderr.write('Usage: node target-metric-shadow-report.js <eval-turns.jsonl>\n');
    process.exitCode = 2;
    return;
  }
  const report = buildTargetMetricShadowReport(readTurnRecords(sourcePath));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  buildTargetMetricShadowReport,
  sortedCounter,
};
