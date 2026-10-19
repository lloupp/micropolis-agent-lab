# Rules: commit de memória após execução (19/10/2026)

## Problema
O Rules incrementava o progresso do blueprint, o índice de construção adaptativa e `policeBuilt` ao **tentar** executar uma ação, mesmo quando o motor retornava `ok: false`. Isso podia pular construções essenciais e afirmar que existia uma delegacia não construída.

## Contrato
- `step` conta **tentativas** (não construções realizadas). Cada decisão mantém um identificador exclusivo e a telemetria continua consistente.
- `blueprintIndex` avança apenas após `ExecutionResult.ok === true` em uma construção da fase blueprint. Uma falha mantém a mesma construção pendente para repetição.
- `adaptiveIndex` e `policeBuilt` só avançam após execução bem-sucedida.
- Três falhas consecutivas de construção colocam o Rules em modo `blocked`, oferecendo apenas `wait`; a UI interrompe o timer automático e explica que a cidade deve ser revisada/preparada novamente. Não há repetição ilimitada nem sucesso fictício.
- Resultado ausente ou sem `ok` booleano é erro, nunca sucesso implícito. Somente Rules chama `executeAction`; Julia permanece shadow sem permissão sobre a cidade.

## Aceite e provas
- Testes: falha de usina -> repetição -> sucesso -> próximo bloco; falha de delegacia -> retry -> só então policeBuilt; falha de zona -> índice conservado; três falhas -> bloqueio; ausência de resultado -> erro.
- A simulação WASM de 100 decisões bem-sucedidas executa `npm run verify:cycle` no CI, com resultado congelado de população **3360** e caixa **15358**. Isso não é nova prova de qualidade da Julia.
- Preservar os benchmarks e experimentos históricos #6/#7. Comportamento em falha é uma **nova política** e deve ser reportado separadamente, sem reescrever baseline anterior.

## Validação
```bash
npm run check
npm run setup
npm run verify:cycle
npm run verify:julia-shadow:mock
npm run verify:shadow-capacity
```
