import { TinkoffInvestApi } from 'tinkoff-invest-api';

const TOKEN = 't.KNbRWnr_MoKUOuBfzvjyUTUYftgAdZhpZ4zBqfwkgYtd4wnOaYuHCJHAeRXounciZ3N4NSQGPtH-8v5Mw0f_fQ';

// Конфигурация инструментов: FIGI -> дельта цены
const INSTRUMENTS = {
    'FUTNGM032600': 0.010,  // NRH6
    'FUTNG0326000': 0.030,   // NGH6
    'FUTNG0426000': 0.030,  // NGJ6
    'FUTNGM042600': 0.030,  // NRJ6
    'FUTSILVM0626': 1,       // S1M6 (шаг = 1)
};

const api = new TinkoffInvestApi({ token: TOKEN });
let accountId = null;
let reconnectDelay = 1000;
let isRunning = true;
let reconnectTimeout = null;
let isReconnecting = false;
let lastTradeTime = Date.now();
let healthCheckInterval = null;

async function processTrade(order, figi) {
    const priceDelta = INSTRUMENTS[figi];
    console.log('\n=== СДЕЛКА ===', figi, 'direction:', order.direction);
    lastTradeTime = Date.now();
    
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

function startHealthCheck() {
    // Проверяем каждые 60 секунд
    healthCheckInterval = setInterval(() => {
        const idleTime = Date.now() - lastTradeTime;
        if (idleTime > 120000) { // 2 минуты без сделок
            console.log(`[${new Date().toISOString()}] Нет активности ${Math.round(idleTime/1000)}s - переподключение...`);
            isReconnecting = false;
            reconnectDelay = 1000;
            scheduleReconnect();
        }
    }, 60000);
}

function scheduleReconnect() {
    if (!isRunning || isReconnecting) return;
    
    isReconnecting = true;
    console.log(`Переподключение через ${reconnectDelay}ms...`);
    
    reconnectTimeout = setTimeout(() => {
        isReconnecting = false;
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
                    if (data.orderTrades) {
                        const order = data.orderTrades;
                        const figi = order.figi;
                        
                        if (INSTRUMENTS.hasOwnProperty(figi)) {
                            await processTrade(order, figi);
                        }
                    }
                }
            } catch (err) {
                console.log('Поток прерван:', err.message);
            }
            
            scheduleReconnect();
        })();
        
    } catch (err) {
        console.log('Ошибка подключения:', err.message);
        scheduleReconnect();
    }
}

async function main() {
    console.log('Подключение к Tinkoff API...');
    
    const { accounts } = await api.users.getAccounts({});
    const account = accounts[0];
    console.log('Аккаунт:', account.name, account.id);
    accountId = account.id;
    
    console.log('Мониторим инструменты:', Object.keys(INSTRUMENTS));
    
    reconnectDelay = 1000;
    lastTradeTime = Date.now();
    connectStream();
    startHealthCheck();
    
    console.log('Бот запущен. Ожидание сделок...');
}

process.on('SIGINT', () => {
    console.log('\nВыключение...');
    isRunning = false;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    if (healthCheckInterval) clearInterval(healthCheckInterval);
    process.exit();
});

process.on('uncaughtException', (err) => {
    console.log('Ошибка:', err.message);
});

main().catch(console.error);
