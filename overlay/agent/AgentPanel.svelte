<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { MicropolisSimulator } from '$lib/MicropolisSimulator';
  import {
    executeAction,
    readSnapshot,
    resetLaboratory,
    isLegalBuildCandidate,
    type AgentAction,
    type AgentSnapshot
  } from './runtime';
  import {
    advanceMemory,
    decideRules,
    makeInitialMemory
  } from './rules.js';
  import { candidateFeatures } from './spatial.js';
  import { availableActionsFor } from './candidates.js';
  import { createShadowObserver } from './shadow-observer.js';
  import { actionId, summarizeShadow } from './agents.js';

  export let getSimulator: () => MicropolisSimulator | null = () => null;

  let running = false;
  let prepared = false;
  let intervalMs = 650;
  let timer: ReturnType<typeof setInterval> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;
  let memory = makeInitialMemory();
  let snapshot: AgentSnapshot | null = null;
  let ready = false;
  let lastAction: AgentAction | null = null;
  let lastResult = '';
  let history: Array<{ action: AgentAction; result: string }> = [];
  let failures: string[] = [];
  let shadowSummary = summarizeShadow([]);
  let shadowObserver = createShadowObserver({ onRecord: (rows) => { shadowSummary = summarizeShadow(rows); } });

  function currentSimulator(): MicropolisSimulator | null {
    return getSimulator?.() ?? null;
  }

  function refresh() {
    const simulator = currentSimulator();
    ready = !!simulator?.micropolis;
    snapshot = readSnapshot(simulator);
  }

  function prepare() {
    const simulator = currentSimulator();
    if (!simulator?.micropolis) return;
    stop();
    resetLaboratory(simulator);
    memory = makeInitialMemory();
    lastAction = null;
    lastResult = '';
    history = [];
    failures = [];
    shadowObserver.cancel();
    shadowObserver = createShadowObserver({ onRecord: (rows) => { shadowSummary = summarizeShadow(rows); } });
    shadowSummary = summarizeShadow([]);
    prepared = true;
    refresh();
  }

  function step() {
    const simulator = currentSimulator();
    if (!simulator?.micropolis) {
      refresh();
      return;
    }
    if (!prepared) prepare();

    const current = readSnapshot(simulator);
    if (!current) return;

    const action = decideRules(current, memory) as AgentAction;
    let candidates: ReturnType<typeof availableActionsFor> = [];
    let features: ReturnType<typeof candidateFeatures> = [];
    let preparationError: string | null = null;
    try {
      candidates = availableActionsFor(current, action, (candidate) => isLegalBuildCandidate(simulator, candidate));
      features = candidateFeatures((x,y)=>simulator.micropolis!.getTile(x,y),120,100,candidates,current.totalFunds);
    }
    catch { preparationError = 'candidate_preparation_error'; }
    const selectedByRules = { actionId: actionId(action) };
    const priorHistory = history;
    const priorLastResult = lastResult;
    const priorFailures = failures;
    const result = executeAction(simulator, action);

    lastAction = action;
    lastResult = result.message;
    if (!result.ok) {
      lastResult = 'FALHA: ' + result.message + ' (código ' + result.code + ')';
    }
    history = [{ action, result: result.message }, ...history].slice(0, 8);
    if (!result.ok) failures = [result.message, ...failures].slice(0, 5);
    const modelSnapshot = {
      ...current, candidateFeatures: features,
      lastActions: priorHistory.map(({ action: recent, result: outcome }) => ({
        actionId: recent.kind === 'build'
          ? `build:${recent.tool}:${recent.x}:${recent.y}`
          : recent.kind === 'tax' ? `tax:${recent.value}` : 'wait',
        result: outcome
      })),
      lastActionResult: priorLastResult,
      recentFailures: [...priorFailures]
    };
    const decisionNumber = memory.step + 1;
    shadowObserver.enqueue({ decision: decisionNumber, snapshot: modelSnapshot, candidates,
      rulesDecision: selectedByRules, rulesResult: result, preparationError });
    memory = advanceMemory(memory, action);
    refresh();
  }

  function start() {
    const simulator = currentSimulator();
    if (!simulator?.micropolis || running) {
      refresh();
      return;
    }
    if (!prepared) prepare();
    running = true;
    timer = setInterval(step, intervalMs);
  }

  function stop() {
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
  }

  function restartTimer() {
    if (!running) return;
    stop();
    start();
  }

  onMount(() => {
    refresh();
    refreshTimer = setInterval(refresh, 250);
  });

  onDestroy(() => {
    stop();
    shadowObserver.cancel();
    if (refreshTimer) clearInterval(refreshTimer);
  });

  function fmt(value: number | undefined | null) {
    return Math.round(Number(value ?? 0)).toLocaleString('pt-BR');
  }

  function actionLabel(action: AgentAction | null) {
    if (!action) return 'Aguardando';
    if (action.kind === 'build') {
      return String(action.tool).toUpperCase() + ' @ (' + action.x + ', ' + action.y + ')';
    }
    if (action.kind === 'tax') return 'Imposto → ' + action.value + '%';
    return 'Esperar';
  }
</script>

<aside class="agent-panel" aria-label="Micropolis Agent Lab">
  <header>
    <div>
      <strong>Agent Lab</strong>
      <small>Rules · visual</small>
    </div>
    <span class:running>{running ? 'RODANDO' : 'PAUSADO'}</span>
  </header>

  <div class="controls">
    {#if running}
      <button on:click={stop}>Pausar</button>
    {:else}
      <button class="primary" on:click={start} disabled={!ready}>Iniciar agente</button>
    {/if}
    <button on:click={step} disabled={!ready || running}>1 passo</button>
    <button on:click={prepare} disabled={!ready}>Preparar laboratório</button>
  </div>

  <label class="speed">
    Intervalo: {intervalMs} ms
    <input
      type="range"
      min="200"
      max="2000"
      step="50"
      bind:value={intervalMs}
      on:change={restartTimer}
    />
  </label>

  {#if snapshot}
    <section class="metrics">
      <div><span>População</span><b>{fmt(snapshot.cityPop)}</b></div>
      <div><span>Caixa</span><b>${fmt(snapshot.totalFunds)}</b></div>
      <div><span>Imposto</span><b>{fmt(snapshot.cityTax)}%</b></div>
      <div><span>Score</span><b>{fmt(snapshot.cityScore)}</b></div>
      <div><span>R / C / I</span><b>{fmt(snapshot.resValve)} / {fmt(snapshot.comValve)} / {fmt(snapshot.indValve)}</b></div>
      <div><span>Crime</span><b>{fmt(snapshot.crimeAverage)}</b></div>
      <div><span>Poluição</span><b>{fmt(snapshot.pollutionAverage)}</b></div>
      <div><span>Sem energia</span><b>{fmt(snapshot.unpoweredZoneCount)}</b></div>
    </section>
  {:else}
    <p class="muted">Carregando simulador...</p>
  {/if}

  <section class="decision">
    <small>DECISÃO #{memory.step}</small>
    <strong>{actionLabel(lastAction)}</strong>
    {#if lastAction}
      <p>{lastAction.reason}</p>
      <em>{lastResult}</em>
    {:else}
      <p>Inicie o agente para preparar a cidade e acompanhar cada ação.</p>
    {/if}
  </section>

  <section class="decision shadow">
    <small>JULIA-1 · SHADOW (SEM EXECUÇÃO)</small>
    <div>{shadowSummary.decisions} avaliadas · {shadowSummary.valid} válidas · {shadowSummary.invalid} inválidas</div>
    <div>{shadowSummary.realInferences} inferências reais · {shadowSummary.timeouts} timeouts · {shadowSummary.errors} erros</div>
    <div>Concordância: {shadowSummary.agreementRate === null ? '—' : Math.round(shadowSummary.agreementRate * 100) + '%'}</div>
    <div>Plausibilidade espacial: {shadowSummary.spatialPlausibility === null ? '—' : Math.round(shadowSummary.spatialPlausibility * 100) + '%'} · neutras: {shadowSummary.spatialNeutralCount}</div>
    <div>Intenção: {shadowSummary.intentAgreement === null ? '—' : Math.round(shadowSummary.intentAgreement * 100) + '%'} · repetições consecutivas: {shadowSummary.consecutiveRepeatRate === null ? '—' : Math.round(shadowSummary.consecutiveRepeatRate * 100) + '%'}</div>
    <div>Loops possíveis: {shadowSummary.possibleLoops} · p95: {fmt(shadowSummary.latencyMs.p95)} ms</div>
  </section>

  {#if history.length}
    <section class="history">
      <small>ÚLTIMAS AÇÕES</small>
      {#each history as item}
        <div>
          <b>{actionLabel(item.action)}</b>
          <span>{item.result}</span>
        </div>
      {/each}
    </section>
  {/if}
</aside>

<style>
  .agent-panel {
    position: absolute;
    z-index: 40;
    top: 0.75rem;
    right: 0.75rem;
    width: min(340px, calc(100% - 1.5rem));
    max-height: calc(100% - 1.5rem);
    overflow: auto;
    box-sizing: border-box;
    padding: 0.9rem;
    border-radius: 12px;
    background: rgba(10, 14, 20, 0.94);
    color: #f4f7fb;
    border: 1px solid rgba(255,255,255,0.15);
    box-shadow: 0 12px 32px rgba(0,0,0,0.36);
    font: 13px/1.35 system-ui, sans-serif;
    backdrop-filter: blur(8px);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.8rem;
  }

  header div {
    display: grid;
  }

  header strong {
    font-size: 1rem;
  }

  header small, .muted, section small {
    color: #9ba7b6;
  }

  header span {
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    color: #b5bec9;
  }

  header span.running {
    color: #8ef0a8;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  button {
    border: 1px solid #394454;
    border-radius: 7px;
    padding: 0.45rem 0.6rem;
    background: #202936;
    color: inherit;
    cursor: pointer;
  }

  button.primary {
    background: #294d83;
  }

  button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .speed {
    display: grid;
    gap: 0.25rem;
    margin: 0.8rem 0;
    color: #c7d0dc;
  }

  .speed input {
    width: 100%;
  }

  .metrics {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }

  .metrics div {
    display: grid;
    gap: 0.1rem;
    padding: 0.45rem;
    background: rgba(255,255,255,0.055);
    border-radius: 7px;
  }

  .metrics span {
    color: #9ba7b6;
    font-size: 0.72rem;
  }

  .metrics b {
    font-size: 0.82rem;
  }

  .decision {
    display: grid;
    gap: 0.3rem;
    margin-top: 0.8rem;
    padding: 0.65rem;
    border-radius: 8px;
    background: rgba(80, 130, 210, 0.13);
  }

  .decision p {
    margin: 0;
    color: #d5dce5;
  }

  .decision em {
    color: #aab6c5;
    font-style: normal;
    font-size: 0.75rem;
  }

  .history {
    margin-top: 0.8rem;
    display: grid;
    gap: 0.35rem;
  }

  .history div {
    display: grid;
    padding-top: 0.35rem;
    border-top: 1px solid rgba(255,255,255,0.08);
  }

  .history b {
    font-size: 0.75rem;
  }

  .history span {
    color: #99a6b5;
    font-size: 0.7rem;
  }
</style>
