# Julia-1 real em shadow mode

Modelo oficial: https://huggingface.co/SupersonicLabs/Julia-1.
Julia-1 é um encoder de 144M parâmetros para escolhas finitas. O runtime Python
nativo recebe o estado e uma pergunta `choice` com 2–20 candidatos. Não gera
comandos ou coordenadas. Não é compatível diretamente com chat completions.

## Execução local (Python 3.11+, Node 24+)

```sh
npm run setup
npm run julia:setup
JULIA_CPU_THREADS=4 npm run julia:sidecar
# Em outro terminal:
npm run smoke:julia-real
npm run verify:julia-shadow
```

A instalação baixa aproximadamente 551 MiB de pesos e instala PyTorch CPU.
Revisão e hash dos pesos estão fixados em `overlay/agent/julia-model.json`.
O checkpoint e o ambiente Python ficam em `artifacts/`, ignorados pelo git.
Não há chave de API necessária. `JULIA_1_CHECKPOINT` permite outro diretório
com o mesmo checkpoint e marcador `.julia-revision`.

O serviço escuta apenas `127.0.0.1:8765`; `JULIA_SHADOW_PORT` altera a porta.
`GET /health` informa runtime, versões e identidade. `POST /decide` recebe somente
`snapshot`, `availableActions` e `memory`. O limite é 24 KiB por requisição,
histórico de 8 ações/5 falhas/10 sugestões, contexto de 4096 tokens. Excesso é
rejeitado, nunca truncado silenciosamente. `JULIA_DEBUG=1` registra probabilidades
brutas. Confiança é a probabilidade nativa; não é avaliação de utilidade urbana.

Para navegador, o sidecar permite CORS em localhost/127.0.0.1:5173;
`JULIA_SHADOW_ALLOWED_ORIGINS` configura origens específicas. O painel usa o
mesmo observer do benchmark. A execução de Rules continua sem o serviço.

## Endpoint externo

Execute este mesmo sidecar na máquina externa com o checkpoint fixado e um túnel
SSH: `ssh -L 8765:127.0.0.1:8765 servidor`. Alternativamente, configure um endpoint
HTTP privado compatível e confiável: `JULIA_SHADOW_URL=http://.../decide npm run
verify:julia-shadow`. No navegador, configure `globalThis.__JULIA_SHADOW_URL__`
antes de iniciar o agente. Não exponha o sidecar sem autenticação na internet.
Não use um endpoint de chat genérico nem um mock: respostas sem a identidade
fixada são rejeitadas. A identidade declarada por um servidor remoto exige
confiança no operador; não comprova criptograficamente inferência remota.

## Evidência real

`verify:julia-shadow` executa smoke real antes do benchmark. Rules termina 100
decisões e 3900 ticks antes de aguardar a fila Julia. Estado histórico é copiado;
sugestões não alteram a cidade. O runner exige 100 inferências com IDs distintos,
100 válidas e estado final idêntico ao baseline (3360 habitantes, $15358).
Falhas são gravadas antes de encerrar o benchmark com erro; o simulador continua.

Resultados reais ficam em `artifacts/julia-real/`; o comando de teste
`npm run verify:julia-shadow:mock` grava exclusivamente `artifacts/julia-mock/`.
Métricas misturadas causam erro. CI testa o mock explicitamente e os casos de
falha sem baixar pesos. CI verde isoladamente não confirma Julia real.

Evidências versionadas em `docs/evidence/`: smoke, JSONL das 100 decisões e resumo.
Execução em AMD EPYC 9V74, 9 vCPUs disponíveis, 9.7 GiB RAM, sem GPU, 4 threads.
PyTorch 2.14.1+cpu / Transformers 5.0.0. Seed 42, cidade vazia, caixa $20000.
100 válidas, 0 inválidas/erros/timeouts, 0% agreement, 59 repetições possíveis,
0 loops comprovadamente improdutivos. Média 403 ms, p50 408 ms, p95 471 ms.

As repetições são sugestões, nunca construções executadas. O snapshot contém
métricas agregadas, sem mapa de conectividade: Julia repetiu propostas em locais
não modificados pelo Rules. Isso limita a interpretação urbana do benchmark.
O próximo passo é dar contexto espacial compacto e medir estabilidade, mantendo
shadow mode e os mesmos candidatos para ambos os agentes. Não ajustar Rules
para aumentar agreement.
