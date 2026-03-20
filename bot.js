import { TinkoffInvestApi } from 'tinkoff-invest-api';

const TOKEN = 't.KNbRWnr_MoKUOuBfzvjyUTUYftgAdZhpZ4zBqfwkgYtd4wnOaYuHCJHAeRXounciZ3N4NSQGPtH-8v5Mw0f_fQ';
const FIGI = 'FUTNGM032600';
const PRICE_DELTA = 0.010;

const api = new TinkoffInvestApi({ token: TOKEN });

async function main() {
    console.log('Подключение к Tinkoff API...');
    
    const { accounts } = await api.users.getAccounts({});
    const account = accounts[0];
    console.log('Аккаунт:', account.name, account.id);
    const accountId = account.id;
    
    console.log('Подключение к потоку моих ордеров...');
    
    const stream = api.ordersStream.tradesStream({ accounts: [accountId] });
    
    (async () => {
        try {
            for await (const data of stream) {
                console.log('\n=== ДАННЫЕ ПОЛУЧЕНЫ ===');
                console.log('Ключи:', Object.keys(data));
                
                if (data.orderTrades) {
                    const order = data.orderTrades;
                    console.log('\n--- МОЙ ОРДЕР ---');
                    console.log('FIGI:', order.figi);
                    console.log('Наш FIGI:', FIGI);
                    console.log('Совпадение:', order.figi === FIGI ? 'ДА' : 'НЕТ');
                    
                    if (order.figi !== FIGI) {
                        console.log('Пропускаем - не наш FIGI');
                        continue;
                    }
                    
                    for (const trade of order.trades) {
                        const price = Number(trade.price.units) + Number(trade.price.nano) / 1000000000;
                        console.log('  Сделка - Цена:', price, 'Кол-во:', trade.quantity);
                        console.log('  Направление сделки:', order.direction, '(1=BUY, 2=SELL)');
                        
                        // После ПОКУПКИ -> ставим ПРОДАЖУ дороже (цена + дельта)
                        // После ПРОДАЖИ -> ставим ПОКУПКУ дешевле (цена - дельта)
                        const isBuy = order.direction === 1;
                        const counterPrice = isBuy ? price + PRICE_DELTA : price - PRICE_DELTA;
                        const counterDirection = isBuy ? 2 : 1;
                        
                        // Округляем чтобы избежать 3.1569999999999996
                        const roundedPrice = Math.round(counterPrice * 1000) / 1000;
                        console.log('  => Выставляю ордер на', isBuy ? 'ПРОДАЖУ' : 'ПОКУПКУ', 'по цене', roundedPrice);
                        
                        try {
                            const result = await api.orders.postOrder({
                                accountId: accountId,
                                figi: FIGI,
                                quantity: Number(trade.quantity),
                                price: api.helpers.toQuotation(roundedPrice),
                                direction: counterDirection,
                                orderType: 1,
                                orderId: `bot_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
                            });
                            console.log('  Ордер отправлен:', result.orderId);
                        } catch (e) {
                            console.log('  Ошибка ордера:', e.message);
                        }
                    }
                }
            }
        } catch (err) {
            console.log('Ошибка потока:', err);
        }
    })();
    
    console.log('Бот запущен. Ожидание моих сделок по', FIGI, '...');
    
    process.on('SIGINT', () => {
        console.log('\nВыключение...');
        process.exit();
    });
}

main().catch(console.error);
