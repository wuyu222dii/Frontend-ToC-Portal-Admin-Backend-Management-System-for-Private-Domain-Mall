<script setup lang="ts">
import productOne from '../../../../product-materials/prototype/assets/product-1.png';
import productTwo from '../../../../product-materials/prototype/assets/product-2.png';
import productSix from '../../../../product-materials/prototype/assets/product-6.png';

defineProps<{
  eyebrow: string;
  subtitle: string;
  title: string;
}>();
</script>

<template>
  <main class="auth-shell">
    <section class="auth-brand" aria-label="青序伙伴品牌">
      <div class="auth-brand-copy">
        <div class="wordmark light">
          <span class="wordmark-symbol" aria-hidden="true">青</span>
          <span><strong>青序伙伴</strong><small>一级代理工作台</small></span>
        </div>
        <div class="auth-message">
          <p>QINGXU PARTNER</p>
          <h2>分享好产品，<br>经营长期价值。</h2>
          <span>商品、收款、发货与售后由青序生活统一负责。</span>
        </div>
        <div class="auth-products" aria-label="青序生活商品陈列">
          <img :src="productTwo" alt="青序洗护商品">
          <img :src="productOne" alt="青序洁面商品">
          <img :src="productSix" alt="青序沐浴商品">
        </div>
        <small class="auth-foot">QINGXU SUPPLY · PARTNER WORKBENCH</small>
      </div>
    </section>
    <section class="auth-form-panel">
      <div class="auth-card">
        <div class="wordmark mobile-wordmark">
          <span class="wordmark-symbol" aria-hidden="true">青</span>
          <span><strong>青序伙伴</strong><small>一级代理工作台</small></span>
        </div>
        <h1 class="auth-product-title">一级代理工作台</h1>
        <p class="auth-eyebrow">{{ eyebrow }}</p>
        <h2>{{ title }}</h2>
        <p class="auth-subtitle">{{ subtitle }}</p>
        <slot />
      </div>
    </section>
  </main>
</template>
