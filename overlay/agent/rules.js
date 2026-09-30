const blueprint = [];

function build(tool, x, y, reason, phase = 'blueprint') {
  return { kind: 'build', tool, x, y, reason, phase };
}

blueprint.push(build('coal', 36, 51, 'Criar a fonte de energia da cidade.'));

for (let x = 39; x <= 74; x += 1) {
  blueprint.push(build('wire', x, 50, 'Estender a rede elétrica superior.'));
  blueprint.push(build('wire', x, 52, 'Estender a rede elétrica inferior.'));
}

for (let x = 40; x <= 74; x += 1) {
  blueprint.push(build('road', x, 46, 'Construir o corredor viário superior.'));
  blueprint.push(build('road', x, 56, 'Construir o corredor viário inferior.'));
}

for (const x of [42, 46]) {
  blueprint.push(build('ind', x, 48, 'Criar empregos industriais perto da infraestrutura.'));
  blueprint.push(build('ind', x, 54, 'Expandir empregos industriais.'));
}

blueprint.push(build('com', 54, 48, 'Criar núcleo comercial.'));
blueprint.push(build('com', 54, 54, 'Expandir núcleo comercial.'));

for (const x of [62, 66, 70]) {
  blueprint.push(build('res', x, 48, 'Criar área residencial conectada.'));
  blueprint.push(build('res', x, 54, 'Expandir área residencial conectada.'));
}

const adaptiveSites = [
  [50, 48], [50, 54],
  [58, 48], [58, 54],
  [74, 48], [74, 54]
];

export const BLUEPRINT_LENGTH = blueprint.length;

export function makeInitialMemory() {
  return { step: 0, adaptiveIndex: 0, policeBuilt: false };
}

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
    return build('police', 58, 60, 'Crime elevado: adicionar cobertura policial.', 'adaptive');
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
