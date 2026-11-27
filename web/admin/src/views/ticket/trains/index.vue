<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="车次管理">
        维护列车开行方案：车次号、始发/终到车站、时刻表与席别、定员。前台按城市区间检索这些车次。实际票价按经停分段票价累加计算，并按席别换算：一等座 = 二等座 × 1.5，商务座 = 二等座 × 2。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4 proCard">
      <div class="toolbar">
        <n-space>
          <n-input
            v-model:value="keyword"
            placeholder="搜索车次号 / 车站"
            clearable
            style="width: 240px"
            @keyup.enter="loadData"
          />
          <n-date-picker v-model:value="queryDate" type="date" clearable placeholder="余票计算日期" style="width: 180px" @update:value="loadData" />
          <n-button quaternary @click="resetFilter">重置</n-button>
        </n-space>
        <n-space>
          <n-button quaternary @click="importVisible = true">批量导入</n-button>
          <n-button quaternary @click="timetableVisible = true">Create 时刻表导入</n-button>
          <n-button quaternary type="primary" :loading="loading" @click="loadData">刷新</n-button>
          <n-button type="primary" @click="openCreate">
            <template #icon>
              <n-icon><PlusOutlined /></n-icon>
            </template>
            新增车次
          </n-button>
        </n-space>
      </div>

      <div v-if="trains.length" class="train-grid">
        <div v-for="row in trains" :key="row.id" class="train-card">
          <div class="tc-head">
            <div class="tc-title">
              <span class="tc-no">{{ row.trainNo }}</span>
              <span class="tc-type">{{ row.type }}</span>
              <n-tag v-if="row.statusText" size="small" :type="statusTagType(row.status)">{{ row.statusText }}</n-tag>
            </div>
            <div class="tc-actions">
              <n-button text type="primary" @click="openEdit(row)">编辑</n-button>
              <n-button text type="error" @click="confirmDelete(row)">删除</n-button>
            </div>
          </div>
          <div class="tc-route">
            <span class="tc-station">{{ row.fromStationName }}</span>
            <span class="tc-arrow">→</span>
            <span class="tc-station">{{ row.toStationName }}</span>
          </div>
          <div class="tc-time">{{ row.departTime }} 开 · {{ row.arriveTime }} 到 · 历时 {{ row.durationText }}</div>
          <div class="tc-seats">
            <span v-for="seat in row.seats" :key="seat.type" class="seat-chip">
              <b>{{ seat.type }}</b>
              <i>¥{{ seat.price }}</i>
              <em :class="{ sold: seat.remaining === 0 }">{{ seat.remaining === 0 ? '已售完' : `余 ${seat.remaining}` }}</em>
            </span>
          </div>
          <div class="tc-checkin">
            <span>检票口 <b>{{ row.gate || '-' }}</b></span>
            <span>站台 <b>{{ row.platform || '-' }}</b></span>
            <span class="landmark-pill" :style="landmarkStyle(row.landmarkColor)">地标 {{ row.landmarkColor || '-' }}</span>
          </div>
        </div>
      </div>
      <n-empty v-else description="暂无车次，点击右上角新增车次" style="padding: 40px 0" />
    </n-card>

    <n-drawer v-model:show="showDrawer" :width="680" placement="right">
      <n-drawer-content :title="isEdit ? '编辑车次' : '新增车次'" closable>
        <n-form ref="formRef" :model="form" :rules="rules" label-placement="left" label-width="110">
          <n-form-item label="车次号" path="trainNo">
            <n-input v-model:value="form.trainNo" placeholder="例如：G1 / D2281" maxlength="6" />
          </n-form-item>
          <n-form-item label="列车类型" path="type">
            <n-select v-model:value="form.type" :options="typeOptions" />
          </n-form-item>
          <n-form-item label="出发车站" path="fromStationId">
            <n-select v-model:value="form.fromStationId" :options="stationOptions" filterable placeholder="请选择出发车站" />
          </n-form-item>
          <n-form-item label="到达车站" path="toStationId">
            <n-select v-model:value="form.toStationId" :options="stationOptions" filterable placeholder="请选择到达车站" />
          </n-form-item>
          <n-form-item label="出发时刻" path="departTime">
            <n-input v-model:value="form.departTime" placeholder="HH:MM，例如 07:00" maxlength="5" />
          </n-form-item>
          <n-form-item label="到达时刻" path="arriveTime">
            <n-input v-model:value="form.arriveTime" placeholder="HH:MM，次日到达也按此时刻填写" maxlength="5" />
          </n-form-item>
          <n-form-item label="途径时长">
            <span class="duration-hint">{{ durationHint }}</span>
          </n-form-item>
          <n-form-item label="站台" path="platform">
            <n-input v-model:value="form.platform" placeholder="例如 3 / 12A，最多 10 位" maxlength="10" />
          </n-form-item>
          <n-form-item label="检票口" path="gate">
            <n-input v-model:value="form.gate" placeholder="例如 10A,10B；多个用逗号分隔，最多 8 个" maxlength="100" />
          </n-form-item>
          <n-alert type="info" :bordered="false" style="margin-bottom: 16px">
            运行调整只影响下方所选日期；保存“正常”并清空临时检票口、站台和公告，即恢复当天原计划。
          </n-alert>
          <n-form-item label="生效日期">
            <n-date-picker
              v-model:formatted-value="form.runtimeDate"
              type="date"
              value-format="yyyy-MM-dd"
              style="width: 100%"
              @update:formatted-value="onRuntimeDateChange"
            />
          </n-form-item>
          <n-form-item label="当日运行状态" path="status">
            <n-select v-model:value="form.status" :options="statusOptions" />
          </n-form-item>
          <n-form-item v-if="form.status === 'delayed'" label="晚点分钟" path="delayMinutes">
            <n-input-number v-model:value="form.delayMinutes" :min="1" :max="240" :precision="0" placeholder="例如 30" />
          </n-form-item>
          <n-form-item label="当日临时检票口" path="tempGate">
            <n-input v-model:value="form.tempGate" placeholder="临时改口填这里，留空表示不改" maxlength="100" />
          </n-form-item>
          <n-form-item label="当日临时站台" path="tempPlatform">
            <n-input v-model:value="form.tempPlatform" placeholder="临时改站台填这里，留空表示不改" maxlength="10" />
          </n-form-item>
          <n-form-item label="当日运行公告" path="runtimeNote">
            <n-input v-model:value="form.runtimeNote" type="textarea" :rows="2" maxlength="120" show-count placeholder="例如：因线路施工晚点，请留意车站广播" />
          </n-form-item>
          <n-form-item label="地标颜色" path="landmarkColor">
            <n-select v-model:value="form.landmarkColor" :options="landmarkOptions" placeholder="请选择地标颜色" />
          </n-form-item>

          <n-divider title-placement="left">经停站（拖动调整顺序）</n-divider>
          <n-form-item label="批量选择">
            <n-select
              v-model:value="stopPicker"
              multiple
              filterable
              :options="stationOptions"
              placeholder="可一次选择多个车站加入经停序列"
              @update:value="onStopPick"
            />
          </n-form-item>
          <n-form-item label="经停顺序">
            <div class="stop-editor">
              <div
                v-for="(stop, index) in form.stops"
                :key="stop.stationId"
                class="stop-row"
                draggable="true"
                @dragstart="dragIndex = index"
                @dragover.prevent
                @drop="dropStop(index)"
              >
                <span class="stop-drag">☰</span>
                <span class="stop-index">{{ index + 1 }}</span>
                <span class="stop-name">{{ stationNameById(stop.stationId) }}</span>
                <n-input-number v-model:value="stop.km" :min="0" :precision="1" size="small" placeholder="里程 km" style="width: 120px" />
                <n-button quaternary type="error" size="small" @click="removeStop(index)">删除</n-button>
              </div>
              <div v-if="!form.stops.length" class="stop-empty">尚未选择经停站</div>
              <n-space style="margin-top: 8px">
                <n-button dashed size="small" @click="fillEndpoints">用出发/到达站填充</n-button>
                <span class="hint">拖动行可调整经停顺序，顺序即列车运行方向；里程用于区间票价计算。</span>
              </n-space>
            </div>
          </n-form-item>

          <n-divider title-placement="left">席别与定员（票价按分段票价和倍率自动计算）</n-divider>
          <div class="seat-editor">
            <div class="seat-head">
              <span>席别</span>
              <span>参考票价（元）</span>
              <span>定员（张）</span>
              <span></span>
            </div>
            <div v-for="(seat, index) in form.seats" :key="index" class="seat-row">
              <n-select v-model:value="seat.type" :options="seatOptions" placeholder="席别" />
              <n-input-number v-model:value="seat.price" :min="0.1" :precision="1" placeholder="票价" />
              <n-input-number v-model:value="seat.total" :min="1" :precision="0" placeholder="定员" />
              <n-button quaternary type="error" :disabled="form.seats.length <= 1" @click="removeSeat(index)">
                删除
              </n-button>
            </div>
            <n-button dashed block @click="addSeat" :disabled="form.seats.length >= 7">+ 添加席别</n-button>
          </div>
        </n-form>

        <template #footer>
          <n-space>
            <n-button @click="showDrawer = false">取消</n-button>
            <n-button type="primary" :loading="saving" @click="submit">保存</n-button>
          </n-space>
        </template>
      </n-drawer-content>
    </n-drawer>

    <ImportModal v-model:show="importVisible" type="trains" title="批量导入车次" />
    <TimetableImportModal v-model:show="timetableVisible" @imported="loadData" />
  </div>
</template>

<script lang="ts" setup>
  import { computed, h, onMounted, reactive, ref } from 'vue';
  import { NButton, NSpace, useDialog, useMessage } from 'naive-ui';
  import type { DataTableColumns, FormInst, FormRules, SelectOption } from 'naive-ui';
  import { PlusOutlined } from '@vicons/antd';
  import {
    createTrain,
    deleteTrain,
    getStationList,
    getTrainList,
    updateTrain,
    type StationItem,
    type TrainItem,
  } from '@/api/ticket';
  import ImportModal from '../components/ImportModal.vue';
  import TimetableImportModal from '../components/TimetableImportModal.vue';
  const message = useMessage();
  const dialog = useDialog();

  const loading = ref(false);
  const saving = ref(false);
  const keyword = ref('');
  const queryDate = ref<number | null>(null);
  const trains = ref<TrainItem[]>([]);
  const stations = ref<StationItem[]>([]);
  const showDrawer = ref(false);
  const importVisible = ref(false);
  const timetableVisible = ref(false);
  const isEdit = ref(false);
  const editingId = ref('');
  const editingRow = ref<TrainItem | null>(null);
  const formRef = ref<FormInst | null>(null);

  const typeOptions = ['高速动车', '动车', '直达特快', '特快', '快速'].map((t) => ({ label: t, value: t }));
  const seatOptions = ['商务座', '一等座', '二等座', '软卧', '硬卧', '硬座', '无座'].map((t) => ({
    label: t,
    value: t,
  }));
  const landmarkOptions = ['蓝色', '黄色', '绿色', '紫色', '红色', '白色'].map((c) => ({ label: c, value: c }));

  const landmarkColorMap: Record<string, string> = {
    蓝色: '#1b64c4',
    黄色: '#c99a06',
    绿色: '#18a058',
    紫色: '#8a5cd6',
    红色: '#d9363e',
    白色: '#8a93a3',
  };

  function landmarkStyle(color?: string) {
    const c = landmarkColorMap[color || ''] || '#8a93a3';
    return { color: c, borderColor: c, background: `${c}14` };
  }

  const statusOptions = [
    { label: '正常', value: 'normal' },
    { label: '晚点', value: 'delayed' },
    { label: '停运', value: 'cancelled' },
    { label: '暂停检票', value: 'maintenance' },
  ];

  function statusTagType(status?: string): 'default' | 'success' | 'warning' | 'error' | 'info' {
    if (status === 'delayed') return 'warning';
    if (status === 'cancelled') return 'error';
    if (status === 'maintenance') return 'info';
    return 'default';
  }

  const form = reactive({
    trainNo: '',
    type: '高速动车',
    fromStationId: null as string | null,
    toStationId: null as string | null,
    departTime: '',
    arriveTime: '',
    platform: '1',
    gate: 'A',
    runtimeDate: todayKey(),
    status: 'normal',
    delayMinutes: 30,
    tempGate: '',
    tempPlatform: '',
    runtimeNote: '',
    landmarkColor: '蓝色',
    stops: [] as Array<{ stationId: string; km: number | null }>,
    seats: [] as Array<{ type: string | null; price: number | null; total: number | null }>,
  });

  const stopPicker = ref<string[]>([]);
  const dragIndex = ref(-1);

  function stationNameById(id: string) {
    const station = stations.value.find((s) => s.id === id);
    return station ? station.name : id;
  }

  function onStopPick(values: string[]) {
    values.forEach((id) => {
      if (!form.stops.some((s) => s.stationId === id)) {
        form.stops.push({ stationId: id, km: null });
      }
    });
    stopPicker.value = [];
  }

  function removeStop(index: number) {
    form.stops.splice(index, 1);
  }

  function dropStop(target: number) {
    if (dragIndex.value < 0 || dragIndex.value === target) return;
    const [moved] = form.stops.splice(dragIndex.value, 1);
    form.stops.splice(target, 0, moved);
    dragIndex.value = -1;
  }

  function fillEndpoints() {
    if (!form.fromStationId || !form.toStationId) return message.warning('请先选择出发站与到达站');
    const ids = [form.fromStationId, form.toStationId];
    ids.forEach((id, index) => {
      if (!form.stops.some((s) => s.stationId === id)) {
        form.stops.push({ stationId: id, km: index === 0 ? 0 : null });
      }
    });
  }

  const stationOptions = computed<SelectOption[]>(() =>
    stations.value.map((s) => ({ label: `${s.name}（${s.cityName || ''} · ${s.code}）`, value: s.id }))
  );

  const durationHint = computed(() => {
    const dep = form.departTime;
    const arr = form.arriveTime;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dep) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(arr)) {
      return '填写正确的出发/到达时刻后自动计算';
    }
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    let diff = toMin(arr) - toMin(dep);
    if (diff < 0) diff += 1440;
    const hh = Math.floor(diff / 60);
    const mm = diff % 60;
    return `${hh} 小时 ${mm} 分`;
  });

  const rules: FormRules = {
    trainNo: [
      { required: true, message: '请输入车次号', trigger: ['blur', 'input'] },
      { pattern: /^[GDCZKTLY]\d{1,4}$/, message: '格式如 G1、D2281（字母 + 数字）', trigger: ['blur', 'input'] },
    ],
    fromStationId: [{ required: true, message: '请选择出发车站', trigger: ['blur', 'change'] }],
    toStationId: [{ required: true, message: '请选择到达车站', trigger: ['blur', 'change'] }],
    departTime: [
      { required: true, message: '请输入出发时刻', trigger: ['blur', 'input'] },
      { pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: '格式为 HH:MM', trigger: ['blur', 'input'] },
    ],
    arriveTime: [
      { required: true, message: '请输入到达时刻', trigger: ['blur', 'input'] },
      { pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: '格式为 HH:MM', trigger: ['blur', 'input'] },
    ],
    platform: [
      { required: true, message: '请输入站台', trigger: ['blur', 'input'] },
      { pattern: /^[0-9A-Za-z-]{1,10}$/, message: '站台仅支持字母、数字、-，最多 10 位', trigger: ['blur', 'input'] },
    ],
    gate: [
      { required: true, message: '请输入检票口', trigger: ['blur', 'input'] },
      {
        validator(_rule: unknown, value: string) {
          const gates = String(value || '')
            .split(/[,\/、，\s]+/)
            .map((v) => v.trim())
            .filter(Boolean);
          if (!gates.length) return new Error('请输入检票口');
          if (gates.length > 8) return new Error('检票口最多 8 个');
          if (gates.some((v) => !/^[0-9A-Za-z-]{1,10}$/.test(v)))
            return new Error('检票口仅支持字母、数字、-，每个最多 10 位');
          return true;
        },
        trigger: ['blur', 'input'],
      },
    ],
    delayMinutes: [
      {
        validator(_rule: unknown, value: number) {
          if (form.status !== 'delayed') return true;
          if (!value || value < 1 || value > 240) return new Error('晚点分钟需为 1-240');
          return true;
        },
        trigger: ['blur', 'change'],
      },
    ],
    tempPlatform: [
      {
        validator(_rule: unknown, value: string) {
          if (!String(value || '').trim()) return true;
          if (!/^[0-9A-Za-z-]{1,10}$/.test(String(value).trim()))
            return new Error('临时站台仅支持字母、数字、-，最多 10 位');
          return true;
        },
        trigger: ['blur', 'input'],
      },
    ],
  };

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

  function dateParam() {
    if (!queryDate.value) return undefined;
    const d = new Date(queryDate.value);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function todayKey() {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function runtimeEntryFor(row: TrainItem | null, date: string) {
    return row?.runtimeByDate?.[date] || null;
  }

  function applyRuntimeForDate(row: TrainItem | null, date: string) {
    const entry = runtimeEntryFor(row, date);
    form.status = entry?.status || 'normal';
    form.delayMinutes = entry?.delayMinutes || 30;
    form.tempGate = entry?.tempGate || (entry?.tempGates || []).join(',') || '';
    form.tempPlatform = entry?.tempPlatform || '';
    form.runtimeNote = entry?.runtimeNote || '';
  }

  function onRuntimeDateChange(value: string | null) {
    if (!value) return;
    applyRuntimeForDate(editingRow.value, value);
  }

  const columns: DataTableColumns<TrainItem> = [
    {
      title: '车次',
      key: 'trainNo',
      width: 110,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('span', { style: 'color:#1b64c4;font-weight:600;font-size:15px' }, row.trainNo),
          h('span', { style: 'color:#9aa3b2;font-size:12px' }, row.type),
        ]),
    },
    {
      title: '运行区间',
      key: 'route',
      minWidth: 200,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px' }, [
          h('span', {}, `${row.fromStationName} → ${row.toStationName}`),
          h('span', { style: 'color:#9aa3b2;font-size:12px' }, `${row.departTime} 开 · ${row.arriveTime} 到`),
        ]),
    },
    { title: '历时', key: 'durationText', width: 100 },
    {
      title: '席别 · 票价 · 余票',
      key: 'seats',
      minWidth: 210,
      render: (row) =>
        h(
          'div',
          { style: 'display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:1.6' },
          (row.seats || []).map((seat) =>
            h('div', { style: 'display:flex;align-items:center;gap:8px' }, [
              h('span', { style: 'color:#6b7280;width:48px' }, seat.type),
              h('span', { style: 'color:#d9363e;font-weight:600;width:62px' }, `¥${seat.price}`),
              h(
                'span',
                { style: seat.remaining === 0 ? 'color:#c9ced8' : 'color:#9aa3b2' },
                seat.remaining === 0 ? '已售完' : `余 ${seat.remaining}`
              ),
            ])
          )
        ),
    },
    {
      title: '检票信息',
      key: 'checkin',
      width: 150,
      render: (row) =>
        h('div', { style: 'display:flex;flex-direction:column;gap:2px;font-size:12px;line-height:1.6' }, [
          h('span', { style: 'color:#1b64c4' }, `检票口 ${row.gate || '-'} · 站台 ${row.platform || '-'}`),
          h('span', { style: 'color:#8a6d1f' }, `地标颜色 ${row.landmarkColor || '-'}`),
        ]),
    },
    {
      title: '操作',
      key: 'action',
      width: 130,
      render: (row) =>
        h(NSpace, { size: 8 }, {
          default: () => [
            h(NButton, { size: 'small', quaternary: true, type: 'primary', onClick: () => openEdit(row) }, { default: () => '编辑' }),
            h(
              NButton,
              { size: 'small', quaternary: true, type: 'error', onClick: () => confirmDelete(row) },
              { default: () => '删除' }
            ),
          ],
        }),
    },
  ];

  async function loadData() {
    loading.value = true;
    try {
      trains.value = ((await getTrainList({ keyword: keyword.value.trim(), date: dateParam() })) as TrainItem[]) || [];
    } catch (e: any) {
      message.error(e.message || '车次列表加载失败');
    } finally {
      loading.value = false;
    }
  }

  async function loadStations() {
    try {
      stations.value = ((await getStationList()) as StationItem[]) || [];
    } catch (e: any) {
      message.error(e.message || '车站列表加载失败');
    }
  }

  function resetFilter() {
    keyword.value = '';
    queryDate.value = null;
    loadData();
  }

  function resetForm() {
    form.trainNo = '';
    form.type = '高速动车';
    form.fromStationId = null;
    form.toStationId = null;
    form.departTime = '';
    form.arriveTime = '';
    form.platform = '1';
    form.gate = 'A';
    form.runtimeDate = todayKey();
    form.status = 'normal';
    form.delayMinutes = 30;
    form.tempGate = '';
    form.tempPlatform = '';
    form.runtimeNote = '';
    form.landmarkColor = '蓝色';
    form.stops = [];
    stopPicker.value = [];
    form.seats = [{ type: '二等座', price: null, total: null }];
    editingId.value = '';
    editingRow.value = null;
    formRef.value?.restoreValidation();
  }

  function openCreate() {
    isEdit.value = false;
    resetForm();
    showDrawer.value = true;
  }

  function openEdit(row: TrainItem) {
    isEdit.value = true;
    editingId.value = row.id;
    editingRow.value = row;
    form.trainNo = row.trainNo;
    form.stops = (row.stops || []).map((s) => ({ stationId: s.stationId, km: s.km }));
    form.type = row.type;
    form.fromStationId = row.fromStationId;
    form.toStationId = row.toStationId;
    form.departTime = row.baseDepartTime || row.departTime;
    form.arriveTime = row.arriveTime;
    form.platform = row.basePlatform || row.platform || '1';
    form.gate = row.baseGate || row.gate || 'A';
    form.runtimeDate = row.runtimeDate || todayKey();
    applyRuntimeForDate(row, form.runtimeDate);
    form.landmarkColor = row.landmarkColor || '蓝色';
    form.seats = (row.seats || []).map((s) => ({ type: s.type, price: s.price, total: s.total }));
    formRef.value?.restoreValidation();
    showDrawer.value = true;
  }

  function addSeat() {
    form.seats.push({ type: null, price: null, total: null });
  }

  function removeSeat(index: number) {
    form.seats.splice(index, 1);
  }

  function validateSeats() {
    if (!form.seats.length) return '请至少配置一种席别';
    const seen = new Set<string>();
    for (const seat of form.seats) {
      if (!seat.type) return '请选择席别';
      if (seen.has(seat.type)) return `席别重复：${seat.type}`;
      if (!seat.price || seat.price <= 0) return `${seat.type} 票价必须大于 0`;
      if (!seat.total || seat.total <= 0) return `${seat.type} 定员必须为正整数`;
      seen.add(seat.type);
    }
    return '';
  }

  function submit() {
    formRef.value?.validate(async (errors) => {
      if (errors) return;
      const seatError = validateSeats();
      if (seatError) return message.error(seatError);
      if (form.fromStationId === form.toStationId) return message.error('出发站与到达站不能相同');

      saving.value = true;
      const payload = {
        trainNo: form.trainNo.trim().toUpperCase(),
        type: form.type,
        fromStationId: form.fromStationId,
        toStationId: form.toStationId,
        departTime: form.departTime,
        arriveTime: form.arriveTime,
        platform: form.platform.trim(),
        gate: form.gate.trim(),
        runtimeDate: form.runtimeDate || todayKey(),
        status: form.status,
        delayMinutes: form.status === 'delayed' ? form.delayMinutes : 0,
        tempGate: form.tempGate.trim(),
        tempPlatform: form.tempPlatform.trim(),
        runtimeNote: form.runtimeNote.trim(),
        landmarkColor: form.landmarkColor,
        stops: form.stops.map((s) => ({ stationId: s.stationId, km: Number(s.km) || 0 })),
        seats: form.seats.map((s) => ({ type: s.type, price: s.price, total: s.total })),
      };
      try {
        if (isEdit.value) {
          await updateTrain(editingId.value, payload);
          message.success('车次更新成功');
        } else {
          await createTrain(payload);
          message.success('车次新增成功');
        }
        showDrawer.value = false;
        await loadData();
      } catch (e: any) {
        message.error(e.message || '保存失败');
      } finally {
        saving.value = false;
      }
    });
  }

  function confirmDelete(row: TrainItem) {
    dialog.warning({
      title: '删除车次',
      content: `确定删除车次「${row.trainNo}」吗？已产生的订单记录会保留。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        try {
          await deleteTrain(row.id);
          message.success('删除成功');
          await loadData();
        } catch (e: any) {
          message.error(e.message || '删除失败');
        }
      },
    });
  }

  onMounted(async () => {
    await loadStations();
    await loadData();
  });
</script>

<style lang="less" scoped>
  .stop-editor {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .stop-row {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid #e8ecf2;
    border-radius: 8px;
    padding: 6px 10px;
    background: #f8fbff;
    cursor: move;
  }

  .stop-row:active {
    border-color: #1b64c4;
  }

  .stop-drag {
    color: #7b8798;
  }

  .stop-index {
    color: #1b64c4;
    font-weight: 700;
    width: 18px;
  }

  .stop-name {
    flex: 1;
    font-size: 14px;
  }

  .stop-empty {
    color: #7b8798;
    font-size: 13px;
    padding: 8px 0;
  }

  .hint {
    color: #7b8798;
    font-size: 12px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
  }

  .train-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 14px;
  }

  .train-card {
    border: 1px solid #e8ecf2;
    border-radius: 10px;
    padding: 14px 16px;
    background: #fff;
    transition: box-shadow 0.2s, border-color 0.2s;
  }

  .train-card:hover {
    border-color: #b9d4f5;
    box-shadow: 0 4px 14px rgb(27 100 196 / 8%);
  }

  .tc-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 8px;
  }

  .tc-title {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .tc-no {
    font-size: 18px;
    font-weight: 700;
    color: #1b64c4;
  }

  .tc-type {
    font-size: 12px;
    color: #9aa3b2;
  }

  .tc-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .tc-route {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    font-size: 15px;
    font-weight: 600;
    color: #253046;
    flex-wrap: wrap;
  }

  .tc-arrow {
    color: #1b64c4;
  }

  .tc-time {
    margin-top: 4px;
    font-size: 12px;
    color: #8a93a3;
  }

  .tc-seats {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 10px;
  }

  .seat-chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    border-radius: 6px;
    background: #f5f8fd;
    border: 1px solid #e3ebf7;
    font-size: 12px;
    white-space: nowrap;
  }

  .seat-chip b {
    color: #4b5563;
    font-weight: 600;
  }

  .seat-chip i {
    color: #d9363e;
    font-style: normal;
    font-weight: 600;
  }

  .seat-chip em {
    color: #8a93a3;
    font-style: normal;
  }

  .seat-chip em.sold {
    color: #c9ced8;
  }

  .tc-checkin {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px dashed #eef1f6;
    font-size: 12px;
    color: #6b7280;
  }

  .tc-checkin b {
    color: #253046;
  }

  .landmark-pill {
    padding: 1px 8px;
    border-radius: 10px;
    border: 1px solid;
    font-size: 12px;
    line-height: 18px;
  }

  .duration-hint {
    color: #6b7280;
  }

  .seat-editor {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .seat-head {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr 60px;
    gap: 10px;
    font-size: 13px;
    color: #6b7280;
  }

  .seat-row {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr 60px;
    gap: 10px;
    align-items: center;
  }
</style>
