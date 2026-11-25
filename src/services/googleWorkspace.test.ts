import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_APPS_SCRIPT_URL,
  batchFetchSheetRanges,
  executeAtomicClientRegistration,
  executeAtomicInstallmentPayment,
  executeAtomicRetryAction,
  invalidateAppsScriptSyncCache,
  invalidateServerWorkspaceCache,
  syncFromAppsScriptUrl,
  syncFromAppsScriptWithSWR,
} from './googleWorkspace';
import type { ClientCase } from '../types/honorarios';

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
    invalidateAppsScriptSyncCache();
  }
});

test('syncFromAppsScriptWithSWR serves fresh/stale cache instantaneously and revalidates in background', async () => {
  invalidateAppsScriptSyncCache();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = (async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify({
        clientes: [
          {
            id: `C-${fetchCount}`,
            nome: `Cliente Versão ${fetchCount}`,
            totalContratado: 1500 * fetchCount,
            modalidade: 'Parcelado',
          },
        ],
        parcelas: [],
        driveEtapas: [],
        eventosAgenda: [],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    // 1. Initial load (cache miss)
    const first = await syncFromAppsScriptWithSWR(DEFAULT_APPS_SCRIPT_URL, {
      freshTtlMs: 60_000,
    });
    assert.equal(first.fromCache, false);
    assert.equal(first.isStale, false);
    assert.equal(first.data.clients[0].fullName, 'Cliente Versão 1');
    assert.equal(fetchCount, 1);

    // 2. Fresh cache hit -> zero additional network requests
    const freshHit = await syncFromAppsScriptWithSWR(DEFAULT_APPS_SCRIPT_URL, {
      freshTtlMs: 60_000,
    });
    assert.equal(freshHit.fromCache, true);
    assert.equal(freshHit.isStale, false);
    assert.equal(fetchCount, 1);

    // 3. Stale hit (seed with 0ms fresh TTL) -> returns stale immediately & revalidates in background
    invalidateAppsScriptSyncCache(DEFAULT_APPS_SCRIPT_URL);
    await syncFromAppsScriptWithSWR(DEFAULT_APPS_SCRIPT_URL, {
      freshTtlMs: -10,
      maxStaleMs: 60_000,
    });
    assert.equal(fetchCount, 2);

    let revalidatedName = '';
    const staleHit = await syncFromAppsScriptWithSWR(DEFAULT_APPS_SCRIPT_URL, {
      freshTtlMs: 60_000,
      maxStaleMs: 60_000,
      onRevalidated: (fresh) => {
        revalidatedName = fresh.clients[0]?.fullName ?? '';
      },
    });
    assert.equal(staleHit.fromCache, true);
    assert.equal(staleHit.isStale, true);
    assert.equal(staleHit.revalidating, true);
    assert.equal(staleHit.data.clients[0].fullName, 'Cliente Versão 2');

    const bg = await staleHit.backgroundRevalidation;
    assert.equal(bg?.clients[0].fullName, 'Cliente Versão 3');
    assert.equal(revalidatedName, 'Cliente Versão 3');
    assert.equal(fetchCount, 3);
  } finally {
    globalThis.fetch = originalFetch;
    invalidateAppsScriptSyncCache();
  }
});

test('batchFetchSheetRanges chunks large tab lists into batched values:batchGet calls', async () => {
  const originalFetch = globalThis.fetch;
  const calledUrls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calledUrls.push(url);
    const matches = url.match(/ranges=/g) ?? [];
    return new Response(
      JSON.stringify({
        valueRanges: matches.map((_, idx) => ({ values: [[`Row-${idx}`]] })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const tabs = Array.from({ length: 12 }, (_, i) => `Aba ${i + 1}`);
    const data = await batchFetchSheetRanges('tok-1', 'sheet-123', tabs, 10);
    assert.equal(calledUrls.length, 2);
    assert.equal(Object.keys(data).length, 12);
    assert.deepEqual(data['Aba 1'], [['Row-0']]);
    assert.deepEqual(data['Aba 12'], [['Row-1']]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeAtomicClientRegistration enforces Sheets SSOT first and preserves commit with retryActions when Calendar/Drive fail', async () => {
  const originalFetch = globalThis.fetch;
  const sampleClient: ClientCase = {
    id: 'cli-atomic-1',
    fullName: 'Beatriz Nogueira',
    phone: '61991112222',
    caseType: 'Divórcio',
    driveStage: '02- Etapa Carlos',
    driveFolderUrl: 'https://drive.google.com/drive/my-drive',
    modality: 'Parcelado',
    contractedTotal: 1500,
    installments: [
      {
        id: 'inst-1',
        clientId: 'cli-atomic-1',
        clientName: 'Beatriz Nogueira',
        installmentNumber: 1,
        totalInstallments: 1,
        amount: 1500,
        dueDate: '2026-12-20',
      },
    ],
  };

  try {
    // Case A: Step 1 (Sheets SSOT) fails -> must abort without touching Calendar or Drive
    const callsOnSheetFail: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      callsOnSheetFail.push(url);
      return new Response('Forbidden', { status: 403 });
    }) as typeof fetch;

    const failedSsot = await executeAtomicClientRegistration({
      accessToken: 'tok',
      spreadsheetId: 'sheet-1',
      sheetTabTitle: 'Honorários',
      client: sampleClient,
      readOnlyMode: false,
    });
    assert.equal(failedSsot.ok, false);
    assert.equal(failedSsot.ssotCommitted, false);
    assert.equal(failedSsot.steps.sheets.status, 'failed');
    assert.equal(failedSsot.steps.calendar.status, 'skipped');
    assert.equal(failedSsot.steps.drive.status, 'skipped');
    assert.equal(callsOnSheetFail.length, 1);

    // Case B: Step 1 succeeds, Step 2 (Calendar) fails, Step 3 (Drive) succeeds
    // -> Sheets MUST stay committed and return structured Calendar retryAction
    const sequence: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? 'GET');
      if (url.includes('sheets.googleapis.com')) {
        sequence.push('sheets');
        return new Response(
          JSON.stringify({ updates: { updatedRange: 'Honorários!A10:J10' } }),
          { status: 200 }
        );
      }
      if (url.includes('googleapis.com/calendar')) {
        sequence.push('calendar');
        return new Response('Calendar Error', { status: 500 });
      }
      if (url.includes('googleapis.com/drive') && method === 'GET') {
        sequence.push('drive-search');
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (url.includes('googleapis.com/drive') && method === 'POST') {
        sequence.push('drive-create');
        return new Response(
          JSON.stringify({
            id: 'drv-new-1',
            webViewLink: 'https://drive.google.com/drive/folders/drv-new-1',
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const partialResult = await executeAtomicClientRegistration({
      accessToken: 'tok',
      spreadsheetId: 'sheet-1',
      sheetTabTitle: 'Honorários',
      client: sampleClient,
      parentDriveFolderId: 'stage-carlos-id',
      readOnlyMode: false,
    });

    assert.deepEqual(sequence, ['sheets', 'calendar', 'drive-search', 'drive-create']);
    assert.equal(partialResult.ok, true);
    assert.equal(partialResult.ssotCommitted, true);
    assert.equal(partialResult.partialFailure, true);
    assert.equal(partialResult.steps.sheets.status, 'completed');
    assert.equal(partialResult.steps.calendar.status, 'failed');
    assert.equal(partialResult.steps.drive.status, 'completed');
    assert.equal(partialResult.retryActions.length, 1);
    assert.equal(partialResult.retryActions[0].step, 'calendar');
    assert.equal(
      partialResult.data?.driveFolderUrl,
      'https://drive.google.com/drive/folders/drv-new-1'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeAtomicInstallmentPayment commits Sheets first and returns retryAction if Drive fails', async () => {
  const originalFetch = globalThis.fetch;
  const sampleClient: ClientCase = {
    id: 'cli-pay-1',
    fullName: 'Mariana Souza Almeida',
    phone: '11999990001',
    caseType: 'Divórcio',
    driveStage: '02- Etapa Carlos',
    driveFolderUrl: 'https://drive.google.com/drive/my-drive',
    modality: 'Parcelado',
    contractedTotal: 1000,
    installments: [
      {
        id: 'inst-pay-1',
        clientId: 'cli-pay-1',
        clientName: 'Mariana Souza Almeida',
        installmentNumber: 1,
        totalInstallments: 2,
        amount: 500,
        dueDate: '2026-11-20',
        sheetRowNumber: 14,
        calendarEventId: 'evt-14',
      },
    ],
  };

  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('sheets.googleapis.com')) {
        return new Response(JSON.stringify({ updatedCells: 1 }), { status: 200 });
      }
      if (url.includes('googleapis.com/calendar')) {
        return new Response(JSON.stringify({ id: 'evt-14' }), { status: 200 });
      }
      if (url.includes('googleapis.com/drive')) {
        return new Response('Drive Unavailable', { status: 503 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const tx = await executeAtomicInstallmentPayment({
      accessToken: 'tok',
      spreadsheetId: 'sheet-1',
      sheetTabTitle: 'Honorários',
      client: sampleClient,
      installment: sampleClient.installments[0],
      paidDateISO: '2026-11-20',
      readOnlyMode: false,
    });

    assert.equal(tx.ok, true);
    assert.equal(tx.ssotCommitted, true);
    assert.equal(tx.partialFailure, true);
    assert.equal(tx.steps.sheets.status, 'completed');
    assert.equal(tx.steps.calendar.status, 'completed');
    assert.equal(tx.steps.drive.status, 'failed');
    assert.equal(tx.retryActions.length, 1);
    assert.equal(tx.retryActions[0].step, 'drive');

    // Read-only mode guard
    const blocked = await executeAtomicInstallmentPayment({
      accessToken: 'tok',
      spreadsheetId: 'sheet-1',
      sheetTabTitle: 'Honorários',
      client: sampleClient,
      installment: sampleClient.installments[0],
      paidDateISO: '2026-11-20',
      readOnlyMode: true,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blockedByReadOnly, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('executeAtomicRetryAction re-executes failed Calendar and Drive actions cleanly', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = String(init?.method ?? 'GET');
      if (url.includes('googleapis.com/calendar')) {
        return new Response(JSON.stringify({ id: 'evt-retried-1' }), {
          status: 200,
        });
      }
      if (url.includes('googleapis.com/drive') && method === 'GET') {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (url.includes('googleapis.com/drive') && method === 'POST') {
        return new Response(
          JSON.stringify({
            id: 'drv-retried-1',
            webViewLink: 'https://drive.google.com/drive/folders/drv-retried-1',
          }),
          { status: 200 }
        );
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const calRetry = await executeAtomicRetryAction('tok', {
      step: 'calendar',
      action: 'sync_calendar_event',
      description: 'Recriar evento',
      payload: {
        summary: 'Cobrança Honorários — Ana',
        description: 'Parcela 1/2',
        dateISO: '2026-12-10',
      },
    });
    assert.equal(calRetry.ok, true);
    assert.equal(calRetry.calendarEventId, 'evt-retried-1');

    const drvRetry = await executeAtomicRetryAction('tok', {
      step: 'drive',
      action: 'ensure_drive_folder',
      description: 'Garantir pasta no Drive',
      payload: {
        clientName: 'Ana Paula',
        parentFolderId: 'root-id',
      },
    });
    assert.equal(drvRetry.ok, true);
    assert.equal(
      drvRetry.driveFolderUrl,
      'https://drive.google.com/drive/folders/drv-retried-1'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('invalidateServerWorkspaceCache clears local cache and calls POST /api/workspace/cache/invalidate', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedMethod = '';
  let capturedAuth = '';
  let capturedBody = '';

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedMethod = String(init?.method ?? 'GET');
      const headers = (init?.headers ?? {}) as Record<string, string>;
      capturedAuth = headers.Authorization ?? '';
      capturedBody = String(init?.body ?? '');
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const ok = await invalidateServerWorkspaceCache(
      'firebase-id-token-123',
      EXPECTED_OFFICIAL_URL
    );
    assert.equal(ok, true);
    assert.equal(capturedUrl, '/api/workspace/cache/invalidate');
    assert.equal(capturedMethod, 'POST');
    assert.equal(capturedAuth, 'Bearer firebase-id-token-123');
    assert.equal(JSON.parse(capturedBody).url, EXPECTED_OFFICIAL_URL);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
