import { actionId } from './agents.js';

/** Only offers the trusted Rules action and bounded, non-executing alternatives. */
/** @param {import('./runtime').AgentSnapshot} snapshot
 * @param {import('./runtime').AgentAction} rulesAction
 * @param {(action: import('./runtime').AgentAction) => boolean} [isLegalBuild]
 * @returns {Array<{id: string, action: import('./runtime').AgentAction}>}
 */
export function availableActionsFor(snapshot, rulesAction, isLegalBuild = () => false) {
  /** @type {Array<{id: string, action: import('./runtime').AgentAction}>} */
  const actions = [];
  const add = (/** @type {import('./runtime').AgentAction} */ action) => {
    const id = actionId(action);
    if (id && !actions.some((item) => item.id === id)) actions.push({ id, action });
  };
  const rulesActionIsLegal = rulesAction.kind === 'build'
    ? isLegalBuild(rulesAction)
    : rulesAction.kind === 'wait' ||
      (rulesAction.kind === 'tax' && typeof rulesAction.value === 'number' &&
       Number.isInteger(rulesAction.value) &&
       rulesAction.value >= 0 && rulesAction.value <= 20);
  if (rulesActionIsLegal) add(rulesAction);
  const constructionTools = ['res', 'com', 'ind', 'road', 'wire', 'police', 'fire'];
  const sites = [];
  for (let y = 10; y <= 90; y += 4) {
    for (let x = 10; x <= 110; x += 4) sites.push([x, y]);
  }
  for (const tool of constructionTools) {
    const [x, y] = sites.find(([siteX, siteY]) => {
      /** @type {import('./runtime').AgentAction} */
      const candidate = { kind: /** @type {'build'} */ ('build'), tool, x: siteX, y: siteY, reason: 'Julia shadow candidate.' };
      return isLegalBuild(candidate);
    }) ?? [];
    if (Number.isInteger(x)) add({ kind: 'build', tool, x, y, reason: 'Julia shadow candidate.' });
  }
  add({ kind: 'wait', reason: 'Shadow candidate.' });
  for (const value of [snapshot.cityTax - 1, snapshot.cityTax + 1]) {
    if (value >= 0 && value <= 20) add({ kind: 'tax', value, reason: 'Shadow candidate.' });
  }
  return actions;
}
