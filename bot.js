import { TinkoffInvestApi } from 'tinkoff-invest-api';

const TOKEN = 't.KNbRWnr_MoKUOuBfzvjyUTUYftgAdZhpZ4zBqfwkgYtd4wnOaYuHCJHAeRXounciZ3N4NSQGPtH-8v5Mw0f_fQ';

const INSTRUMENTS = {
    'FUTNGM032600': 0.010,  // NRH6
    'FUTNG0326000': 0.030,   // NGH6
    'FUTNG0426000': 0.030,  // NGJ6
    'FUTNG0526000': 0.007,  // NGK6
    'FUTSILVM0626': 1,       // S1M6
};

const api = new TinkoffInvestApi({ token: TOKEN });
let accountId = null;
let reconnectDelay = 1000;
let isRunning = true;

async function processTrade(order, figi) {
    const priceDelta = INSTRUMENTS[figi];
    console.log(`\n=== СДЕЛКА === ${figi} direction: ${order.direction}`);
    
    for (const trade of order.trades) {
        const price = Number(trade.price.units) + Number(trade.price.nano) / 1000000000;
        console.log(`  Цена: ${price} Кол-во: ${trade.quantity}`);
        
        const isBuy = order.direction === 1;
        const counterPrice = isBuy ? price + priceDelta : price - priceDelta;
        const counterDirection = isBuy ? 2 : 1;
        
        const roundedPrice = Math.round(counterPrice * 1000) / 1000;
        console.log(`  => Ордер на ${isBuy ? 'ПРОДАЖУ' : 'ПОКУПКУ'} по цене ${roundedPrice}`);
        
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
            console.log(`  => Ордер отправлен: ${result.orderId}`);
        } catch (e) {
            console.log(`  => Ошибка: ${e.message}`);
        }
    }
}

function scheduleReconnect() {
    if (!isRunning) return;
    
    console.log(`[${new Date().toISOString()}] Переподключение через ${reconnectDelay}ms...`);
    
    setTimeout(() => {
        reconnectDelay = 1000;
        connectStream();
    }, reconnectDelay);
    
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

async function connectStream() {
    if (!isRunning) return;
    
    console.log(`[${new Date().toISOString()}] Подключение к потоку...`);
    
    try {
        const stream = api.ordersStream.tradesStream({ accounts: [accountId] });
        
        (async () => {
            try {
                for await (const data of stream) {
                    // Логируем что пришло
                    if (data.subscription) {
                        console.log(`[${new Date().toISOString()}] Подписка: ${JSON.stringify(data.subscription)}`);
                    } else if (data.ping) {
                        console.log(`[${new Date().toISOString()}] Ping`);
                    } else if (data.orderTrades) {
                        const order = data.orderTrades;
                        const figi = order.figi;
                        
                        console.log(`[${new Date().toISOString()}] Получен ордер: ${figi}`);
                        
                        if (INSTRUMENTS.hasOwnProperty(figi)) {
                            await processTrade(order, figi);
                        } else {
                            console.log(`  => FIGI ${figi} не в списке`);
                        }
                    } else {
                        console.log(`[${new Date().toISOString()}] Неизвестные данные: ${JSON.stringify(data)}`);
                    }
                }
            } catch (err) {
                console.log(`[${new Date().toISOString()}] Поток прерван: ${err.message}`);
                scheduleReconnect();
            }
        })();
        
    } catch (err) {
        console.log(`[${new Date().toISOString()}] Ошибка подключения: ${err.message}`);
        scheduleReconnect();
    }
}

async function main() {
    console.log('Подключение к Tinkoff API...');
    
    const { accounts } = await api.users.getAccounts({});
    const account = accounts[0];
    console.log(`Аккаунт: ${account.name} ${account.id}`);
    accountId = account.id;
    
    console.log('Мониторим инструменты:', Object.keys(INSTRUMENTS));
    
    reconnectDelay = 1000;
    connectStream();
    
    console.log('Бот запущен. Ожидание сделок...');
}

process.on('SIGINT', () => {
    console.log('\nВыключение...');
    isRunning = false;
    process.exit();
});

main().catch(console.error);
