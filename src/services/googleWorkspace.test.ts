import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APPS_SCRIPT_URL,
  syncFromAppsScriptUrl,
} from './googleWorkspace';

const EXPECTED_OFFICIAL_URL =
  'https://script.google.com/macros/s/AKfycbxz9gSeBsBVBAWNbLZOn4S4NSWQop7sk7FokMc_0bFzDqdLxRzGlmkDYAe1fFA5ruM2wA/exec';

test('DEFAULT_APPS_SCRIPT_URL matches the official fixed Web App URL', () => {
  assert.equal(DEFAULT_APPS_SCRIPT_URL, EXPECTED_OFFICIAL_URL);
});

test('syncFromAppsScriptUrl uses DEFAULT_APPS_SCRIPT_URL via GET (Somente Leitura) and returns real state replacing demo', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedMethod = '';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedMethod = String(init?.method ?? 'GET');
    return new Response(
      JSON.stringify({
        clientes: [
          {
            id: 'R001',
            nome: 'Cliente Real Planilha',
            totalContratado: 4500,
            modalidade: 'Parcelado',
            parcelasRegulares: 3,
          },
        ],
        parcelas: [
          {
            idParcela: 'RP01',
            idCliente: 'R001',
            cliente: 'Cliente Real Planilha',
            parcela: '1/3',
            vencimento: '2026-11-20',
            previsto: 1500,
            recebido: 0,
            faltaReceber: 1500,
            situacao: 'Em aberto',
          },
        ],
        driveEtapas: [
          {
            etapa: '01- Etapa Luis',
            nomePasta: 'Cliente Real Planilha',
            urlPasta: 'https://drive.google.com/drive/folders/real-1',
          },
          {
            etapa: 'ZZ - Encerrados',
            nomePasta: 'Cliente Antigo Encerrado',
            urlPasta: 'https://drive.google.com/drive/folders/encerrado-1',
          },
        ],
        eventosAgenda: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const result = await syncFromAppsScriptUrl();
    assert.equal(capturedUrl, EXPECTED_OFFICIAL_URL);
    assert.equal(capturedMethod, 'GET');
    assert.equal(result.clients.length, 1);
    assert.equal(result.clients[0].fullName, 'Cliente Real Planilha');
    assert.equal(result.driveEtapas.length, 2);
    assert.equal(result.driveEtapas[1].etapa, 'ZZ - Encerrados');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncFromAppsScriptUrl throws a clear Portuguese error when the Web App returns an HTTP error', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('Service Unavailable', { status: 503 })) as typeof fetch;

  try {
    await assert.rejects(
      () => syncFromAppsScriptUrl(DEFAULT_APPS_SCRIPT_URL),
      /erro 503/i
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
