import logging
import os
import time
from pathlib import Path
from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage, HumanMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.types import RunnableConfig
from deepagents import create_deep_agent

logger = logging.getLogger(__name__)

from agents.llm import create_llm_provider
from daytona import DAYTONA_SPECS_PATH

# Teto de tokens por RESPOSTA (não janela de contexto — nome anterior
# MODEL_CONTEXT_WINDOW era enganoso). Provider cobra por output, então
# manter teto justo evita custos altos. Artefato típico (CONSTITUICAO ~7KB)
# usa ~2k tokens; 12000 cobre artefatos grandes (até ~40KB) com folga.
# Aceita MODEL_CONTEXT_WINDOW como fallback pra .env antigo, com aviso.
_legacy = os.environ.get("MODEL_CONTEXT_WINDOW")
if _legacy and not os.environ.get("MAX_OUTPUT_TOKENS"):
    logger.warning(
        "MODEL_CONTEXT_WINDOW está deprecado — renomeie para MAX_OUTPUT_TOKENS "
        "no .env. Usando valor legado %s nesta sessão.",
        _legacy,
    )
MAX_OUTPUT_TOKENS = int(os.environ.get("MAX_OUTPUT_TOKENS", _legacy or "12000"))
PROJECT_ROOT = Path(__file__).parents[2]
PROMPTS_DIR = PROJECT_ROOT / "prompts"

PHASE_ORDER = ["CONSTITUICAO", "PRD", "ESPECIFICACAO", "PLANO", "TAREFAS"]

_SAVE_INSTRUCTION_TEMPLATE = """

---

## INSTRUÇÃO DE SAÍDA (PRIORIDADE MÁXIMA)

Ao concluir o artefato, use `write_file` (ou `edit_file` se o arquivo já existe)
para salvar no caminho **EXATO** indicado em `[SALVAR EM]` da mensagem do usuário.

Regras obrigatórias:
- Copie o path do `[SALVAR EM]` **caractere por caractere**. Sem adicionar prefixo,
  sem alterar maiúsculas/minúsculas.
- O path é sempre absoluto e aponta para `{specs_path}/{{slug}}/{{PHASE}}.md`
  dentro do sandbox Daytona. Esse diretório existe e está pronto pra receber
  o arquivo.
- O conteúdo deve ser apenas o markdown do artefato, sem preâmbulo nem comentários extras.
"""

_SAVE_INSTRUCTION = _SAVE_INSTRUCTION_TEMPLATE.format(specs_path=DAYTONA_SPECS_PATH)

_RETRY_MESSAGE = (
    "Você não salvou o artefato. "
    "Use a ferramenta write_file (geração inicial) ou edit_file (edição) "
    "para salvar no caminho exato indicado em [SALVAR EM]. "
    "Não responda com texto — salve o arquivo diretamente."
)

# Número total de invocações do agente (1ª tentativa + retries). Combinado com
# backoff de rate-limit em run_agent. Default 3 dá espaço pro provider recuperar
# cota em ~65s acumulados de espera entre tentativas.
MAX_AGENT_ATTEMPTS = int(os.environ.get("MAX_AGENT_ATTEMPTS", "3"))
# Tamanho mínimo do draft em bytes pra considerar como "agente realmente salvou".
# Threshold baixo evita pegar arquivos truncados ou vazios sem rejeitar artefatos
# legitimamente curtos.
DRAFT_MIN_BYTES = int(os.environ.get("DRAFT_MIN_BYTES", "100"))

# Substrings que indicam rate-limit (HTTP 429) em qualquer parte do exc/name/msg.
# Se um novo provider usar vocabulário diferente, acrescentar aqui.
_RATE_LIMIT_HINTS = ("429", "rate limit", "rate_limit", "too many", "toomany")

# Backoff alinhado com 20 req/min do OpenRouter free tier (janela = 60s).
# Index = attempt-1. 30s na 1ª retry atravessa metade da janela; 60s na 2ª
# garante que uma janela inteira passou. Total máximo ~90s, dentro do
# STREAM_IDLE_TIMEOUT_MS=5min do front. Backoff exponencial puro (5/15/45)
# era pessimista demais — passava 5s ainda dentro da mesma janela bloqueada.
_RATE_LIMIT_BACKOFF_SECS = (30, 60, 60)

# Provider escolhido uma vez por processo via LLM_PROVIDER. Adapter
# encapsula spec + provider-profile internamente.
_LLM_PROVIDER = create_llm_provider()


def _is_rate_limit_error(exc: Exception) -> bool:
    """True se a exceção do invoke indica rate-limit do provider (HTTP 429)."""
    name = type(exc).__name__.lower()
    msg = str(exc).lower()
    return any(hint in name or hint in msg for hint in _RATE_LIMIT_HINTS)


def _rate_limit_backoff_secs(attempt: int) -> int:
    """Espera em segundos antes da próxima tentativa em caso de rate-limit."""
    idx = min(max(attempt - 1, 0), len(_RATE_LIMIT_BACKOFF_SECS) - 1)
    return _RATE_LIMIT_BACKOFF_SECS[idx]


class WrapperState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    retry_count: int
    # Propagado de config.configurable.slug pra route_after_run conseguir
    # construir o draft path direto. Reducer default (overwrite) é suficiente —
    # run_agent sempre re-popula.
    slug: str | None


def _resolve_backend(slug: str | None):
    """Retorna (DaytonaBackend, repo_path) — sandbox é a única superfície de
    file I/O do agente. Sem CompositeBackend/FilesystemBackend na Fase 2."""
    if not slug:
        raise ValueError("slug não informado no config do run.")

    from daytona import manager

    daytona_backend, repo_path = manager.get(slug)
    if daytona_backend is None:
        raise ValueError(
            f"Nenhum sandbox ativo para o slug '{slug}'. "
            "Garanta o sandbox via POST /ensure/{slug} antes de gerar artefatos."
        )
    return daytona_backend, repo_path


def _codebase_block(repo_path: str) -> str:
    # Paths absolutos reais dentro do sandbox — sem prefixo virtual /repo/.
    # Agente usa o path completo direto em ls/read_file/glob/grep.
    return f"""

---

## CONTEXTO DO REPOSITÓRIO (MODO BROWNFIELD)

[CODEBASE]
O código real do projeto está clonado em `{repo_path}` dentro do sandbox.
Use esse path absoluto em todas as suas ferramentas de leitura.

❌ NUNCA faça:
- `ls /` — lista diretórios do container Linux (bin, etc, usr…), não o projeto.
- `grep <pattern>` sem path ou com path `/` — varre o sistema de arquivos
  inteiro do sandbox e estoura timeout, derrubando a geração. Mesma coisa
  pra `find /`.
- Buscas em paths fora de `{repo_path}`.

✅ Exemplos válidos:
- `ls {repo_path}` — raiz do projeto
- `read_file {repo_path}/README.md` — lê arquivo específico
- `glob "**/*.py" {repo_path}` — lista arquivos Python do projeto
- `grep "class " {repo_path}` — busca dentro do projeto apenas

O artefato gerado deve referenciar arquivos e estruturas reais encontrados em
`{repo_path}`.
"""


def _predecessors_block(phase: str, slug: str) -> str:
    """Lista os artefatos prévios disponíveis para leitura via read_file no sandbox.

    Substitui a antiga injeção de conteúdo de `_previous_artifacts_block`:
    agente passa a buscar os predecessores quando precisar, em vez de receber
    tudo pré-injetado. Reduz tokens no system prompt e desbloqueia análises
    seletivas (grep, read parcial).
    """
    if phase not in PHASE_ORDER:
        return ""
    idx = PHASE_ORDER.index(phase)
    if idx == 0:
        return ""

    predecessors = PHASE_ORDER[:idx]
    lines = [f"- `{DAYTONA_SPECS_PATH}/{slug}/{p}.md` ({p})" for p in predecessors]
    immediate = predecessors[-1]
    paths_listed = "\n".join(lines)

    return f"""

---

## ARTEFATOS PRÉVIOS DISPONÍVEIS

[CONTEXTO PRÉ-EXISTENTE]
Os artefatos das fases anteriores deste slug estão materializados no sandbox
e disponíveis para leitura via tool call:

{paths_listed}

**Antes de produzir esta fase**, leia o predecessor imediato (`{immediate}`)
com `read_file` — é a fonte primária de continuidade. Consulte os artefatos
mais antigos sob demanda quando precisar fechar lacunas de rastreabilidade
(BR-XXX, FR-XXX, etc.).

❌ Não tente ler em outros paths (`features/...`, `drafts/...`, blob, etc.).
Os artefatos só existem nos paths absolutos listados acima.
"""


def make_agent(prompt_filename: str):
    base_prompt = (PROMPTS_DIR / prompt_filename).read_text(encoding="utf-8")
    phase = prompt_filename.removesuffix(".md").upper()

    def _draft_sandbox_path(slug: str) -> str:
        return f"{DAYTONA_SPECS_PATH}/{slug}/{phase}.md"

    def run_agent(state: WrapperState, config: RunnableConfig) -> dict:
        slug = (config.get("configurable") or {}).get("slug")
        attempt = state.get("retry_count", 0) + 1
        logger.info(
            "[%s] run_agent attempt=%d slug=%s msgs_in=%d",
            phase, attempt, slug, len(state["messages"]),
        )
        backend, repo_path = _resolve_backend(slug)

        # Ordem importa: _SAVE_INSTRUCTION vai POR ÚLTIMO pra garantir recência no
        # contexto do modelo. Sem isso, _codebase_block era o último bloco antes
        # do user message e o modelo extrapolava o prefixo pro write_file.
        # Sem _previous_artifacts_block na Fase 2 — agente lê predecessores via
        # tool call (read_file) orientado por _predecessors_block.
        system_prompt = base_prompt
        if repo_path:
            system_prompt += _codebase_block(repo_path)
        if slug:
            system_prompt += _predecessors_block(phase, slug)
        system_prompt += _SAVE_INSTRUCTION

        _model = _LLM_PROVIDER.build_chat_model(max_output_tokens=MAX_OUTPUT_TOKENS)
        deep_agent = create_deep_agent(
            model=_model,
            system_prompt=system_prompt,
            backend=backend,
            skills=["backend/skills"],
        )
        logger.info("[%s] invoking deep_agent (system_prompt=%d chars)",
                    phase, len(system_prompt))
        try:
            result = deep_agent.invoke({"messages": state["messages"]})
        except Exception as exc:
            logger.exception("[%s] deep_agent.invoke RAISED: %s", phase, exc)
            error_summary = f"{type(exc).__name__}: {str(exc)[:400]}"
            is_rate_limit = _is_rate_limit_error(exc)
            will_retry = attempt < MAX_AGENT_ATTEMPTS

            if is_rate_limit and will_retry:
                wait_secs = _rate_limit_backoff_secs(attempt)
                logger.warning(
                    "[%s] rate-limit detectado (attempt=%d), aguardando %ds antes do retry",
                    phase, attempt, wait_secs,
                )
                time.sleep(wait_secs)
                msg_hint = (
                    f"⚠️ Provider retornou rate-limit (HTTP 429): {error_summary}\n\n"
                    f"Esperei {wait_secs}s antes desta tentativa pra dar tempo da cota recuperar. "
                    "Repita o mesmo plano que você ia executar — não troque de abordagem. "
                    "Quando o stream voltar a funcionar, salve o artefato com write_file "
                    "no caminho indicado em [SALVAR EM]."
                )
            elif is_rate_limit:
                msg_hint = (
                    f"⚠️ Rate-limit persistente do provider: {error_summary}\n\n"
                    "Sem mais tentativas. O usuário precisa trocar pra modelo pago "
                    "ou aguardar reset da cota antes de tentar de novo."
                )
            else:
                msg_hint = (
                    f"⚠️ A iteração anterior falhou com erro de ferramenta: {error_summary}\n\n"
                    "Possível causa: escopo de busca grande demais (ex.: grep/find em '/' "
                    "ou em path fora do repositório clonado), ou tool inválida. "
                    "Tente abordagem diferente — use caminhos específicos DENTRO do "
                    "path do repositório (veja [CODEBASE] no system prompt). "
                    "Quando tiver informação suficiente, salve o artefato com write_file "
                    "no caminho indicado em [SALVAR EM]."
                )

            logger.warning(
                "[%s] convertendo exceção em retry (attempt=%d, rate_limit=%s, will_retry=%s)",
                phase, attempt, is_rate_limit, will_retry,
            )
            error_msg = HumanMessage(content=msg_hint)
            return {
                "messages": [error_msg],
                "retry_count": attempt,
                "slug": slug,
            }

        # Observabilidade: loga toda tool-call e tool-result emitida nesta invocação.
        # Slice em new_messages evita relog em retries — só o delta desta attempt.
        new_messages = result["messages"][len(state["messages"]):]
        for m in new_messages:
            tool_calls = getattr(m, "tool_calls", None) or []
            for tc in tool_calls:
                if isinstance(tc, dict):
                    name = tc.get("name", "?")
                    args = tc.get("args", {})
                else:
                    name = getattr(tc, "name", "?")
                    args = getattr(tc, "args", {})
                args_str = str(args)[:240]
                logger.debug("[%s] tool_call name=%s args=%s", phase, name, args_str)
            msg_type = getattr(m, "type", "") or type(m).__name__
            if msg_type == "tool" or (getattr(m, "name", None) and not tool_calls):
                content = getattr(m, "content", "")
                content_str = (content if isinstance(content, str) else str(content))[:240]
                logger.debug("[%s] tool_result name=%s -> %s",
                             phase, getattr(m, "name", "?"), content_str)

        logger.info("[%s] deep_agent done, msgs_out=%d", phase, len(result["messages"]))
        return {
            "messages": result["messages"],
            "retry_count": attempt,
            "slug": slug,
        }

    def inject_retry(state: WrapperState) -> dict:
        """Nó real que injeta a mensagem de retry — em conditional edges a mutação
        de state['messages'] não propaga, então isso precisa ser um update real."""
        logger.info("[%s] inject_retry attempt=%d", phase, state.get("retry_count", 0))
        return {"messages": [HumanMessage(content=_RETRY_MESSAGE)]}

    def route_after_run(state: WrapperState) -> str:
        """Verifica que o agente salvou o draft no sandbox e snapshota pro blob.

        Source of truth = blob. Sandbox armazena o draft transitoriamente entre
        agente e snapshot — se sandbox morrer antes daqui, o trabalho é perdido
        (decisão consciente: usuário re-roda em ~30s).
        """
        slug = state.get("slug")
        rc = state.get("retry_count", 0)
        if not slug:
            logger.warning("[%s] route_after_run sem slug — END", phase)
            return END

        try:
            from daytona import manager
            backend, _ = manager.get(slug)
        except Exception as exc:
            logger.warning("[%s] route_after_run: manager.get falhou: %s", phase, exc)
            return END if rc >= MAX_AGENT_ATTEMPTS else "inject_retry"

        if backend is None:
            logger.warning("[%s] route_after_run: sandbox ausente pra slug=%s", phase, slug)
            return END if rc >= MAX_AGENT_ATTEMPTS else "inject_retry"

        draft_path = _draft_sandbox_path(slug)
        try:
            responses = backend.download_files([draft_path])
        except Exception as exc:
            logger.warning("[%s] download_files falhou: %s", phase, exc)
            return END if rc >= MAX_AGENT_ATTEMPTS else "inject_retry"

        resp = responses[0] if responses else None
        content_bytes = getattr(resp, "content", None) if resp else None
        error = getattr(resp, "error", None) if resp else "no_response"
        size = len(content_bytes) if content_bytes else 0
        file_ok = error is None and size > DRAFT_MIN_BYTES

        logger.info(
            "[%s] route_after_run draft=%s error=%s size=%d retry_count=%d",
            phase, draft_path, error, size, rc,
        )

        if file_ok:
            try:
                from storage.factory import create_blob_storage
                blob = create_blob_storage()
                blob.save_artifact(
                    slug, phase, content_bytes.decode("utf-8"), namespace="drafts",
                )
                logger.info("[%s] snapshot blob OK (slug=%s, %d bytes)", phase, slug, size)
            except Exception as exc:
                logger.warning("[%s] snapshot blob FAILED (slug=%s): %s", phase, slug, exc)
            return END

        if rc >= MAX_AGENT_ATTEMPTS:
            return END
        return "inject_retry"

    workflow = StateGraph(WrapperState)
    workflow.add_node("run_agent", run_agent)
    workflow.add_node("inject_retry", inject_retry)
    workflow.set_entry_point("run_agent")
    workflow.add_conditional_edges("run_agent", route_after_run,
                                   {END: END, "inject_retry": "inject_retry"})
    workflow.add_edge("inject_retry", "run_agent")

    return workflow.compile()
