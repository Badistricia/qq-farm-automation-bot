const fs = require('node:fs');
const path = require('node:path');
const { getFruitPrice, getPlantByFruitId } = require('../config/gameConfig');
const { readJsonFile, writeJsonFileAtomic } = require('./json-db');

function getAssetFilePath(accountId) {
    const { getDataDir } = require('../config/runtime-paths');
    const safeId = String(accountId || '').replace(/[^\w-]/g, '_');
    return path.join(getDataDir(), 'assets', `${safeId}.json`);
}

function recordAssetSnapshot(accountId, gold, bagItems, reason = '定时记录') {
    if (!accountId) return null;

    try {
        // 计算果实总值
        let fruitValue = 0;
        if (Array.isArray(bagItems)) {
            for (const item of bagItems) {
                const id = Number(item && item.id) || 0;
                const count = Number(item && item.count) || 0;
                if (id > 0 && count > 0 && getPlantByFruitId(id)) {
                    const price = getFruitPrice(id) || 0;
                    fruitValue += count * price;
                }
            }
        }

        const totalAssets = gold + fruitValue;
        const filePath = getAssetFilePath(accountId);

        // 读取历史记录
        const history = readJsonFile(filePath, () => []);

        // 计算历史总赚取
        let historicalEarned = totalAssets;
        if (history.length > 0) {
            const lastEntry = history[history.length - 1];
            const delta = totalAssets - lastEntry.totalAssets;
            if (delta > 0) {
                historicalEarned = lastEntry.historicalEarned + delta;
            } else {
                historicalEarned = lastEntry.historicalEarned;
            }
        }

        // 构建新的快照记录
        const newEntry = {
            timestamp: Date.now(),
            gold,
            fruitValue,
            totalAssets,
            historicalEarned,
            reason,
        };

        // 如果资产和历史赚取完全没有变化，并且上一条的 reason 也是“定时记录”，可以考虑只更新时间戳，减少文件写入和数据冗余
        // 但如果 reason 是特殊的（如“升级土地”、“收获作物”），即使数值没变我们也记一条以保留事件点
        if (history.length > 0) {
            const lastEntry = history[history.length - 1];
            const sameStats = lastEntry.gold === gold &&
                              lastEntry.fruitValue === fruitValue &&
                              lastEntry.totalAssets === totalAssets &&
                              lastEntry.historicalEarned === historicalEarned;
            if (sameStats && reason === '定时记录' && lastEntry.reason === '定时记录') {
                // 仅更新最后一条的时间戳，避免记录无限膨胀
                lastEntry.timestamp = newEntry.timestamp;
            } else {
                history.push(newEntry);
            }
        } else {
            history.push(newEntry);
        }

        // 限制最大长度为 50000 条
        if (history.length > 50000) {
            history.shift();
        }

        writeJsonFileAtomic(filePath, history);
        return newEntry;
    } catch (e) {
        console.error('[资产服务] 记录资产快照失败:', e.message);
        return null;
    }
}

function generateMockHistory() {
    const history = [];
    const now = Date.now();
    const twoHours = 2 * 60 * 60 * 1000;
    const pointsCount = 60; // 5 days of data

    let gold = 30000;
    let fruitValue = 10000;
    let totalAssets = gold + fruitValue;
    let historicalEarned = totalAssets;

    for (let i = pointsCount - 1; i >= 0; i--) {
        const timestamp = now - i * twoHours;
        
        // 增减模拟
        const earnGold = Math.floor(Math.random() * 6000) + 2000;
        const earnFruits = Math.floor(Math.random() * 4000) + 1000;
        
        gold += earnGold;
        fruitValue += earnFruits;
        
        let reason = '定时记录';
        const rand = Math.random();
        
        if (rand < 0.15) {
            reason = '收获作物';
            fruitValue += 10000;
        } else if (rand < 0.3) {
            reason = '出售果实';
            gold += fruitValue;
            fruitValue = 0;
        } else if (rand < 0.38 && gold > 120000) {
            reason = '升级土地';
            const cost = Math.floor(gold * 0.9); // 90%
            gold -= cost;
        } else if (rand < 0.48) {
            reason = '购买商品';
            gold -= Math.floor(Math.random() * 4000) + 1000;
        }

        if (gold < 5000) gold = 5000;
        totalAssets = gold + fruitValue;

        if (history.length > 0) {
            const prev = history[history.length - 1];
            const delta = totalAssets - prev.totalAssets;
            if (delta > 0) {
                historicalEarned = prev.historicalEarned + delta;
            } else {
                historicalEarned = prev.historicalEarned;
            }
        } else {
            historicalEarned = totalAssets;
        }

        history.push({
            timestamp,
            gold,
            fruitValue,
            totalAssets,
            historicalEarned,
            reason,
        });
    }

    return history;
}

function getAssetHistory(accountId) {
    if (!accountId) return [];
    const filePath = getAssetFilePath(accountId);
    const history = readJsonFile(filePath, () => []);
    if (history.length === 0) {
        const mock = generateMockHistory();
        writeJsonFileAtomic(filePath, mock);
        return mock;
    }
    return history;
}

function clearAssetHistory(accountId) {
    if (!accountId) return { ok: false };
    try {
        const filePath = getAssetFilePath(accountId);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

module.exports = {
    recordAssetSnapshot,
    getAssetHistory,
    clearAssetHistory,
};
