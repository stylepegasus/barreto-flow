# Barreto Flow — Registro e Documentação Operacional

Documento operacional de produção do **Barreto Flow — Barreto Advocacia Especializada**.

## 1. Ambiente de Produção (Google Cloud Run + CI/CD GitHub)

| Item | Configuração |
|---|---|
| **Aplicação** | Barreto Flow — Barreto Advocacia Especializada |
| **Projeto GCP / Firebase** | `gen-lang-client-0925403191` (`barret-flow`) |
| **Serviço Cloud Run (CI/CD)** | `barreto-flow-git` (`europe-west1`) |
| **URL pública principal** | `https://barreto-flow-git-ci3amx7gdq-ew.a.run.app` |
| **URL alternativa (`run.app`)** | `https://barreto-flow-git-137290765564.europe-west1.run.app` |
| **Repositório GitHub** | `https://github.com/stylepegasus/barreto-flow.git` (branch `main`) |
| **Gatilho Cloud Build** | `cloudrun-barreto-flow-git-europe-west1-stylepegasus-barreto-sbo` (`southamerica-east1`, Developer Connect → `/Dockerfile`) |
| **Runtime** | Node.js 22 ESM (`node:22-slim`, `node server.ts`, porta `8080`) |
| **Escala e recursos** | `1Gi` RAM, `1 vCPU`, `--cpu-boost`, `min-instances=1`, `max-instances=10`, `concurrency=80`, `timeout=300s` |
| **Health Checks** | `startupProbe` e `livenessProbe` HTTP em `GET /api/health:8080` |

## 2. Variáveis de Ambiente (sem segredos em repositório)

Consulte [`.env.example`](../.env.example) para o modelo completo. Em produção no Cloud Run estão configuradas:
- **Obrigatórias:** `GEMINI_API_KEY`, `ZAPSIGN_API_TOKEN`, `NODE_ENV=production` (e `PORT=8080` injetado pelo Cloud Run).
- **Recomendadas:** `FIREBASE_PROJECT_ID`, `APPS_SCRIPT_URL`, `APP_URL`.

## 3. Autenticação, Domínios Autorizados e OAuth

### Domínios Autorizados no Firebase Authentication (Concluído)
Todos os domínios de Cloud Run e AI Studio foram adicionados em **Firebase Console → Authentication → Settings → Authorized domains**:
- `barreto-flow-git-ci3amx7gdq-ew.a.run.app`
- `barreto-flow-git-137290765564.europe-west1.run.app`
- `barreto-flow.ai.studio`

### Contas Autorizadas (Allowlist)
O acesso à interface e às APIs protegidas (`/api/workspace/*`, `/api/zapsign/signed`, `/api/assistant/chat`) é restrito via verificação criptográfica de ID Token Firebase + allowlist em `src/utils/authAllowlist.ts`.

### Identidade Visual no Popup OAuth do Google
- Os metadados da aplicação (`index.html` e `metadata.json`) exibem exclusivamente **"Barreto Flow — Barreto Advocacia Especializada"**.
- **Nota operacional:** o identificador exibido no popup OAuth do Google (ex.: `gen-lang-client-0925403191.firebaseapp.com`) é controlado externamente pelo **Nome Público (Public-facing name)** no Firebase Console e pela **OAuth Consent Screen (Google Auth Platform / Branding)** no Console GCP — já sinalizado para ajuste manual para **"Barreto Flow"**.

## 4. Histórico Operacional de Validações

### 2026-11-27 — Go-Live Cloud Run via GitHub CI/CD e Validação de Login
- **Status:** Operacional e validado em produção.
- **CI/CD:** Push na branch `main` validado de ponta a ponta via Developer Connect + Cloud Build (`Dockerfile` multi-stage em `node:22-slim`), atualizando `barreto-flow-git` automaticamente.
- **Resiliência:** Servidor `server.ts` configurado com `0.0.0.0:${PORT || 8080}`, `trust proxy`, tratamento gracioso de `SIGTERM`/`SIGINT`/`unhandledRejection`/`uncaughtException`, timeout em chamadas externas (ZapSign e Apps Script), `no-cache` em `dist/index.html` e `immutable` em `dist/assets/*`.
- **Domínios Firebase Auth:** `barreto-flow-git-ci3amx7gdq-ew.a.run.app`, `barreto-flow-git-137290765564.europe-west1.run.app` e `barreto-flow.ai.studio` adicionados aos Domínios Autorizados.
- **Validação de Login em Produção:** Login Google em `https://barreto-flow-git-ci3amx7gdq-ew.a.run.app` testado e validado com sucesso utilizando conta autorizada.
- **Padronização de Nome:** `metadata.json` e `index.html` atualizados para exibir exclusivamente **"Barreto Flow — Barreto Advocacia Especializada"**.

### 2026-11-27 — Paridade Matemática SSOT (100%), Zeragem de Falsos Alertas e Soberania Google sobre ZapSign
- **Paridade Matemática (aritmética em centavos):**
  - `SALDO TOTAL A RECEBER = R$ 178.240,61` (`Parcelas datadas: R$ 130.490,61` + `Saldo sem data: R$ 47.750,00`, com `Crédito a vincular: R$ 500,00`).
  - `TOTAL JÁ RECEBIDO = R$ 20.379,99` | `RECEBIDO NO MÊS = R$ 6.906,67` | `PREVISTO NO MÊS = R$ 10.296,68` | `PARCELAS ATRASADAS = R$ 3.420,01` (20 parcelas) | `FALTA DAS PARCELAS DO MÊS = R$ 4.060,01`.
  - Corrigida baixa parcial (`PARCIAL` com saldo residual de R$ 0,01) e leitura dedicada da aba `Pagamentos` (incluindo juros e créditos avulsos).
- **Zeragem de Falsos Erros de Parse (`935 → 0`):**
  - Campo booleano `dataConfirmada` (`TRUE`/`FALSE` da aba `Cobranças`), células legitimamente vazias, placeholders (`A definir`, `Êxito`, `-`) e linhas de cabeçalho/totalização deixaram de gerar `parseIssues`.
- **Soberania do Ecossistema Google sobre ZapSign + Deduplicação:**
  - Enriquecimento de signatários via `GET /api/v1/docs/{token}/` com cache em memória em `server.ts`.
  - Limpeza de títulos com underscore (`_`), correção de `Hipossuficiência`/`Hipossuficioência`, bloqueio de colisão de 5 letras (`Maria` vs `Márcia`), deduplicação por cliente no ZapSign e validação automática de clientes já presentes na Planilha (`Clientes`, `Contratos`, `ZapSign`) ou com pasta ativa no Drive `"Clientes Tráfego Pago"`.
- **Apps Script v2.0 (Somente Leitura):**
  - Código pronto para colar em [docs/apps-script/Code.gs](apps-script/Code.gs) expondo `dashboard`, `clientes`, `parcelas`, `pagamentos`, `contratos`, `zapsignConferencia`, `driveEtapas` e `eventosAgenda`.

### 2026-11-27 — Blindagem da Assistente Dona (Gemini + Firebase) e Novo Avatar Editorial
- **Motor Gemini & Contexto (`server.ts`, `src/utils/assistantContext.ts`):**
  - Prompt centralizado da Dona em fonte única de verdade com suporte à composição oficial de saldos (datadas, sem data, crédito a vincular), alertas de integridade (`parseIssues`/Drive/Calendar) e soberania Google sobre ZapSign.
  - Limites rígidos por requisição (`16` turnos, `4.000` chars/turno, `8.000` chars/mensagem, `48.000` chars de contexto, `12 MB` em anexos com allowlist de MIME types), redação automática de tokens/JWTs/chaves, timeouts explícitos (`25s`), fallback automático (`gemini-4-hydrogen` → `gemini-3.1-flash-lite`) e retry em falhas transitórias.
- **Segurança Firebase na Leitura de Documentos do Drive:**
  - Nova rota autenticada `GET /api/workspace/drive-file` protegida por `requireAuthorizedUser` (ID Token Firebase + allowlist) + validação estrita de `fileId` e URL permitida do Apps Script.
- **Avatar Editorial da Dona:**
  - Novo componente `src/components/DonaAvatar.tsx` + asset otimizado `public/assets/dona-avatar-v1.jpg` (320×320, ~20 KB, mulher ruiva executiva em estética editorial alinhada à paleta `#313131` / `#F6F3EC` / `#DCB14A`) com fallback SVG ilustrado confiável no FAB, cabeçalho, boas-vindas, bolhas de resposta e botão *Analisar com a Dona*.
