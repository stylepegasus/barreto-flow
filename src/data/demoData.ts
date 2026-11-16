import { ClientCase, DriveStage, Installment, PaymentModality } from '../types/honorarios';

function ym(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, 1));
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildInstallments(
  clientId: string,
  clientName: string,
  count: number,
  amount: number,
  startYear: number,
  startMonth: number,
  billingDay: number,
  paidCount: number,
  overrideCurrentMonthDueDay?: number,
  currentYear?: number,
  currentMonth?: number
): Installment[] {
  const list: Installment[] = [];
  for (let i = 0; i < count; i++) {
    const instDate = new Date(Date.UTC(startYear, startMonth - 1 + i, 1));
    const y = instDate.getUTCFullYear();
    const m = instDate.getUTCMonth() + 1;

    let dueDay = billingDay;
    if (
      overrideCurrentMonthDueDay !== undefined &&
      y === currentYear &&
      m === currentMonth
    ) {
      dueDay = overrideCurrentMonthDueDay;
    }

    const dueDate = ym(y, m, dueDay);
    const isPaid = i < paidCount;

    list.push({
      id: `${clientId}-p${i + 1}`,
      clientId,
      clientName,
      installmentNumber: i + 1,
      totalInstallments: count,
      amount,
      dueDate,
      paidDate: isPaid ? dueDate : undefined,
    });
  }
  return list;
}

export function createDemoClients(referenceDateISO: string): ClientCase[] {
  const [refYear, refMonth, refDay] = referenceDateISO.split('-').map(Number);

  // Helper for relative month offsets
  const monthOffset = (delta: number) => {
    const d = new Date(Date.UTC(refYear, refMonth - 1 + delta, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
  };

  const mMinus3 = monthOffset(-3);
  const mMinus2 = monthOffset(-2);
  const mMinus1 = monthOffset(-1);

  const clients: ClientCase[] = [
    // === DIA 10 (atrasadas + pagas) ===
    {
      id: 'cli-01',
      fullName: 'Mariana Souza Almeida',
      phone: '11987451201',
      caseType: 'Divórcio Litigioso com Partilha',
      processNumber: '1048291-33.2026.8.26.0100',
      driveStage: 'Protocolados / Processo Ativo',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-mariana-almeida',
      modality: 'Parcelado',
      contractedTotal: 4500,
      notes: 'Parcelamento em 10x todo dia 10.',
      installments: buildInstallments(
        'cli-01',
        'Mariana Souza Almeida',
        10,
        450,
        mMinus2.y,
        mMinus2.m,
        10,
        2 // Month -2 and -1 paid; current month (day 10) is overdue!
      ),
    },
    {
      id: 'cli-02',
      fullName: 'Fernanda Costa Ribeiro',
      phone: '11991234410',
      caseType: 'Pensão Alimentícia e Regulamentação de Visitas',
      processNumber: '1029384-11.2026.8.26.0002',
      driveStage: '04- Emendas',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-fernanda-ribeiro',
      modality: 'Parcelado',
      contractedTotal: 3200,
      notes: 'Aguardando comprovante de residência atualizado para emenda.',
      installments: buildInstallments(
        'cli-02',
        'Fernanda Costa Ribeiro',
        8,
        400,
        mMinus1.y,
        mMinus1.m,
        10,
        1 // Current month day 10 is overdue
      ),
    },
    {
      id: 'cli-03',
      fullName: 'Camila Ferreira Mendes',
      phone: '11982013345',
      caseType: 'Divórcio Consensual Extrajudicial',
      driveStage: '02- Etapa Carlos',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-camila-mendes',
      modality: 'Parcelado',
      contractedTotal: 2500,
      installments: buildInstallments(
        'cli-03',
        'Camila Ferreira Mendes',
        5,
        500,
        mMinus2.y,
        mMinus2.m,
        10,
        3 // Current month already paid
      ),
    },

    // === VENCIMENTO HOJE (para "Atenção Hoje" ter vencimentos de hoje além de atrasadas) ===
    {
      id: 'cli-04',
      fullName: 'Patrícia Oliveira Santos',
      phone: '11994558821',
      caseType: 'Guarda Unilateral e Alimentos',
      processNumber: '1011450-72.2026.8.26.0011',
      driveStage: '03- Etapa Gilmar',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-patricia-santos',
      modality: 'Parcelado',
      contractedTotal: 3600,
      notes: 'Cliente solicitou ajuste pontual do vencimento desta parcela para hoje.',
      installments: buildInstallments(
        'cli-04',
        'Patrícia Oliveira Santos',
        6,
        600,
        mMinus1.y,
        mMinus1.m,
        15,
        1,
        refDay,
        refYear,
        refMonth
      ),
    },

    // === DIA 15 ===
    {
      id: 'cli-05',
      fullName: 'Juliana Pereira Martins',
      phone: '11988776612',
      caseType: 'Reconhecimento e Dissolução de União Estável',
      driveStage: '01- Etapa Luis',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-juliana-martins',
      modality: 'Parcelado',
      contractedTotal: 3500,
      installments: buildInstallments(
        'cli-05',
        'Juliana Pereira Martins',
        10,
        350,
        mMinus1.y,
        mMinus1.m,
        15,
        1
      ),
    },
    {
      id: 'cli-06',
      fullName: 'Ricardo Henrique Duarte',
      phone: '11996302218',
      caseType: 'Revisional de Alimentos',
      processNumber: '1009982-19.2026.8.26.0005',
      driveStage: 'Protocolados / Processo Ativo',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-ricardo-duarte',
      modality: 'Parcelado',
      contractedTotal: 2400,
      installments: buildInstallments(
        'cli-06',
        'Ricardo Henrique Duarte',
        6,
        400,
        mMinus2.y,
        mMinus2.m,
        15,
        2
      ),
    },

    // === DIA 17 ===
    {
      id: 'cli-07',
      fullName: 'Amanda Barbosa Nogueira',
      phone: '11984129900',
      caseType: 'Inventário Judicial Consensual',
      driveStage: '02- Etapa Carlos',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-amanda-nogueira',
      modality: 'Parcelado',
      contractedTotal: 6000,
      installments: buildInstallments(
        'cli-07',
        'Amanda Barbosa Nogueira',
        12,
        500,
        mMinus2.y,
        mMinus2.m,
        17,
        2
      ),
    },
    {
      id: 'cli-08',
      fullName: 'Larissa Gomes Teixeira',
      phone: '11991887734',
      caseType: 'Execução de Alimentos',
      processNumber: '1034410-55.2026.8.26.0100',
      driveStage: 'Protocolados / Processo Ativo',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-larissa-teixeira',
      modality: 'Parcelado',
      contractedTotal: 1800,
      installments: buildInstallments(
        'cli-08',
        'Larissa Gomes Teixeira',
        6,
        300,
        mMinus1.y,
        mMinus1.m,
        17,
        1
      ),
    },

    // === DIA 18 ===
    {
      id: 'cli-09',
      fullName: 'Beatriz Cardoso Lima',
      phone: '11985662319',
      caseType: 'Guarda Compartilhada com Fixação de Lar',
      driveStage: '03- Etapa Gilmar',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-beatriz-lima',
      modality: 'Parcelado',
      contractedTotal: 3000,
      installments: buildInstallments(
        'cli-09',
        'Beatriz Cardoso Lima',
        6,
        500,
        mMinus3.y,
        mMinus3.m,
        18,
        3
      ),
    },
    {
      id: 'cli-10',
      fullName: 'Vanessa Moura Cavalcanti',
      phone: '11993104578',
      caseType: 'Divórcio Consensual com Filhos Menores',
      driveStage: '01- Etapa Luis',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-vanessa-cavalcanti',
      modality: 'À vista',
      contractedTotal: 2200,
      installments: [
        {
          id: 'cli-10-p1',
          clientId: 'cli-10',
          clientName: 'Vanessa Moura Cavalcanti',
          installmentNumber: 1,
          totalInstallments: 1,
          amount: 2200,
          dueDate: ym(refYear, refMonth, 18),
        },
      ],
    },

    // === DIA 20 (7 clientes • R$ 1.400) ===
    ...(
      [
        {
          id: 'cli-11',
          name: 'Ana Paula Rodrigues Vieira',
          phone: '11981239001',
          caseType: 'Pensão Alimentícia',
          stage: '01- Etapa Luis' as DriveStage,
          total: 2000,
          count: 10,
          amount: 200,
          paid: 0,
        },
        {
          id: 'cli-12',
          name: 'Carla Menezes Monteiro',
          phone: '11981239002',
          caseType: 'Divórcio Consensual',
          stage: '02- Etapa Carlos' as DriveStage,
          total: 2000,
          count: 10,
          amount: 200,
          paid: 2,
        },
        {
          id: 'cli-13',
          name: 'Daniela Rocha Azevedo',
          phone: '11981239003',
          caseType: 'Guarda de Menores',
          stage: '03- Etapa Gilmar' as DriveStage,
          total: 2000,
          count: 10,
          amount: 200,
          paid: 1,
        },
        {
          id: 'cli-14',
          name: 'Eduarda Castro Lopes',
          phone: '11981239004',
          caseType: 'Dissolução de União Estável',
          stage: '04- Emendas' as DriveStage,
          total: 2000,
          count: 10,
          amount: 200,
          paid: 3,
        },
        {
          id: 'cli-15',
          name: 'Fabiana Nunes Correia',
          phone: '11981239005',
          caseType: 'Execução de Pensão',
          stage: 'Protocolados / Processo Ativo' as DriveStage,
          total: 2000,
          count: 10,
          amount: 200,
          paid: 1,
        },
        {
          id: 'cli-16',
          name: 'Gabriela Pinto Farias',
          phone: '11981239006',
          caseType: 'Regulamentação de Convivência',
          stage: '02- Etapa Carlos' as DriveStage,
          total: 2000,
          count: 10,
          amount: 200,
          paid: 2,
        },
        {
          id: 'cli-17',
          name: 'Helena Barros Sampaio',
          phone: '11981239007',
          caseType: 'Alimentos Gravídicos',
          stage: 'Protocolados / Processo Ativo' as DriveStage,
          total: 2000,
          count: 10,
          amount: 200,
          paid: 1,
        },
      ] as const
    ).map((c) => {
      const start = monthOffset(-c.paid);
      return {
        id: c.id,
        fullName: c.name,
        phone: c.phone,
        caseType: c.caseType,
        driveStage: c.stage,
        driveFolderUrl: `https://drive.google.com/drive/folders/demo-${c.id}`,
        modality: 'Parcelado' as PaymentModality,
        contractedTotal: c.total,
        installments: buildInstallments(
          c.id,
          c.name,
          c.count,
          c.amount,
          start.y,
          start.m,
          20,
          c.paid
        ),
      };
    }),

    // === DIA 23 ===
    {
      id: 'cli-18',
      fullName: 'Renata Batista Moreira',
      phone: '11997743210',
      caseType: 'Sobrepartilha de Imóvel',
      processNumber: '1055120-88.2026.8.26.0100',
      driveStage: 'Protocolados / Processo Ativo',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-renata-moreira',
      modality: 'Parcelado',
      contractedTotal: 4800,
      installments: buildInstallments(
        'cli-18',
        'Renata Batista Moreira',
        8,
        600,
        mMinus2.y,
        mMinus2.m,
        23,
        2
      ),
    },

    // === DIA 27 ===
    {
      id: 'cli-19',
      fullName: 'Tatiana Borges Cunha',
      phone: '11983321984',
      caseType: 'Interdição e Curatela Familiar',
      driveStage: '04- Emendas',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-tatiana-cunha',
      modality: 'Parcelado',
      contractedTotal: 3600,
      installments: buildInstallments(
        'cli-19',
        'Tatiana Borges Cunha',
        9,
        400,
        mMinus1.y,
        mMinus1.m,
        27,
        1
      ),
    },

    // === DIA 30 ===
    {
      id: 'cli-20',
      fullName: 'Luciana Teixeira Braga',
      phone: '11992205514',
      caseType: 'Partilha de Bens Pós-Divórcio',
      processNumber: '1062001-14.2026.8.26.0002',
      driveStage: 'Protocolados / Processo Ativo',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-luciana-braga',
      modality: 'Êxito 30%',
      contractedTotal: 15000,
      notes: 'Contrato de êxito 30% sobre o patrimônio partilhado + taxa inicial parcelada.',
      installments: buildInstallments(
        'cli-20',
        'Luciana Teixeira Braga',
        3,
        500,
        mMinus1.y,
        mMinus1.m,
        30,
        1
      ),
    },
    {
      id: 'cli-21',
      fullName: 'Sílvia Regina Machado',
      phone: '11986007743',
      caseType: 'Inventário e Arrolamento Sumário',
      driveStage: '02- Etapa Carlos',
      driveFolderUrl: 'https://drive.google.com/drive/folders/demo-silvia-machado',
      modality: 'Êxito 30%',
      contractedTotal: 18000,
      notes: 'Honorários de êxito 30% ao final da expedição do formal de partilha.',
      installments: [],
    },
  ];

  return clients;
}
