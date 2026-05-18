"""ask_user — ferramenta human-in-the-loop para agentes deepagents.

Quando o agente estiver prestes a escrever um placeholder por falta de
informação, chama esta tool com as perguntas. A tool grava no SQLite,
bloqueia em poll de 10s, e retorna as respostas quando o usuário responde
no frontend.

thread_id é obtido via InjectedToolArg — o framework LangChain injeta o
RunnableConfig diretamente no parâmetro, sem depender de contextvar.
Isso resolve o problema de deepagents executar tools em thread pool
(run_in_executor não copia contextvars do asyncio).
"""
import json
import logging
import time
from typing import Annotated

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import InjectedToolArg, tool

from db import create_clarification, delete_clarification, get_clarification

logger = logging.getLogger(__name__)

_POLL_INTERVAL_SECS = 10
_MAX_POLLS = 60  # 10 minutos


@tool
def ask_user(questions: str, config: Annotated[RunnableConfig, InjectedToolArg]) -> str:
    """Faz perguntas ao usuário quando há requisitos ambíguos ou indefinidos.

    Use ANTES de escrever qualquer placeholder como [A definir - ...].
    Agrupe TODAS as perguntas pendentes em UMA única chamada.
    Bloqueia até o usuário responder (timeout: 10 minutos).

    O parâmetro 'questions' deve ser uma string JSON com um array de objetos.
    Cada objeto deve ter:
      - "question": string com a pergunta
      - "type": "radio" | "checkbox" | "text"
      - "options": lista de strings (obrigatório para radio e checkbox)

    Exemplo:
    '[{"question": "Qual broker?", "type": "radio", "options": ["RabbitMQ", "Kafka"]}, {"question": "Qual runtime?", "type": "text"}]'
    """
    thread_id = (config.get("configurable") or {}).get("thread_id")
    if not thread_id:
        return (
            "ERROR: thread_id não disponível — impossível suspender para input do usuário. "
            "Prossiga com defaults razoáveis e documente as premissas no artefato."
        )

    try:
        parsed_questions = json.loads(questions)
    except (json.JSONDecodeError, TypeError):
        return "ERROR: o parâmetro 'questions' deve ser uma string JSON válida."

    if not isinstance(parsed_questions, list) or not parsed_questions:
        return "ERROR: questions deve ser um array JSON não-vazio."
    for q in parsed_questions:
        if not isinstance(q, dict) or not q.get("question") or not q.get("type"):
            return "ERROR: cada pergunta requer os campos 'question' e 'type'."
        if q["type"] in ("radio", "checkbox") and not q.get("options"):
            return f"ERROR: pergunta do tipo '{q['type']}' requer o campo 'options'."

    questions = parsed_questions  # type: ignore[assignment]

    logger.info("[ask_user] thread_id=%s gravando %d perguntas", thread_id, len(questions))
    create_clarification(thread_id, questions)

    for poll_num in range(_MAX_POLLS):
        time.sleep(_POLL_INTERVAL_SECS)
        row = get_clarification(thread_id)
        if row is None:
            logger.warning("[ask_user] thread_id=%s sessão removida durante poll", thread_id)
            return "CANCELADO: sessão de clarificação removida. Prossiga com defaults."
        if row["status"] == "answered":
            answers_raw = row["answers"]
            delete_clarification(thread_id)
            logger.info(
                "[ask_user] thread_id=%s respostas recebidas após %d polls",
                thread_id, poll_num + 1,
            )
            try:
                answers = json.loads(answers_raw)
            except (json.JSONDecodeError, TypeError):
                return f"ERROR: payload de respostas malformado: {answers_raw!r}"
            parts = [
                f"Q{i + 1}: {q['question']}\nA{i + 1}: {a}"
                for i, (q, a) in enumerate(zip(questions, answers))
            ]
            return "\n\n".join(parts)

    delete_clarification(thread_id)
    logger.warning("[ask_user] thread_id=%s timeout após %d polls", thread_id, _MAX_POLLS)
    return (
        "TIMEOUT: usuário não respondeu em 10 minutos. "
        "Prossiga com defaults razoáveis e documente todas as premissas explicitamente no artefato."
    )
