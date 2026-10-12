/** Base URL of the FlowSync API (baked in at build time). */
export const API_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
