# Barreto Flow — Barreto Advocacia Especializada

Sistema interno de gestão de honorários, cobranças, projeções, auditoria ZapSign e assistência operacional (**Dona**) da Barreto Advocacia Especializada.

## Produção (Google Cloud Run)

- **URL Principal:** https://barreto-flow-git-ci3amx7gdq-ew.a.run.app
- **Deploy Automático:** Push na branch `main` dispara o Cloud Build (Developer Connect) utilizando o [`Dockerfile`](./Dockerfile) na raiz.
- **Documentação Operacional e Histórico:** consulte [`docs/OPERATIONS.md`](./docs/OPERATIONS.md).

## Execução Local

**Pré-requisito:** Node.js `>= 22.18.0`

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Copie `.env.example` para `.env` e preencha as chaves obrigatórias (`GEMINI_API_KEY`, `ZAPSIGN_API_TOKEN`).
3. Execute em desenvolvimento:
   ```bash
   npm run dev
   ```
4. Validação de tipos, testes e build de produção:
   ```bash
   npm run lint
   npm run build
   ```
