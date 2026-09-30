/** @typedef {import('./runtime').AgentAction} AgentAction */
/** @typedef {{step: number, adaptiveIndex: number, policeBuilt: boolean}} AgentMemory */
/** @type {AgentAction[]} */
const blueprint = [];

/**
 * @param {string} tool
 * @param {number} x
 * @param {number} y
 * @param {string} reason
 * @param {string} phase
 * @returns {AgentAction}
 */
function build(tool, x, y, reason, phase = 'blueprint') {
  return { kind: 'build', tool, x, y, reason, phase };
}

blueprint.push(build('coal', 36, 51, 'Criar a fonte de energia da cidade.'));

// A compact, contiguous district lets zoning conduct power between neighbors.
// Finish R/C/I early enough for growth during the first 100 decisions.
for (let x = 39; x <= 41; x += 1) {
  blueprint.push(build('wire', x, 50, 'Conectar a usina ao primeiro distrito.'));
}
for (let x = 40; x <= 67; x += 1) {
  blueprint.push(build('road', x, 46, 'Construir acesso para zonas contíguas.'));
}
/** @type {Array<[string, number]>} */
const initialZones = [['ind', 42], ['ind', 45], ['com', 48],
  ['res', 51], ['res', 54], ['res', 57], ['res', 60]];
for (const [tool, x] of initialZones) {
  blueprint.push(build(tool, x, 48, 'Criar zona ligada à via e à rede elétrica.'));
}
const adaptiveSites = [[63, 48], [66, 48]];

export const BLUEPRINT_LENGTH = blueprint.length;

export function makeInitialMemory() {
  return { step: 0, adaptiveIndex: 0, policeBuilt: false };
}

/** @param {import('./runtime').AgentSnapshot} snapshot
 * @param {AgentMemory} memory
 * @returns {AgentAction}
 */
export function decideRules(snapshot, memory) {
  if (memory.step < blueprint.length) {
    return blueprint[memory.step];
  }

  if (snapshot.totalFunds < 1500 && snapshot.cityTax < 12) {
    return {
      kind: 'tax',
      value: snapshot.cityTax + 1,
      reason: 'Caixa baixo: aumentar imposto em um ponto para proteger o orçamento.',
      phase: 'adaptive'
    };
  }

  if (!memory.policeBuilt && snapshot.crimeAverage > 120 && snapshot.totalFunds >= 700) {
    return build('police', 54, 51, 'Crime elevado: adicionar cobertura policial.', 'adaptive');
  }

  if (memory.adaptiveIndex < adaptiveSites.length && snapshot.totalFunds >= 500) {
    const demands = [
      { tool: 'res', value: snapshot.resValve, label: 'residencial' },
      { tool: 'com', value: snapshot.comValve, label: 'comercial' },
      { tool: 'ind', value: snapshot.indValve, label: 'industrial' }
    ].sort((a, b) => b.value - a.value);

    const best = demands[0];
    if (best.value > 0) {
      const [x, y] = adaptiveSites[memory.adaptiveIndex];
      return build(
        best.tool,
        x,
        y,
        'Maior demanda atual: ' + best.label + ' (' + Math.round(best.value) + ').',
        'adaptive'
      );
    }
  }

  if (snapshot.totalFunds > 12000 && snapshot.cityTax > 7) {
    return {
      kind: 'tax',
      value: snapshot.cityTax - 1,
      reason: 'Caixa saudável: reduzir imposto gradualmente.',
      phase: 'adaptive'
    };
  }

  return {
    kind: 'wait',
    reason: 'Sem intervenção necessária; deixar a simulação evoluir.',
    phase: 'adaptive'
  };
}

/** @param {AgentMemory} memory
 * @param {AgentAction} action
 * @returns {AgentMemory}
 */
export function advanceMemory(memory, action) {
  return {
    step: memory.step + 1,
    adaptiveIndex:
      action.phase === 'adaptive' && action.kind === 'build' && action.tool !== 'police'
        ? memory.adaptiveIndex + 1
        : memory.adaptiveIndex,
    policeBuilt: memory.policeBuilt || (action.kind === 'build' && action.tool === 'police')
  };
}
