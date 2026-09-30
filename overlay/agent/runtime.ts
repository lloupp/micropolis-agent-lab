import type { MicropolisSimulator } from '$lib/MicropolisSimulator';
import { micropolisReactive } from '$lib/MicropolisReactive.svelte';
import { resolveEditingTool } from '$lib/gameTools';

export interface AgentSnapshot {
  totalFunds: number;
  cityPop: number;
  cityTime: number;
  simCycle: number;
  resPop: number;
  comPop: number;
  indPop: number;
  cityYear: number;
  cityMonth: number;
  cityTax: number;
  cityScore: number;
  resValve: number;
  comValve: number;
  indValve: number;
  crimeAverage: number;
  pollutionAverage: number;
  trafficAverage: number;
  landValueAverage: number;
  poweredZoneCount: number;
  unpoweredZoneCount: number;
  cashFlow: number;
}

export interface AgentAction {
  kind: 'build' | 'tax' | 'wait';
  tool?: string;
  x?: number;
  y?: number;
  value?: number;
  reason: string;
  phase?: string;
}

export interface ExecutionResult {
  ok: boolean;
  code: number | null;
  message: string;
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'value' in value) {
    return Number((value as { value: unknown }).value);
  }
  return Number(value);
}

export function readSnapshot(simulator: MicropolisSimulator | null): AgentSnapshot | null {
  const m = simulator?.micropolis;
  if (!m) return null;

  const trace = resetTraces.get(simulator!);
  if (trace && !trace.some(entry => entry.stage === 'AgentPanel')) recordReset(simulator!, 'AgentPanel');

  return {
    totalFunds: Number(m.totalFunds),
    cityPop: Number(m.cityPop),
    cityTime: Number(m.cityTime),
    simCycle: Number(m.simCycle),
    resPop: Number(m.resPop),
    comPop: Number(m.comPop),
    indPop: Number(m.indPop),
    cityYear: Number(m.cityYear),
    cityMonth: Number(m.cityMonth),
    cityTax: Number(m.cityTax),
    cityScore: Number(m.cityScore),
    resValve: Number(m.resValve),
    comValve: Number(m.comValve),
    indValve: Number(m.indValve),
    crimeAverage: Number(m.crimeAverage),
    pollutionAverage: Number(m.pollutionAverage),
    trafficAverage: Number(m.trafficAverage),
    landValueAverage: Number(m.landValueAverage),
    poweredZoneCount: Number(m.poweredZoneCount),
    unpoweredZoneCount: Number(m.unpoweredZoneCount),
    cashFlow: Number(m.cashFlow)
  };
}

export interface ResetTraceEntry {
  stage: string;
  totalFunds: number;
  cashFlow: number;
  cityPop: number;
  totalPop: number;
  cityTime: number;
  simCycle: number;
  phaseCycle: number;
  autoBudget: boolean;
  cityTax: number;
}
const resetTraces = new WeakMap<MicropolisSimulator, ResetTraceEntry[]>();
export function getResetTrace(simulator: MicropolisSimulator): ResetTraceEntry[] {
  return [...(resetTraces.get(simulator) ?? [])];
}
function recordReset(simulator: MicropolisSimulator, stage: string): void {
  const m = simulator.micropolis!;
  const entry = { stage, totalFunds: Number(m.totalFunds), cashFlow: Number(m.cashFlow),
    cityPop: Number(m.cityPop), totalPop: Number(m.totalPop), cityTime: Number(m.cityTime),
    simCycle: Number(m.simCycle), phaseCycle: Number(m.phaseCycle),
    autoBudget: Boolean(m.autoBudget), cityTax: Number(m.cityTax) };
  resetTraces.get(simulator)!.push(entry);
  console.debug('[Agent Lab reset]', entry);
}

export function resetLaboratory(simulator: MicropolisSimulator): void {
  const m = simulator.micropolis;
  if (!m) return;

  resetTraces.set(simulator, []);
  recordReset(simulator, 'before');
  // setPaused toggles only simPaused and immediately ticks. Stop the engine
  // via its API first so that tick cannot finish the previous city's budget.
  m.pause();
  simulator.setPaused(true);
  // clearMap alone retains census, tax/budget, evaluation and phase state.
  // init reinitializes all of these in the same engine and preserves callbacks.
  m.init();
  m.pause();
  m.clearMap();
  m.cityPop = 0;
  m.cityTime = 0;
  m.simCycle = 0;
  m.phaseCycle = 0;
  m.cashFlow = 0;
  m.seedRandom(42);
  m.totalFunds = 20000;
  recordReset(simulator, 'assignment');
  m.setCityTax(7);
  m.setEnableDisasters(false);
  m.setAutoBudget(true);
  m.setAutoBulldoze(true);
  m.updateFunds();
  m.simUpdate();
  recordReset(simulator, 'updateFunds');
  simulator.syncMapViews();
  simulator.render();
  simulator.setGameSpeed(4);
  // setPaused(false) restores this cached scheduler rate. Keep it aligned
  // with the selected speed instead of inheriting the previous city's FPS.
  simulator.pausedFramesPerSecond = simulator.framesPerSecond;
  m.resume();
  m.setSpeed(3);
  simulator.setPaused(false);
  recordReset(simulator, 'resume/setPaused(false)');
  simulator.tick();
  recordReset(simulator, 'after 1 tick');
}

export function executeAction(
  simulator: MicropolisSimulator,
  action: AgentAction
): ExecutionResult {
  const m = simulator.micropolis;
  const engine = simulator.micropolisengine;
  if (!m || !engine) {
    return { ok: false, code: null, message: 'Simulador ainda não está pronto.' };
  }

  if (action.kind === 'wait') {
    return { ok: true, code: null, message: 'Aguardando evolução da cidade.' };
  }

  if (action.kind === 'tax') {
    const value = Math.max(0, Math.min(20, Number(action.value ?? m.cityTax)));
    m.setCityTax(value);
    return { ok: true, code: null, message: 'Imposto ajustado para ' + value + '%.' };
  }

  if (action.kind === 'build') {
    const toolId = action.tool as Parameters<typeof resolveEditingTool>[1];
    const tool = resolveEditingTool(engine, toolId);
    const result = m.doTool(
      tool,
      Number(action.x),
      Number(action.y)
    );
    micropolisReactive.syncFromEngine();
    simulator.render();

    const code = numberValue(result);
    const messages: Record<number, string> = {
      1: 'Construção concluída.',
      0: 'Não foi possível construir nesta posição.',
      [-1]: 'Área precisa ser limpa antes.',
      [-2]: 'Dinheiro insuficiente.'
    };

    return {
      ok: code === 1,
      code,
      message: messages[code] ?? ('Resultado do motor: ' + code)
    };
  }

  return { ok: false, code: null, message: 'Ação desconhecida.' };
}
