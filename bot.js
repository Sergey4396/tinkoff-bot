import { TinkoffInvestApi } from 'tinkoff-invest-api';

const TOKEN = 't.KNbRWnr_MoKUOuBfzvjyUTUYftgAdZhpZ4zBqfwkgYtd4wnOaYuHCJHAeRXounciZ3N4NSQGPtH-8v5Mw0f_fQ';

// Конфигурация инструментов: FIGI -> дельта цены
const INSTRUMENTS = {
    'FUTNGM032600': 0.010,  // NRH6
    'FUTNG0326000': 0.025,   // NGH6
    'FUTNG0426000': 0.010,  // NGJ6
    'FUTNGM042600': 0.010,  // NRJ6
};

const api = new TinkoffInvestApi({ token: TOKEN });

async function main() {
    console.log('Подключение к Tinkoff API...');
    
    const { accounts } = await api.users.getAccounts({});
    const account = accounts[0];
    console.log('Аккаунт:', account.name, account.id);
    const accountId = account.id;
    
    console.log('Мониторим инструменты:', Object.keys(INSTRUMENTS));
    
    const stream = api.ordersStream.tradesStream({ accounts: [accountId] });
    
    (async () => {
        try {
            for await (const data of stream) {
                if (data.orderTrades) {
                    const order = data.orderTrades;
                    const figi = order.figi;
                    
                    // Проверяем есть ли FIGI в нашем списке
                    if (!INSTRUMENTS.hasOwnProperty(figi)) {
                        continue;
                    }
                    
                    const priceDelta = INSTRUMENTS[figi];
                    console.log('\n=== СДЕЛКА ===', figi);
                    
                    for (const trade of order.trades) {
                        const price = Number(trade.price.units) + Number(trade.price.nano) / 1000000000;
                        console.log('  Цена:', price, 'Кол-во:', trade.quantity);
                        
                        const isBuy = order.direction === 1;
                        const counterPrice = isBuy ? price + priceDelta : price - priceDelta;
                        const counterDirection = isBuy ? 2 : 1;
                        
                        const roundedPrice = Math.round(counterPrice * 1000) / 1000;
                        console.log('  => Ордер на', isBuy ? 'ПРОДАЖУ' : 'ПОКУПКУ', 'по цене', roundedPrice);
                        
                        try {
                            const result = await api.orders.postOrder({
                                accountId: accountId,
                                figi: figi,
                                instrumentId: figi,
                                quantity: Number(trade.quantity),
                                price: api.helpers.toQuotation(roundedPrice),
                                direction: counterDirection,
                                orderType: 1,
                                timeInForce: 1,
                                priceType: 1,
                                orderId: `bot_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
                            });
                            console.log('  => Ордер отправлен:', result.orderId);
                        } catch (e) {
                            console.log('  => Ошибка:', e.message);
                        }
                    }
                }
            }
        } catch (err) {
            console.log('Ошибка потока:', err);
        }
    })();
    
    console.log('Бот запущен. Ожидание сделок...');
    
    process.on('SIGINT', () => {
        console.log('\nВыключение...');
        process.exit();
    });
}

main().catch(console.error);
