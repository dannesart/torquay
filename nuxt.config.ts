export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  // Purely client-side app: no server rendering, no backend.
  ssr: false,
  devtools: { enabled: false },
  css: ['maplibre-gl/dist/maplibre-gl.css', '~/assets/main.css'],
  app: {
    head: {
      title: 'MapMarks',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
    },
  },
  runtimeConfig: {
    public: {
      // Set via NUXT_PUBLIC_MAPTILER_KEY. This is a public browser key, not a secret.
      maptilerKey: '',
    },
  },
})
