export const CRMStore = {
  session: {
    user: null,
    empresaId: null,
    permissions: []
  },
  ui: {
    currentPage: "dashboard",
    theme: "dark",
    sidebarOpen: false,
    loading: false
  },
  data: {
    customers: [],
    orders: [],
    tasks: [],
    products: [],
    cities: [],
    production: [],
    alerts: []
  },
  intelligence: {
    customerScores: [],
    opportunities: [],
    dailyActions: [],
    forecast: {},
    segments: {}
  },
  integrations: {
    supabase: { connected: false },
    bling: { connected: false },
    shopify: { connected: false }
  }
};
