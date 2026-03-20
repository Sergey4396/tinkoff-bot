import { TinkoffInvestApi, RealAccount } from 'tinkoff-invest-api';
import { OrderDirection, OrderType } from 'tinkoff-invest-api/dist/generated/orders.js';

const TOKEN = 't.KNbRWnr_MoKUOuBfzvjyUTUYftgAdZhpZ4zBqfwkgYtd4wnOaYuHCJHAeRXounciZ3N4NSQGPtH-8v5Mw0f_fQ';
const FIGI = 'FUTNGM032600';
const PRICE_DELTA = 0.010;

const api = new TinkoffInvestApi({ token: TOKEN });

async function main() {
    console.log('Подключение к Tinkoff API...');
    
    const { accounts } = await api.users.getAccounts({});
    const account = accounts[0];
    console.log('Аккаунт:', account.name, account.id);
    
    const tinkoffAccount = new RealAccount(api, account.id);
    
    console.log('Подключение к потоку моих ордеров (напрямую)...');
    
    const call = api.ordersStream.tradesStream({ accounts: [account.id] });
    
    call.on('data', (data) => {
        console.log('\n=== ДАННЫЕ ПОЛУЧЕНЫ ===');
        console.log('Ключи:', Object.keys(data));
        console.log(JSON.stringify(data, null, 2));
        
        if (data.orderTrades) {
            const order = data.orderTrades;
            console.log('\n--- МОЙ ОРДЕР ---');
            console.log('FIGI:', order.figi);
            console.log('Наш FIGI:', FIGI);
            console.log('Совпадение:', order.figi === FIGI ? 'ДА' : 'НЕТ');
            console.log('Направление:', order.direction);
            
            if (order.figi !== FIGI) {
                console.log('Пропускаем - не наш FIGI');
                return;
            }
            
            for (const trade of order.trades) {
                const price = api.helpers.toNumber(trade.price);
                console.log('  Сделка - Цена:', price, 'Кол-во:', trade.quantity);
                
                const counterPrice = order.direction === OrderDirection.ORDER_DIRECTION_BUY 
                    ? price - PRICE_DELTA 
                    : price + PRICE_DELTA;
                
                console.log('  => Выставляю ордер на', order.direction === OrderDirection.ORDER_DIRECTION_BUY ? 'ПРОДАЖУ' : 'ПОКУПКУ', 'по цене', counterPrice);
                
                tinkoffAccount.postOrder({
                    figi: FIGI,
                    quantity: Number(trade.quantity),
                    price: api.helpers.toQuotation(counterPrice),
                    direction: order.direction === OrderDirection.ORDER_DIRECTION_BUY 
                        ? OrderDirection.ORDER_DIRECTION_SELL 
                        : OrderDirection.ORDER_DIRECTION_BUY,
                    orderType: OrderType.ORDER_TYPE_LIMIT,
                    orderId: `bot-${Date.now()}`
                }).then(result => {
                    console.log('  Ордер отправлен:', result.orderId);
                }).catch(e => {
                    console.log('  Ошибка ордера:', e.message);
                });
            }
        }
    });
    
    call.on('error', (err) => {
        console.log('Ошибка потока:', err);
    });
    
    call.on('end', () => {
        console.log('Поток завершён');
    });
    
    console.log('Бот запущен. Ожидание моих сделок по', FIGI, '...');
    
    process.on('SIGINT', () => {
        console.log('\nВыключение...');
        call.cancel();
        process.exit();
    });
}

main().catch(console.error);
