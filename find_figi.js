import { TinkoffInvestApi } from 'tinkoff-invest-api';

const TOKEN = 't.KNbRWnr_MoKUOuBfzvjyUTUYftgAdZhpZ4zBqfwkgYtd4wnOaYuHCJHAeRXounciZ3N4NSQGPtH-8v5Mw0f_fQ';

const api = new TinkoffInvestApi({ token: TOKEN });

const query = process.argv[2];
if (!query) {
    console.log('Использование: node find_figi.js <тикер>');
    console.log('Пример: node find_figi.js NRM6');
    process.exit(1);
}

const result = await api.instruments.findInstrument({ query });
for (const inst of result.instruments) {
    console.log(`${inst.ticker.padEnd(6)} ${inst.figi.padEnd(18)} ${inst.instrumentType.padEnd(10)} ${inst.name}`);
}
