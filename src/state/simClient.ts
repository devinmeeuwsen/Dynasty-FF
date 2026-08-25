import type { Scenario } from '../engine/scenario';
import type { TradeProposal, TradeResult } from '../engine/trade';
import type { SimRequest, SimRequestBase, SimResponse } from '../workers/sim.worker';

/**
 * Thin promise wrapper over the simulation worker. One worker, one request at a
 * time per id, so a slider drag that fires three simulations resolves all three
 * rather than leaving promises dangling.
 */

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (value: SimResponse) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/sim.worker.ts', import.meta.url), {
    type: 'module',
  });
  worker.onmessage = (event: MessageEvent<SimResponse>) => {
    const entry = pending.get(event.data.id);
    if (!entry) return;
    pending.delete(event.data.id);
    if (event.data.kind === 'error') entry.reject(new Error(event.data.message));
    else entry.resolve(event.data);
  };
  worker.onerror = (event) => {
    for (const [, entry] of pending) {
      entry.reject(new Error(event.message || 'Simulation worker failed.'));
    }
    pending.clear();
  };
  return worker;
}

function send(request: SimRequest): Promise<SimResponse> {
  return new Promise((resolve, reject) => {
    pending.set(request.id, { resolve, reject });
    getWorker().postMessage(request);
  });
}

export async function runSimulation(
  base: Omit<SimRequestBase, 'id'>,
): Promise<{ scenario: Scenario; elapsedMs: number }> {
  const response = await send({ ...base, id: nextId++, kind: 'baseline' });
  if (response.kind !== 'baseline') throw new Error('Unexpected simulation response.');
  return { scenario: response.scenario, elapsedMs: response.elapsedMs };
}

export async function runTrade(
  base: Omit<SimRequestBase, 'id'>,
  proposal: TradeProposal,
): Promise<TradeResult> {
  const response = await send({ ...base, id: nextId++, kind: 'trade', proposal });
  if (response.kind !== 'trade') throw new Error('Unexpected trade response.');
  return response.result;
}
