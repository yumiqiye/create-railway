/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
/** 清空全部业务数据：node reset.js */
const { resetDB, DB_PATH } = require('./db');

resetDB();
console.log('已清空数据（城市/车站/车次/订单均为空）：' + DB_PATH);
