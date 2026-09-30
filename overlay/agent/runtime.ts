import type { MicropolisSimulator } from '$lib/MicropolisSimulator';
import { micropolisReactive } from '$lib/MicropolisReactive.svelte';
import { resolveEditingTool } from '$lib/gameTools';

export interface AgentSnapshot {
  totalFunds: number;
  cityPop: number;
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

  return {
    totalFunds: Number(m.totalFunds),
    cityPop: Number(m.cityPop),
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

export function resetLaboratory(simulator: MicropolisSimulator): void {
  const m = simulator.micropolis;
  if (!m) return;

  simulator.setPaused(true);
  m.clearMap();
  m.totalFunds = 20000;
  m.setCityTax(7);
  m.setEnableDisasters(false);
  m.setAutoBudget(true);
  m.setAutoBulldoze(true);
  m.updateFunds();
  simulator.syncMapViews();
  simulator.render();
  simulator.setGameSpeed(3);
  simulator.setPaused(false);
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
    const result = micropolisReactive.poke.doTool(
      tool,
      Number(action.x),
      Number(action.y)
    );
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
