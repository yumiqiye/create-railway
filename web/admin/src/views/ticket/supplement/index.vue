<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="补票管理">
        车站窗口补票：无票与越站补票会扣减余票并分配座位；无座补票按二等座全价、下车补票在所选席别全价基础上加收 2 元手续费，均不分配座位、不扣减余票；丢失车票按挂失补办，沿用原座位并作废原票。越站补票按区段里程自动计算补差票价。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4 proCard">
      <div class="toolbar">
        <n-space>
          <n-input
            v-model:value="keyword"
            placeholder="补票订单号 / 手机号 / 姓名 / 证件号"
            clearable
            style="width: 280px"
            @keyup.enter="loadData"
          />
          <n-button type="primary" ghost @click="loadData">查询</n-button>
          <n-button quaternary @click="resetFilter">重置</n-button>
        </n-space>
        <n-space>
          <n-button type="primary" @click="openForm">
            <template #icon><n-icon><PlusOutlined /></n-icon></template>
            办理补票
          </n-button>
          <n-button quaternary :loading="loading" @click="loadData">刷新</n-button>
        </n-space>
      </div>

      <div v-if="rows.length" class="supplement-list">
        <div v-for="row in rows" :key="row.id" class="supplement-card">
          <div class="sc-head">
            <div>
              <b>{{ row.orderNo }}</b>
              <small>{{ formatTime(row.createdAt) }}</small>
            </div>
            <n-tag type="warning" size="small" :bordered="false">补票</n-tag>
          </div>
          <div class="sc-route">
            <strong>{{ row.trainNo }}</strong>
            <span>{{ row.route?.fromStationName || '-' }} → {{ row.route?.toStationName || '-' }}</span>
          </div>
          <div class="sc-meta">
            {{ row.date }} · {{ row.seatType }} · {{ row.route?.departTime || '-' }} 开
            <n-tag size="small" :bordered="false" type="info">{{ row.supplementReason || '补票' }}</n-tag>
          </div>
          <div class="sc-passenger">
            旅客：{{ (row.passengers || []).map((p) => p.name + (p.seatNo ? '（' + p.seatNo + '）' : '')).join('、') }}
          </div>
          <div class="sc-foot">
            <span>¥{{ row.totalPrice }}</span>
            <span v-if="row.originalOrderNo" class="muted">原订单：{{ row.originalOrderNo }}</span>
          </div>
        </div>
      </div>
      <n-empty v-else description="暂无补票记录" style="padding: 40px 0" />
    </n-card>

    <n-modal v-model:show="showForm" preset="card" title="办理补票" style="width: 680px" :bordered="false">
      <n-form label-placement="left" label-width="112" require-mark-placement="right-hanging">
        <n-grid :cols="2" :x-gap="18">
          <n-form-item-gi label="旅客手机号" required>
            <n-input v-model:value="form.phone" placeholder="已注册前台账号的手机号" />
          </n-form-item-gi>
          <n-form-item-gi label="旅客姓名" required>
            <n-input v-model:value="form.name" placeholder="与证件一致" />
          </n-form-item-gi>
          <n-form-item-gi label="证件类型">
            <n-select v-model:value="form.idType" :options="idTypeOptions" />
          </n-form-item-gi>
          <n-form-item-gi label="证件号码" required>
            <n-input v-model:value="form.idNo" placeholder="身份证号或其他证件号" />
          </n-form-item-gi>
          <n-form-item-gi label="票种">
            <n-select v-model:value="form.type" :options="ticketTypeOptions" />
          </n-form-item-gi>
          <n-form-item-gi label="补票原因" required>
            <n-select v-model:value="form.reason" :options="reasonOptions" @update:value="onReasonChange" />
          </n-form-item-gi>
          <n-form-item-gi label="补票车次" required>
            <n-select
              v-model:value="form.trainId"
              :options="trainOptions"
              filterable
              placeholder="选择车次"
              @update:value="onTrainChange"
            />
          </n-form-item-gi>
          <n-form-item-gi label="乘车日期" required>
            <n-date-picker v-model:value="travelDate" type="date" style="width: 100%" />
          </n-form-item-gi>
          <n-form-item-gi :label="needsSeat ? '补票席别' : isStanding ? '计价席别（固定二等座）' : '计价席别'" required>
            <div style="width: 100%">
              <n-select v-model:value="form.seatType" :options="seatOptions" :disabled="isStanding" placeholder="先选择车次" @update:value="loadQuote" />
              <div v-if="seatHint" style="font-size: 12px; color: #888; margin-top: 4px">{{ seatHint }}</div>
            </div>
          </n-form-item-gi>
          <n-form-item-gi v-if="form.reason === '越站补票'" label="原到站" required>
            <n-select
              v-model:value="form.fromStationId"
              :options="fromStopOptions"
              placeholder="车票原到站"
              @update:value="onFromStationChange"
            />
          </n-form-item-gi>
          <n-form-item-gi v-if="form.reason === '越站补票'" label="越站到站" required>
            <n-select
              v-model:value="form.toStationId"
              :options="toStopOptions"
              placeholder="实际越站到站"
              @update:value="onToStationChange"
            />
          </n-form-item-gi>
          <n-form-item-gi v-if="form.reason === '越站补票'" label="补差票价">
            <n-input
              :value="quoteFare !== null ? '¥' + quoteFare.toFixed(2) : quoteLoading ? '计算中…' : quoteText || '选择站点后自动计算'"
              readonly
            />
          </n-form-item-gi>
          <n-form-item-gi label="原订单号">
            <div style="display: flex; gap: 8px; width: 100%">
              <n-input
                v-model:value="form.originalOrderNo"
                :placeholder="form.reason === '丢失车票补票' ? '挂失补办必填' : '丢失车票 / 越站时可填'"
              />
              <n-button quaternary @click="loadOriginal">载入</n-button>
            </div>
          </n-form-item-gi>
        </n-grid>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showForm = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="submit">确认补票</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
  import { computed, onMounted, reactive, ref } from 'vue';
  import { useMessage } from 'naive-ui';
  import { PlusOutlined } from '@vicons/antd';
  import { createSupplementOrder, getSupplementList, getSupplementOriginal, getSupplementQuote, getTrainList } from '@/api/ticket';
  import type { OrderItem, TrainItem } from '@/api/ticket';

  const message = useMessage();
  const rows = ref<OrderItem[]>([]);
  const trains = ref<TrainItem[]>([]);
  const keyword = ref('');
  const loading = ref(false);
  const saving = ref(false);
  const showForm = ref(false);
  const travelDate = ref<number | null>(Date.now() + 86400000);
  const quoteFare = ref<number | null>(null);
  const quoteText = ref('');
  const quoteLoading = ref(false);

  const form = reactive({
    phone: '',
    name: '',
    idType: '身份证',
    idNo: '',
    type: '成人',
    reason: '无票补票',
    trainId: null as string | null,
    seatType: null as string | null,
    originalOrderNo: '',
    fromStationId: null as string | null,
    toStationId: null as string | null,
  });

  const idTypeOptions = [
    { label: '身份证', value: '身份证' },
    { label: '护照', value: '护照' },
    { label: '港澳通行证', value: '港澳通行证' },
    { label: '其他', value: '其他' },
  ];
  const ticketTypeOptions = [
    { label: '成人票', value: '成人' },
    { label: '儿童票', value: '儿童' },
  ];
  const reasonOptions = [
    { label: '无票补票', value: '无票补票' },
    { label: '无座补票', value: '无座补票' },
    { label: '越站补票', value: '越站补票' },
    { label: '丢失车票补票', value: '丢失车票补票' },
    { label: '下车补票', value: '下车补票' },
    { label: '其他', value: '其他' },
  ];

  const trainOptions = computed(() =>
    trains.value.map((train) => ({
      label: `${train.trainNo} ${train.fromStationName} → ${train.toStationName} ${train.departTime}`,
      value: train.id,
    }))
  );

  const seatOptions = computed(() => {
    const train = trains.value.find((t) => t.id === form.trainId);
    return (train?.seats || []).map((seat) => ({
      label: `${seat.type} ¥${seat.price}（余 ${seat.remaining ?? 0}）`,
      value: seat.type,
      disabled: needsSeat.value && (seat.remaining ?? 0) <= 0,
    }));
  });

  const selectedTrain = computed(() => trains.value.find((t) => t.id === form.trainId));
  const needsSeat = computed(() => !['丢失车票补票', '无座补票', '下车补票'].includes(form.reason));
  const isStanding = computed(() => form.reason === '无座补票');
  const seatHint = computed(() => {
    if (form.reason === '丢失车票补票') return '沿用原票座位，不占新座；固定收取 2 元补办费，原票同时标记为已挂失作废';
    if (form.reason === '无座补票') return '无座票，不分配座位、不扣减余票，统一按二等座全价收费';
    if (form.reason === '下车补票') return '不分配座位、不扣减余票；按所选席别全价收费并加收 2 元手续费，登记为已完成行程';
    return '';
  });
  const stopOptions = computed(() =>
    (selectedTrain.value?.stops || []).map((stop) => ({
      label: `${stop.name}${stop.km ? '（' + stop.km + ' km）' : ''}`,
      value: stop.stationId,
    }))
  );
  const fromStopOptions = computed(() => stopOptions.value.slice(0, -1));
  const toStopOptions = computed(() => {
    const idx = (selectedTrain.value?.stops || []).findIndex((s) => s.stationId === form.fromStationId);
    if (idx < 0) return [];
    return (selectedTrain.value?.stops || []).slice(idx + 1).map((stop) => ({
      label: `${stop.name}${stop.km ? '（' + stop.km + ' km）' : ''}`,
      value: stop.stationId,
    }));
  });

  async function loadQuote() {
    quoteFare.value = null;
    quoteText.value = '';
    if (form.reason !== '越站补票' || !form.trainId || !form.seatType || !form.fromStationId || !form.toStationId) return;
    quoteLoading.value = true;
    try {
      const quote = await getSupplementQuote({
        trainId: form.trainId,
        seatType: form.seatType,
        fromStationId: form.fromStationId,
        toStationId: form.toStationId,
      });
      quoteFare.value = Number(quote.fare);
      quoteText.value = `${quote.from.name} → ${quote.to.name}，${quote.segmentKm} / ${quote.totalKm} km`;
    } catch (e: any) {
      quoteText.value = e.message || '补差票价计算失败';
    } finally {
      quoteLoading.value = false;
    }
  }

  function onReasonChange() {
    quoteFare.value = null;
    quoteText.value = '';
    if (form.reason === '无座补票') {
      const second = selectedTrain.value?.seats?.find((s) => s.type === '二等座');
      form.seatType = second ? second.type : form.seatType;
    }
    if (form.reason !== '越站补票') {
      form.fromStationId = null;
      form.toStationId = null;
    }
  }

  function onFromStationChange() {
    form.toStationId = null;
    loadQuote();
  }

  function onToStationChange() {
    loadQuote();
  }

  async function loadOriginal() {
    if (!form.originalOrderNo.trim()) return message.warning('请先填写原订单号');
    try {
      const original = await getSupplementOriginal(form.originalOrderNo.trim());
      form.phone = original.contactPhone || form.phone;
      form.trainId = original.trainId;
      form.seatType = original.seatType;
      if (original.passengers?.[0]) {
        form.name = original.passengers[0].name;
        form.idType = original.passengers[0].idType || form.idType;
        form.idNo = original.passengers[0].idNo;
        form.type = original.passengers[0].type || form.type;
      }
      if (original.date) travelDate.value = new Date(original.date + 'T00:00:00').getTime();
      message.success('原票信息已载入');
    } catch (e: any) {
      message.error(e.message || '原票载入失败');
    }
  }

  async function loadData() {
    loading.value = true;
    try {
      rows.value = ((await getSupplementList({ keyword: keyword.value.trim() })) as OrderItem[]) || [];
    } catch (e: any) {
      message.error(e.message || '补票记录加载失败');
    } finally {
      loading.value = false;
    }
  }

  function resetFilter() {
    keyword.value = '';
    loadData();
  }

  async function openForm() {
    form.phone = '';
    form.name = '';
    form.idType = '身份证';
    form.idNo = '';
    form.type = '成人';
    form.reason = '无票补票';
    form.trainId = null;
    form.seatType = null;
    form.originalOrderNo = '';
    form.fromStationId = null;
    form.toStationId = null;
    quoteFare.value = null;
    quoteText.value = '';
    travelDate.value = Date.now() + 86400000;
    showForm.value = true;
    if (!trains.value.length) {
      try {
        trains.value = ((await getTrainList()) as TrainItem[]) || [];
      } catch (e: any) {
        message.error(e.message || '车次加载失败');
      }
    }
  }

  function onTrainChange() {
    const train = trains.value.find((t) => t.id === form.trainId);
    form.seatType = train?.seats?.[0]?.type || null;
    form.fromStationId = null;
    form.toStationId = null;
    quoteFare.value = null;
    quoteText.value = '';
  }

  function dateFromTs(ts: number | null) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function formatTime(value?: string) {
    if (!value) return '-';
    return value.replace('T', ' ').slice(0, 19);
  }

  async function submit() {
    if (!/^1[3-9]\d{9}$/.test(form.phone.trim())) return message.error('请输入正确的 11 位手机号');
    if (!form.name.trim()) return message.error('请填写旅客姓名');
    if (!form.idNo.trim()) return message.error('请填写证件号码');
    if (!form.trainId) return message.error('请选择补票车次');
    if (!form.seatType) return message.error('请选择补票席别');
    if (!travelDate.value) return message.error('请选择乘车日期');
    if (form.reason === '丢失车票补票' && !form.originalOrderNo.trim()) return message.error('挂失补办必须填写原订单号');
    if (form.reason === '越站补票' && (!form.fromStationId || !form.toStationId)) {
      return message.error('请选择越站补票的原到站和越站到站');
    }
    saving.value = true;
    try {
      const order = (await createSupplementOrder({
        phone: form.phone.trim(),
        name: form.name.trim(),
        idType: form.idType,
        idNo: form.idNo.trim(),
        type: form.type,
        reason: form.reason,
        trainId: form.trainId,
        date: dateFromTs(travelDate.value),
        seatType: form.seatType,
        originalOrderNo: form.originalOrderNo.trim(),
        fromStationId: form.fromStationId || undefined,
        toStationId: form.toStationId || undefined,
        agent: 'operator',
      })) as OrderItem;
      const seatText = form.reason === '丢失车票补票'
        ? (order.passengers?.[0]?.seatNo ? `沿用原座位 ${order.passengers[0].seatNo}，未占用新座` : '原票无座位信息，未占用新座')
        : form.reason === '无座补票'
          ? '无座，未占用座位'
          : form.reason === '下车补票'
            ? '无座，已登记为已完成行程'
            : `座位 ${order.passengers?.[0]?.seatNo || '已分配'}`;
      message.success(`补票成功：${order.orderNo}，${seatText}`);
      showForm.value = false;
      await loadData();
    } catch (e: any) {
      message.error(e.message || '补票失败');
    } finally {
      saving.value = false;
    }
  }

  onMounted(async () => {
    await loadData();
    try {
      trains.value = ((await getTrainList()) as TrainItem[]) || [];
    } catch (e: any) {
      message.error(e.message || '车次加载失败');
    }
  });
</script>

<style lang="less" scoped>
  :deep(.n-form-item-label) {
    white-space: nowrap;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .supplement-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(330px, 1fr));
    gap: 14px;
  }

  .supplement-card {
    padding: 16px;
    border: 1px solid #e3e8ef;
    border-radius: 10px;
    background: #fff;
  }

  .sc-head,
  .sc-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .sc-head b {
    font-size: 15px;
    color: #1f3a5f;
  }

  .sc-head small {
    display: block;
    margin-top: 3px;
    color: #98a2b3;
    font-size: 12px;
  }

  .sc-route {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 14px 0 6px;
    color: #344054;
  }

  .sc-route strong {
    color: #2367b0;
    font-size: 18px;
  }

  .sc-meta {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    color: #667085;
    font-size: 12px;
  }

  .sc-passenger {
    margin: 10px 0 12px;
    color: #475467;
    font-size: 13px;
  }

  .sc-foot {
    padding-top: 10px;
    border-top: 1px dashed #e4e7ec;
    color: #b54708;
    font-weight: 600;
  }

  .sc-foot .muted {
    color: #98a2b3;
    font-weight: 400;
    font-size: 12px;
  }
</style>
