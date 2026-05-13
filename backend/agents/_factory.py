import logging
import os
import re
import time
from pathlib import Path
from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage, HumanMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.types import RunnableConfig
from deepagents import create_deep_agent
from deepagents.backends.filesystem import FilesystemBackend

logger = logging.getLogger(__name__)

from agents.llm import create_llm_provider

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
SPECS_DIR = PROJECT_ROOT / ".specs"

PHASE_ORDER = ["CONSTITUICAO", "PRD", "ESPECIFICACAO", "PLANO", "TAREFAS"]

_SAVE_INSTRUCTION = """

---

## INSTRUÇÃO DE SAÍDA (PRIORIDADE MÁXIMA)

Ao concluir o artefato, use `write_file` (ou `edit_file` se o arquivo já existe)
para salvar no caminho **EXATO** indicado em `[SALVAR EM]` da mensagem do usuário.

Regras obrigatórias:
- Copie o path do `[SALVAR EM]` **caractere por caractere**. Sem adicionar prefixo,
  sem converter para absoluto, sem normalizar.
- ⚠️ O prefixo `/repo/...` mencionado em [CODEBASE] é EXCLUSIVO para LER código-fonte
  com `ls`, `read_file`, `glob`, `grep`. **NUNCA** use esse prefixo em `write_file`
  ou `edit_file` para salvar drafts — drafts vão para disco local FORA do sandbox,
  e o path do `[SALVAR EM]` já está pronto pra uso direto.
- Exemplo: se `[SALVAR EM]` diz `/drafts/foo/CONSTITUICAO.md`, chame
  `write_file(file_path="/drafts/foo/CONSTITUICAO.md", ...)` — sem `/repo/`,
  sem `/home/daytona/`, sem nada extra.
- O conteúdo deve ser apenas o markdown do artefato, sem preâmbulo nem comentários extras.
"""

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
    # construir o draft path direto (sem regex em messages). Reducer default
    # (overwrite) é suficiente — run_agent sempre re-popula.
    slug: str | None


def _resolve_backend(slug: str | None) -> tuple:
    """Retorna (CompositeBackend, repo_path).

    Exige sandbox Daytona ativo para o slug. Falha explicitamente se ausente.
    """
    if not slug:
        raise ValueError("slug não informado no config do run.")

    from daytona import manager
    from deepagents.backends.composite import CompositeBackend

    daytona_backend, repo_path = manager.get(slug)
    if daytona_backend is None:
        raise ValueError(
            f"Nenhum sandbox ativo para o slug '{slug}'. "
            "Crie um sandbox com o repositório antes de gerar artefatos."
        )

    composite = CompositeBackend(
        default=FilesystemBackend(str(SPECS_DIR), virtual_mode=True),
        routes={"/repo/": daytona_backend},
    )
    return composite, repo_path


def _codebase_block(repo_path: str) -> str:
    # CompositeBackend roteia o prefixo virtual /repo/ pro DaytonaBackend; ou seja,
    # o caminho real `{repo_path}` dentro do sandbox é acessado pelas tools como
    # `/repo{repo_path}`. Sem isso explícito, o agente perde rounds tentando ls em
    # /repo, /repo/home, /repo/home/daytona até finalmente achar o código.
    virtual_repo = f"/repo{repo_path}"
    return f"""

---

## CONTEXTO DO REPOSITÓRIO (MODO BROWNFIELD)

[CODEBASE]
O código real do projeto foi clonado em `{repo_path}` dentro do sandbox e é
acessível pelas suas ferramentas EXCLUSIVAMENTE via o path virtual:

    {virtual_repo}

Use SEMPRE esse prefixo em `ls`, `read_file`, `glob` e `grep`.

❌ NUNCA faça:
- `ls /` ou `ls /repo` — listam diretórios do container Linux (bin, etc, usr…),
  não o código do projeto. Desperdiça rounds e tokens.
- `grep <pattern>` sem path ou com path `/` — varre o sistema de arquivos
  inteiro do sandbox (~milhares de arquivos do sistema) e estoura timeout,
  derrubando a geração. Mesma coisa pra `find /`.
- Buscas em paths fora de `{virtual_repo}`.

✅ Exemplos válidos:
- `ls {virtual_repo}` — raiz do projeto
- `read_file {virtual_repo}/README.md` — lê arquivo específico
- `glob "**/*.py" {virtual_repo}` — lista arquivos Python do projeto
- `grep "class " {virtual_repo}` — busca dentro do projeto apenas

O artefato gerado deve referenciar arquivos e estruturas reais encontrados em
`{virtual_repo}`.
"""


def _previous_artifacts_block(slug: str, current_phase: str) -> str:
    """Bloco de contexto com manifesto das fases prévias + predecessor imediato em texto integral.

    Balanço entre token-eficiência (read_file sob demanda) e garantia (predecessor sempre presente).
    Retorna string vazia se for a primeira fase ou se nenhuma anterior foi aprovada.
    """
    if current_phase not in PHASE_ORDER:
        return ""
    idx = PHASE_ORDER.index(current_phase)
    if idx == 0:
        return ""

    from storage.factory import create_blob_storage

    blob = create_blob_storage()
    approved_set = set(blob.list_artifacts(slug))
    previous_approved = [p for p in PHASE_ORDER[:idx] if p in approved_set]
    if not previous_approved:
        return ""

    immediate = previous_approved[-1]
    older = previous_approved[:-1]

    parts: list[str] = ["\n\n---\n\n## ARTEFATOS PRÉVIOS APROVADOS\n"]
    if older:
        parts.append(
            "**Anteriores (use `read_file` para o conteúdo completo quando precisar):**"
        )
        for p in older:
            parts.append(f"- {p} → `features/{slug}/{p}.md`")
        parts.append("")

    parts.append(
        f"**Predecessor imediato (incluído integralmente abaixo — também disponível em "
        f"`features/{slug}/{immediate}.md`):**\n"
    )
    parts.append(f"### {immediate}\n")
    content = blob.get_artifact(slug, immediate) or "(conteúdo indisponível)"
    parts.append(content)

    return "\n".join(parts)


def _draft_path_for(slug: str, phase: str) -> Path:
    """Caminho canônico do draft no disco. Fonte única — consistente com
    api.py:_draft_path e prompts.ts:buildInitialInput."""
    return SPECS_DIR / "drafts" / slug / f"{phase}.md"


def _get_draft_path_via_regex(messages: list) -> Path | None:
    """Fallback: parseia `[SALVAR EM]` das messages quando state.slug não está
    populado (ex.: chamada via studio sem configurable.slug). Mantido só por
    safety-net — caminho normal é _draft_path_for(slug, phase)."""
    for m in messages:
        content = m.content if hasattr(m, "content") else m.get("content", "")
        if not isinstance(content, str):
            continue
        # Aceita os 3 formatos: `drafts/foo.md`, `/drafts/foo.md` (novo, com leading
        # slash desde o fix Azure), e `.specs/drafts/foo.md` (caso o agente normalize).
        match = re.search(r"\[SALVAR EM\]\s*\n(?:\.specs)?/?(drafts/.+\.md)", content)
        if match:
            return SPECS_DIR / match.group(1).strip()
    return None


def make_agent(prompt_filename: str):
    base_prompt = (PROMPTS_DIR / prompt_filename).read_text(encoding="utf-8")
    phase = prompt_filename.removesuffix(".md").upper()

    def run_agent(state: WrapperState, config: RunnableConfig) -> dict: 
        slug = (config.get("configurable") or {}).get("slug")
        attempt = state.get("retry_count", 0) + 1
        logger.info(
            "[%s] run_agent attempt=%d slug=%s msgs_in=%d",
            phase, attempt, slug, len(state["messages"]),
        )
        backend, repo_path = _resolve_backend(slug)

        # Ordem importa: _SAVE_INSTRUCTION vai POR ÚLTIMO pra garantir recência no
        # contexto do modelo. Sem isso, o _codebase_block ("use SEMPRE o prefixo
        # /repo/...") era o último bloco antes do user message, e GPT-5.4-mini
        # extrapolava o prefixo pro write_file de drafts (bug Azure draft path).
        system_prompt = base_prompt
        if repo_path:
            system_prompt += _codebase_block(repo_path)
        if slug:
            system_prompt += _previous_artifacts_block(slug, phase)
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
            # Converte exceção em mensagem de erro injetada na conversa em vez
            # de derrubar o run. Detecta rate-limit (HTTP 429) e aplica backoff
            # exponencial antes de retornar; outras exceções (timeout Daytona,
            # parser deepagents) retornam direto pro retry-loop sem espera.
            error_summary = f"{type(exc).__name__}: {str(exc)[:400]}"
            is_rate_limit = _is_rate_limit_error(exc)
            will_retry = attempt < MAX_AGENT_ATTEMPTS

            if is_rate_limit and will_retry:
                # Backoff alinhado a 20 req/min do OpenRouter (janela 60s).
                # time.sleep bloqueia o worker thread (sync) mas fica dentro do
                # STREAM_IDLE_TIMEOUT_MS=5min do front.
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
                # Última tentativa, sem mais backoff — vai cair em phantom.
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
                    "path virtual do repositório (veja [CODEBASE] no system prompt). "
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
                logger.info("[%s] tool_call name=%s args=%s", phase, name, args_str)
            msg_type = getattr(m, "type", "") or type(m).__name__
            if msg_type == "tool" or (getattr(m, "name", None) and not tool_calls):
                content = getattr(m, "content", "")
                content_str = (content if isinstance(content, str) else str(content))[:240]
                logger.info("[%s] tool_result name=%s -> %s",
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
        # Caminho canônico via state.slug (populado por run_agent) + closure phase.
        # Regex em messages é fallback pra casos onde config.slug não foi passado.
        slug_state = state.get("slug")
        if slug_state:
            draft = _draft_path_for(slug_state, phase)
        else:
            draft = _get_draft_path_via_regex(state["messages"])
            if draft is not None:
                logger.warning(
                    "[%s] route_after_run usando fallback regex (state.slug vazio) → %s",
                    phase, draft,
                )
        file_ok = draft is not None and draft.exists() and draft.stat().st_size > DRAFT_MIN_BYTES
        rc = state.get("retry_count", 0)
        logger.info(
            "[%s] route_after_run draft=%s exists=%s size=%s retry_count=%d",
            phase,
            str(draft) if draft else "None",
            draft.exists() if draft else False,
            draft.stat().st_size if (draft and draft.exists()) else 0,
            rc,
        )
        if file_ok or rc >= MAX_AGENT_ATTEMPTS:
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
