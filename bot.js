import { TinkoffInvestApi } from 'tinkoff-invest-api';

const TOKEN = 't.KNbRWnr_MoKUOuBfzvjyUTUYftgAdZhpZ4zBqfwkgYtd4wnOaYuHCJHAeRXounciZ3N4NSQGPtH-8v5Mw0f_fQ';

const INSTRUMENTS = {

'FUTSILVM0926': 0.2, // S1U6 серебро мини сентябрь
'FSMLT0926000': 1, //SSU6
'FWUSH0926000': 1, //WUU6
//'FUTNGM072600': 0.010,  // NRN6
//'FUTNGM082600': 0.010,  // NRQ6
'FUTNGM052600': 0.012,  // NRK6
    'FUTNGM062600': 0.012,  // NRM6
    'FUTNG0626000': 0.030,   // NGM6
    'FUTNG0426000': 0.007,  // NGJ6
    'FUTNG0526000': 0.012,  // NGK6
    'FUTSILVM0626': 1,       // S1M6
    'FUTBRM072600': 1,   // BMN6
    'FTTF05260000': 0.5,   //FFK6
};
// переход в раздел с ботом   -   ~# cd ~/tinkoff-bot
// остановка работающего pkill -f "node bot.js"
//запуск -     nohup node bot.js > bot.log 2>&1 &
// проверка работы -   ps aux | grep node

//теперь так
//systemctl status tinkoff-bot      # статус
//tail -f ~/tinkoff-bot/bot.log     # логи в реальном времени
//systemctl restart tinkoff-bot     # перезапуск
//systemctl stop tinkoff-bot        # остановка

//Так ищем фиги
//cd ~/tinkoff-bot && git pull
//  node find_figi.js NRM6


const api = new TinkoffInvestApi({ token: TOKEN });
let accountId = null;
let reconnectDelay = 1000;
let isRunning = true;
let isConnecting = false;
let lastActivity = Date.now();
const processedTrades = new Set();

function isAfterHours() {
    const now = new Date();
    const mskHour = (now.getUTCHours() + 3) % 24;
    const mskMin = now.getUTCMinutes();
    return mskHour < 7 || (mskHour === 7 && mskMin < 1);
}

async function getActiveOrders(figi) {
    try {
        const res = await api.orders.getOrders({ accountId });
        return (res.orders || []).filter(o => o.figi === figi);
    } catch (e) {
        console.log(`  => Ошибка getOrders: ${e.message}`);
        return [];
    }
}

function countActiveOffset1(orders, figi, price) {
    let lots = 0;
    for (const o of orders) {
        if (o.orderId?.startsWith('1_')) {
            const p = Number(o.price.units) + Number(o.price.nano) / 1000000000;
            if (Math.abs(p - price) < 0.0005) {
                lots += Number(o.quantity);
            }
        }
    }
    return lots;
}

async function processTrade(order, figi) {
    const priceDelta = INSTRUMENTS[figi];
    console.log(`\n=== СДЕЛКА === ${figi} direction: ${order.direction}`);
    
    if (isAfterHours()) {
        const now = new Date();
        const h = (now.getUTCHours() + 3) % 24;
        const m = String(now.getUTCMinutes()).padStart(2, '0');
        console.log(`  => Пропущен: до 07:01 МСК (сейчас ${h}:${m})`);
        return;
    }
    
    const activeOrders = await getActiveOrders(figi);
    let active1LotsGlobal = 0;
    
    for (const trade of order.trades) {
        const tradeId = trade.tradeId || trade.trade_id;
        if (!tradeId) {
            console.log(`  => Нет tradeId, пропускаем`);
            continue;
        }
        if (processedTrades.has(tradeId)) {
            console.log(`  => Трейд ${tradeId} уже обработан, пропускаем`);
            continue;
        }
        processedTrades.add(tradeId);
        
        if (processedTrades.size > 1000) {
            processedTrades.clear();
        }
        
        const price = Number(trade.price.units) + Number(trade.price.nano) / 1000000000;
        console.log(`  Цена: ${price} Кол-во: ${trade.quantity}`);
        
        const isBuy = order.direction === 1;
        const counterDirection = isBuy ? 2 : 1;
        const basePrice = isBuy ? price + priceDelta : price - priceDelta;
        const roundedBase = Math.round(basePrice * 1000) / 1000;
        
        let active1Lots = countActiveOffset1(activeOrders, figi, roundedBase) + active1LotsGlobal;
        const needed1 = Math.max(0, 10 - active1Lots);
        const place1 = Math.min(Number(trade.quantity), needed1);
        const placeWide = Number(trade.quantity) - place1;
        active1LotsGlobal += place1;
        
        console.log(`  => offset1 всего/нужно/ставим: ${active1Lots}/${needed1}/${place1}, wide: ${placeWide}`);
        
        if (place1 > 0) {
            const oid = `1_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            try {
                const r = await api.orders.postOrder({
                    accountId, figi, instrumentId: figi,
                    quantity: place1,
                    price: api.helpers.toQuotation(roundedBase),
                    direction: counterDirection,
                    orderType: 1, timeInForce: 1, priceType: 1, orderId: oid,
                });
                console.log(`  => offset1 ${place1} @ ${roundedBase}: ${r.orderId}`);
            } catch (e) {
                console.log(`  => Ошибка offset1: ${e.message}`);
            }
        }
        
        if (placeWide > 0) {
            const each = Math.floor(placeWide / 10);
            const extra = placeWide % 10;
            for (let i = 0; i < 10; i++) {
                const lots = each + (i < extra ? 1 : 0);
                if (lots === 0) continue;
                const offsetStep = 2 + i;
                const widePrice = isBuy
                    ? price + priceDelta + offsetStep
                    : price - priceDelta - offsetStep;
                const roundedWide = Math.round(widePrice * 1000) / 1000;
                const oid = `w${offsetStep}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
                try {
                    const r = await api.orders.postOrder({
                        accountId, figi, instrumentId: figi,
                        quantity: lots,
                        price: api.helpers.toQuotation(roundedWide),
                        direction: counterDirection,
                        orderType: 1, timeInForce: 1, priceType: 1, orderId: oid,
                    });
                    console.log(`  => w${offsetStep} ${lots} @ ${roundedWide}: ${r.orderId}`);
                } catch (e) {
                    console.log(`  => Ошибка w${offsetStep}: ${e.message}`);
                }
            }
        }
    }
}

function scheduleReconnect() {
    if (!isRunning) return;
    
    isConnecting = false;
    
    console.log(`[${new Date().toISOString()}] Переподключение через ${reconnectDelay}ms...`);
    
    setTimeout(() => {
        reconnectDelay = 1000;
        connectStream();
    }, reconnectDelay);
    
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

async function connectStream() {
    if (!isRunning || isConnecting) return;
    isConnecting = true;
    
    console.log(`[${new Date().toISOString()}] Подключение к потоку...`);
    
    try {
        const stream = api.ordersStream.tradesStream({ accounts: [accountId] });
        
        (async () => {
            try {
                for await (const data of stream) {
                    lastActivity = Date.now();
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
                const msg = err.message || '';
                if (msg.includes('RESOURCE_EXHAUSTED')) {
                    console.log(`[${new Date().toISOString()}] Лимит стримов, перезапуск...`);
                    isRunning = false;
                    process.exit(1);
                }
                console.log(`[${new Date().toISOString()}] Поток прерван: ${msg}`);
            } finally {
                isConnecting = false;
                scheduleReconnect();
            }
        })();
        
    } catch (err) {
        console.log(`[${new Date().toISOString()}] Ошибка подключения: ${err.message}`);
        isConnecting = false;
        scheduleReconnect();
    } finally {
        isConnecting = false;
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
    
    setInterval(() => {
        if (!isRunning) return;
        if (Date.now() - lastActivity > 240000) {
            console.log(`[${new Date().toISOString()}] Watchdog: нет данных 4 мин, перезапуск...`);
            isRunning = false;
            process.exit(1);
        }
    }, 60000);
    
    console.log('Бот запущен. Ожидание сделок...');
}

process.on('SIGINT', () => {
    console.log('\nВыключение...');
    isRunning = false;
    process.exit();
});

main().catch(console.error);
