<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import { useAccountStore } from '@/stores/account'
import { useToastStore } from '@/stores/toast'

const accountStore = useAccountStore()
const toast = useToastStore()
const { currentAccountId } = storeToRefs(accountStore)

const loading = ref(false)
const history = ref<any[]>([])
const clearing = ref(false)

// Chart dimensions
const chartWidth = 800
const chartHeight = 360
const padding = { top: 30, right: 30, bottom: 40, left: 70 }

// Tooltip state
const activeIndex = ref<number | null>(null)
const tooltipX = ref(0)
const tooltipY = ref(0)
const svgRef = ref<SVGElement | null>(null)

// Load asset history from backend
async function loadHistory() {
  if (!currentAccountId.value)
    return
  loading.value = true
  try {
    const res = await api.get('/api/assets/history', {
      headers: { 'x-account-id': currentAccountId.value },
    })
    if (res.data && res.data.ok) {
      history.value = res.data.data || []
    }
  }
  catch (e) {
    console.error(e)
    toast.error('加载资产历史失败')
  }
  finally {
    loading.value = false
  }
}

// Clear asset history
async function handleClearHistory() {
  if (!currentAccountId.value || clearing.value)
    return
  
  if (!confirm('确定要清空资产历史吗？清空后将无法恢复（如果清空，刷新后将重新生成测试用的 Mock 假数据）。'))
    return

  clearing.value = true
  try {
    const res = await api.delete('/api/assets/history', {
      headers: { 'x-account-id': currentAccountId.value },
    })
    if (res.data && res.data.ok) {
      toast.success('资产历史已清空')
      history.value = []
      await loadHistory() // This will re-generate mock data, which is perfect for testing!
    }
  }
  catch (e) {
    console.error(e)
    toast.error('清空资产历史失败')
  }
  finally {
    clearing.value = false
  }
}

onMounted(() => {
  loadHistory()
})

watch(currentAccountId, () => {
  loadHistory()
})

// Metrics
const currentGold = computed(() => {
  if (!history.value.length) return 0
  return history.value[history.value.length - 1].gold
})

const currentFruitValue = computed(() => {
  if (!history.value.length) return 0
  return history.value[history.value.length - 1].fruitValue
})

const currentTotalAssets = computed(() => {
  if (!history.value.length) return 0
  return history.value[history.value.length - 1].totalAssets
})

const historicalEarned = computed(() => {
  if (!history.value.length) return 0
  return history.value[history.value.length - 1].historicalEarned
})

// Calculate growth over past 24 hours
const growth24h = computed(() => {
  if (history.value.length < 2) return 0
  const now = Date.now()
  const oneDayAgo = now - 24 * 60 * 60 * 1000
  // Find point closest to 24h ago
  let prevPoint = history.value[0]
  for (const point of history.value) {
    if (point.timestamp >= oneDayAgo) {
      prevPoint = point
      break
    }
  }
  return currentTotalAssets.value - prevPoint.totalAssets
})

// Chart math bounds
const minTime = computed(() => {
  if (!history.value.length) return 0
  return Math.min(...history.value.map(d => d.timestamp))
})

const maxTime = computed(() => {
  if (!history.value.length) return 0
  return Math.max(...history.value.map(d => d.timestamp))
})

const maxAssetVal = computed(() => {
  if (!history.value.length) return 10000
  const maxAssets = Math.max(...history.value.map(d => d.totalAssets))
  const maxEarned = Math.max(...history.value.map(d => d.historicalEarned))
  return Math.max(maxAssets, maxEarned) * 1.15 // Add 15% padding
})

const minAssetVal = computed(() => {
  if (!history.value.length) return 0
  const minVal = Math.min(...history.value.map(d => Math.min(d.totalAssets, d.gold)))
  return Math.max(0, minVal * 0.8) // Deduct 20% but cap at 0
})

// Generate SVG drawing coordinates and paths
const points = computed(() => {
  if (history.value.length === 0) return []

  const timeRange = maxTime.value - minTime.value || 1
  const assetRange = maxAssetVal.value - minAssetVal.value || 1

  // Downsample to max 500 points for chart performance
  let displayHistory = history.value
  const maxPoints = 500
  if (history.value.length > maxPoints) {
    const sampled = new Set<any>()
    
    // Always include first and last
    sampled.add(history.value[0])
    sampled.add(history.value[history.value.length - 1])
    
    // Always include important events
    for (const item of history.value) {
      if (item.reason && item.reason !== '定时记录') {
        sampled.add(item)
      }
    }
    
    // Add evenly sampled points
    const step = (history.value.length - 1) / (maxPoints - 1)
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.round(i * step)
      if (history.value[idx]) {
        sampled.add(history.value[idx])
      }
    }
    
    displayHistory = Array.from(sampled).sort((a: any, b: any) => a.timestamp - b.timestamp)
  }

  return displayHistory.map((item, index) => {
    const x = padding.left + ((item.timestamp - minTime.value) / timeRange) * (chartWidth - padding.left - padding.right)
    const yAssets = chartHeight - padding.bottom - ((item.totalAssets - minAssetVal.value) / assetRange) * (chartHeight - padding.top - padding.bottom)
    const yEarned = chartHeight - padding.bottom - ((item.historicalEarned - minAssetVal.value) / assetRange) * (chartHeight - padding.top - padding.bottom)

    return {
      x,
      yAssets,
      yEarned,
      raw: item,
      index,
    }
  })
})

const assetsPath = computed(() => {
  if (points.value.length < 2) return ''
  return 'M ' + points.value.map(p => `${p.x} ${p.yAssets}`).join(' L ')
})

const assetsAreaPath = computed(() => {
  if (points.value.length < 2) return ''
  const first = points.value[0]
  const last = points.value[points.value.length - 1]
  if (!first || !last) return ''
  const bottomY = chartHeight - padding.bottom
  return `M ${first.x} ${bottomY} L ` + points.value.map(p => `${p.x} ${p.yAssets}`).join(' L ') + ` L ${last.x} ${bottomY} Z`
})

const earnedPath = computed(() => {
  if (points.value.length < 2) return ''
  return 'M ' + points.value.map(p => `${p.x} ${p.yEarned}`).join(' L ')
})

const earnedAreaPath = computed(() => {
  if (points.value.length < 2) return ''
  const first = points.value[0]
  const last = points.value[points.value.length - 1]
  if (!first || !last) return ''
  const bottomY = chartHeight - padding.bottom
  return `M ${first.x} ${bottomY} L ` + points.value.map(p => `${p.x} ${p.yEarned}`).join(' L ') + ` L ${last.x} ${bottomY} Z`
})

// Axis grid lines
const yGridLines = computed(() => {
  const lines = []
  const steps = 4
  const valRange = maxAssetVal.value - minAssetVal.value
  const yRange = chartHeight - padding.top - padding.bottom

  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps
    const value = minAssetVal.value + ratio * valRange
    const y = chartHeight - padding.bottom - ratio * yRange
    lines.push({ y, value })
  }
  return lines
})

const xGridLines = computed(() => {
  if (history.value.length < 2) return []
  const lines = []
  const steps = 5
  const timeRange = maxTime.value - minTime.value
  const xRange = chartWidth - padding.left - padding.right

  for (let i = 0; i <= steps; i++) {
    const ratio = i / steps
    const time = minTime.value + ratio * timeRange
    const x = padding.left + ratio * xRange
    lines.push({ x, time })
  }
  return lines
})

// Highlight points that are interesting (like upgrading lands)
const eventMarkers = computed(() => {
  return points.value.filter(p => p.raw.reason && p.raw.reason !== '定时记录')
})

// Interactive mouse tracking
function handleMouseMove(e: MouseEvent) {
  if (!svgRef.value || points.value.length === 0) return

  const rect = svgRef.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  // Scale HTML mouse position to SVG coordinate space
  const svgX = (mouseX / rect.width) * chartWidth

  // Find closest point by X coordinate
  let closestPoint = points.value[0]
  if (!closestPoint) return
  let minDiff = Math.abs(closestPoint.x - svgX)

  for (const p of points.value) {
    const diff = Math.abs(p.x - svgX)
    if (diff < minDiff) {
      closestPoint = p
      minDiff = diff
    }
  }

  activeIndex.value = closestPoint.index
  tooltipX.value = closestPoint.x
  tooltipY.value = Math.min(closestPoint.yAssets, closestPoint.yEarned) - 10
}

function handleMouseLeave() {
  activeIndex.value = null
}

const activePoint = computed(() => {
  if (activeIndex.value === null) return null
  return points.value[activeIndex.value] || null
})

// Helpers
function formatMoney(num: number) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M'
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'k'
  }
  return num.toString()
}

function formatDate(ts: number) {
  const d = new Date(ts)
  return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function getEventColor(reason: string) {
  if (reason === '升级土地') return 'bg-red-500 text-white'
  if (reason === '出售果实') return 'bg-emerald-500 text-white'
  if (reason === '收获作物') return 'bg-blue-500 text-white'
  if (reason === '初始化') return 'bg-purple-500 text-white'
  return 'bg-gray-500 text-white'
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex items-center gap-3">
        <div class="i-carbon-chart-multitype text-2xl text-blue-500" />
        <div>
          <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">
            资产总值上升趋势
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            追踪目前拥有的实际资产（金币+果实价值）与历史总赚取的资产走向。
          </p>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <BaseButton variant="secondary" size="sm" @click="loadHistory" :loading="loading">
          <div class="i-carbon-renew mr-1.5" />
          <span>刷新数据</span>
        </BaseButton>
        <BaseButton variant="danger" size="sm" @click="handleClearHistory" :loading="clearing">
          <div class="i-carbon-trash-can mr-1.5" />
          <span>清空记录</span>
        </BaseButton>
      </div>
    </div>

    <!-- No Account Selected -->
    <div v-if="!currentAccountId" class="rounded-lg bg-white p-8 text-center text-gray-500 shadow dark:bg-gray-800">
      请选择账号后查看资产统计
    </div>

    <!-- Main Dashboard -->
    <div v-else class="space-y-6">
      <!-- Loading indicator -->
      <div v-if="loading && history.length === 0" class="flex justify-center py-12">
        <div class="i-svg-spinners-90-ring-with-bg text-4xl text-blue-500" />
      </div>

      <!-- Stats Cards -->
      <div v-else class="grid grid-cols-1 gap-4 lg:grid-cols-4 sm:grid-cols-2">
        <div class="relative overflow-hidden rounded-xl bg-white p-5 shadow-sm border border-gray-100 dark:border-gray-700/50 dark:bg-gray-800">
          <div class="flex items-center justify-between text-gray-400">
            <span class="text-sm font-medium">目前资产总值</span>
            <div class="i-carbon-wallet text-lg text-blue-500" />
          </div>
          <div class="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {{ formatMoney(currentTotalAssets) }}
          </div>
          <div class="mt-1 text-xs text-gray-400">
            金币 + 仓库未卖果实价值
          </div>
        </div>

        <div class="relative overflow-hidden rounded-xl bg-white p-5 shadow-sm border border-gray-100 dark:border-gray-700/50 dark:bg-gray-800">
          <div class="flex items-center justify-between text-gray-400">
            <span class="text-sm font-medium">历史总赚取</span>
            <div class="i-carbon-growth text-lg text-emerald-500" />
          </div>
          <div class="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {{ formatMoney(historicalEarned) }}
          </div>
          <div class="mt-1 text-xs text-gray-400">
            累计赚取总额（排除土地升级等开销）
          </div>
        </div>

        <div class="relative overflow-hidden rounded-xl bg-white p-5 shadow-sm border border-gray-100 dark:border-gray-700/50 dark:bg-gray-800">
          <div class="flex items-center justify-between text-gray-400">
            <span class="text-sm font-medium">账户持有现金 (金币)</span>
            <div class="i-carbon-currency text-lg text-amber-500" />
          </div>
          <div class="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {{ formatMoney(currentGold) }}
          </div>
          <div class="mt-1 text-xs text-gray-400">
            仓库未变现果实价值: {{ formatMoney(currentFruitValue) }}
          </div>
        </div>

        <div class="relative overflow-hidden rounded-xl bg-white p-5 shadow-sm border border-gray-100 dark:border-gray-700/50 dark:bg-gray-800">
          <div class="flex items-center justify-between text-gray-400">
            <span class="text-sm font-medium">24小时资产增长</span>
            <div class="i-carbon-chart-line text-lg" :class="growth24h >= 0 ? 'text-green-500' : 'text-red-500'" />
          </div>
          <div class="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100" :class="growth24h >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'">
            {{ growth24h >= 0 ? '+' : '' }}{{ formatMoney(growth24h) }}
          </div>
          <div class="mt-1 text-xs text-gray-400">
            相比24小时前的资产总值变动
          </div>
        </div>
      </div>

      <!-- Trend Chart Card -->
      <div v-if="history.length > 0" class="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-gray-700/50 dark:bg-gray-800">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">
            资产走势图
          </h3>
          <div class="flex items-center gap-4 text-xs">
            <div class="flex items-center gap-1.5">
              <span class="h-3 w-3 rounded-full bg-blue-500" />
              <span class="text-gray-500 dark:text-gray-400">目前资产总值</span>
            </div>
            <div class="flex items-center gap-1.5">
              <span class="h-3 w-3 rounded-full bg-emerald-500" />
              <span class="text-gray-500 dark:text-gray-400">历史总赚取</span>
            </div>
          </div>
        </div>

        <!-- SVG chart container with relative positioning for HTML tooltip -->
        <div class="relative w-full">
          <svg
            ref="svgRef"
            :viewBox="`0 0 ${chartWidth} ${chartHeight}`"
            class="w-full h-auto overflow-visible select-none"
            @mousemove="handleMouseMove"
            @mouseleave="handleMouseLeave"
          >
            <defs>
              <!-- Gradient fill for Assets area -->
              <linearGradient id="assetsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.2" />
                <stop offset="100%" stop-color="#3b82f6" stop-opacity="0.0" />
              </linearGradient>
              <!-- Gradient fill for Historical Earned area -->
              <linearGradient id="earnedGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#10b981" stop-opacity="0.15" />
                <stop offset="100%" stop-color="#10b981" stop-opacity="0.0" />
              </linearGradient>
            </defs>

            <!-- Horizontal Grid lines & labels -->
            <g class="text-gray-300 dark:text-gray-700">
              <line
                v-for="line in yGridLines"
                :key="line.y"
                :x1="padding.left"
                :y1="line.y"
                :x2="chartWidth - padding.right"
                :y2="line.y"
                stroke="currentColor"
                stroke-dasharray="3 3"
              />
              <text
                v-for="line in yGridLines"
                :key="'lbl' + line.y"
                :x="padding.left - 10"
                :y="line.y + 4"
                text-anchor="end"
                class="fill-gray-400 text-[10px] font-mono"
              >
                {{ formatMoney(line.value) }}
              </text>
            </g>

            <!-- Vertical Grid lines & labels -->
            <g class="text-gray-200 dark:text-gray-700">
              <line
                v-for="line in xGridLines"
                :key="line.x"
                :x1="line.x"
                :y1="padding.top"
                :x2="line.x"
                :y2="chartHeight - padding.bottom"
                stroke="currentColor"
                stroke-dasharray="2 4"
              />
              <text
                v-for="line in xGridLines"
                :key="'lbl' + line.x"
                :x="line.x"
                :y="chartHeight - padding.bottom + 20"
                text-anchor="middle"
                class="fill-gray-400 text-[10px] font-mono"
              >
                {{ formatDate(line.time).split(' ')[0] }}
              </text>
            </g>

            <!-- Chart Areas (Fill) -->
            <path :d="earnedAreaPath" fill="url(#earnedGrad)" />
            <path :d="assetsAreaPath" fill="url(#assetsGrad)" />

            <!-- Chart Lines -->
            <path :d="earnedPath" stroke="#10b981" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />
            <path :d="assetsPath" stroke="#3b82f6" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" />

            <!-- Event Highlight markers -->
            <g>
              <g v-for="marker in eventMarkers" :key="'marker-' + marker.raw.timestamp">
                <!-- Dashed vertical indicator line -->
                <line
                  :x1="marker.x"
                  :y1="padding.top"
                  :x2="marker.x"
                  :y2="chartHeight - padding.bottom"
                  stroke="#ef4444"
                  stroke-opacity="0.3"
                  stroke-dasharray="2 2"
                />
                <!-- Dot marker on assets line -->
                <circle
                  :cx="marker.x"
                  :cy="marker.yAssets"
                  r="4"
                  :fill="marker.raw.reason === '升级土地' ? '#ef4444' : '#10b981'"
                  stroke="#ffffff"
                  stroke-width="1.5"
                  class="cursor-pointer"
                />
              </g>
            </g>

            <!-- Hover indicator lines and dots -->
            <g v-if="activePoint">
              <line
                :x1="tooltipX"
                :y1="padding.top"
                :x2="tooltipX"
                :y2="chartHeight - padding.bottom"
                stroke="currentColor"
                class="text-gray-400 dark:text-gray-500"
                stroke-width="1"
              />
              <circle
                :cx="tooltipX"
                :cy="activePoint.yAssets"
                r="6"
                fill="#3b82f6"
                stroke="#ffffff"
                stroke-width="2"
              />
              <circle
                :cx="tooltipX"
                :cy="activePoint.yEarned"
                r="6"
                fill="#10b981"
                stroke="#ffffff"
                stroke-width="2"
              />
            </g>
          </svg>

          <!-- Floating HTML Tooltip -->
          <div
            v-if="activePoint"
            class="absolute pointer-events-none rounded-xl bg-white/95 p-3 shadow-xl border border-gray-100 text-xs dark:bg-gray-900/95 dark:border-gray-800 text-left z-20"
            :style="{
              left: `${(tooltipX / chartWidth) * 100}%`,
              top: `${(activePoint.yAssets / chartHeight) * 100 - 35}%`,
              transform: 'translate(-50%, -100%)',
              minWidth: '180px'
            }"
          >
            <div class="mb-1.5 flex items-center justify-between border-b border-gray-100 pb-1.5 dark:border-gray-800">
              <span class="font-bold text-gray-500 dark:text-gray-400">{{ formatDate(activePoint.raw.timestamp) }}</span>
              <span
                class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                :class="getEventColor(activePoint.raw.reason)"
              >
                {{ activePoint.raw.reason }}
              </span>
            </div>
            <div class="space-y-1">
              <div class="flex justify-between">
                <span class="text-gray-400">目前资产总值:</span>
                <span class="font-bold text-blue-500 font-mono">{{ activePoint.raw.totalAssets.toLocaleString() }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">历史累计赚取:</span>
                <span class="font-bold text-emerald-500 font-mono">{{ activePoint.raw.historicalEarned.toLocaleString() }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">其中持有金币:</span>
                <span class="font-bold text-amber-500 font-mono">{{ activePoint.raw.gold.toLocaleString() }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-gray-400">其中果实估值:</span>
                <span class="font-bold text-purple-500 font-mono">{{ activePoint.raw.fruitValue.toLocaleString() }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Historical Logs Table -->
      <div v-if="history.length > 0" class="rounded-xl border border-gray-100 bg-white shadow-sm dark:border-gray-700/50 dark:bg-gray-800 overflow-hidden">
        <div class="bg-gray-50 px-6 py-4 dark:bg-gray-700/30 border-b border-gray-100 dark:border-gray-700">
          <h3 class="text-base font-bold text-gray-900 dark:text-gray-100">
            资产变动详情志
          </h3>
        </div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm whitespace-nowrap">
            <thead class="bg-gray-50/50 text-xs text-gray-500 uppercase dark:bg-gray-700/10 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
              <tr>
                <th class="px-6 py-3 font-medium">变动时间</th>
                <th class="px-6 py-3 font-medium">资产总值</th>
                <th class="px-6 py-3 font-medium">持有金币</th>
                <th class="px-6 py-3 font-medium">果实价格</th>
                <th class="px-6 py-3 font-medium">历史总赚取</th>
                <th class="px-6 py-3 font-medium">记录事件</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
              <tr
                v-for="item in [...history].reverse().slice(0, 30)"
                :key="item.timestamp"
                class="hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors"
              >
                <td class="px-6 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">
                  {{ formatDate(item.timestamp) }}
                </td>
                <td class="px-6 py-3 font-bold text-blue-500 font-mono">
                  {{ item.totalAssets.toLocaleString() }}
                </td>
                <td class="px-6 py-3 font-medium text-amber-500 font-mono">
                  {{ item.gold.toLocaleString() }}
                </td>
                <td class="px-6 py-3 font-medium text-purple-500 font-mono">
                  {{ item.fruitValue.toLocaleString() }}
                </td>
                <td class="px-6 py-3 font-bold text-emerald-500 font-mono">
                  {{ item.historicalEarned.toLocaleString() }}
                </td>
                <td class="px-6 py-3">
                  <span
                    class="rounded-full px-2.5 py-0.5 text-xs font-bold"
                    :class="getEventColor(item.reason)"
                  >
                    {{ item.reason }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-if="history.length > 30" class="bg-gray-50/50 px-6 py-3 text-center text-xs text-gray-500 dark:bg-gray-700/10 dark:text-gray-400">
          仅展示最近 30 条记录 · 共有 {{ history.length }} 条记录已缓存在本地
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Interactive styles */
circle {
  transition: r 0.15s ease-in-out;
}
circle:hover {
  r: 8;
}
</style>
