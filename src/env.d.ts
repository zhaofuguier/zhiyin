interface ImportMetaEnv {
  readonly VITE_APP_MODE?: string;
  readonly VITE_API_BASE_URL?: string;
  readonly DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
