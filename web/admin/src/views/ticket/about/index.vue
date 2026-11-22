<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div>
    <div class="n-layout-page-header">
      <n-card :bordered="false" title="关于">
        清江铁路12306 购票演示系统 —— 后台管理 + 前台购票双端，数据与铁路官方系统无关。
      </n-card>
    </div>

    <n-card :bordered="false" class="mt-4" title="系统说明">
      <n-descriptions :column="2" label-placement="left" bordered>
        <n-descriptions-item label="系统名称">清江铁路12306</n-descriptions-item>
        <n-descriptions-item label="版本">v1.0（演示版）</n-descriptions-item>
        <n-descriptions-item label="后台技术栈">Vue 3 + Naive UI（naive-ui-admin）</n-descriptions-item>
        <n-descriptions-item label="后端技术栈">Node.js 原生 HTTP + JSON 持久化</n-descriptions-item>
        <n-descriptions-item label="后台地址">{{ adminUrl }}</n-descriptions-item>
        <n-descriptions-item label="前台地址">{{ frontendUrl }}</n-descriptions-item>
      </n-descriptions>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="功能范围">
      <n-ul>
        <n-li>总览：城市 / 车站 / 车次规模，票额合计、已售、余票与售票率，按日期查看各车次票额明细</n-li>
        <n-li>城市管理、车站管理：维护站点基础资料，前台城市下拉完全来自这里</n-li>
        <n-li>车次管理：车次号、车型、始发/终到站、时刻表、席别票价与定员</n-li>
        <n-li>车票管理：按日期维护各席别可售票额，默认取车次定员</n-li>
        <n-li>订单管理：查看订单、退票、取消、删除记录</n-li>
        <n-li>系统设置：站点名称、公告、单笔乘客数、预售天数、退票开关、客服电话</n-li>
        <n-li>前台：常用乘车人管理（购票时勾选，无需重复填写），余票实时计算，支持同城出发到达</n-li>
      </n-ul>
    </n-card>

    <n-card :bordered="false" class="mt-4" title="数据与并发">
      <n-p>
        数据保存在后端 <n-text code>server/data/db.json</n-text>，所有写操作先写临时文件再原子替换，
        并配合 Node 单进程串行处理，支持数十人同时在线维护与购票，不会写坏数据文件。
      </n-p>
      <n-p>
        余票 = 当日票额（或车次定员）- 当天该席别已支付订单的乘客数；退票后自动释放。
      </n-p>
    </n-card>

    <n-card :bordered="false" class="mt-4">
      <n-space>
        <n-button type="primary" ghost @click="openFrontend">打开前台购票页</n-button>
        <n-button quaternary @click="goPage('ticket_settings')">系统设置</n-button>
      </n-space>
    </n-card>
  </div>
</template>

<script lang="ts" setup>
  import { onMounted, ref } from 'vue';
  import { useRouter } from 'vue-router';
  import { getRuntimeConfig } from '@/api/ticket';

  const router = useRouter();
  const adminUrl = ref('http://localhost:8001');
  const frontendUrl = ref('http://localhost:3000');

  function goPage(name: string) {
    router.push({ name });
  }

  function openFrontend() {
    window.open(frontendUrl.value, '_blank');
  }

  onMounted(async () => {
    try {
      const cfg = await getRuntimeConfig();
      if (cfg && cfg.urls) {
        if (cfg.urls.admin) adminUrl.value = cfg.urls.admin;
        if (cfg.urls.ticket) frontendUrl.value = cfg.urls.ticket;
      }
    } catch (e) {
      /* 保留默认地址 */
    }
  });
</script>
