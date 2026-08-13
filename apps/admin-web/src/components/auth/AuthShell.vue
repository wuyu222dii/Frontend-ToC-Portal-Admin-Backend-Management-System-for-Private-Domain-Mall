<script setup lang="ts">
defineProps<{
  eyebrow: string;
  title: string;
  subtitle: string;
}>();
</script>

<template>
  <main class="auth-shell">
    <section class="auth-brand" aria-label="青序生活总部管理后台">
      <div class="auth-brand-shade" />
      <div class="auth-brand-content">
        <div class="wordmark">
          <span class="wordmark-symbol" aria-hidden="true">青</span>
          <span>
            <strong>青序生活</strong>
            <h1 class="wordmark-admin-title">总部管理后台</h1>
          </span>
        </div>
        <div class="auth-brand-copy">
          <p>QINGXU COMMERCE</p>
          <h2>把每一份日常护理，<br>经营得清晰而从容。</h2>
          <span>商品、订单、客户与经营数据，在一处完成管理。</span>
        </div>
        <small class="auth-brand-foot">QINGXU SUPPLY · PRIVATE COMMERCE SYSTEM</small>
      </div>
    </section>

    <section class="auth-form-panel">
      <div class="auth-card">
        <div class="mobile-wordmark">
          <span class="wordmark-symbol" aria-hidden="true">青</span>
          <span><strong>青序生活</strong><h1>总部管理后台</h1></span>
        </div>
        <p class="auth-eyebrow">{{ eyebrow }}</p>
        <h2>{{ title }}</h2>
        <p class="auth-subtitle">{{ subtitle }}</p>
        <slot />
      </div>
    </section>
  </main>
</template>
