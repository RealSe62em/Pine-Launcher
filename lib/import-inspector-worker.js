'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const { buildTransferPlan, transferPlanSummary } = require('./transfer-plan');

try {
  const plan = buildTransferPlan(workerData);
  parentPort.postMessage({ ok: true, value: transferPlanSummary(plan) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error?.message || String(error) });
}
