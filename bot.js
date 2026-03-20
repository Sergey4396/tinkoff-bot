import { TinkoffInvestApi } from 'tinkoff-invest-api';

const TOKEN = 't.KNbRWnr_MoKUOuBfzvjyUTUYftgAdZhpZ4zBqfwkgYtd4wnOaYuHCJHAeRXounciZ3N4NSQGPtH-8v5Mw0f_fQ';
const FIGI = 'FUTNGM032600';
const PRICE_DELTA = 0.010;

const api = new TinkoffInvestApi({ token: TOKEN });

async function main() {
    console.log('Подключение к Tinkoff API...');
    
    const accounts = await api.investAPI.usersService.GetAccounts({});
    const account = accounts.accounts[0];
    console.log('Аккаунт:', account.name, account.id);
    
    const instrument = await api.investAPI.instrumentsService.GetInstrumentBy({
        idType: 1,
        id: FIGI
    });
    console.log('Инструмент:', instrument.name);
    
    console.log('Подключение к потоку сделок...');
    
    const stream = api.investAPI.ordersStream.OrdersStream({
        accounts: [account.id]
    });
    
    stream.on('data', async (data) => {
        if (data.orderTrades) {
            const order = data.orderTrades;
            console.log('\n=== НОВАЯ СДЕЛКА ===');
            console.log('FIGI:', order.figi);
            console.log('Направление:', order.direction === 1 ? 'ПОКУПКА' : 'ПРОДАЖА');
            console.log('Кол-во:', order.trades.length, 'сделок');
            
            for (const trade of order.trades) {
                const price = Number(trade.price) / 100000000;
                console.log('  Цена:', price, 'Кол-во:', trade.quantity);
                
                const counterPrice = order.direction === 1 
                    ? price - PRICE_DELTA 
                    : price + PRICE_DELTA;
                
                console.log('  => Выставляю ордер на', order.direction === 1 ? 'ПРОДАЖУ' : 'ПОКУПКУ', 'по цене', counterPrice);
                
                try {
                    const result = await api.investAPI.ordersService.PostOrder({
                        accountId: account.id,
                        figi: FIGI,
                        quantity: trade.quantity,
                        price: { units: Math.floor(counterPrice), nano: Math.round((counterPrice % 1) * 1000000000) },
                        direction: order.direction === 1 ? 2 : 1,
                        orderType: 1,
                        orderId: `bot-${Date.now()}`
                    });
                    console.log('  Ордер отправлен:', result.orderId);
                } catch (e) {
                    console.log('  Ошибка ордера:', e.message);
                }
            }
        }
    });
    
    stream.on('error', (err) => {
        console.log('Ошибка потока:', err.message);
    });
}

main().catch(console.error);
