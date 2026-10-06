# Experimento semantics-v2

Experimento separado da PR #6 reprovada. Rules, gerador de candidatos,
classificador physical-prerequisites-v1, pergunta e limites permanecem iguais.
O padrão do sidecar permanece distances-v1. Ative semantics-v2 apenas pelo ambiente.

A nova descrição explicita ausência de estrada ou rede elétrica conectada à usina,
distâncias desde o footprint, proximidade de zonas e contagens de tiles de estrada
ou usina. Não fornece rótulo de plausibilidade, ranking ou escolha do Rules.
Proximidade elétrica não garante energização. wait/tax mantêm suas descrições.

## Protocolo congelado antes da execução

Comparar distances-v1 e semantics-v2 nos 100 estados históricos de spatial-v1,
sem alterar candidatos, com memórias independentes e ordem AB/BA alternada.
Validar encoding pela saúde e proveniência; guardar IDs únicos de inferência,
SHA-256 da entrada, decisões brutas, métricas e evidência parcial a cada par.
Não ajustar descrições após observar resultados sem criar outro experimento.

```sh
npm run julia:setup
OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 JULIA_SPATIAL_ENCODING=distances-v1 JULIA_SHADOW_PORT=8765 npm run julia:sidecar
# Segundo terminal
OMP_NUM_THREADS=4 MKL_NUM_THREADS=4 JULIA_SPATIAL_ENCODING=semantics-v2 JULIA_SHADOW_PORT=8766 npm run julia:sidecar
# Terceiro terminal
npm run replay:julia-spatial
```

Resultado em artifacts/julia-spatial-v2. Replay não carrega o engine e não pode
certificar isolamento vivo do Rules. Por isso seu gate permanece BLOQUEADO mesmo
se houver melhora das métricas. A aprovação exige adicionalmente benchmark vivo,
testes/check/CI verdes no SHA final e os critérios congelados do usuário.
Plausibilidade só de construções e quantidade de ações neutras continuam expostas.
