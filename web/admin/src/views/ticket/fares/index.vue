<!--
  票价管理：票价只按车站中心点坐标自动生成，不提供手填价格。
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="票价管理">
        车站通过 <code>/railway admin station &lt;站名&gt; POS1/POS2</code> 划定范围后，系统按两站中心点的方块距离自动生成票价。
        售票时按车次经停顺序累加，例如 A-B-C 的 A→C 票价 = A-B 段价 + B-C 段价。票价只由坐标决定，后台不提供手填价格；两站都缺坐标时不能生成票价。
        席别先取整二等座基准再乘倍率：一等座 = round(round(二等座) × 1.5)，商务座 = round(round(二等座) × 2)，最后四舍五入取整。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4" title="模组车站与设备">
      <template #header-extra>
        <n-button size="small" :loading="stationLoading" @click="loadStations">刷新</n-button>
      </template>
      <n-data-table
        :columns="stationColumns"
        :data="stations"
        :loading="stationLoading"
        :pagination="false"
        :bordered="false"
        size="small"
      />
      <p class="hint">闸机与售票机由模组扫描车站范围自动登记；闸机类型与停用状态请在游戏内用 CRH 刷子修改。</p>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="票价列表">
      <template #header-extra>
        <n-space>
          <n-button size="small" :loading="recalculating" @click="recalculate">按坐标重算全部票价</n-button>
          <n-button size="small" type="primary" @click="openCreate">新增自动票价</n-button>
        </n-space>
      </template>
      <n-data-table
        :columns="columns"
        :data="fares"
        :loading="loading"
        :pagination="{ pageSize: 12 }"
        :bordered="false"
        size="small"
      />
    </n-card>

    <n-modal v-model:show="editVisible" preset="card" title="新增自动票价" style="width: 460px">
      <n-form label-placement="left" label-width="110">
        <n-form-item label="起点站">
          <n-select v-model:value="form.fromStationId" :options="stationOptions" filterable />
        </n-form-item>
        <n-form-item label="终点站">
          <n-select v-model:value="form.toStationId" :options="stationOptions" filterable />
        </n-form-item>
        <n-alert type="info" :bordered="false">
          保存时按两站中心点坐标自动计算票价；两站都必须有坐标。POS、窗口代客购票与网页售票机走同一套计价。
        </n-alert>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="editVisible = false">取消</n-button>
          <n-button type="primary" :loading="saving" @click="submit">保存</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script lang="ts" setup>
  import { computed, h, onMounted, reactive, ref } from 'vue';
  import { NButton, useMessage } from 'naive-ui';
  import type { DataTableColumns, SelectOption } from 'naive-ui';
  import {
    getRailwayFares,
    getRailwayStations,
    getSettings,
    getStationList,
    recalcRailwayFares,
    saveRailwayFare,
    type RailwayFare,
    type RailwayStationGeo,
    type StationItem,
  } from '@/api/ticket';

  const message = useMessage();

  const fares = ref<RailwayFare[]>([]);
  const stations = ref<RailwayStationGeo[]>([]);
  const stationList = ref<StationItem[]>([]);
  const loading = ref(false);
  const stationLoading = ref(false);
  const recalculating = ref(false);
  const saving = ref(false);
  const editVisible = ref(false);
  const currencyLabel = ref('绿宝石');
  const currencyNames: Record<string, string> = {
    emerald: '绿宝石',
    diamond: '钻石',
    gold_ingot: '金锭',
    iron_ingot: '铁锭',
    gold_nugget: '金粒',
  };

  const form = reactive({
    fromStationId: null as string | null,
    toStationId: null as string | null,
  });

  const stationOptions = computed<SelectOption[]>(() =>
    stationList.value.map((s) => ({ label: `${s.name}${s.cityName ? '（' + s.cityName + '）' : ''}`, value: s.id }))
  );

  const columns: DataTableColumns<RailwayFare> = [
    { title: '起点站', key: 'fromStationName', width: 160 },
    { title: '终点站', key: 'toStationName', width: 160 },
    { title: '坐标距离', key: 'distance', width: 120, render: (row) => `${row.distance || 0} 格` },
    {
      title: '票价',
      key: 'price',
      width: 140,
      render: (row) => h('b', { style: 'color:#1c8a4b' }, `${row.price} ${currencyLabel.value}`),
    },
    { title: '更新时间', key: 'updatedAt', render: (row) => row.updatedAt || '-' },
  ];

  const stationColumns: DataTableColumns<RailwayStationGeo> = [
    { title: '车站', key: 'name', width: 160 },
    { title: '中心点', key: 'center', width: 180, render: (row) => `${row.x}, ${row.y}, ${row.z}` },
    { title: '维度', key: 'dimension', width: 160 },
    { title: '铁路局', key: 'bureauName', width: 140, render: (row) => row.bureauName || '-' },
    { title: '闸机', key: 'gates', width: 80, render: (row) => `${row.gates?.length || 0} 台` },
    { title: '售票机', key: 'vendors', width: 80, render: (row) => `${row.vendors?.length || 0} 台` },
  ];

  function load() {
    loading.value = true;
    getRailwayFares()
      .then((rows) => (fares.value = rows || []))
      .catch((e: any) => message.error(e.message || '票价加载失败'))
      .finally(() => (loading.value = false));
  }

  function loadStations() {
    stationLoading.value = true;
    getRailwayStations()
      .then((rows) => (stations.value = rows || []))
      .catch((e: any) => message.error(e.message || '车站加载失败'))
      .finally(() => (stationLoading.value = false));
  }

  function loadStationOptions() {
    getStationList()
      .then((data: any) => {
        stationList.value = data?.list || data || [];
      })
      .catch(() => {
        stationList.value = [];
      });
  }

  function openCreate() {
    form.fromStationId = null;
    form.toStationId = null;
    editVisible.value = true;
  }

  function submit() {
    if (!form.fromStationId || !form.toStationId) return message.warning('请选择起点站与终点站');
    if (form.fromStationId === form.toStationId) return message.warning('起点站与终点站不能相同');
    saving.value = true;
    saveRailwayFare({
      fromStationId: form.fromStationId,
      toStationId: form.toStationId,
    })
      .then(() => {
        message.success('已按坐标生成票价');
        editVisible.value = false;
        load();
      })
      .catch((e: any) => message.error(e.message || '保存失败'))
      .finally(() => (saving.value = false));
  }

  function recalculate() {
    recalculating.value = true;
    recalcRailwayFares()
      .then((res) => {
        message.success(`已按坐标重算 ${res?.recalculated || 0} 条票价`);
        load();
      })
      .catch((e: any) => message.error(e.message || '重算失败'))
      .finally(() => (recalculating.value = false));
  }

  onMounted(() => {
    load();
    loadStations();
    loadStationOptions();
    getSettings()
      .then((s: any) => {
        currencyLabel.value = currencyNames[s?.railwayCurrency || 'emerald'] || s?.railwayCurrency || '绿宝石';
      })
      .catch(() => {});
  });
</script>

<style scoped>
  .hint {
    color: #7b8798;
    font-size: 13px;
    margin-top: 10px;
  }
  .mt-4 {
    margin-top: 16px;
  }
</style>
