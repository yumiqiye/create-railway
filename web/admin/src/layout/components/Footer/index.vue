<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <div class="page-footer">
    <div class="copyright">清江铁路12306 · 购票演示系统</div>
  </div>
</template>

<script lang="ts" setup>
  defineProps<{ collapsed?: boolean }>();
</script>

<style lang="less" scoped>
  .page-footer {
    padding: 0 16px;
    text-align: center;

    .copyright {
      color: #808695;
      font-size: 14px;
    }
  }
</style>
