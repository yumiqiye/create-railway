<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="售票窗口">
        面向车站窗口售票，手机号可不填。出票后立即生成纸质票二维码，可下载二维码图片或直接打印车票。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4 proCard">
      <div class="sales-head">
        <div>
          <strong>窗口售票</strong>
          <span>选择车次和席别，填写旅客信息后直接出票</span>
        </div>
        <n-tag :bordered="false" type="success">现金 / 扫码收款后出票</n-tag>
      </div>

      <n-form label-placement="left" label-width="92">
        <n-grid :cols="3" :x-gap="18">
          <n-form-item-gi label="车次" required>
            <n-select
              v-model:value="form.trainId"
              :options="trainOptions"
              filterable
              placeholder="选择车次"
              @update:value="onTrainChange"
            />
          </n-form-item-gi>
          <n-form-item-gi label="乘车日期" required>
            <n-date-picker v-model:value="travelDate" type="date" style="width: 100%" @update:value="onDateChange" />
          </n-form-item-gi>
          <n-form-item-gi label="席别" required>
            <n-select v-model:value="form.seatType" :options="seatOptions" placeholder="先选择车次" />
          </n-form-item-gi>
          <n-form-item-gi :span="2" label="联系电话">
            <n-input v-model:value="form.contactPhone" placeholder="可不填，窗口售票不强制手机号" maxlength="11" />
          </n-form-item-gi>
          <n-form-item-gi label="当前余票">
            <div class="remain-text">
              <span v-if="selectedSeat">{{ selectedSeat.remaining ?? 0 }} 张</span>
              <span v-else>选择车次后显示</span>
            </div>
          </n-form-item-gi>
        </n-grid>
      </n-form>

      <div class="passenger-head">
        <div>
          <strong>旅客信息</strong>
          <span>最多 20 人，同一订单证件号不能重复</span>
        </div>
        <n-button dashed @click="addPassenger" :disabled="form.passengers.length >= 20">+ 添加旅客</n-button>
      </div>

      <div class="passenger-table">
        <div class="passenger-row passenger-title">
          <span>姓名</span>
          <span>证件类型</span>
          <span>证件号码</span>
          <span>票种</span>
          <span></span>
        </div>
        <div v-for="(p, index) in form.passengers" :key="index" class="passenger-row">
          <n-input v-model:value="p.name" placeholder="旅客姓名" maxlength="20" />
          <n-select v-model:value="p.idType" :options="idTypeOptions" />
          <n-input v-model:value="p.idNo" placeholder="证件号码" maxlength="20" />
          <n-select v-model:value="p.type" :options="passengerTypeOptions" />
          <n-button quaternary type="error" :disabled="form.passengers.length <= 1" @click="removePassenger(index)">
            删除
          </n-button>
        </div>
      </div>

      <div class="sales-foot">
        <div class="total">
          <span>应收金额</span>
          <b>¥{{ totalPrice.toFixed(2) }}</b>
        </div>
        <n-space>
          <n-button quaternary @click="resetForm">清空</n-button>
          <n-button type="primary" size="large" :loading="saving" @click="submit">确认收款并出票</n-button>
        </n-space>
      </div>
    </n-card>

    <n-card :bordered="false" class="mt-4 proCard" title="最近窗口出票">
      <div v-if="recentOrders.length" class="recent-list">
        <div v-for="row in recentOrders" :key="row.id" class="recent-row">
          <div class="recent-main">
            <b>{{ row.orderNo }}</b>
            <span>{{ row.trainNo }} · {{ row.date }} · {{ row.seatType }}</span>
            <span class="muted">{{ (row.passengers || []).map((p) => p.name + (p.seatNo ? '（' + p.seatNo + '）' : '')).join('、') }}</span>
          </div>
          <div class="recent-side">
            <b>¥{{ row.totalPrice }}</b>
            <n-space>
              <n-button text type="primary" @click="showTicket(row)">查看车票</n-button>
              <n-button text @click="downloadQr(row)">下载二维码</n-button>
            </n-space>
          </div>
        </div>
      </div>
      <n-empty v-else description="还没有窗口出票记录" style="padding: 28px 0" />
    </n-card>

    <n-modal v-model:show="ticketVisible" preset="card" title="出票成功" style="width: 680px" :bordered="false">
      <template v-if="ticket">
        <div class="ticket-preview">
          <div class="ticket-info">
            <div class="ticket-head">
              <span>清江铁路12306</span>
              <n-tag size="small" :bordered="false" type="success">已出票</n-tag>
            </div>
            <div class="ticket-no">{{ ticket.orderNo }}</div>
            <div class="ticket-route">
              <div>
                <b>{{ ticket.route?.fromStationName || '-' }}</b>
                <span>{{ ticket.route?.departTime || '-' }} 开</span>
              </div>
              <span class="arrow">→</span>
              <div>
                <b>{{ ticket.route?.toStationName || '-' }}</b>
                <span>{{ ticket.route?.arriveTime || '-' }} 到</span>
              </div>
            </div>
            <div class="ticket-meta">
              <span>{{ ticket.trainNo }}</span>
              <span>{{ ticket.date }}</span>
              <span>{{ ticket.seatType }}</span>
              <span>{{ ticket.route?.gate || '-' }} 检票口</span>
            </div>
            <div class="ticket-passengers">
              <div v-for="p in ticket.passengers" :key="p.idNo">
                <b>{{ p.name }}</b>
                <span>{{ p.idType }} {{ p.idNo }}</span>
                <strong>{{ p.seatNo || '无座' }}</strong>
              </div>
            </div>
            <div class="ticket-price">合计 ¥{{ ticket.totalPrice }}</div>
          </div>
          <div class="ticket-qr">
            <img :src="qrUrl(ticket)" alt="车票二维码" />
            <span>纸质票二维码</span>
          </div>
        </div>
        <n-alert type="info" :bordered="false" style="margin-top: 14px">
          此二维码为纸质票专用静态码，可直接打印在车票上；请旅客凭二维码或有效身份证件检票。
        </n-alert>
      </template>
      <template #footer>
        <n-space justify="space-between">
          <n-button quaternary @click="ticketVisible = false">关闭</n-button>
          <n-space>
            <n-button @click="downloadQr(ticket)">下载二维码</n-button>
            <n-button type="primary" @click="printTicket(ticket)">打印车票</n-button>
          </n-space>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue';
  import { useMessage } from 'naive-ui';
  import { createCounterSale, getOrderList, getTrainList, logTicketPrint, type OrderItem, type TrainItem } from '@/api/ticket';

  const message = useMessage();
  const trains = ref<TrainItem[]>([]);
  const recentOrders = ref<OrderItem[]>([]);
  const saving = ref(false);
  const ticketVisible = ref(false);
  const ticket = ref<OrderItem | null>(null);
  const travelDate = ref<number | null>(Date.now() + 86400000);

  const form = reactive({
    trainId: null as string | null,
    seatType: null as string | null,
    contactPhone: '',
    passengers: [{ name: '', idType: '身份证', idNo: '', type: '成人' }],
  });

  const idTypeOptions = ['身份证', '护照', '港澳通行证', '其他'].map((t) => ({ label: t, value: t }));
  const passengerTypeOptions = [
    { label: '成人票', value: '成人' },
    { label: '儿童票（半价）', value: '儿童' },
  ];

  const trainOptions = computed(() =>
    trains.value.map((t) => ({
      label: `${t.trainNo}　${t.fromStationName} → ${t.toStationName}　${t.departTime} 开`,
      value: t.id,
    }))
  );
  const selectedTrain = computed(() => trains.value.find((t) => t.id === form.trainId));
  const seatOptions = computed(() =>
    (selectedTrain.value?.seats || []).map((seat) => ({
      label: `${seat.type}　¥${seat.price}　余 ${seat.remaining ?? 0}`,
      value: seat.type,
      disabled: (seat.remaining ?? 0) <= 0,
    }))
  );
  const selectedSeat = computed(() => selectedTrain.value?.seats?.find((s) => s.type === form.seatType));
  const totalPrice = computed(() => {
    const price = Number(selectedSeat.value?.price || 0);
    return form.passengers.reduce((sum, p) => sum + (p.type === '儿童' ? price * 0.5 : price), 0);
  });

  function dateFromTs(ts: number | null) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  async function loadTrains() {
    try {
      trains.value = ((await getTrainList({ date: dateFromTs(travelDate.value) })) as TrainItem[]) || [];
    } catch (e: any) {
      message.error(e.message || '车次加载失败');
    }
  }

  async function loadRecent() {
    try {
      const rows = (await getOrderList()) as OrderItem[];
      recentOrders.value = (rows || []).filter((o) => o.source === 'counter').slice(0, 8);
    } catch {
      recentOrders.value = [];
    }
  }

  function onDateChange() {
    form.trainId = null;
    form.seatType = null;
    loadTrains();
  }

  function onTrainChange() {
    form.seatType = selectedTrain.value?.seats?.find((s) => (s.remaining ?? 0) > 0)?.type || null;
  }

  function addPassenger() {
    form.passengers.push({ name: '', idType: '身份证', idNo: '', type: '成人' });
  }

  function removePassenger(index: number) {
    form.passengers.splice(index, 1);
  }

  function resetForm() {
    form.trainId = null;
    form.seatType = null;
    form.contactPhone = '';
    form.passengers = [{ name: '', idType: '身份证', idNo: '', type: '成人' }];
    travelDate.value = Date.now() + 86400000;
  }

  async function submit() {
    if (!form.trainId) return message.error('请选择车次');
    if (!form.seatType) return message.error('请选择席别');
    if (!travelDate.value) return message.error('请选择乘车日期');
    if (form.contactPhone.trim() && !/^1[3-9]\d{9}$/.test(form.contactPhone.trim())) {
      return message.error('联系电话格式不正确，可留空');
    }
    if (!form.passengers.length) return message.error('请至少填写一位旅客');
    for (const p of form.passengers) {
      if (!p.name.trim()) return message.error('请填写旅客姓名');
      if (!p.idNo.trim()) return message.error('请填写旅客证件号码');
    }
    saving.value = true;
    try {
      const order = (await createCounterSale({
        trainId: form.trainId,
        date: dateFromTs(travelDate.value),
        seatType: form.seatType,
        contactPhone: form.contactPhone.trim() || undefined,
        agent: '售票窗口',
        passengers: form.passengers.map((p) => ({
          name: p.name.trim(),
          idType: p.idType,
          idNo: p.idNo.trim(),
          phone: '',
          type: p.type,
        })),
      })) as OrderItem;
      ticket.value = order;
      ticketVisible.value = true;
      message.success('出票成功');
      await loadRecent();
      form.passengers = [{ name: '', idType: '身份证', idNo: '', type: '成人' }];
    } catch (e: any) {
      message.error(e.message || '出票失败');
    } finally {
      saving.value = false;
    }
  }

  function showTicket(row: OrderItem) {
    ticket.value = row;
    ticketVisible.value = true;
  }

  function qrUrl(row: OrderItem | null) {
    if (!row) return '';
    return `/api/qrcode/ticket?orderNo=${encodeURIComponent(row.orderNo)}&mode=paper`;
  }

  async function downloadQr(row: OrderItem | null) {
    if (!row) return;
    try {
      const res = await fetch(qrUrl(row));
      if (!res.ok) throw new Error('二维码下载失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${row.orderNo}-纸质票二维码.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      message.error(e.message || '二维码下载失败');
    }
  }

  function escapeHtml(value: unknown) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function printTicket(row: OrderItem | null) {
    if (!row) return;
    const qr = window.location.origin + qrUrl(row);
    const passengers = (row.passengers || [])
      .map(
        (p) =>
          `<tr><td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.idType)} ${escapeHtml(p.idNo)}</td><td>${escapeHtml(
            p.seatNo || '无座'
          )}</td></tr>`
      )
      .join('');
    const win = window.open('', '_blank', 'width=560,height=760');
    if (!win) {
      message.error('打印窗口被浏览器拦截，请允许弹窗后重试');
      return;
    }
    win.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(
      row.orderNo
    )}</title><style>
      @page { size: 80mm auto; margin: 5mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #111; font-family: "Microsoft YaHei", "SimSun", Arial, sans-serif; }
      .ticket { border: 1px dashed #333; padding: 10px; }
      h1 { margin: 0 0 4px; font-size: 18px; text-align: center; letter-spacing: 2px; }
      .sub { margin: 0 0 10px; font-size: 11px; text-align: center; color: #666; }
      .no { padding: 6px 0; border-top: 1px solid #999; border-bottom: 1px solid #999; font-size: 12px; }
      .route { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 10px 0; }
      .route b { display: block; font-size: 17px; }
      .route span { font-size: 11px; color: #555; }
      .meta { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11px; padding-bottom: 8px; }
      .meta span { padding: 2px 5px; background: #f1f1f1; border-radius: 2px; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      th, td { padding: 4px 0; border-top: 1px dashed #bbb; text-align: left; }
      th { color: #666; font-weight: normal; }
      .qr { margin-top: 10px; text-align: center; }
      .qr img { width: 150px; height: 150px; }
      .tip { margin-top: 6px; font-size: 10px; text-align: center; color: #666; line-height: 1.5; }
      .total { margin-top: 8px; font-size: 12px; text-align: right; }
    </style></head><body>
      <div class="ticket">
        <h1>清江铁路12306 电子客票</h1>
        <p class="sub">车站窗口纸质票 · 凭二维码或有效身份证件乘车</p>
        <div class="no">订单号：${escapeHtml(row.orderNo)}</div>
        <div class="route">
          <div><b>${escapeHtml(row.route?.fromStationName || '-')}</b><span>${escapeHtml(
      row.route?.departTime || '-'
    )} 开</span></div>
          <span>→</span>
          <div><b>${escapeHtml(row.route?.toStationName || '-')}</b><span>${escapeHtml(
      row.route?.arriveTime || '-'
    )} 到</span></div>
        </div>
        <div class="meta">
          <span>${escapeHtml(row.trainNo)}</span><span>${escapeHtml(row.date)}</span><span>${escapeHtml(
      row.seatType
    )}</span><span>${escapeHtml(row.route?.gate || '-')} 检票口</span><span>${escapeHtml(
      row.route?.platform || '-'
    )} 站台</span>
        </div>
        <table><thead><tr><th>姓名</th><th>证件</th><th>座位</th></tr></thead><tbody>${passengers}</tbody></table>
        <div class="total">合计 ¥${escapeHtml(row.totalPrice)}</div>
        <div class="qr"><img src="${qr}" alt="车票二维码" /></div>
        <div class="tip">请妥善保管车票，按票面车次、日期和席别乘车。<br/>二维码为纸质票专用码，可在检票闸机扫码使用。</div>
      </div>
    </body></html>`);
    win.document.close();
    logTicketPrint(row.orderNo).catch(() => {});
    setTimeout(() => {
      win.focus();
      win.print();
    }, 600);
  }

  onMounted(async () => {
    await loadTrains();
    await loadRecent();
  });
</script>

<style scoped>
  .sales-head,
  .passenger-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }

  .sales-head strong,
  .passenger-head strong {
    font-size: 15px;
  }

  .sales-head span,
  .passenger-head span {
    margin-left: 8px;
    color: #888;
    font-size: 12px;
  }

  .remain-text {
    color: #555;
  }

  .passenger-table {
    overflow-x: auto;
  }

  .passenger-row {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1.8fr 1fr 64px;
    gap: 10px;
    align-items: center;
    padding: 6px 0;
  }

  .passenger-title {
    color: #888;
    font-size: 12px;
    padding-top: 0;
  }

  .sales-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid #eee;
  }

  .total {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .total b {
    color: #d03050;
    font-size: 24px;
  }

  .recent-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 10px 0;
    border-bottom: 1px solid #f0f0f0;
  }

  .recent-main {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .recent-main b {
    font-size: 13px;
  }

  .recent-side {
    display: flex;
    align-items: center;
    gap: 14px;
    white-space: nowrap;
  }

  .ticket-preview {
    display: flex;
    align-items: stretch;
    gap: 18px;
    padding: 16px;
    border: 1px dashed #999;
    border-radius: 8px;
    background: #fafafa;
  }

  .ticket-info {
    flex: 1;
    min-width: 0;
  }

  .ticket-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 15px;
    font-weight: 600;
  }

  .ticket-no {
    margin: 8px 0 12px;
    padding: 6px 0;
    border-top: 1px solid #ddd;
    border-bottom: 1px solid #ddd;
    color: #555;
    font-size: 12px;
  }

  .ticket-route {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .ticket-route div {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ticket-route b {
    font-size: 20px;
  }

  .ticket-route span {
    color: #777;
    font-size: 12px;
  }

  .arrow {
    color: #999 !important;
    font-size: 20px !important;
  }

  .ticket-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 10px;
  }

  .ticket-meta span {
    padding: 2px 6px;
    border-radius: 3px;
    background: #eee;
    font-size: 12px;
  }

  .ticket-passengers {
    border-top: 1px dashed #ccc;
  }

  .ticket-passengers > div {
    display: grid;
    grid-template-columns: 1fr 1.6fr auto;
    gap: 8px;
    padding: 7px 0;
    border-bottom: 1px dashed #eee;
    font-size: 12px;
  }

  .ticket-passengers span {
    color: #777;
  }

  .ticket-price {
    margin-top: 10px;
    text-align: right;
    font-size: 14px;
  }

  .ticket-qr {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 190px;
    flex: 0 0 auto;
  }

  .ticket-qr img {
    width: 170px;
    height: 170px;
  }

  .ticket-qr span {
    color: #888;
    font-size: 12px;
  }

  @media (max-width: 720px) {
    .passenger-row {
      grid-template-columns: 1fr;
    }

    .ticket-preview {
      flex-direction: column;
    }

    .ticket-qr {
      width: 100%;
    }
  }
</style>
