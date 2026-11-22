<!--
  ══════════════════════════════════════════════════════
    清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
    版权所有，仿冒必究    All Rights Reserved
  ══════════════════════════════════════════════════════
-->
<template>
  <n-dialog-provider>
    <n-notification-provider>
      <n-message-provider>
        <slot name="default"></slot>
      </n-message-provider>
    </n-notification-provider>
  </n-dialog-provider>
</template>

<script lang="ts">
  import { defineComponent } from 'vue';
  import { NDialogProvider, NNotificationProvider, NMessageProvider } from 'naive-ui';

  export default defineComponent({
    name: 'Application',
    components: {
      NDialogProvider,
      NNotificationProvider,
      NMessageProvider,
    },
    setup() {
      return {};
    },
  });
</script>
