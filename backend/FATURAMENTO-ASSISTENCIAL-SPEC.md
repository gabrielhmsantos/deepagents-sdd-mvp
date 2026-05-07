# Especificação de Feature — Faturamento Assistencial

## User Stories

### User Story 1 - Autenticação e Acesso ao Sistema

- **Priority:** P1 ⭐ MVP — Funcionalidade base sem a qual nenhuma outra operação pode ser executada; todo usuário precisa autenticar-se para acessar qualquer módulo.
- **Story:** Como operador da SECONCI ou usuário do portal, quero autenticar-me com e-mail e senha para que eu possa acessar as funcionalidades autorizadas no meu contexto de tenant ativo.
- **Implements:** BR-001, BR-002, BR-003, BR-004, NFR-001, NFR-002, NFR-003, NFR-004
- **Acceptance Criteria:**
  1. WHEN operador insere e-mail e senha válidos AND sistema executa MFA com token enviado por e-mail AND operador confirma token válido THEN system SHALL conceder acesso e exibir home do portal com contexto do tenant ativo.
  2. WHEN operador acessa link de primeiro acesso AND link não expirou AND operador define senha conforme regra de segurança THEN system SHALL ativar credencial, marcar troca obrigatória de senha como pendente e redirecionar para home.
  3. WHEN operador solicita recuperação de senha AND sistema identifica e-mail válido THEN system SHALL enviar link de uso único com validade configurada e registrar intento em trilha de auditoria.
  4. WHEN operador excede 5 tentativas falhas consecutivas em janela de 15 minutos THEN system SHALL bloquear autenticação temporariamente por período configurado e registrar tentativa em log de segurança.
  5. WHEN operador está autenticado E permanece inativo por mais de 30 minutos THEN system SHALL expirar sessão automaticamente e redirecionar para tela de login.
- **Independent Test:** A autenticação pode ser testada independentemente das demais funcionalidades; o teste deve validar login com credenciais válidas, rejeição com credenciais inválidas, expiração de token MFA, tentativas excessivas bloqueadas e expiração de sessão por inatividade — tudo sem dependência de outros módulos.

---

### User Story 2 - Portal do Cliente: Atualização Cadastral em Lote

- **Priority:** P1 ⭐ MVP — Jornada central do portal; sem atualização cadastral o faturamento não possui base consistente e as empresas não conseguem manter dados atualizados.
- **Story:** Como Administrador Cliente, quero atualizar cadastros de funcionários e dependentes por meio de upload de arquivo para que eu mantenha a base de dados consistente e apta para faturamento.
- **Implements:** BR-021, BR-022, BR-023, BR-024, BR-064, BR-065, NFR-006
- **Acceptance Criteria:**
  1. WHEN Administrador Cliente seleciona competência, unidade e empresa/tenant E realiza upload de arquivo no layout aceito THEN system SHALL processar arquivo em staging, classificar registros em "convergente", "divergente" ou "ausente" e exibir resultado consolidado.
  2. WHEN arquivo enviado contém registros divergentes E Administrador Cliente trata cada pendência THEN system SHALL registrar tratativa por registro e desbloquear finalização quando pendências bloqueantes forem resolvidas.
  3. WHEN situação cadastral exige evidência documentária (dependente PCD, dependente maior de 21 anos estudante) E Administrador Cliente envia documento THEN system SHALL registrar tipo, usuário responsável, data/hora e status de análise com histórico rastreável.
  4. WHEN Administrador Cliente tenta finalizar movimentação E existem pendências bloqueantes não tratadas THEN system SHALL bloquear finalização e exibir listagem das pendências pendentes.
  5. WHEN Administrador Cliente tenta upload de arquivo fora do layout aceito OU duplicado THEN system SHALL rejeitar upload com mensagem explicativa e registrar tentativa em log.
  6. WHEN movimentação é concluída THEN system SHALL gerar protocolo único com número, data/hora de abertura, responsável e status final.
- **Independent Test:** A atualização cadastral pode ser testada com arquivo de exemplo no layout definido, validando classificação de registros, tratamento de divergências, envio de evidências e geração de protocolo — sem dependência de outros módulos além de empresa/tenant e competência configurados.

---

### User Story 3 - Portal do Cliente: Transferências de Funcionários

- **Priority:** P1 ⭐ MVP — Operações de transferência são frequentes e impactam diretamente a composição de lotes de faturamento; impedir transferências inválidas protege a integridade do cálculo.
- **Story:** Como Administrador Cliente, quero transferir funcionários entre unidades ou CNPJs do mesmo grupo econômico para que eu mantenha a vinculação funcional atualizada e o faturamento seja calculado corretamente.
- **Implements:** BR-025, BR-026, BR-064, BR-065
- **Acceptance Criteria:**
  1. WHEN Administrador Cliente seleciona funcionário E registra origem, destino, data da transferência e motivo E sistema valida elegibilidade THEN system SHALL gerar protocolo da movimentação e atualizar vínculo funcional e local de trabalho vigente.
  2. WHEN Administrador Cliente tenta transferir funcionário E funcionário está inativo OU sem vínculo válido THEN system SHALL bloquear transferência com justificativa explicativa.
  3. WHEN Administrador Cliente tenta transferir E destino é inexistente OU não autorizado para a empresa THEN system SHALL bloquear transferência com justificativa.
  4. WHEN Administrador Cliente tenta transferir E existe conflito temporal com desligamento, reativação ou outra transferência THEN system SHALL bloquear transferência com informação do conflito identificado.
  5. WHEN transferência é concluída THEN system SHALL manter histórico consultável com origem, destino, data, motivo e responsável.
- **Independent Test:** A transferência pode ser testada com funcionário elegível e destino válido, validando geração de protocolo, atualização de vínculo e consulta de histórico — não requer dependência de outros módulos além de empresa/tenant com grupo econômico configurado.

---

### User Story 4 - Portal do Cliente: Envio de Folha de Pagamento

- **Priority:** P1 ⭐ MVP — O confronto entre folha de pagamento e base cadastral é insumo crítico do faturamento; sem envio de folha o processamento não possui referência para validação.
- **Story:** Como Administrador Cliente, quero enviar arquivo de folha de pagamento para confronto com a base cadastral para que o faturamento seja calculado com dados validados e divergências identificadas.
- **Implements:** BR-028, BR-029, BR-064
- **Acceptance Criteria:**
  1. WHEN Administrador Cliente seleciona competência, unidade e empresa/tenant E realiza upload de arquivo de folha THEN system SHALL processar arquivo em staging, classificar divergências relevantes e retornar status do processamento com resultado consolidado.
  2. WHEN arquivo enviado não está no layout aceito THEN system SHALL rejeitar upload com mensagem indicando formato esperado.
  3. WHEN Administrador Cliente tenta múltiplos envios conflitantes na mesma competência E não há regra de substituição ou versionamento THEN system SHALL bloquear novo envio com informação do envio existente.
  4. WHEN processamento é concluído THEN system SHALL gerar protocolo do envio e do processamento com status consultável.
- **Independent Test:** O envio de folha pode ser testado com arquivo no layout aceito, validando processamento em staging, classificação de divergências e geração de protocolo — não requer dependência de outros módulos além de competência configurada.

---

### User Story 5 - Portal do Cliente: Acompanhamento de Protocolos

- **Priority:** P1 ⭐ MVP — Protocolos são a unidade de rastreabilidade de todas as operações do portal; sem acompanhamento a visibilidade operacional é comprometida.
- **Story:** Como Administrador Cliente, quero consultar protocolos por filtros combinados para que eu acompanhe o status de todas as movimentações do meu tenant e navegue para detalhamento quando necessário.
- **Implements:** BR-027, BR-064
- **Acceptance Criteria:**
  1. WHEN Administrador Cliente aplica filtros combinados (tenant, unidade, competência, tipo, origem, status) THEN system SHALL retornar listagem de protocolos com número, origem, status, data/hora de abertura e data/hora de conclusão.
  2. WHEN Administrador Cliente seleciona protocolo E possui permissão de exportação THEN system SHALL permitir exportação da listagem em formato suportado.
  3. WHEN Administrador Cliente seleciona protocolo E seleciona opção de navegação THEN system SHALL redirecionar para detalhamento da jornada ou processo relacionado.
  4. WHEN Administrador Cliente tenta acessar protocolo de empresa/tenant distinta do contexto ativo THEN system SHALL bloquear acesso com mensagem de proteção de dados.
- **Independent Test:** O acompanhamento de protocolos pode ser testado com protocolos gerados nas jornadas anteriores (atualização cadastral, transferência, envio de folha), validando filtros, exibição de dados e navegação — não requer dependência de outros módulos além de protocolo existente.

---

### User Story 6 - Portal do Cliente: Consulta e Download de Boletos

- **Priority:** P1 ⭐ MVP — Boletos são documentos financeiros críticos para os clientes; a consulta e download devem respeitar segregação rigorosa de tenant.
- **Story:** Como Administrador Cliente, quero consultar e baixar boletos filtrados por competência, unidade e vencimento para que eu tenha acesso aos títulos financeiros da minha empresa.
- **Implements:** BR-030, BR-031, BR-064
- **Acceptance Criteria:**
  1. WHEN Administrador Cliente acessa jornada de boletos E aplica filtros (competência, unidade, vencimento, status) THEN system SHALL localizar arquivos correspondentes à empresa/tenant ativa, competência, unidade e filtros aplicáveis.
  2. WHEN Administrador Cliente seleciona título E possui permissão de download THEN system SHALL permitir visualização e download do arquivo.
  3. WHEN Administrador Cliente tenta acessar título de empresa/tenant distinta do contexto ativo THEN system SHALL bloquear acesso com proteção de dados.
  4. WHEN Administrador Cliente tenta download E não possui permissão correspondente THEN system SHALL bloquear com mensagem de permissão necessária.
  5. WHEN consulta retorna ausência, duplicidade ou inconsistência de arquivos THEN system SHALL exibir mensagem rastreável e compreensível ao usuário.
  6. WHEN operação de consulta ou download é executada THEN system SHALL registrar log de acesso com usuário, data/hora e tipo de operação.
- **Independent Test:** A consulta de boletos pode ser testada com arquivos existentes no diretório de rede configurado, validando filtros, localização de arquivos, registro de log e tratamento de ausência/duplicidade — requer dependência de integração com diretório de rede.

---

### User Story 7 - Portal do Cliente: Suspensão e Aprovação

- **Priority:** P1 ⭐ MVP — A fila operacional de pendências é essencial para a operação do portal; sem esse mecanismo registros ficam sem tratamento adequado.
- **Story:** Como Administrador Cliente, quero visualizar e tratar pendências de suspensão/aprovação para que eu conclua registros que dependem de decisão ou regularização.
- **Implements:** BR-062, BR-063, BR-064
- **Acceptance Criteria:**
  1. WHEN Administrador Cliente acessa fila de suspensões/aprovações THEN system SHALL exibir listagem de itens pendentes com tipo, origem, data, protocolo e status.
  2. WHEN Administrador Cliente executa ação de aprovar, reprovar, suspender ou solicitar ajuste E possui permissão E fornece justificativa quando exigida THEN system SHALL registrar decisão com usuário responsável, data/hora, comentário e evidência.
  3. WHEN Administrador Cliente tenta decisão E não fornece justificativa para reprovação, suspensão ou ajuste THEN system SHALL bloquear ação com mensagem indicando obrigatoriedade de justificativa.
  4. WHEN Administrador Cliente tenta conclusão de item E item já está encerrado E não existe fluxo formal de reabertura THEN system SHALL bloquear ação.
  5. WHEN decisão é tomada THEN system SHALL preservar histórico consultável da tratativa.
- **Independent Test:** A suspensão/aprovação pode ser testada com itens pendentes existentes, validando listagem, ações disponíveis, registro de decisão e histórico — não requer dependência de outros módulos além de itens pendentes gerados por outras jornadas.

---

### User Story 8 - Gestão Contratual: Cadastro de Empresa/Tenant

- **Priority:** P1 ⭐ MVP — A empresa é o tenant da aplicação; sem cadastro correto nenhuma operação pode ser executada no contexto do cliente.
- **Story:** Como Operador Backoffice ou Administrador Master, quero cadastrar e manter empresas/clientes para que cada empresa tenha seu contexto de tenant isolado e parametrizado.
- **Implements:** BR-012, BR-032, BR-033, BR-011, NFR-005, NFR-006
- **Acceptance Criteria:**
  1. WHEN Operador Backoffice cadastra nova empresa com documento principal, razão social, nome fantasia, responsável, contatos, endereço, vínculo de atendimento, grupo econômico, referências contratuais E sistema valida unicidade pelo documento principal THEN system SHALL criar empresa e utilizar identificador da empresa como tenantId em entidades dependentes.
  2. WHEN empresa é criada E é o primeiro usuário indicado THEN system SHALL provisionar automaticamente primeiro usuário com perfil Administrador Cliente, status "primeiro acesso pendente" E enviar texto de boas-vindas com link de ativação.
  3. WHEN Operador tenta cadastrar empresa E documento principal já existe E não é exceção formal para CNO THEN system SHALL rejeitar cadastro com mensagem de duplicidade.
  4. WHEN Operador tenta alterar empresa E alteração comprometeria vínculos contratuais ativos THEN system SHALL bloquear alteração com justificativa formal.
  5. WHEN Operador tenta vincular empresa a grupo econômico E interpreta isso como autorização automática de acesso THEN system SHALL bloquear interpretação, pois acesso é determinado por vínculos explícitos.
  6. WHEN empresa é alterada E sistema valida consistência THEN system SHALL registrar trilha de auditoria com valores anteriores e novos.
- **Independent Test:** O cadastro de empresa pode ser testado com dados válidos, validando criação, provisionamento de primeiro usuário, rejeição de duplicidade e trilha de auditoria — não requer dependência de outros módulos além de grupo econômico existente (opcional).

---

### User Story 9 - Gestão Contratual: Locais de Trabalho

- **Priority:** P1 ⭐ MVP — Locais de trabalho são a granularidade de vinculação do funcionário e determinante para sobrescrita de regras de faturamento.
- **Story:** Como Operador Backoffice, quero cadastrar e manter locais de trabalho vinculados à empresa para que eu defina a estrutura operacional e a regra de faturamento efetiva por local.
- **Implements:** BR-034, BR-043, BR-064
- **Acceptance Criteria:**
  1. WHEN Operador cadastra local de trabalho E associa a empresa E informa código interno, descrição, endereço, unidade de atendimento, situação THEN system SHALL criar local com regra herdada da empresa por padrão.
  2. WHEN Operador define sobrescrita de regra de faturamento para local específico E regra existe e está ativa THEN system SHALL aplicar sobrescrita e atualizar automaticamente locais sem sobrescrita específica para herdarem regra da empresa.
  3. WHEN Operador altera associação de regra E modifica contexto THEN system SHALL preservar histórico das associações com quem alterou, data/hora e motivo para rastreabilidade do cálculo por competência.
  4. WHEN Operador tenta associar regra inexistente OU inativa THEN system SHALL bloquear com mensagem de regra inválida.
- **Independent Test:** O cadastro de local de trabalho pode ser testado com empresa existente, validando criação, herança de regra, sobrescrita específica e histórico de alterações — não requer dependência de outros módulos além de empresa e regra de faturamento configuradas.

---

### User Story 10 - Gestão Contratual: Funcionários e Dependentes

- **Priority:** P1 ⭐ MVP — Funcionários e dependentes são a base cadastral para o faturamento; sem esses cadastros não há insumo para cálculo.
- **Story:** Como Operador Backoffice, quero cadastrar e manter funcionários vinculados à empresa e dependentes vinculados aos funcionários para que a base de faturamento esteja completa e consistente.
- **Implements:** BR-035, BR-036, BR-037, BR-038, BR-064
- **Acceptance Criteria:**
  1. WHEN Operador cadastra funcionário E associa a empresa E informa nome completo, CPF, datas de admissão e desligamento, categoria funcional, situação, local de trabalho THEN system SHALL criar vínculo com histórico de mudanças.
  2. WHEN Operador tenta cadastrar funcionário E não informa empresa vinculada OU CPF é inválido THEN system SHALL bloquear cadastro com justificativa.
  3. WHEN Operador cadastra dependente E associa a funcionário E informa nome completo, CPF, data de nascimento, grau de parentesco, definição de recolhimento THEN system SHALL criar vínculo com suporte a documentos e evidências.
  4. WHEN Operador tenta cadastrar dependente E não existe funcionário vinculado OU já existe dependente com mesma identidade lógica no contexto ativo THEN system SHALL bloquear cadastro com justificativa.
  5. WHEN Operador tenta excluir fisicamente documento/evidência E documento já foi utilizado em processo concluído THEN system SHALL bloquear exclusão, pois deve-se utilizar fluxo formal de substituição ou cancelamento auditado.
  6. WHEN dependente possui situação cadastral que exige evidência (PCD, maior de 21 anos estudante) E Operador envia documento THEN system SHALL registrar tipo, status de análise, histórico de decisão, usuário responsável e data/hora.
- **Independent Test:** O cadastro de funcionário e dependente pode ser testado com empresa e local existentes, validando criação, rejeição de dados inválidos, vínculo funcional e histórico — não requer dependência de outros módulos além de empresa configurada.

---

### User Story 11 - Gestão Contratual: Contratos, Vigências, Coberturas e Serviços

- **Priority:** P1 ⭐ MVP — Contratos definem as coberturas e vigências que determinam quais serviços são faturados; sem contrato não há faturamento.
- **Story:** Como Operador Backoffice, quero cadastrar e manter contratos vinculados à empresa com vigências, coberturas e serviços para que eu defina o escopo operacional e de cobrança do cliente.
- **Implements:** BR-039, BR-040, BR-064
- **Acceptance Criteria:**
  1. WHEN Operador cadastra contrato E associa a empresa E informa tipo, data de início, data de término THEN system SHALL criar contrato com suporte a situações contratuais, coberturas por unidade/categoria/carência/vigência e serviços.
  2. WHEN Operador tenta cadastrar contrato E não informa empresa vinculada THEN system SHALL bloquear com justificativa.
  3. WHEN Operador tenta criar vigência E já existe vigência sobreposta para contrato do mesmo tipo THEN system SHALL bloquear com informação da sobreposição.
  4. WHEN Operador tenta excluir contrato THEN system SHALL bloque ar exclusão física e sugerir encerramento lógico; sistema permitirá apenas inativação ou encerramento de vigência.
  5. WHEN Operador altera contrato E sistema valida consistência THEN system SHALL registrar trilha de auditoria com histórico temporal consultável.
- **Independent Test:** O cadastro de contrato pode ser testado com empresa existente, validando criação, bloqueio de vigências sobrepostas, encerramento lógico e histórico — não requer dependência de outros módulos além de empresa configurada.

---

### User Story 12 - Faturamento Assistencial: Parametrização de Regras de Faturamento

- **Priority:** P1 ⭐ MVP — Regras de faturamento são a base do cálculo; sem regra parametrizada não há como executar processamento.
- **Story:** Como Operador Backoffice, quero criar, manter e duplicar regras de faturamento para que eu defina os parâmetros percentuais e monetários que orientam o cálculo de cada competência.
- **Implements:** BR-041, BR-042, BR-043, BR-064, NFR-015
- **Acceptance Criteria:**
  1. WHEN Operador cria regra E informa nome, situação, parâmetros percentuais e monetários, mínimos, isenções e indicadores específicos E não há conflito entre campos mutuamente exclusivos THEN system SHALL criar regra com versionamento por vigência quando aplicável.
  2. WHEN Operador tenta criar regra E nome é obrigatório E não informado THEN system SHALL bloquear criação.
  3. WHEN Operador tenta criar regra E parâmetros são inconsistentes entre si THEN system SHALL bloquear com indicação dos conflitos.
  4. WHEN Operador tenta criar regra E já existe regra com mesma combinação de nome e vigência (duplicidade lógica) THEN system SHALL bloquear com mensagem de duplicidade.
  5. WHEN Operador executa duplicação de regra existente E seleciona nova regra como base THEN system SHALL criar nova regra com parâmetros copiados, identificador único e trilha de auditoria indicando origem da duplicação.
  6. WHEN Operador associa regra à empresa E regra existe e está ativa THEN system SHALL aplicar como regra principal da empresa E propagar herança para locais sem sobrescrita específica.
- **Independent Test:** A parametrização de regras pode ser testada com dados válidos, validando criação, validações de consistência, duplicação e associação — não requer dependência de outros módulos além de empresa configurada.

---

### User Story 13 - Faturamento Assistencial: Cadastro de Piso Salarial

- **Priority:** P1 ⭐ MVP — Piso salarial é insumo direto do cálculo de faturamento; sem piso não há como calcular corretamente.
- **Story:** Como Operador Backoffice, quero cadastrar e manter pisos salariais por CBO/categoria com vigência para que o cálculo de faturamento utilize valores corretos por unidade e competência.
- **Implements:** BR-044, BR-045, BR-064
- **Acceptance Criteria:**
  1. WHEN Operador cadastra piso E informa vigência, unidade de atendimento, regra de faturamento E valores por categoria funcional THEN system SHALL criar registro com suporte a manutenção simplificada em lote.
  2. WHEN Operador tenta cadastrar piso E já existe registro com mesma combinação de vigência, regra e unidade THEN system SHALL bloquear com mensagem de duplicidade.
  3. WHEN Operador mantém pisos em lote E sistema processa alterações THEN system SHALL preservar registros inequívocos e auditáveis no banco com histórico de alterações.
  4. WHEN Operador utiliza piso E existe vigência válida E piso está ativo THEN system SHALL utilizar valores para cálculo conforme competência.
  5. WHEN Operador tenta utilizar piso E piso está fora da vigência válida OU inativo THEN system SHALL ignorar uso e sinalizar pendência parametrizada.
- **Independent Test:** O cadastro de piso salarial pode ser testado com vigência, unidade e regra configuradas, validando criação, rejeição de duplicidade e manutenção em lote — não requer dependência de outros módulos além de unidade e regra de faturamento configuradas.

---

### User Story 14 - Faturamento Assistencial: Parametrização e Aplicação de Penalidades

- **Priority:** P1 ⭐ MVP — Penalidades são componente do cálculo com impacto direto no valor faturado; sem parametrização o cálculo fica incompleto.
- **Story:** Como Operador Backoffice, quero parametrizar penalidades e registrar sua aplicação em eventos de faturamento para que o cálculo inclua valores corretos de acréscimo ou dedução conforme regra da empresa.
- **Implements:** BR-046, BR-047, BR-064
- **Acceptance Criteria:**
  1. WHEN Operador cadastra penalidade E informa descrição, percentual, mínimos e situação THEN system SHALL criar registro auditável e reutilizável em cálculos.
  2. WHEN Operador ou sistema aplica penalidade E registra base de cálculo, valor calculado, competência, motivo e referência THEN system SHALL executar aplicação com rastreabilidade completa.
  3. WHEN empresa é VIP E sistema identifica classificação VIP E penalidade é aplicável THEN system SHALL aplicar penalidade de 2% conforme parametrização.
  4. WHEN empresa não é VIP E sistema identifica classificação padrão E penalidade é aplicável THEN system SHALL aplicar penalidade de 3% conforme parametrização.
  5. WHEN Operador ou sistema tenta aplicar penalidade E não informa competência OU objeto de referência THEN system SHALL bloquear aplicação com justificativa.
  6. WHEN Operador ou sistema tenta aplicar penalidade E percentual ou parâmetro é incoerente com a regra da penalidade THEN system SHALL bloquear com mensagem de inconsistência.
- **Independent Test:** A parametrização e aplicação de penalidades pode ser testada com empresa VIP e não-VIP configuradas, validando cadastro de penalidade, aplicação de percentual correto e registro auditável — requer dependência de empresa com classificação VIP parametrizada.

---

### User Story 15 - Faturamento Assistencial: Execução do Cálculo

- **Priority:** P1 ⭐ MVP — O cálculo é a operação central do módulo; sem execução o faturamento não é gerado.
- **Story:** Como Operador Backoffice, quero disparar e acompanhar a execução do cálculo de faturamento para competência para que eu obtenha lotes, itens, totais e logs consultáveis para análise e conferência.
- **Implements:** BR-048, BR-049, BR-064, BR-065, NFR-008, NFR-009
- **Acceptance Criteria:**
  1. WHEN Operador define competência e parâmetros obrigatórios E dispara execução THEN system SHALL gerar identificador de execução único, status inicial "Em Processamento" E registrar início em log.
  2. WHEN Operador tenta disparar E competência não foi informada OU parâmetros vigentes ausentes OU insumos mínimos necessários não disponíveis THEN system SHALL bloquear com listagem das pendências.
  3. WHEN Operador tenta novo disparo E já existe execução em andamento para a mesma competência E não há política formal de concorrência THEN system SHALL bloquear com mensagem indicando execução em curso.
  4. WHEN execução Oracle é concluída E sistema recebe resultado THEN system SHALL exibir resumo com lotes gerados, totais, inconsistências identificadas e mensagens relevantes.
  5. WHEN Operador solicita reprocessamento E autorização está presente OU contexto permite THEN system SHALL executar reprocessamento controlado com novo identificador e log de reprocessamento.
  6. WHEN Operador consulta execução específica E fornece identificador THEN system SHALL exibir detalhes técnicos e funcionais do processamento.
- **Independent Test:** A execução do cálculo pode ser testada com competência configurada, parâmetros vigentes, insumos disponíveis (funcionários, dependentes, regras, pisos, penalidades), validando geração de identificador, resumo de lotes/totais e log consultável — requer dependência de todas as parametrizações anteriores (regras, pisos, penalidades) e base cadastral (empresa, funcionários, dependentes).

---

### User Story 16 - Faturamento Assistencial: Faturamento Manual e Transferência de Lotes

- **Priority:** P2 — Importante para cenários de ajuste operacional, mas o faturamento automático é a regra principal; sem esse mecanismo o MVP ainda funciona.
- **Story:** Como Operador Backoffice, quero criar lotes manuais, transferir empresas do fluxo automático para lotes manuais e manter itens manuais para que eu possa corrigir cenários que o processamento automático não contemplou.
- **Implements:** BR-050, BR-051, BR-064
- **Acceptance Criteria:**
  1. WHEN Operador cria lote manual E informa competência THEN system SHALL criar lote sequencial com distinção lógica "manual" e status "aberto".
  2. WHEN Operador copia empresas elegíveis do fluxo automático para lote manual E regra de elegibilidade está satisfeita THEN system SHALL copiar registros e manter referência de origem.
  3. WHEN Operador mantém itens manuais E modifica valores OU adiciona/remover itens E recalcular totais THEN system SHALL recalcular totais do lote e atualizar totais.
  4. WHEN Operador tenta editar lote E lote está encerrado OU já enviado E não há fluxo formal de reabertura THEN system SHALL bloquear edição com justificativa.
  5. WHEN Operador tenta mistura indevida entre itens de origem automática e manual no mesmo lote THEN system SHALL bloquear com mensagem de separação obrigatória.
  6. WHEN Operador encerra lote manual THEN system SHALL marcar como "encerrado" com trilha de auditoria.
- **Independent Test:** O faturamento manual pode ser testado após execução de cálculo automático, validando criação de lote, cópia de empresas, manutenção de itens e separação lógica — requer dependência de execução de cálculo anterior.

---

### User Story 17 - Faturamento Assistencial: Exportação de Lotes ao Datasul

- **Priority:** P1 ⭐ MVP — A exportação é o objetivo final do faturamento; sem envio ao Datasul o processamento não entrega valor de negócio.
- **Story:** Como Operador Backoffice, quero gerar e enviar artefato de integração de lotes fechados ao Datasul para que o faturamento seja entregue ao ERP para processamento contábil e financeiro.
- **Implements:** BR-052, BR-053, BR-054, BR-055, BR-064, BR-065, NFR-006, NFR-019
- **Acceptance Criteria:**
  1. WHEN Operador seleciona lote fechado e validado E solicita geração de artefato THEN system SHALL gerar arquivo a partir dos itens do lote, distinguindo faturamento calculado (automático) de faturamento manual.
  2. WHEN Operador confirma data de emissão E lote é automático THEN system SHALL definir data de vencimento como dia 30 do mês corrente ou subsequente conforme competência.
  3. WHEN Operador define data de vencimento E lote é manual THEN system SHALL permitir data específica conforme regra operacional.
  4. WHEN Operador confirma envio E API do Datasul está disponível THEN system SHALL enviar arquivo por API E registrar data de emissão, layout de saída, usuário responsável e status.
  5. WHEN API retorna sucesso THEN system SHALL marcar lote como "exportado" de forma auditável e idempotente E registrar protocolo, mensagem e status de sucesso.
  6. WHEN API retorna rejeição ou erro THEN system SHALL registrar falha com detalhes técnicos, protocolo, mensagem de erro E sinalizar necessidade de correção.
  7. WHEN Operador tenta reenvio E não existe trilha formal de estorno OU cancelamento THEN system SHALL bloquear com mensagem de trilha obrigatória.
  8. WHEN Operador tenta alteração de arquivo já enviado E não existe fluxo formal de cancelamento, estorno, reabertura ou novo envio controlado THEN system SHALL bloquear.
  9. WHEN API não está disponível OU não é adotada THEN system SHALL disponibilizar arquivo gerado em diretório configurado E registrar estratégia alternativa aplicada.
- **Independent Test:** A exportação pode ser testada com lote fechado e validado, validando geração de artefato, distinção de origem automático/manual, registro de envio e marcação de exportado — requer dependência de lote criado por execução de cálculo.

---

### User Story 18 - Faturamento Assistencial: Relatórios e Conferência de Amostragem

- **Priority:** P2 — Importante para validação e controle de qualidade do faturamento, mas não bloqueia a operação principal.
- **Story:** Como Operador Backoffice, quero gerar relatórios operacionais e conduzir conferência de amostragem para que eu valide a consistência do faturamento e identifique divergências que precisam de tratamento.
- **Implements:** BR-056, BR-057, BR-064
- **Acceptance Criteria:**
  1. WHEN Operador define filtros (competência, empresa, lote, regra, penalidade, status) E solicita relatório THEN system SHALL gerar relatório com dados filtrados.
  2. WHEN Operador possui permissão de exportação THEN system SHALL permitir exportação do relatório em formato suportado.
  3. WHEN Operador seleciona competência E solicita amostra de empresas para conferência E critério parametrizado está configurado THEN system SHALL selecionar empresas conforme critério E exibir listagem.
  4. WHEN Operador confirma conferência E selecionar item ou empresa E registra resultado (convergência, divergência) E identifica operador conferente THEN system SHALL registrar resultado com rastreabilidade.
  5. WHEN Operador tenta alteração de resultado já conferido THEN system SHALL manter histórico E sinalizar alteração com usuário e timestamp novos, preservando registro original.
  6. WHEN Operador tenta confirmação de conferência E não selecionou item ou empresa alvo THEN system SHALL bloquear com mensagem de seleção obrigatória.
  7. WHEN Operador tenta confirmação de conferência E competência não informada THEN system SHALL bloquear com mensagem de competência obrigatória.
- **Independent Test:** Os relatórios e conferência podem ser testados com faturamento executado, validando geração de relatório por filtros, seleção de amostra e registro de resultado de conferência — requer dependência de execução de cálculo anterior.

---

### User Story 19 - Administração Backoffice: Perfis e Permissões

- **Priority:** P1 ⭐ MVP — Perfis e permissões são a base da autorização; sem esse controle o sistema não garante segregação de acesso.
- **Story:** Como Administrador Master/ROOT, quero criar, editar, ativar e inativar perfis e suas permissões para que o sistema autorize ações por módulo, tela e funcionalidade conforme perfil de cada usuário.
- **Implements:** BR-005, BR-006, BR-058, BR-064, NFR-006
- **Acceptance Criteria:**
  1. WHEN Administrador Master cria perfil E informa nome E associa funcionalidades (módulo, tela, ação) THEN system SHALL criar perfil com permissões vinculadas.
  2. WHEN Administrador Master tenta criar perfil E nome não informado THEN system SHALL bloquear com mensagem de nome obrigatório.
  3. WHEN Administrador Master tenta criar funcionalidade E código técnico já existe THEN system SHALL bloquear com mensagem de duplicidade.
  4. WHEN Administrador Master tenta vincular funcionalidade inativa a novo perfil THEN system SHALL bloquear com mensagem de funcionalidade indisponível.
  5. WHEN Administrador Master edita permissões de perfil E perfil possui usuários vinculados E alterações são válidas THEN system SHALL aplicar alterações E registrar trilha de auditoria.
  6. WHEN Administrador Master tenta excluir perfil E perfil possui usuários vinculados OU está em uso THEN system SHALL bloquear exclusão física E sugerir inativação.
  7. WHEN Operador Backoffice tenta criar OU editar OU administrar perfis E não possui permissão específica THEN system SHALL bloquear com mensagem de permissão necessária.
  8. WHEN Administrador Master inativa perfil THEN system SHALL manter histórico E invalidar permissões para novos acessos, preservando vínculos existentes para usuários já autenticados até reavaliação de sessão.
- **Independent Test:** A gestão de perfis pode ser testada com Administrador Master autenticado, validando criação de perfil, associação de permissões, inativação e rejeição de exclusão física — não requer dependência de outros módulos.

---

### User Story 20 - Administração Backoffice: Gestão de Usuários

- **Priority:** P1 ⭐ MVP — A gestão de usuários é essencial para operação do sistema; sem criação e manutenção de usuários ninguém acessa a aplicação.
- **Story:** Como Administrador Master/ROOT ou Operador Backoffice autorizado, quero criar, editar, ativar, inativar e associar usuários a perfis e empresas/tenants para que cada operador tenha acesso ao contexto correto.
- **Implements:** BR-007, BR-008, BR-009, BR-010, BR-059, BR-064, NFR-006
- **Acceptance Criteria:**
  1. WHEN Administrador Master cria usuário E informa nome completo, email corporativo único, tipo de usuário, empresas/tenants vinculados E perfis por empresa/tenant THEN system SHALL criar usuário com status ativo por padrão.
  2. WHEN Administrador Master cria usuário E email já existe THEN system SHALL bloquear com mensagem de email duplicado.
  3. WHEN Administrador Master associa usuário a empresa/tenant E perfil E usuário já possui vínculo existente nesse contexto THEN system SHALL permitir múltiplos perfis E agregar à lista existente.
  4. WHEN Administrador Master cria usuário E define como primeiro usuário da empresa E empresa é nova THEN system SHALL provisionar automaticamente com perfil Administrador Cliente E status "primeiro acesso pendente" E enviar texto de boas-vindas.
  5. WHEN Administrador Master inativa usuário E usuário possui sessão ativa THEN system SHALL invalidar sessão E bloquear novos acessos.
  6. WHEN Administrador Master redefine status de acesso E solicita reset de credencial OU reenvio de primeiro acesso E justificativa está presente THEN system SHALL executar ação E registrar em trilha de auditoria.
  7. WHEN Administrador Cliente OU usuário do portal tenta criar usuário OU editar usuário OU administrar acessos THEN system SHALL bloquear com mensagem de permissão necessária.
  8. WHEN Operador Backoffice tenta gestão de usuários E não possui permissão específica THEN system SHALL bloquear com mensagem de permissão necessária.
  9. WHEN usuário acessa sistema E autenticação é bem-sucedida THEN system SHALL registrar data do último acesso para consultas administrativas.
- **Independent Test:** A gestão de usuários pode ser testada com Administrador Master autenticado, validando criação de usuário, associação a perfis e empresas, inativação e bloqueio de ações por usuários não autorizados — não requer dependência de outros módulos além de perfis e empresas existentes.

---

### User Story 21 - Multi-Tenancy: Troca de Contexto e Segregação

- **Priority:** P1 ⭐ MVP — A segregação por tenant é princípio mandatório do sistema; sem esse controle não há integridade de dados entre empresas.
- **Story:** Como usuário com múltiplos vínculos de empresa/tenant, quero trocar o contexto ativo para que eu opere no ambiente correto com menus, dados, telas e permissões atualizados.
- **Implements:** BR-013, BR-014, BR-015, BR-016, BR-017, BR-018, BR-019, NFR-005, NFR-006, RE-001
- **Acceptance Criteria:**
  1. WHEN usuário autenticado E possui mais de um vínculo de empresa/tenant E acessa seletor de contexto THEN system SHALL exibir lista de tenants vinculados com indicador do ativo.
  2. WHEN usuário seleciona tenant diferente E confirma troca THEN system SHALL atualizar imediatamente menus, dados exibidos, telas acessíveis e permissões efetivas conforme perfil no novo contexto.
  3. WHEN usuário troca de tenant E tenta acessar dados do tenant anterior E não possui vínculo explícito THEN system SHALL bloquear acesso com proteção de dados cross-tenant.
  4. WHEN usuário tenta acesso direto por rota E rota pertence a módulo não autorizado para perfil no tenant ativo THEN system SHALL bloquear no front-end E negar no back-end.
  5. WHEN usuário tenta chamada direta a endpoint E endpoint requer permissão não presente no perfil do tenant ativo THEN system SHALL negar no back-end mesmo que tentativa seja disfarçada.
  6. WHEN usuário acessa página com componente de ação E não possui permissão para essa ação THEN system SHALL ocultar OU bloquear componente no front-end E negar no back-end.
  7. WHEN Administrador tenta associar grupo econômico como autorização automática de acesso THEN system SHALL bloquear E reforçar que acesso depende de vínculos explícitos.
  8. WHEN operação crítica é executada E система detecta tentativa de cross-tenant THEN system SHALL registrar incidente de segurança E notificar Administrators Master quando aplicável.
- **Independent Test:** A troca de contexto pode ser testada com usuário vinculado a múltiplos tenants, validando seletor de contexto, atualização imediata de menus/dados/permissões e bloqueio de acesso cross-tenant — não requer dependência de outros módulos além de múltiplos tenants vinculados ao usuário.

---

## Functional Requirements

**FR-001:** O sistema deve autenticar usuário por e-mail e senha, executar MFA por token enviado por e-mail, validar token com expiração de 15 minutos e uso único, e registrar tentativa de autenticação em log de segurança. (User Story 1, BR-001, NFR-001, NFR-002, NFR-003)

**FR-002:** O sistema deve permitir primeiro acesso com link seguro de ativação com expiração configurada, enviar texto de boas-vindas juntamente com ativação, e exigir troca obrigatória de senha no primeiro acesso. (User Story 1, BR-002)

**FR-003:** O sistema deve permitir recuperação de senha com link de uso único, validar expiração do link, e registrar intenção de recuperação em trilha de auditoria. (User Story 1, BR-003)

**FR-004:** O sistema deve controlar sessão após autenticação com timeout de inatividade de 30 minutos, armazenar identificador do usuário, tipo, tenant ativo, tenants vinculados, perfis do tenant ativo, permissões efetivas, e registrar logout e expiração. (User Story 1, BR-004, NFR-004)

**FR-005:** O sistema deve bloquear autenticação temporariamente após 5 tentativas falhas consecutivas em janela de 15 minutos, registrar tentativa excessiva em log de segurança, e desbloquear automaticamente após período configurado. (User Story 1, NFR-003)

**FR-006:** O sistema deve processar upload de arquivo de atualização cadastral em staging, classificar registros em "convergente", "divergente" ou "ausente", e retornar resultado consolidado ao usuário. (User Story 2, BR-022)

**FR-007:** O sistema deve permitir envio de documentos e imagens como evidências cadastrais vinculadas a funcionário, dependente, movimentação ou protocolo, registrando tipo, usuário responsável, data/hora, status de análise e histórico de decisão. (User Story 2, BR-023)

**FR-008:** O sistema deve bloquear finalização de movimentação quando existirem pendências bloqueantes não tratadas, e validar tipo, tamanho, formato e vínculo dos documentos enviados. (User Story 2, BR-024)

**FR-009:** O sistema deve gerar protocolo único com número, data/hora de abertura, responsável e status final para cada movimentação concluída no portal. (User Story 2, BR-022, BR-028)

**FR-010:** O sistema deve bloquear transferência de funcionário quando: funcionário inativo, sem vínculo válido, destino inexistente, não autorizado, ou conflito temporal com desligamento, reativação ou outra transferência. (User Story 3, BR-026)

**FR-011:** O sistema deve manter histórico consultável de transferências com origem, destino, data, motivo e responsável. (User Story 3, BR-025)

**FR-012:** O sistema deve processar upload de arquivo de folha de pagamento em staging, classificar divergências relevantes, retornar status do processamento com resultado consolidado, e gerar protocolo do envio. (User Story 4, BR-028)

**FR-013:** O sistema deve bloquear upload de arquivo fora do layout aceito e múltiplos envios conflitantes sem regra de substituição ou versionamento. (User Story 4, BR-029)

**FR-014:** O sistema deve consultar protocolos por filtros combinados (tenant, unidade, competência, tipo, origem, status), exibir número, origem, status, data/hora de abertura e conclusão, permitir exportação conforme permissão, e permitir navegação para detalhamento. (User Story 5, BR-027)

**FR-015:** O sistema deve localizar arquivos de boleto correspondentes à empresa/tenant ativa, competência, unidade e filtros, registrar log de acesso/consulta/download, e tratar ausência/duplicidade/inconsistência de forma rastreável. (User Story 6, BR-030, BR-031)

**FR-016:** O sistema deve bloquear acesso a boleto de empresa/tenant distinta do contexto ativo e download por usuário sem permissão correspondente. (User Story 6, BR-030)

**FR-017:** O sistema deve listar itens pendentes por tipo, origem, data, protocolo e status, permitir aprovar/reprovar/suspender/solicitar ajuste conforme permissão, registrar usuário responsável, data/hora, comentário e evidência. (User Story 7, BR-062)

**FR-018:** O sistema deve exigir justificativa para reprovação, suspensão ou solicitação de ajuste, e bloquear conclusão de item já encerrado sem fluxo formal de reabertura. (User Story 7, BR-063)

**FR-019:** O sistema deve criar empresa utilizando identificador como tenantId em entidades dependentes, validar unicidade pelo documento principal, e não permitir alteração que comprometa vínculos contratuais ativos. (User Story 8, BR-012, BR-033)

**FR-020:** O sistema deve validar CNPJ, CPF, CNO e demais identificadores conforme o domínio de cada tipo de documento. (User Story 8, BR-033)

**FR-021:** O sistema deve provisionar automaticamente primeiro usuário com perfil Administrador Cliente e status "primeiro acesso pendente" quando empresa for criada, e enviar texto de boas-vindas com link de ativação. (User Story 8, BR-011)

**FR-022:** O sistema deve criar local de trabalho com regra herdada da empresa por padrão, permitir sobrescrita específica quando autorizada, e aplicar herança automática para locais sem sobrescrita. (User Story 9, BR-034, BR-043)

**FR-023:** O sistema deve preservar histórico das associações de regra com quem alterou, data/hora e motivo para rastreabilidade do cálculo por competência. (User Story 9, BR-043)

**FR-024:** O sistema deve cadastrar funcionário com vínculo à empresa, validar CPF,不允许 funcionário sem empresa vinculada, e manter histórico de mudanças. (User Story 10, BR-035, BR-036)

**FR-025:** O sistema deve cadastrar dependente vinculado a funcionário,不允许 dependente sem funcionário,不允许 duplicidade lógica no mesmo contexto ativo,不允许 exclusão física de documento já utilizado como evidência em processo concluído. (User Story 10, BR-037, BR-038)

**FR-026:** O sistema deve cadastrar contrato vinculado à empresa,不允许 contrato sem empresa,不允许 vigências sobrepostas em contratos do mesmo tipo,不允许 exclusão física, apenas encerramento lógico. (User Story 11, BR-039, BR-040)

**FR-027:** O sistema deve criar regra de faturamento com nome obrigatório, validar consistência de parâmetros,不允许 duplicidade lógica conforme política de nome e vigência, e permitir duplicação com identificador único. (User Story 12, BR-041, BR-042)

**FR-028:** O sistema deve associar regra principal à empresa, aplicar sobrescrita por local de trabalho quando configurada, e suportar versionamento por vigência. (User Story 12, BR-043)

**FR-029:** O sistema deve cadastrar piso salarial com vigência, unidade e regra de faturamento,不允许 duplicidade da mesma combinação, e suportar manutenção em lote. (User Story 13, BR-044, BR-045)

**FR-030:** O sistema deve cadastrar penalidade com descrição, percentual, mínimos e situação, permitir aplicação com base de cálculo, valor calculado, competência, motivo e referência auditável, aplicar 2% para empresas VIP e 3% para demais. (User Story 14, BR-046)

**FR-031:** O sistema deve不允许 aplicação de penalidade sem competência e objeto de referência, e不允许 percentual incoerente com a regra. (User Story 14, BR-047)

**FR-032:** O sistema deve permitir disparo de cálculo por competência e parâmetros obrigatórios, gerar identificador de execução único e status inicial, exibir resumo com lotes gerados, totais, inconsistências e mensagens. (User Story 15, BR-048)

**FR-033:** O sistema deve bloquear processamento sem competência obrigatória, sem parâmetros vigentes, sem insumos mínimos, e不允许 reprocessamento concurrente destrutivo sem política formal. (User Story 15, BR-049)

**FR-034:** O sistema deve executar cálculo em Oracle com procedures, functions e packages, retornar status de processamento assíncrono, e permitir reprocessamento controlado quando autorizado. (User Story 15, BR-048, NFR-008, NFR-009)

**FR-035:** O sistema deve criar lote manual sequencial na competência, copiar empresas elegíveis do fluxo automático, manter itens manuais com recálculo de totais, e preservar distinção lógica entre automático e manual. (User Story 16, BR-050)

**FR-036:** O sistema deve不允许 edição de lote encerrado ou já enviado sem fluxo formal de reabertura, e不允许 mistura indevida entre origem automática e manual. (User Story 16, BR-051)

**FR-037:** O sistema deve gerar artefato de integração a partir de lotes fechados e validados, distinguir faturamento automático de manual, registrar data de emissão, layout, usuário responsável e status. (User Story 17, BR-052, BR-053)

**FR-038:** O sistema deve marcar lote como exportado de forma auditável e idempotente,不允许 reenvio inconsistente sem trilha formal,不允许 alteração de arquivo já enviado sem fluxo formal. (User Story 17, BR-055)

**FR-039:** O sistema deve enviar arquivo ao Datasul por API quando disponível, registrar retorno com protocolo, mensagem de sucesso/rejeição/erro, e prover estratégia alternativa de disponibilização quando API indisponível. (User Story 17, BR-054)

**FR-040:** O sistema deve definir data de vencimento como dia 30 do mês para lote automático, e permitir data específica para lote manual conforme regra operacional. (User Story 17, BR-055)

**FR-041:** O sistema deve gerar relatórios por competência, empresa, lote, regra, penalidade e status, permitir exportação conforme permissão, e selecionar amostra de empresas para conferência conforme critério parametrizado. (User Story 18, BR-056)

**FR-042:** O sistema deve不允许 confirmação de conferência sem seleção do item ou empresa alvo,不允许 alteração silenciosa do resultado conferido, e manter histórico de alterações. (User Story 18, BR-057)

**FR-043:** O sistema deve criar, editar, ativar e inativar perfis e permissões apenas por Administrador Master/ROOT ou perfil expressamente autorizado,不允许 код дублированный de funcionalidade,不允许 vínculo de funcionalidade inativa a novo perfil. (User Story 19, BR-058)

**FR-044:** O sistema deve不允许 exclusão física de perfil em uso, preferir inativação, e manter histórico de alterações. (User Story 19, BR-058)

**FR-045:** O sistema deve criar, editar, ativar, inativar e associar usuários a perfis e empresas/tenants por usuários internos autorizados,不允许 usuário administrativo sem email único,不允许 usuário do portal criar usuários ou administrar acessos. (User Story 20, BR-010, BR-059)

**FR-046:** O sistema deve不允许 criação ou manutenção de usuários por perfis sem permissão explícita, e mantener trilha de auditoria para todas as operações de gestão de usuários. (User Story 20, BR-059)

**FR-047:** O sistema deve exibir mecanismo visível de troca de empresa/tenant para usuários com múltiplos vínculos, atualizar menus, dados, telas e permissões imediatamente após troca, e bloquear acesso cruzado a dados do tenant anterior. (User Story 21, BR-014, BR-015, NFR-005)

**FR-048:** O sistema deve bloquear visualização de menu e acesso direto por rota para funcionalidades não autorizadas, ocultar ou bloquear componentes de ação sem permissão, e negar operações críticas no back-end mesmo com chamada direta. (User Story 21, BR-017, BR-018, BR-019)

**FR-049:** O sistema deve不允许 código técnico duplicado de funcionalidade,不允许 vínculo de funcionalidade inativa em novos perfis,不允许 criação de perfil sem nome,不允许 associação inconsistente entre usuário, empresa/tenant e perfil. (User Story 21, BR-017, BR-018, BR-019)

**FR-050:** O sistema deve registrar auditoria para todas as operações críticas contendo: usuário responsável, tenant ativo, data/hora, operação executada, entidade afetada, valores anteriores e novos quando aplicáveis, e origem/IP quando aplicáveis. (All User Stories, BR-064, NFR-006)

**FR-051:** O sistema deve auditar: login, MFA, troca de tenant, primeiro acesso e recuperação de senha; criação, edição, inativação e redefinição de acesso de usuários; criação, edição e inativação de perfis, permissões, campos de seleção e parâmetros; movimentações do portal, uploads, protocolos, decisões de aprovação e envios de folha; alterações contratuais e estruturais relevantes; parametrização de regras, pisos, penalidades e associações de faturamento; e execução de cálculo, reprocessamento, geração de lote, exportação e conferência. (All User Stories, BR-065)

**FR-052:** O sistema deve armazenar senhas com algoritmo seguro (bcrypt/Argon2) com salt único, tokens com validade máxima de 15 minutos e uso único, e proteger contra brute force. (User Story 1, NFR-001, NFR-002)

## Success Criteria

**SC-001:** O tempo médio de conclusão de jornada de atualização cadastral em lote deve ser reduzido em 60% em relação ao baseline manual, medido pelo log de protocolo (data/hora de abertura → data/hora de conclusão). (User Story 2, KM-001)

**SC-002:** A taxa de erro em upload de arquivo de folha (rejeição por layout) deve ser inferior a 5% após 3 meses de operação, medida pelo contador de uploads rejeitados / total de uploads. (User Story 4, KM-002)

**SC-003:** A taxa de divergência cadastral detectada em processamento de folha deve ter baseline estabelecido e redução de 20% após 6 meses, medida por divergências classificadas em staging / total de registros. (User Story 4, KM-003)

**SC-004:** O tempo médio de ciclo de faturamento (disparo → resultado) deve ser de até 2 horas após disparo, medido pelo identificador de execução (timestamp de início → timestamp de conclusão). (User Story 15, KM-004)

**SC-005:** A taxa de lotes exportados com sucesso na primeira tentativa deve ser superior a 95% em 3 meses, medida por lotes exportados com status "sucesso" / total de lotes exportados. (User Story 17, KM-005)

**SC-006:** A quantidade de acessos cruzados indevidos entre tenants deve ser zero, medida por incidentes de segurança por segregação reportados. (User Story 21, KM-006, NFR-005)

**SC-007:** O tempo médio de resolução de pendência de aprovação (suspensão) deve ser inferior a 48 horas úteis, medido por data/hora de criação da pendência → data/hora de decisão. (User Story 7, KM-007)

**SC-008:** A taxa de provisionamento automático de primeiro acesso concluído com sucesso deve ser 100%, medida por provisionamentos realizados / completados. (User Story 1, User Story 8, KM-008)

**SC-009:** A quantidade de protocolos gerados por mês (portal) deve ter baseline inicial e crescimento proporcional ao volume de operações, medida por contador mensal de protocolos por tipo. (User Story 2, User Story 4, User Story 5, KM-009)

**SC-010:** A taxa de utilização de funcionalidade de faturamento manual deve ser mantida abaixo de 10% do volume total, medida por itens manuais / total de itens de faturamento. (User Story 16, KM-010)

**SC-011:** O tempo de ativação de novo tenant (empresa + provisionamento) deve ser inferior a 2 horas úteis após cadastro validado, medido por timestamp de criação da empresa → timestamp de primeiro acesso concluído. (User Story 8, KM-011)

**SC-012:** Incidentes de segurança (tentativas de acesso não autorizado, escalação de privilégios) devem ser zero, medidos por registros de auditoria de segurança. (User Story 1, User Story 21, KM-012, NFR-006)

**SC-013:** O sistema deve bloquear acesso cross-tenant validando tenantId em todos os endpoints back-end e reavaliando sessão após troca de contexto. (User Story 21, RE-001, NFR-005)

**SC-014:** O sistema deve bloquear execução de cálculo quando parâmetros vigentes ou insumos mínimos não estiverem disponíveis. (User Story 15, RE-002)

**SC-015:** O sistema deve implementar política formal de controle de concorrência para reprocessamento destrutivo. (User Story 15, RE-003)

**SC-016:** O sistema deve implementar marca idempotente de status "exportado" e fluxo formal de estorno/reabertura. (User Story 17, RE-004)

**SC-017:** O sistema deve validar layout, tipo, tamanho, hash e duplicidade de arquivos antes do processamento. (User Story 2, User Story 4, RE-008)

## Edge Cases

**WHEN** operador tenta autenticação com credenciais de empresa/tenant diferente do vínculo autorizado **THEN** system SHALL bloquear acesso com mensagem de credenciais inválidas e registrar tentativa em log de segurança.

**WHEN** operador tenta acesso a funcionalidade sem permissão no tenant ativo **THEN** system SHALL bloquear no front-end (menu oculto, rota negada) e no back-end (endpoint retorna 403 Forbidden).

**WHEN** operador troca de tenant e existe requisição em andamento do tenant anterior **THEN** system SHALL invalidar requisições pendentes e redirecionar para contexto do novo tenant.

**WHEN** arquivo de upload contém registros além do limite suportado **THEN** system SHALL processar em batches e retornar status parcial com indicação de continuidade.

**WHEN** execução de cálculo falha por erro transitório de banco Oracle **THEN** system SHALL registrar erro técnico com stack trace, marcar execução como "falhou" com motivo, e permitir reagendamento.

**WHEN** API do Datasul retorna timeout ou erro 5xx **THEN** system SHALL registrar falha com payload, registrar retry agendado conforme política de backoff, e notificar operador sobre status pendente.

**WHEN** integração com HIS retorna erro de validação de payload **THEN** system SHALL registrar erro com payload rejeitado, sinalizar necessidade de correção de dados, e não reenviar automaticamente.

**WHEN** operador tenta duplicar regra de faturamento E regra origem foi desativada após a solicitação **THEN** system SHALL bloquear duplicação e informar que regra de origem não está disponível.

**WHEN** lantai de faturamento manual tenta inclusão de empresa já presente no lote automático da mesma competência **THEN** system SHALL bloquear com mensagem de duplicidade entre origens e sugerir transferência explícita.

**WHEN** tentativa de exclusão de perfil E perfil possui 10 ou mais usuários vinculados **THEN** system SHALL bloquear exclusão física e sugerir inativação como alternativa audível.

**WHEN** protocolo de movimentação não é encontrado por filtros aplicados **THEN** system SHALL exibir mensagem informativa e sugerir expansão de filtros.

**WHEN** arquivo de boleto não é encontrado no diretório após busca por filtros **THEN** system SHALL exibir mensagem explicativa e registrar ausência em log consultável.

**WHEN** competência solicitada para cálculo já possui execução em andamento com status "Em Processamento" **THEN** system SHALL bloquear novo disparo e informar identificação da execução em curso com tempo decorrido.

**WHEN** usuário tenta reenvio de arquivo de folha E já existe arquivo processado para mesma competência/unidade E não há versão anterior **THEN** system SHALL bloquear com mensagem indicando arquivo existente e regra de substituição não configurada.

**WHEN** operador tenta associar grupo econômico como autorização automática de acesso para usuário **THEN** system SHALL bloquear associação e reforçar que acesso depende de vínculos explícitos usuário-empresa-perfil.

**WHEN** tentativa de criação de usuário com email já existente na base **THEN** system SHALL bloquear com mensagem indicando email duplicado e sugerir recuperação de senha se aplicável.

**WHEN** execução de cálculo não encontra piso salarial vigente para competência/unidade/regra **THEN** system SHALL pausar execução, sinalizar pendência parametrizada, e permitir continuação após ajuste ou flag de ignore.

**WHEN** execução de cálculo Oracle excede timeout configurado **THEN** system SHALL marcar execução como "timeout" com data/hora da expiração, notificar operador, e disponibilizar logs parciais para diagnóstico.

## Gray Areas

### Gray Area 1 - Definição de "Empresa VIP" para Aplicação de Penalidade de 2%

- **Pergunta:** Qual é o critério exato para classificar uma empresa como VIP para aplicação de penalidade de 2%? A classificação é manual (flag no cadastro) ou automática (baseada em volume, receita, contrato)?
- **Opções:**
  - A) Flag booleano "empresa_vip" no cadastro da empresa, preenchido manualmente pela SECONCI no momento do cadastro ou atualização contratual.
  - B) Classificação automática baseada em critério de volume de faturamento mensal (ex.: acima de X contratos ou Y valor) com revisão trimestral.
  - C) Classificação automática baseada no tipo de contrato ou nível de serviço (ex.: contrato premium/platinum).
  - D) Combinação: flag manual primário com fallback para classificação automática por tipo de contrato.
- **Recomendação:** Opção A — Flag booleano no cadastro da empresa. A classificação manual é mais segura para penalidades financeiras e evita erros automáticos com impacto contábil. A SECONCI mantém controle explícito sobre quais empresas recebem 2% vs 3%, e a mudança de status é rastreável via auditoria. Critérios automáticos podem ser avaliados em fase posterior se houver demanda operacional.

---

### Gray Area 2 - Regra de Substituição ou Versionamento para Upload de Folha Conflitante

- **Pergunta:** Quando um operador tenta enviar arquivo de folha para competência/unidade que já possui arquivo processado, qual é o comportamento esperado? Substituição automática, versionamento, ou bloqueio absoluto? E como isso se relaciona com o reprocessamento destrutivo que exige trilha formal?
- **Opções:**
  - A) Bloqueio absoluto — nenhum reenvio permitido sem fluxo formal de cancelamento do arquivo anterior. Garante rastreabilidade máxima, mas pode ser burocrático para correção operacional.
  - B) Substituição automática com criação de versão — novo arquivo substitui anterior, versões anteriores são consultáveis. Permite correção rápida, mas pode conflitar com necessidade de trilha formal para reprocessamento.
  - C) Substituição automática sem versionamento — novo arquivo substitui anterior, histórico de substituição é registrado em log. Simplicidade máxima, mas版本 anterior é perdida se não houver log detalhado.
  - D) Substituição permitida apenas se novo arquivo for enviado pelo mesmo usuário dentro de janela de tempo configurada (ex.: 1 hora). Balanceia flexibilidade com segurança, mas requer rastreamento de usuário e timestamp.
- **Recomendação:** Opção B — Substituição automática com criação de versão, com integração à trilha formal de reprocessamento. A substituição com versionamento resolve o conflito operacional, mas deve ser integrada ao fluxo de reprocessamento: quando um arquivo é substituído, o sistema cria automaticamente uma "solicitação de reprocessamento" pendente de autorização formal. Isso garante que a substituição seja rastreável no mesmo fluxo que其他 operações de reprocessamento, sem criar mecanismo paralelo. A SECONCI pode configurar se a substituição cria versão apenas no staging ou mantém versão no arquivo processado.

---

### Gray Area 3 - Comportamento de Reativação de Funcionário Após Transferência

- **Pergunta:** Quando um funcionário é transferido de Local A para Local B e posteriormente precisa retornar ao Local A, o sistema deve criar nova transferência ou reativar o registro original?
- **Opções:**
  - A) Sempre criar nova transferência com histórico anterior consultável — não reativar, apenas marcar ambas as transferências com referência cruzada.
  - B) Permitir reativação do vínculo original quando a transferência de retorno ocorre em janela curta (ex.: 30 dias) e não houve desligamento entre operações.
  - C) Criar nova transferência com flag "retorno" indicando transferência de origem, preservando histórico completo.
  - D) Apenas transferir quando não existe conflito temporal — se funcionário foi desligado entre operações, exigir novo admissão.
- **Recomendação:** Opção C — Sempre criar nova transferência com flag "retorno". Preserva histórico completo para rastreabilidade de faturamento por competência e local de trabalho, elimina ambiguidade sobre vínculos ativos, e permite análise de padrões de transferência por empresa. A criação de nova transferência com referência à original mantém rastreabilidade mesmo quando há retorno ao local de origem. O flag "retorno" facilita relatórios de análise de rotatividade sem precisar inferir o padrão a partir do histórico.

---

### Gray Area 4 - Data de Vencimento para Lote Manual com Competências Passadas

- **Pergunta:** Para lote manual com competência passada (ex.: competência 01/2025 gerada em 03/2025), qual deve ser a data de vencimento padrão quando o operador não define explicitamente? E o que acontece se nenhuma data for configurada?
- **Opções:**
  - A) Dia 30 do mês da competência — mantém lógica de competência como determinante do vencimento, mesmo para competências passadas. Se não configurado, assume dia 30 do mês da competência.
  - B) Dia 30 do mês atual — antecipa vencimento para competência passada já que lançamento está atrasado. Se não configurado, assume dia 30 do mês corrente.
  - C) Dia 30 do mês seguinte à competência — se competência 01/2025 é enviada em 03/2025, vencimento padrão é 30/02 (mês seguinte). Se não configurado, calcula 30 dias a partir da competência.
  - D) Data configurável por lote, com fallback obrigatório para dia 30 do mês corrente — operador pode escolher data livre, mas se não definir, sistema assume vencimento no dia 30 mais próximo do mês corrente ou subsequente.
- **Recomendação:** Opção D — Data configurável com fallback obrigatório. Permite ajuste operacional quando há justificativa para data diferenciada (ex.: acordo com cliente para competência passada), mas garante que lotes sem definição explícita terão vencimento previsível e rastreável. O fallback evita lotes "órfãos" sem data de vencimento, situação que bloquearia exportação ao Datasul. A justificativa de mudança de data do fallback deve ser registrada em trilha de auditoria quando operador sobrescrever. A configuração de fallback deve ser parâmetro do sistema (não código), permitindo ajuste sem alteração de código se a regra de negócio mudar.

---

### Gray Area 5 - Limite de Versões Anteriores de Regra de Faturamento

- **Pergunta:** Ao duplicar ou versionar regra de faturamento, quantas versões anteriores devem ser mantidas consultáveis? Existe limite de retenção ou política de descarte?
- **Opções:**
  - A) Manter todas as versões sem limite — histórico completo para rastreabilidade e auditoria.
  - B) Manter últimas 10 versões por regra — balanceia rastreabilidade com performance de consulta.
  - C) Manter versões dos últimos 24 meses — descarte automático de versões mais antigas com arquivamento.
  - D) Manter versão ativa atual e última versão anterior — apenas rastrear mudança mais recente, versões anteriores arquivadas.
- **Recomendação:** Opção A — Manter todas as versões sem limite. Cálculo de faturamento por competência passada depende de regra vigente na época; versionamento ilimitado garante que histórico de cálculo seja consultável com a regra correta. Performance pode ser mitigada com índices otimizados e paginação na interface de consulta. Versões arquivadas (após período configurable, ex.: 5 anos) podem ser movidas para armazenamento frio, mas permanecem recuperáveis para auditoria. A política de retenção deve ser definida em parâmetro, não em código.

---

### Gray Area 6 - Timeout, Notificação e Retry para Execução de Cálculo Oracle

- **Pergunta:** Quando a execução de cálculo Oracle excede o tempo esperado ou falha, como o sistema deve notificar o operador? Deve haver retry automático? Qual é o timeout máximo aceito?
- **Opções:**
  - A) Timeout fixo configurável (ex.: 60 minutos), sem retry automático. Quando timeout é atingido, marcar como "timeout" e notificar operador com instruções de verificação. Operador decide se reagenda.
  - B) Retry automático com backoff exponencial (ex.: 3 tentativas), timeout geral de 120 minutos. Se todas as tentativas falharem, marcar como "falhou" e notificar operador com log de erros.
  - C) Sem timeout, polling contínuo até conclusão. Notificar apenas em caso de erro. Simplicidade operacional, mas pode deixar operador em suspense se houver problema técnico prolongado.
  - D) Timeout configurável com notificação progressiva: avisar operador após 50% do timeout, marcar como "demorado" após 80%, e "timeout" após 100%. Retry opcional após timeout se operador confirmar.
- **Recomendação:** Opção D — Timeout configurável com notificação progressiva. A abordagem progressiva mantém operador informado durante execução longa sem alarme prematuro, mas garante que situações de timeout sejam identificadas antes que o operador assuma que o processo está "travado". O retry automático sem consentimento pode gerar problemas se a falha for de dados (não técnica), pois o reagendamento automático pode mascarar problemas que precisam de correção manual. A decisão de reagendar após timeout deve ser explícita do operador, com registro em trilha de auditoria.

---

### Gray Area 7 - Política de Retenção de Arquivos em Staging e Histórico de Uploads

- **Pergunta:** Por quanto tempo os arquivos em staging (pós-upload, pré-processamento) e os arquivos processados com histórico de versões devem ser mantidos? Qual é a política de descarte ou arquivamento?
- **Opções:**
  - A) Retenção indefinida — todos os arquivos e versões são mantidos para auditoria completa. Maior rastreabilidade, maior custo de armazenamento.
  - B) Retenção de 90 dias para staging e 24 meses para arquivos processados — balanceia rastreabilidade operacional com custo de armazenamento. Após 24 meses, mover para arquivamento frio.
  - C) Retenção de 30 dias para staging e 12 meses para arquivos processados — retenção mínima operacional, arquivamento após esses períodos.
  - D) Retenção configurável por parâmetro com valores padrão sugeridos — sistema permite configurar períodos distintos para staging vs. processado, com默认值 baseados em requisitos regulatórios ou operacionais.
- **Recomendação:** Opção D — Retenção configurável por parâmetro. Requisitos regulatórios (ex.: Lei Geral de Proteção de Dados, normas contábeis) podem exigir períodos de retenção diferentes para diferentes tipos de arquivo. A configuração por parâmetro permite ajuste sem alteração de código e mantém histórico de qual configuração estava ativa em cada período para auditoria. Valores sugeridos como padrão: 90 dias para staging, 60 meses (5 anos) para arquivos processados de folha de pagamento (por impacto fiscal), e 24 meses para arquivos de atualização cadastral.

---

## Traceability

| ID | Origem (User Story) | PRD origin | Status |
|----|---------------------|------------|--------|
| FR-001 | User Story 1 | BR-001, NFR-001, NFR-002, NFR-003 | Pending |
| FR-002 | User Story 1 | BR-002 | Pending |
| FR-003 | User Story 1 | BR-003 | Pending |
| FR-004 | User Story 1 | BR-004, NFR-004 | Pending |
| FR-005 | User Story 1 | NFR-003 | Pending |
| FR-006 | User Story 2 | BR-022 | Pending |
| FR-007 | User Story 2 | BR-023 | Pending |
| FR-008 | User Story 2 | BR-024 | Pending |
| FR-009 | User Story 2 | BR-022, BR-028 | Pending |
| FR-010 | User Story 3 | BR-026 | Pending |
| FR-011 | User Story 3 | BR-025 | Pending |
| FR-012 | User Story 4 | BR-028 | Pending |
| FR-013 | User Story 4 | BR-029 | Pending |
| FR-014 | User Story 5 | BR-027 | Pending |
| FR-015 | User Story 6 | BR-030, BR-031 | Pending |
| FR-016 | User Story 6 | BR-030 | Pending |
| FR-017 | User Story 7 | BR-062 | Pending |
| FR-018 | User Story 7 | BR-063 | Pending |
| FR-019 | User Story 8 | BR-012, BR-033 | Pending |
| FR-020 | User Story 8 | BR-033 | Pending |
| FR-021 | User Story 8 | BR-011 | Pending |
| FR-022 | User Story 9 | BR-034, BR-043 | Pending |
| FR-023 | User Story 9 | BR-043 | Pending |
| FR-024 | User Story 10 | BR-035, BR-036 | Pending |
| FR-025 | User Story 10 | BR-037, BR-038 | Pending |
| FR-026 | User Story 11 | BR-039, BR-040 | Pending |
| FR-027 | User Story 12 | BR-041, BR-042 | Pending |
| FR-028 | User Story 12 | BR-043 | Pending |
| FR-029 | User Story 13 | BR-044, BR-045 | Pending |
| FR-030 | User Story 14 | BR-046 | Pending |
| FR-031 | User Story 14 | BR-047 | Pending |
| FR-032 | User Story 15 | BR-048 | Pending |
| FR-033 | User Story 15 | BR-049 | Pending |
| FR-034 | User Story 15 | BR-048, NFR-008, NFR-009 | Pending |
| FR-035 | User Story 16 | BR-050 | Pending |
| FR-036 | User Story 16 | BR-051 | Pending |
| FR-037 | User Story 17 | BR-052, BR-053 | Pending |
| FR-038 | User Story 17 | BR-055 | Pending |
| FR-039 | User Story 17 | BR-054 | Pending |
| FR-040 | User Story 17 | BR-055 | Pending |
| FR-041 | User Story 18 | BR-056 | Pending |
| FR-042 | User Story 18 | BR-057 | Pending |
| FR-043 | User Story 19 | BR-058 | Pending |
| FR-044 | User Story 19 | BR-058 | Pending |
| FR-045 | User Story 20 | BR-010, BR-059 | Pending |
| FR-046 | User Story 20 | BR-059 | Pending |
| FR-047 | User Story 21 | BR-014, BR-015, NFR-005 | Pending |
| FR-048 | User Story 21 | BR-017, BR-018, BR-019 | Pending |
| FR-049 | User Story 21 | BR-017, BR-018, BR-019 | Pending |
| FR-050 | All User Stories | BR-064, NFR-006 | Pending |
| FR-051 | All User Stories | BR-065 | Pending |
| FR-052 | User Story 1 | NFR-001, NFR-002 | Pending |
| SC-001 | User Story 2 | KM-001 | Pending |
| SC-002 | User Story 4 | KM-002 | Pending |
| SC-003 | User Story 4 | KM-003 | Pending |
| SC-004 | User Story 15 | KM-004 | Pending |
| SC-005 | User Story 17 | KM-005 | Pending |
| SC-006 | User Story 21 | KM-006, NFR-005 | Pending |
| SC-007 | User Story 7 | KM-007 | Pending |
| SC-008 | User Story 1, User Story 8 | KM-008 | Pending |
| SC-009 | User Story 2, User Story 4, User Story 5 | KM-009 | Pending |
| SC-010 | User Story 16 | KM-010 | Pending |
| SC-011 | User Story 8 | KM-011 | Pending |
| SC-012 | User Story 1, User Story 21 | KM-012, NFR-006 | Pending |
| SC-013 | User Story 21 | RE-001, NFR-005 | Pending |
| SC-014 | User Story 15 | RE-002 | Pending |
| SC-015 | User Story 15 | RE-003 | Pending |
| SC-016 | User Story 17 | RE-004 | Pending |
| SC-017 | User Story 2, User Story 4 | RE-008 | Pending |

## Assumptions

**S-001:** O formato, a estrutura de diretórios e o mecanismo de nomenclatura dos boletos ainda serão definidos em especificação complementar. A solução prevê acesso sob demanda e tratamento de ausência/duplicidade, mas o padrão final depende de definição técnica conjunta com a equipe de infraestrutura.

**S-002:** O contrato de API com o HIS SECONCI (campos trafegados, eventos de sincronização, regras de retentativa) será definido em especificação complementar. A integração será assíncrona com logs, mas os detalhes do payload e dos eventos de triggers dependem de alinhamento com a equipe do HIS.

**S-003:** A integração com o Datasul para envio de arquivo prevê prioritariamente API, mas pode requerer estratégia alternativa de disponibilização de arquivo caso a API não seja viabilizada. A solução deve suportar ambos os caminhos sem remodelação significativa.

**S-004:** O primeiro usuário provisionado automaticamente no cadastro da empresa/tenant assume o perfil Administrador Cliente, mas não recebe automaticamente permissão de criar outros perfis de portal — isso depende de autorização explícita da SECONCI em cada contexto.

**S-005:** O motor de cálculo em Oracle é assumido como existente ou em desenvolvimento paralelo. A aplicação assume que terá interface de execução, retorno de status e logs consultáveis, mas não controla a implementação interna das rotinas Oracle.

**S-006:** O número de empresas clientes atendidas simultaneamente no MVP é estimado em dezenas a centenas. A arquitetura multi-tenant sem alteração de instância atende a essa escala sem necessidade de sharding, mas a decisão de escalar horizontalmente fica condicionada a validação em produção.

**S-007:** O protótipo visual mencionado no requisito detalhado é a referência primária de layout e jornada. Alterações de fluxo funcional exigirão revisão de protótipo; alterações visuais que não afetem funcionalidade podem seguir fluxo de design acordado.

**S-008:** O formato e layout dos arquivos de folha de pagamento estão definidos e serão documentados em especificação complementar. A solução assume que o staging e classificação de divergências tratam os campos conforme especificação de layout.

**S-009:** A classificação de empresa como VIP (para penalidade de 2%) será feita via flag booleano no cadastro da empresa, gerenciado manualmente pela SECONCI. Critérios automáticos podem ser avaliados em fase posterior.

**S-010:** O layout de exportação de arquivo ao Datasul será definido em especificação complementar. A solução assume que a distinção entre faturamento automático e manual será feita por campo identificador no arquivo, e que o arquivo gerado pela aplicação segue estrutura validada pelo Datasul.

**S-011:** As permissões de exportação de relatórios seguirão o modelo de funcionalidades com ações "exportar" vinculadas a módulos/telas específicas. Perfis que não possuem ação "exportar" na tela de relatórios não poderão exportar.

**S-012:** O timeout de sessão de 30 minutos de inatividade é configurável por parâmetro geral do sistema. O valor de 30 minutos é o padrão inicial; ajuste pode ser feito sem modificação de código.

**S-013:** A validação de CPF segue algoritmo de dígito verificador padrão brasileiro. CPF com formato válido mas dígito inválido será rejeitado; CPF com máscara ou sem máscara (apenas dígitos) serão aceitos como mesma entrada.

**S-014:** O tratamento de caracteres especiais e encoding em uploads de arquivo será UTF-8. Arquivos em outras codificações serão rejeitados com mensagem indicando necessidade de conversão.

**S-015:** A política de retenção de arquivos segue os valores padrão definidos na Gray Area 7 (90 dias staging, 60 meses processados), mas será configurável por parâmetro para permitir ajuste sem alteração de código conforme requisitos regulatórios evoluam.

---

Especificação criada com base no PRD aprovado e na Constituição de Produto do épico Faturamento Assistencial Seconci App. As 21 user stories priorizadas cobrem os módulos de Segurança e Acesso, Portal do Cliente, Gestão Contratual, Faturamento Assistencial e Administração Backoffice, com rastreabilidade completa para os requisitos do PRD (BR-001 a BR-065) e métricas de sucesso (KM-001 a KM-012).

**Gray Areas revisadas:**
- **Gray Area 2:** Refinada para explicitar integração com trilha formal de reprocessamento — substituição cria automaticamente uma "solicitação de reprocessamento" pendente de autorização.
- **Gray Area 4:** Aprimorada com fallback obrigatório — operador pode escolher data livre, mas se não definir, sistema assume vencimento no dia 30 do mês corrente com justificativa registrada.
- **Gray Area 6 (nova):** Timeout, notificação progressiva e retry para execução de cálculo Oracle — evita alarme prematuro, garante identificação de timeout, e exige decisão explícita do operador para reagendamento.
- **Gray Area 7 (nova):** Política de retenção de arquivos em staging e histórico — configurável por parâmetro com valores sugeridos para balancear rastreabilidade, custo e requisitos regulatórios.