<script setup lang="ts">
import type { Mode } from './MapView.vue'
import { MAP_STYLES, type MapStyleId } from '~/utils/mapStyles'

export interface Status {
  text: string
  kind: 'info' | 'warn' | 'error'
}

defineProps<{
  count: number
  areaCount: number
  saveError: string | null
  imageryError: string | null
  hasKey: boolean
  status: Status | null
}>()
const emit = defineEmits<{ export: []; import: [file: File]; dismissStatus: [] }>()
const mode = defineModel<Mode>('mode', { required: true })
const mapStyle = defineModel<MapStyleId>('mapStyle', { required: true })

const fileInput = ref<HTMLInputElement>()
function onFileChosen() {
  const file = fileInput.value?.files?.[0]
  if (file) emit('import', file)
  fileInput.value!.value = '' // allow choosing the same file again
}

const modes: { value: Mode; label: string; title: string }[] = [
  { value: 'navigate', label: '✋', title: 'Navigate · click an area to select it, then drag its corners to edit' },
  { value: 'red-x', label: '✕', title: 'Red X: click to mark' },
  {
    value: 'polygon',
    label: '⬠',
    title: 'Exclusion area: click to add corners · double-click or Enter to finish · Backspace removes the last corner · Esc cancels',
  },
  { value: 'eraser', label: '⌫', title: 'Eraser: click a mark or area to remove it (Esc to stop)' },
]
</script>

<template>
  <div class="toolbar-wrap">
    <div class="toolbar">
      <button
        v-for="m in modes"
        :key="m.value"
        :class="['mode', m.value, { active: mode === m.value }]"
        :title="m.title"
        :aria-pressed="mode === m.value"
        @click="mode = m.value"
      >
        {{ m.label }}
      </button>
      <span class="count" title="Marks · excluded areas — Eraser or right-click removes · Ctrl+Z undo · Ctrl+Shift+Z redo · Esc navigate">
        {{ count }}<template v-if="areaCount"> · ⬠{{ areaCount }}</template>
      </span>
      <span class="divider" />
      <button
        v-for="s in MAP_STYLES"
        :key="s.id"
        :class="['style', { active: mapStyle === s.id }]"
        :aria-pressed="mapStyle === s.id"
        :disabled="s.imagery && !hasKey"
        :title="s.imagery && !hasKey ? 'Satellite imagery needs NUXT_PUBLIC_MAPTILER_KEY (see README)' : `${s.label} map`"
        @click="mapStyle = s.id"
      >
        {{ s.label }}
      </button>
      <span class="divider" />
      <button class="file" title="Export all marks as GeoJSON" @click="emit('export')">⤓</button>
      <button class="file" title="Import marks from a MapMarks GeoJSON file" @click="fileInput?.click()">⤒</button>
      <input
        ref="fileInput"
        type="file"
        accept=".geojson,.json,application/geo+json,application/json"
        hidden
        @change="onFileChosen"
      >
      <span v-if="saveError" class="error" :title="saveError">Not saved!</span>
    </div>
    <div v-if="status" :class="['notice', 'status', status.kind]" role="status">
      {{ status.text }}
      <button class="dismiss" title="Dismiss" @click="emit('dismissStatus')">×</button>
    </div>
    <div v-if="imageryError" class="notice" role="alert">
      Satellite imagery unavailable: {{ imageryError }}
      <button @click="mapStyle = 'street'">Use Street</button>
    </div>
  </div>
</template>

<style scoped>
.toolbar-wrap {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  max-width: calc(100vw - 20px);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px;
  background: rgba(255, 255, 255, 0.92);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  user-select: none;
}
button {
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}
button:hover:not(:disabled) {
  background: #eee;
}
.mode {
  width: 32px;
  height: 32px;
  font-size: 16px;
}
.mode.active,
.style.active {
  background: #333;
  color: #fff;
}
.mode.red-x {
  color: #e00000;
  font-weight: bold;
}
.mode.red-x.active {
  background: #e00000;
  color: #fff;
}
.style {
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
}
.style:disabled {
  color: #aaa;
  cursor: not-allowed;
}
.divider {
  width: 1px;
  height: 20px;
  background: #ccc;
  margin: 0 2px;
}
.count {
  min-width: 20px;
  padding: 0 6px;
  font-size: 13px;
  color: #555;
  text-align: center;
  cursor: help;
}
.error {
  padding: 0 6px;
  font-size: 13px;
  color: #c00;
  font-weight: 600;
}
.notice {
  padding: 4px 6px 4px 10px;
  border-radius: 6px;
  background: rgba(255, 244, 229, 0.95);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
  color: #7a3d00;
  font-size: 12px;
}
.notice button {
  margin-left: 6px;
  padding: 2px 8px;
  background: #7a3d00;
  color: #fff;
  font-size: 12px;
}
.notice button:hover {
  background: #5c2e00;
}
.file {
  width: 28px;
  height: 28px;
  font-size: 15px;
}
.status.info {
  background: rgba(255, 255, 255, 0.95);
  color: #222;
}
.status.error {
  background: rgba(255, 235, 235, 0.97);
  color: #a00;
}
.notice .dismiss {
  padding: 0 6px;
  background: transparent;
  color: inherit;
  font-size: 14px;
}
.notice .dismiss:hover {
  background: rgba(0, 0, 0, 0.08);
}
</style>
