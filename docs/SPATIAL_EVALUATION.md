# Contexto espacial v1: experimento reprovado

Comparação real e pareada: seed 42, 100 decisões do Rules, 200 inferências nativas
Julia-1 (100 por braço). Modelo, candidatos, cidade inicial, pergunta e critérios
originais idênticos. Só o braço espacial acrescenta distâncias nas descrições dos
candidatos. Memórias independentes; ordem AB/BA alternada. Cada estado histórico é
copiado antes da ação Rules; o resultado atual não é enviado ao modelo.

```sh
npm run setup
npm run julia:setup
JULIA_CPU_THREADS=4 npm run julia:sidecar
# Outro terminal
npm run verify:julia-spatial
```

Evidência completa: `docs/evidence/spatial-v1/` (requisições históricas, decisões
por braço, resumo). Artefatos de execução: `artifacts/julia-spatial/`.
Não misturar essas métricas com mock ou repetir ajustes depois de ver os resultados
sem registrar um novo experimento. CI testa código e mock explicitamente;
não afirma que executou inferência real. O report guarda a verificação CI como
pendente; a conclusão formal só usa CI confirmado no SHA da PR.

## Classificador physical-prerequisites-v1

Congelado antes do benchmark; sem entrada da decisão Rules ou da resposta Julia.
Observa tiles reais, footprint completo, custo, limites do mapa e ocupação. As
constantes são do engine fixado em `config/upstream.json`. Distância Manhattan
mínima desde o footprint. Rede elétrica alcançável é uma busca por tiles condutores
partindo de usinas, não simples proximidade de fios isolados nem PWRBIT desatualizado.

- R/C/I: estrada a distância <=1 e rede elétrica alcançável <=3.
- Fio: rede elétrica alcançável <=1.
- Estrada: estrada existente <=1; primeira estrada pode iniciar a <=8 da usina.
- Usina: primeira usina ou proximidade <=8 de zonas existentes.
- Polícia/bombeiros: estrada <=1 e zonas <=6.
- Esperar/imposto: neutros espacialmente; nenhuma restrição de posicionamento.
  Quando legais, contam como plausíveis no denominador de todas as decisões.
  Contagem neutra e plausibilidade exclusiva das construções são expostas separadamente.

Isso é um proxy físico de plausibilidade, não garantia de crescimento ou ação
ótima. Acesso viário é local: não prova trajeto até emprego/comércio. Distância
<=3 da rede indica disponibilidade próxima, não energização garantida da nova zona.
O sidecar acrescenta roadDistance/powerDistance às descrições finitas; zoneDistance,
contagens e legalidade ficam na observação auditável e no classificador. Nenhum
rótulo de plausibilidade ou indicação de preferência Rules é passado ao modelo.

## Denominadores e limites

`intentAgreement` considera build:<tool> (ignora coordenadas), tax (ignora valor)
ou wait. Agreement exato usa ID completo. Tax values distinguem exato, não intenção.
Taxas usam todas as 100 decisões, inclusive falhas. Repetição consecutiva inclui
wait, conta decisões 2–100 iguais à anterior e divide por 100. Loop possível mantém
a definição anterior: terceiro passo e seguintes do mesmo ID, exceto wait. As duas
métricas são diferentes. Bloqueadas contam registros inválidos no pipeline de validação, incluindo
parse/contexto e HTTP 422; erros HTTP 500/503 são contabilizados como erros. Não alterar essa definição apenas para melhorar números.

`overlay/agent/evaluation.js` aplica os critérios do usuário: 100 inferências reais,
99% válidas, <=1% inválidas/timeouts, zero erros, isolamento, testes/check/CI verdes,
média <=550 ms e p95 <=650 ms. Para MELHOROU exige 3/6 melhorias e pelo menos
plausibilidade >=90% ou loops <=35. MELHOROU MUITO exige 5/6, plausibilidade >=95%,
loops <=25, intenção >=35%, média <=483.6 ms (120% de 403). Regressão prevalece se
loops >59 ou plausibilidade <80%. Evidência faltante impede declarar melhoria.

## Resultado observado

| Métrica | Baseline pareado | Espacial |
|---|---:|---:|
| Inferências reais/válidas | 100/100 | 100/100 |
| Inválidas/erros/timeouts | 0/0/0 | 0/0/0 |
| Plausibilidade (inclui neutras) | 21% | 78% |
| Neutras (wait/tax) | 21 | 75 |
| Plausibilidade só construções | 0/79 | 3/25 (12%) |
| Loops possíveis | 59 | 33 |
| Agreement exato | 0% | 3% |
| Agreement por intenção | 39% | 3% |
| Repetição consecutiva | 72% | 69% |
| Bloqueadas pelo validator | 0% | 0% |
| Latência média / p95 | 376.49 / 434.82 ms | 416.86 / 473.43 ms |

O baseline pareado reproduziu as escolhas/loops históricos. Latência histórica
403/471 ms permanece referência oficial dos limites; a atual foi medida no mesmo
processo/hardware que o braço espacial (AMD EPYC 9V74, CPU, 4 threads).

Apenas loops e bloqueadas passaram (2/6). Plausibilidade <80% determina REGRESSÃO.
A maior parte do aumento de plausibilidade veio de sugestões neutras, não de boas
construções. Julia sugeriu tax 43, wait 32, road 7, com 18. As escolhas não alteraram
nenhum tile: hash do mapa e snapshot final permaneceram iguais após as inferências.
Rules: 3360 habitantes, $15358, cityTime/simCycle 244, 11 zonas energizadas.

Este experimento deve ficar sem merge. Próximo experimento: descrições espaciais
mais semânticas e avaliação de utilidade das ações neutras, preservando comparação
pareada e os thresholds. Não alterar Rules, candidatos ou classificador depois de
ver resultados para apresentar este mesmo experimento como sucesso.
