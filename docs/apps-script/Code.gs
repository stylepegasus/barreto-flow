/**
 * Barreto Flow — Google Apps Script Web App (SSOT Somente Leitura)
 * Planilha Oficial: "Barreto — Honorários (Ads Família)"
 * Pasta Raiz Drive: "Clientes Tráfego Pago"
 *
 * COMO PUBLICAR / ATUALIZAR:
 * 1. Abra a planilha "Barreto — Honorários (Ads Família)" -> Extensões -> Apps Script.
 * 2. Substitua o conteúdo de Code.gs por este arquivo e salve (Ctrl+S).
 * 3. Clique em "Implantar" -> "Gerenciar implantações" -> ícone de lápis (Editar) na implantação atual.
 * 4. Em "Versão", selecione "Nova versão" (mantendo a mesma URL /exec) e clique em "Implantar".
 *    - Executar como: Eu (proprietário da planilha/Drive/Calendar)
 *    - Quem pode acessar: Qualquer pessoa
 *
 * NOTA: Este script executa EXCLUSIVAMENTE leitura (doGet). Nunca altera a planilha, Drive ou Calendar.
 */

var SPREADSHEET_ID = '10_jWd4C2yZvaayKLKk7EiTO8Xo5-80uDKVziiUQ0LSc';
var DRIVE_ROOT_FOLDER_NAME = 'Clientes Tráfego Pago';
var CALENDAR_DAYS_BACK = 60;
var CALENDAR_DAYS_FORWARD = 180;
var MAX_DRIVE_FILE_BYTES = 12 * 1024 * 1024; // 12 MB

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var acao = String(params.acao || '').trim();

    if (acao === 'lerArquivo') {
      return jsonResponse_(lerArquivoDrive_(String(params.fileId || '').trim()));
    }

    var ss = getOfficialSpreadsheet_();
    var clientes = lerAbaClientes_(ss);
    var parcelas = lerAbaCobrancas_(ss);
    var pagamentos = lerAbaPagamentos_(ss);
    var contratos = lerAbaContratos_(ss);
    var zapsignConferencia = lerAbaZapSign_(ss);
    var dashboard = lerAbaDashboard_(ss, parcelas, pagamentos);
    var driveEtapas = lerPastasDrive_();
    var eventosAgenda = lerEventosAgenda_();

    return jsonResponse_({
      versaoContrato: '2.0-ssot',
      geradoEm: new Date().toISOString(),
      dashboard: dashboard,
      clientes: clientes,
      parcelas: parcelas,
      pagamentos: pagamentos,
      contratos: contratos,
      zapsignConferencia: zapsignConferencia,
      driveEtapas: driveEtapas,
      eventosAgenda: eventosAgenda,
    });
  } catch (err) {
    return jsonResponse_({
      error: err && err.message ? err.message : String(err),
    });
  }
}

function getOfficialSpreadsheet_() {
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (ignore) {}
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

function formatDateISO_(val) {
  if (!val) return '';
  if (Object.prototype.toString.call(val) === '[object Date]' && !isNaN(val.getTime())) {
    return Utilities.formatDate(val, Session.getScriptTimeZone() || 'America/Sao_Paulo', 'yyyy-MM-dd');
  }
  var s = String(val).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    var d = ('0' + br[1]).slice(-2);
    var m = ('0' + br[2]).slice(-2);
    var y = br[3].length === 2 ? '20' + br[3] : br[3];
    return y + '-' + m + '-' + d;
  }
  return s;
}

function formatMonthKey_(val) {
  var iso = formatDateISO_(val);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(iso)) return iso;
  return '';
}

function toNumber_(val) {
  if (typeof val === 'number') return isFinite(val) ? Math.round(val * 100) / 100 : 0;
  if (val === null || val === undefined || val === '') return 0;
  var s = String(val)
    .replace(/\u00A0/g, ' ')
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '')
    .trim();
  if (!s || s === '-' || s === '—') return 0;
  if (s.indexOf(',') !== -1) {
    s = s.replace(/\./g, '').replace(',', '.');
  }
  var n = Number(s);
  return isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function isSummaryLabel_(val) {
  var s = String(val || '').trim().toLowerCase();
  return (
    !s ||
    s === 'total' ||
    s === 'totais' ||
    s === 'subtotal' ||
    s === 'cliente' ||
    s.indexOf('total ') === 0 ||
    s.indexOf('saldo total') === 0
  );
}

/**
 * Aba "Clientes" — Cabeçalho linha 14, dados a partir da linha 15.
 * A: Cliente | B: CPF | C: Honorário total | D: Recebido | E: Falta receber |
 * F: 1º vencimento | G: Situação | H: ID cliente | I: Tipo | J: Parcelas regulares |
 * K: Entrada | N: Êxito %
 */
function lerAbaClientes_(ss) {
  var sheet = ss.getSheetByName('Clientes');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 15) return [];

  var values = sheet.getRange(15, 1, lastRow - 14, 18).getValues();
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var nome = String(row[0] || '').trim();
    var id = String(row[7] || '').trim();
    if (isSummaryLabel_(nome) && !id) continue;
    if (!nome) continue;

    out.push({
      id: id || 'CLI-' + (i + 15),
      nome: nome,
      cpf: String(row[1] || '').trim(),
      totalContratado: toNumber_(row[2]),
      totalPago: toNumber_(row[3]),
      saldoRestante: toNumber_(row[4]),
      primeiroVencimento: formatDateISO_(row[5]),
      situacao: String(row[6] || '').trim(),
      modalidade: String(row[8] || '').trim(),
      parcelasRegulares: toNumber_(row[9]),
      entrada: toNumber_(row[10]),
      exitoPercentual: toNumber_(row[13]),
    });
  }

  return out;
}

/**
 * Aba "Cobranças" — Cabeçalho linha 9, dados a partir da linha 10.
 * A: Cliente | B: Parcela | C: Vencimento | D: Previsto | E: Recebido |
 * F: Falta receber | G: Situação | H: Último pagamento | I: Alerta |
 * K: ID parcela | L: ID cliente | O: Data confirmada (TRUE/FALSE) |
 * T: Cliente ativo | U: Previsto ativo | V: Recebido ativo | W: Saldo ativo
 */
function lerAbaCobrancas_(ss) {
  var sheet = ss.getSheetByName('Cobranças') || ss.getSheetByName('Cobrancas');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 10) return [];

  var values = sheet.getRange(10, 1, lastRow - 9, 23).getValues();
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var cliente = String(row[0] || '').trim();
    var idParcela = String(row[10] || '').trim();
    if (isSummaryLabel_(cliente) && !idParcela) continue;
    if (!cliente && !idParcela) continue;

    // Ignora linhas marcadas explicitamente como Cliente ativo = FALSE (ex.: cancelados)
    if (row[19] === false) continue;

    var dataConfirmadaRaw = row[14];
    var dataConfirmada =
      typeof dataConfirmadaRaw === 'boolean'
        ? dataConfirmadaRaw
        : String(dataConfirmadaRaw || '').trim().toUpperCase() === 'TRUE';

    out.push({
      idParcela: idParcela || 'PARC-' + (i + 10),
      idCliente: String(row[11] || '').trim(),
      cliente: cliente,
      parcela: String(row[1] || '').trim(),
      vencimento: formatDateISO_(row[2]),
      previsto: toNumber_(row[20] !== '' && row[20] !== null ? row[20] : row[3]),
      recebido: toNumber_(row[21] !== '' && row[21] !== null ? row[21] : row[4]),
      faltaReceber: toNumber_(row[22] !== '' && row[22] !== null ? row[22] : row[5]),
      situacao: String(row[6] || '').trim(),
      ultimoPagamento: formatDateISO_(row[7]),
      alerta: String(row[8] || '').trim(),
      dataConfirmada: dataConfirmada,
    });
  }

  return out;
}

/**
 * Aba "Pagamentos" — Cabeçalho linha 15, dados a partir da linha 16.
 * A: Cliente | B: Parcela/Tipo | C: Valor recebido | D: Data pagamento |
 * E: Registro (PAGO/PENDENTE) | F: Observação | G: ID pagamento |
 * H: ID parcela | I: ID cliente | J: Mês recebido | K: Valor ativo
 */
function lerAbaPagamentos_(ss) {
  var sheet = ss.getSheetByName('Pagamentos');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 16) return [];

  var values = sheet.getRange(16, 1, lastRow - 15, 11).getValues();
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var cliente = String(row[0] || '').trim();
    var idPagamento = String(row[6] || '').trim();
    var valorAtivo = toNumber_(row[10]);
    var statusRegistro = String(row[4] || '').trim();

    if (!cliente && !idPagamento) continue;
    if (isSummaryLabel_(cliente) && !idPagamento) continue;
    if (statusRegistro.toUpperCase() === 'PENDENTE' || valorAtivo <= 0) continue;

    var dataPagISO = formatDateISO_(row[3]);
    var mesRecebido = formatMonthKey_(row[9]) || (dataPagISO ? dataPagISO.slice(0, 7) : '');

    out.push({
      idPagamento: idPagamento || 'PAG-' + (i + 16),
      dataPagamento: dataPagISO,
      idCliente: String(row[8] || '').trim(),
      cliente: cliente,
      tipo: String(row[1] || '').trim(),
      valor: toNumber_(row[2]),
      valorAtivo: valorAtivo,
      statusRegistro: statusRegistro || 'PAGO',
      observacao: String(row[5] || '').trim(),
      idParcela: String(row[7] || '').trim(),
      mesRecebido: mesRecebido,
    });
  }

  return out;
}

/**
 * Aba "Contratos" — Cabeçalho linha 6, dados a partir da linha 7.
 * A: ID contrato | B: Cliente | C: Situação | D: Modalidade | E: Valor fixo total
 */
function lerAbaContratos_(ss) {
  var sheet = ss.getSheetByName('Contratos');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 7) return [];

  var values = sheet.getRange(7, 1, lastRow - 6, 6).getValues();
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var idCliente = String(row[0] || '').trim();
    var cliente = String(row[1] || '').trim();
    if (!cliente && !idCliente) continue;
    if (isSummaryLabel_(cliente) && !idCliente) continue;

    out.push({
      idCliente: idCliente,
      cliente: cliente,
      status: String(row[2] || '').trim(),
      modalidade: String(row[3] || '').trim(),
      valorTotal: toNumber_(row[4]),
    });
  }

  return out;
}

/**
 * Aba "ZapSign" — Cabeçalho linha 6, dados a partir da linha 7.
 * A: ID ZapSign | B: ID contrato | C: Documento na exportação |
 * D: Status da exportação | E: Criado em
 */
function lerAbaZapSign_(ss) {
  var sheet = ss.getSheetByName('ZapSign');
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 7) return [];

  var values = sheet.getRange(7, 1, lastRow - 6, 6).getValues();
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    var idCliente = String(row[1] || '').trim();
    var documento = String(row[2] || '').trim();
    if (!documento && !idCliente) continue;

    out.push({
      idCliente: idCliente,
      documento: documento,
      status: String(row[3] || '').trim(),
      dataAssinatura: formatDateISO_(row[4]),
    });
  }

  return out;
}

/**
 * Aba "Dashboard" — Consolidação oficial da SSOT.
 * C4: Mês ref | B7: Saldo total a receber | F7: Total já recebido | J7: Parcelas atrasadas
 * B10: Previsto no mês | F10: Recebido no mês | J10: Falta das parcelas do mês
 */
function lerAbaDashboard_(ss, parcelas, pagamentos) {
  var sheet = ss.getSheetByName('Dashboard');
  if (!sheet) return null;

  var mesRef = formatMonthKey_(sheet.getRange('C4').getValue());
  var saldoTotalAReceber = toNumber_(sheet.getRange('B7').getValue());
  var totalJaRecebido = toNumber_(sheet.getRange('F7').getValue());
  var parcelasAtrasadasValor = toNumber_(sheet.getRange('J7').getValue());
  var previstoNoMes = toNumber_(sheet.getRange('B10').getValue());
  var recebidoNoMes = toNumber_(sheet.getRange('F10').getValue());
  var faltaParcelasMes = toNumber_(sheet.getRange('J10').getValue());

  var datadasCents = 0;
  var semDataBrutoCents = 0;
  var atrasadasCount = 0;
  var hojeISO = formatDateISO_(new Date());

  for (var i = 0; i < parcelas.length; i++) {
    var p = parcelas[i];
    var faltaCents = Math.round(toNumber_(p.faltaReceber) * 100);
    if (faltaCents <= 0) continue;
    if (p.dataConfirmada === true) {
      datadasCents += faltaCents;
      if (p.vencimento && p.vencimento < hojeISO) {
        atrasadasCount += 1;
      }
    } else {
      semDataBrutoCents += faltaCents;
    }
  }

  var creditoCents = 0;
  for (var j = 0; j < pagamentos.length; j++) {
    var pay = pagamentos[j];
    if (!String(pay.idParcela || '').trim()) {
      creditoCents += Math.round(toNumber_(pay.valorAtivo) * 100);
    }
  }

  var saldoParcelasDatadas = Math.round(datadasCents) / 100;
  var creditoAVincular = Math.round(creditoCents) / 100;
  var saldoSemData = Math.max(0, Math.round(semDataBrutoCents - creditoCents)) / 100;

  return {
    mesReferencia: mesRef,
    saldoTotalAReceber: saldoTotalAReceber,
    saldoParcelasDatadas: saldoParcelasDatadas,
    saldoSemData: saldoSemData,
    creditoAVincular: creditoAVincular,
    totalJaRecebido: totalJaRecebido,
    recebidoNoMes: recebidoNoMes,
    previstoNoMes: previstoNoMes,
    parcelasAtrasadasValor: parcelasAtrasadasValor,
    parcelasAtrasadasCount: atrasadasCount,
    faltaParcelasMes: faltaParcelasMes,
    fromOfficialSheetTab: true,
  };
}

/**
 * Lê todas as subpastas de etapas e pastas de clientes dentro de "Clientes Tráfego Pago".
 */
function lerPastasDrive_() {
  var result = [];
  var roots = DriveApp.getFoldersByName(DRIVE_ROOT_FOLDER_NAME);
  if (!roots.hasNext()) return result;

  var rootFolder = roots.next();
  var stageFolders = rootFolder.getFolders();

  while (stageFolders.hasNext()) {
    var stageFolder = stageFolders.next();
    var etapaNome = stageFolder.getName();
    var clientFolders = stageFolder.getFolders();

    while (clientFolders.hasNext()) {
      var clientFolder = clientFolders.next();
      var arquivos = [];
      var files = clientFolder.getFiles();

      while (files.hasNext()) {
        var file = files.next();
        arquivos.push({
          id: file.getId(),
          nome: file.getName(),
          mimeType: file.getMimeType(),
          url: file.getUrl(),
          atualizadoEm: file.getLastUpdated().toISOString(),
        });
      }

      result.push({
        etapa: etapaNome,
        nomePasta: clientFolder.getName(),
        urlPasta: clientFolder.getUrl(),
        arquivos: arquivos,
      });
    }
  }

  return result;
}

/**
 * Lê eventos de cobrança no Google Calendar principal (somente leitura).
 */
function lerEventosAgenda_() {
  var out = [];
  var cal = CalendarApp.getDefaultCalendar();
  if (!cal) return out;

  var now = new Date();
  var start = new Date(now.getTime() - CALENDAR_DAYS_BACK * 86400000);
  var end = new Date(now.getTime() + CALENDAR_DAYS_FORWARD * 86400000);
  var events = cal.getEvents(start, end);

  for (var i = 0; i < events.length; i++) {
    var ev = events[i];
    out.push({
      id: ev.getId(),
      titulo: ev.getTitle(),
      inicio: ev.getStartTime().toISOString(),
      fim: ev.getEndTime().toISOString(),
      descricao: ev.getDescription() || '',
    });
  }

  return out;
}

/**
 * Leitura sob demanda de arquivo no Google Drive para análise da assistente Dona.
 */
function lerArquivoDrive_(fileId) {
  if (!fileId) {
    return { error: 'Parâmetro fileId obrigatório.' };
  }

  var file = DriveApp.getFileById(fileId);
  var mimeType = file.getMimeType();
  var nome = file.getName();

  if (mimeType === MimeType.GOOGLE_DOCS) {
    var docText = DocumentApp.openById(fileId).getBody().getText();
    return {
      nome: nome,
      mimeType: 'text/plain',
      formato: 'texto',
      conteudo: docText,
    };
  }

  var blob = file.getBlob();
  var bytes = blob.getBytes();
  if (bytes.length > MAX_DRIVE_FILE_BYTES) {
    return {
      error: 'Arquivo excede o limite de 12 MB suportado para análise direta.',
    };
  }

  return {
    nome: nome,
    mimeType: mimeType,
    formato: 'base64',
    conteudo: Utilities.base64Encode(bytes),
  };
}
