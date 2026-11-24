declare module "*?url" { const url: string; export default url; }
declare module "*?worker&url" { const url: string; export default url; }
interface ImportMeta { env: { MODE: string; PROD: boolean; DREAM_CORD_PROXY_URL?: string } }
declare module "*.css" {}
