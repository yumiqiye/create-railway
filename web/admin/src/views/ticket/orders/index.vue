<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="订单管理">
        查看前台产生的购票订单，可按订单号、手机号、乘客姓名检索。支持退票与取消订单，删除仅清理记录。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4 proCard">
      <div class="toolbar">
        <n-space>
          <n-input
            v-model:value="keyword"
            placeholder="订单号 / 手机号 / 乘客姓名"
            clearable
            style="width: 260px"
            @keyup.enter="loadData"
          />
          <n-select v-model:value="status" :options="statusOptions" placeholder="订单状态" clearable style="width: 150px" />
          <n-button type="primary" ghost @click="loadData">查询</n-button>
          <n-button quaternary @click="resetFilter">重置</n-button>
        </n-space>
        <n-space>
          <n-button quaternary :loading="loading" @click="loadData">刷新</n-button>
        </n-space>
      </div>

      <div v-if="orders.length" class="order-list">
        <div v-for="row in orders" :key="row.id" class="order-card">
          <div class="oc-head">
            <div class="oc-no">
              <span>{{ row.orderNo }}</span>
              <small>{{ formatTime(row.createdAt) }}</small>
            </div>
            <n-space align="center" :size="6">
              <n-tag :type="statusType(row.status)" size="small" :bordered="false">{{ statusText(row.status) }}</n-tag>
              <n-tag v-if="row.lostReported || row.voided" type="error" size="small" :bordered="false">已挂失作废</n-tag>
            </n-space>
          </div>
          <div class="oc-route">
            <b>{{ row.trainNo }}</b>
            <span>{{ row.route?.fromStationName || '-' }} → {{ row.route?.toStationName || '-' }}</span>
          </div>
          <div class="oc-meta">{{ row.date }} · {{ row.seatType }} · {{ row.route?.departTime || '-' }} 开</div>
          <div class="oc-passengers">
            乘客：{{ (row.passengers || []).map((p) => p.name).join('、') }}（{{ (row.passengers || []).length }} 人）
          </div>
          <div class="oc-foot">
            <span class="oc-amount">¥{{ row.totalPrice }}</span>
            <div class="oc-actions">
              <n-button text type="primary" @click="openDetail(row)">详情</n-button>
              <n-button v-if="canManageOrders && row.status === 'paid'" text type="warning" @click="changeStatus(row, 'refunded')">退票</n-button>
              <n-button v-if="canDeleteOrders" text type="error" @click="confirmDelete(row)">删除</n-button>
            </div>
          </div>
        </div>
      </div>
      <n-empty v-else description="暂无订单" style="padding: 40px 0" />
    </n-card>

    <n-modal v-model:show="showDetail" preset="card" title="订单详情" style="width: 640px" :bordered="false">
      <template v-if="current">
        <n-descriptions :column="2" bordered size="small" label-placement="left">
          <n-descriptions-item label="订单号">{{ current.orderNo }}</n-descriptions-item>
          <n-descriptions-item label="订单状态">
            <n-tag :type="statusType(current.status)" size="small" :bordered="false">
              {{ statusText(current.status) }}
            </n-tag>
          </n-descriptions-item>
          <n-descriptions-item label="车次">{{ current.trainNo }}</n-descriptions-item>
          <n-descriptions-item label="乘车日期">{{ current.date }}</n-descriptions-item>
          <n-descriptions-item label="出发">
            {{ current.route?.fromStationName }} {{ current.route?.departTime }}
          </n-descriptions-item>
          <n-descriptions-item label="到达">
            {{ current.route?.toStationName }} {{ current.route?.arriveTime }}
          </n-descriptions-item>
          <n-descriptions-item label="席别">{{ current.seatType }}</n-descriptions-item>
          <n-descriptions-item label="检票口 / 站台">
            {{ current.route?.gate || '-' }} / {{ current.route?.platform || '-' }}
          </n-descriptions-item>
          <n-descriptions-item label="地标颜色">{{ current.route?.landmarkColor || '-' }}</n-descriptions-item>
          <n-descriptions-item label="检票状态">{{ current.checkedIn ? '已检票' : '未检票' }}</n-descriptions-item>
          <n-descriptions-item label="联系电话">{{ current.contactPhone }}</n-descriptions-item>
          <n-descriptions-item label="下单时间">{{ formatTime(current.createdAt) }}</n-descriptions-item>
          <n-descriptions-item label="订单来源">
            {{ current.source === 'counter' ? '售票窗口' : current.source === 'agent' ? '后台代购' : '网页购票' }}
          </n-descriptions-item>
          <n-descriptions-item label="订单金额">¥{{ current.totalPrice }}</n-descriptions-item>
          <n-descriptions-item v-if="current.refundFee" label="退票手续费">¥{{ current.refundFee }}（实退 ¥{{ current.refundAmount }}）</n-descriptions-item>
          <n-descriptions-item v-if="current.invoiceNo" label="发票号码">{{ current.invoiceNo }}</n-descriptions-item>
          <n-descriptions-item v-if="current.invoiceNo" label="发票状态">
            {{ current.invoiceStatus === 'redFlushed' ? '已红冲' : '已开具' }}
          </n-descriptions-item>
          <n-descriptions-item v-if="current.lostReported || current.voided" label="原票状态">
            已挂失作废{{ current.lostReissueOrderNo ? `，补办订单 ${current.lostReissueOrderNo}` : '' }}
          </n-descriptions-item>
        </n-descriptions>

        <n-divider title-placement="left">乘客信息</n-divider>
        <n-table :bordered="false" :single-line="false" size="small">
          <thead>
            <tr>
              <th>姓名</th>
              <th>票种</th>
              <th>证件类型</th>
              <th>证件号码</th>
              <th>票价</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in current.passengers" :key="p.idNo">
              <td>{{ p.name }}</td>
              <td>{{ p.type || '成人' }}</td>
              <td>{{ p.idType }}</td>
              <td>{{ p.idNo }}</td>
              <td>¥{{ p.price ?? current.price }}</td>
            </tr>
          </tbody>
        </n-table>
      </template>
      <template #footer>
        <n-space justify="end">
          <n-button @click="showDetail = false">关闭</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, h, onMounted, reactive, ref } from 'vue';
  import { NButton, NSpace, NTag, useDialog, useMessage } from 'naive-ui';
  import type { DataTableColumns, SelectOption } from 'naive-ui';
  import { PlusOutlined } from '@vicons/antd';
  import {
    createAgentOrder,
    deleteOrder,
    getOrderList,
    getTrainList,
    updateOrderStatus,
    type OrderItem,
    type TrainItem,
  } from '@/api/ticket';
  import { usePermission } from '@/hooks/web/usePermission';

  const { hasPermission } = usePermission();
  const canManageOrders = computed(() => hasPermission(['ticket_orders_manage']));
  const canDeleteOrders = computed(() => hasPermission(['ticket_orders_delete']));

  const message = useMessage();
  const dialog = useDialog();

  const loading = ref(false);
  const keyword = ref('');
  const status = ref<string | null>(null);
  const orders = ref<OrderItem[]>([]);
  const showDetail = ref(false);
  const current = ref<OrderItem | null>(null);

  const agentModal = ref(false);
  const agentSaving = ref(false);
  const agentTrains = ref<TrainItem[]>([]);
  const agentDate = ref<number | null>(Date.now() + 86400000);
  const agentForm = reactive({
    phone: '',
    trainId: null as string | null,
    seatType: null as string | null,
    contactPhone: '',
    passengers: [] as Array<{ name: string; idType: string; idNo: string; phone: string; type: string }>,
  });

  const idTypeOptions = ['身份证', '护照', '港澳通行证'].map((t) => ({ label: t, value: t }));
  const passengerTypeOptions = [
    { label: '成人票', value: '成人' },
    { label: '儿童票（半价）', value: '儿童' },
  ];
  const trainOptions = computed<SelectOption[]>(() =>
    agentTrains.value.map((t) => ({
      label: `${t.trainNo}　${t.fromStationName} → ${t.toStationName}　${t.departTime} 开`,
      value: t.id,
    }))
  );
  const agentSeatOptions = computed<SelectOption[]>(() => {
    const train = agentTrains.value.find((t) => t.id === agentForm.trainId);
    return (train?.seats || []).map((s) => ({ label: `${s.type}　¥${s.price}`, value: s.type }));
  });

  const statusOptions: SelectOption[] = [
    { label: '待支付', value: 'pending' },
    { label: '已支付', value: 'paid' },
    { label: '已退票', value: 'refunded' },
    { label: '已取消', value: 'canceled' },
  ];

  const statusText = (s: string) => ({ pending: '待支付', paid: '已支付', refunded: '已退票', canceled: '已取消' }[s] || s);
  const statusType = (s: string) =>
    ({ pending: 'info', paid: 'success', refunded: 'warning', canceled: 'default' }[s] || 'default') as any;

  const pagination = reactive({
    pageSize: 10,
    pageSizes: [10, 20, 50],
    showSizePicker: true,
    page: 1,
    onChange: (page: number) => {
      pagination.page = page;
    },
    onUpdatePageSize: (size: number) => {
      pagination.pageSize = size;
      pagination.page = 1;
    },
  }) as any;

  const columns: DataTableColumns<OrderItem> = [
    {
      title: '订单信息',
      key: 'orderNo',
      width: 175,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('span', { style: 'font-family:Consolas,monospace;font-size:13px' }, row.orderNo),
          h('span', { style: 'color:#9aa3b2;font-size:12px' }, formatTime(row.createdAt)),
        ]),
    },
    {
      title: '车次行程',
      key: 'route',
      minWidth: 200,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('div', { style: 'display:flex;align-items:center;gap:6px' }, [
            h('span', { style: 'color:#1b64c4;font-weight:600' }, row.trainNo),
            h('span', {}, `${row.route?.fromStationName || '-'} → ${row.route?.toStationName || '-'}`),
          ]),
          h(
            'span',
            { style: 'color:#9aa3b2;font-size:12px' },
            `${row.date} · ${row.seatType} · ${row.route?.departTime || '-'} 开`
          ),
        ]),
    },
    {
      title: '乘客',
      key: 'passengers',
      minWidth: 120,
      render: (row) =>
        h(
          'span',
          { style: 'font-size:13px' },
          `${(row.passengers || []).map((p) => p.name).join('、')}（${(row.passengers || []).length} 人）`
        ),
    },
    {
      title: '金额',
      key: 'totalPrice',
      width: 85,
      render: (row) => `¥${row.totalPrice}`,
    },
    {
      title: '状态',
      key: 'status',
      width: 85,
      render: (row) =>
        h(NTag, { size: 'small', bordered: false, type: statusType(row.status) }, { default: () => statusText(row.status) }),
    },
    {
      title: '操作',
      key: 'action',
      width: 185,
      render: (row) =>
        h(NSpace, { size: 4 }, {
          default: () => [
            h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openDetail(row) }, { default: () => '详情' }),
            row.status === 'paid' && canManageOrders.value
              ? h(
                  NButton,
                  { size: 'small', quaternary: true, type: 'warning', onClick: () => changeStatus(row, 'refunded') },
                  { default: () => '退票' }
                )
              : null,
            canDeleteOrders.value
              ? h(
                  NButton,
                  { size: 'small', quaternary: true, type: 'error', onClick: () => confirmDelete(row) },
                  { default: () => '删除' }
                )
              : null,
          ],
        }),
    },
  ];

  function formatTime(value?: string) {
    if (!value) return '-';
    const d = new Date(value);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  async function loadData() {
    loading.value = true;
    try {
      orders.value =
        ((await getOrderList({ keyword: keyword.value.trim(), status: status.value || '' })) as OrderItem[]) || [];
    } catch (e: any) {
      message.error(e.message || '订单加载失败');
    } finally {
      loading.value = false;
    }
  }

  function resetFilter() {
    keyword.value = '';
    status.value = null;
    loadData();
  }

  function openDetail(row: OrderItem) {
    current.value = row;
    showDetail.value = true;
  }

  function changeStatus(row: OrderItem, next: 'refunded' | 'canceled') {
    const label = next === 'refunded' ? '退票' : '取消';
    dialog.warning({
      title: `${label}确认`,
      content: `确定为订单「${row.orderNo}」办理${label}吗？`,
      positiveText: '确定',
      negativeText: '再想想',
      onPositiveClick: async () => {
        try {
          await updateOrderStatus(row.id, next);
          message.success(`${label}成功`);
          await loadData();
        } catch (e: any) {
          message.error(e.message || `${label}失败`);
        }
      },
    });
  }

  function confirmDelete(row: OrderItem) {
    dialog.warning({
      title: '删除订单记录',
      content: '删除后记录不可恢复，仅用于清理演示数据。',
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await deleteOrder(row.id);
          message.success('删除成功');
          await loadData();
        } catch (e: any) {
          message.error(e.message || '删除失败');
        }
      },
    });
  }

  function openAgentOrder() {
    agentForm.phone = '';
    agentForm.trainId = null;
    agentForm.seatType = null;
    agentForm.contactPhone = '';
    agentForm.passengers = [{ name: '', idType: '身份证', idNo: '', phone: '', type: '成人' }];
    agentDate.value = Date.now() + 86400000;
    agentModal.value = true;
    getTrainList()
      .then((rows) => {
        agentTrains.value = (rows as TrainItem[]) || [];
      })
      .catch((e: any) => message.error(e.message || '车次加载失败'));
  }

  function onAgentTrainChange() {
    const train = agentTrains.value.find((t) => t.id === agentForm.trainId);
    agentForm.seatType = train?.seats?.[0]?.type || null;
  }

  function addAgentPassenger() {
    agentForm.passengers.push({ name: '', idType: '身份证', idNo: '', phone: '', type: '成人' });
  }

  function removeAgentPassenger(index: number) {
    agentForm.passengers.splice(index, 1);
  }

  function dateFromTs(ts: number | null) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  async function submitAgentOrder() {
    if (!/^1[3-9]\d{9}$/.test(agentForm.phone)) return message.error('请输入乘客已注册的 11 位手机号');
    if (!agentForm.trainId) return message.error('请选择车次');
    if (!agentForm.seatType) return message.error('请选择席别');
    if (!agentDate.value) return message.error('请选择乘车日期');
    const contact = agentForm.contactPhone.trim() || agentForm.phone;
    if (!/^1[3-9]\d{9}$/.test(contact)) return message.error('请输入正确的联系电话');
    if (!agentForm.passengers.length) return message.error('请至少填写一位乘客');
    for (const p of agentForm.passengers) {
      if (!p.name.trim()) return message.error('请填写乘客姓名');
      if (!p.idNo.trim()) return message.error('请填写乘客证件号码');
      if (!/^1[3-9]\d{9}$/.test(p.phone || contact)) return message.error(`乘客 ${p.name} 的手机号不正确`);
    }
    agentSaving.value = true;
    try {
      await createAgentOrder({
        phone: agentForm.phone,
        trainId: agentForm.trainId,
        date: dateFromTs(agentDate.value),
        seatType: agentForm.seatType,
        contactPhone: contact,
        agent: 'operator',
        passengers: agentForm.passengers.map((p) => ({
          name: p.name.trim(),
          idType: p.idType,
          idNo: p.idNo.trim(),
          phone: p.phone.trim() || contact,
          type: p.type,
        })),
      });
      message.success('代客购票成功');
      agentModal.value = false;
      await loadData();
    } catch (e: any) {
      message.error(e.message || '代购失败');
    } finally {
      agentSaving.value = false;
    }
  }

  onMounted(loadData);
</script>

<style lang="less" scoped>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .order-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
  }

  .order-card {
    border: 1px solid #e8ecf2;
    border-radius: 10px;
    padding: 14px 16px;
    background: #fff;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: box-shadow 0.2s, border-color 0.2s;
  }

  .order-card:hover {
    border-color: #b9d4f5;
    box-shadow: 0 4px 14px rgb(27 100 196 / 8%);
  }

  .oc-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .oc-no {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .oc-no span {
    font-family: Consolas, monospace;
    font-size: 13px;
    font-weight: 600;
    color: #253046;
    word-break: break-all;
  }

  .oc-no small {
    font-size: 12px;
    color: #9aa3b2;
  }

  .oc-route {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 14px;
  }

  .oc-route b {
    color: #1b64c4;
    font-size: 16px;
  }

  .oc-meta,
  .oc-passengers {
    font-size: 12px;
    color: #8a93a3;
  }

  .oc-passengers {
    color: #6b7280;
  }

  .oc-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 4px;
    padding-top: 10px;
    border-top: 1px dashed #eef1f6;
  }

  .oc-amount {
    color: #d9363e;
    font-size: 16px;
    font-weight: 700;
  }

  .oc-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .agent-passengers {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .agent-head,
  .agent-row {
    display: grid;
    grid-template-columns: 1fr 110px 1.3fr 1fr 110px 60px;
    gap: 8px;
    align-items: center;
  }

  .agent-head {
    font-size: 13px;
    color: #6b7280;
  }
</style>
