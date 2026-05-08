# Roadmap: Champion AI — Modo Sandbox (Brownfield)

## Visão

Hoje o Champion AI opera em modo **greenfield** — gera documentação a partir de descrições textuais e artefatos aprovados, sem acesso ao código do projeto-alvo. O modo **sandbox** permitirá que o Champion AI trabalhe sobre projetos existentes: o agente clona o repositório do cliente, explora o codebase real e produz artefatos (PRD, Plano, Tarefas) com rastreabilidade direta ao código.

---

## Por que o modelo atual não funciona para brownfield

No modo atual, o `FilesystemBackend` aponta para o repositório do `champion-ai-deepagents` em si — o agente não tem acesso ao código do projeto que está sendo documentado. Qualquer tentativa de "explorar o codebase" resulta em globbing do `.venv/` e `node_modules/`, causando timeouts e respostas vazias.

---

## Arquitetura do Sandbox

```
Champion AI (este repositório)
    │
    ├── /sandboxes/{slug}/          ← diretório isolado por épico
    │       └── {repo-clonado}/     ← git clone do projeto-alvo
    │
    └── .specs/{slug}/              ← artefatos gerados (inalterado)
```

### Fluxo

1. **Usuário informa** a URL do repositório + branch no frontend
2. **Backend** faz `git clone --depth=1` para `/sandboxes/{slug}/`
3. **FilesystemBackend** do agente aponta para `/sandboxes/{slug}/{repo}/` (read-only via `virtual_mode=True`)
4. **Agente** pode usar `ls`, `read_file`, `grep`, `glob` para explorar o código real
5. **Write** só é permitido em `.specs/drafts/{slug}/` — o sandbox é somente-leitura
6. Após aprovação de todos os artefatos, o sandbox pode ser removido

---

## Fases de Implementação

### Fase 1 — API de Sandbox

- `POST /sandboxes/{slug}` — recebe `{ repo_url, branch }`, faz `git clone --depth=1` assíncrono
- `GET /sandboxes/{slug}` — retorna status (`cloning | ready | error`) e metadata do repo
- `DELETE /sandboxes/{slug}` — limpa o diretório clonado
- Validação: bloquear URLs não-HTTPS, repos muito grandes (> 500MB), branches inválidos
- Timeout de clone: 120s com feedback de progresso via SSE

### Fase 2 — Backend Composto (CompositeBackend)

Usar `CompositeBackend` do deepagents para separar permissões:

```python
from deepagents.backends.composite import CompositeBackend

backend = CompositeBackend({
    # Read-only: código do projeto-alvo
    "/repo": FilesystemBackend(root_dir=sandbox_path, virtual_mode=True),
    # Read-write: apenas artefatos gerados
    "/specs": FilesystemBackend(root_dir=specs_path, virtual_mode=True),
})
```

O agente vê dois "discos" virtuais: `/repo/` (leitura) e `/specs/` (escrita). O `[SALVAR EM]` passaria a ser `/specs/drafts/{slug}/{PHASE}.md`.

### Fase 3 — Instrução de contexto do sandbox

Adicionar bloco `[CODEBASE]` no prompt inicial quando sandbox estiver disponível:

```
[CODEBASE]
O repositório foi clonado em /repo. Use ls, grep e read_file para explorar.
Stack detectada: {linguagem, framework, versão}
Entry points: {arquivos principais detectados}
```

O agente do PLANO poderá então fazer `grep "NomeClasse"` no código real e citar arquivos com rastreabilidade.

### Fase 4 — Frontend

- Campo opcional "URL do repositório" no formulário principal
- Indicador de status do clone (spinner → pronto)
- Badge "modo sandbox" quando repositório estiver disponível
- Botão para limpar sandbox após conclusão do pipeline

### Fase 5 — Segurança e Isolamento

- Executar clone em container isolado (Docker/Firecracker) para evitar scripts maliciosos no repo
- Limitar tamanho do clone (`--depth=1`, sem submodules por padrão)
- Rate limiting por IP/usuário
- Scan de segredos no clone antes de expor ao agente (trufflehog ou similar)
- Auto-limpeza: sandboxes expiram após 24h sem atividade

---

## Dependências Técnicas

| Componente | Tecnologia | Observação |
|-----------|-----------|------------|
| Git clone | `subprocess` / `pygit2` | `--depth=1 --single-branch` |
| CompositeBackend | deepagents ≥ 0.5 | Já disponível no pacote |
| Stack detection | heurística de arquivos | `package.json`, `pyproject.toml`, `pom.xml`, etc. |
| Isolamento | Docker (fase 5) | Opcional nas fases iniciais |

---

## O que não muda

- Pipeline de 5 fases (Constituição → PRD → Especificação → Plano → Tarefas)
- Formato dos artefatos e rastreabilidade (BR-XXX, FR-XXX)
- API de drafts/approve/artifacts — inalterada
- Modo greenfield continua funcionando sem sandbox
